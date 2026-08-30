import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { containsQuote, normalizeForMatch } from '../knowledge/text.ts'
import type { Extraction, Proposal, Target } from './extract.ts'

export const UNRESOLVED_THRESHOLD = 0.5

export type Disposition = 'add' | 'update' | 'conflict' | 'duplicate' | 'unresolved' | 'rejected'

export type FieldChange = { field: string; from: unknown; to: unknown }

export type PlanItem = {
  proposal: Proposal
  disposition: Disposition
  file: string
  existingId: string | null
  /**
   * Position of the matched entity in its file. Not every entity has an `id`
   * (metrics are keyed by name), so the index is what apply uses to write back —
   * matching there by id silently appended duplicates instead of updating.
   */
  existingIndex: number | null
  changes: FieldChange[]
  reason: string
}

export type MergePlan = {
  sourceId: string
  sourceType: string
  summary: string
  items: PlanItem[]
}

const FILES: Record<Target, string> = {
  company: 'company.yaml',
  founder: 'founder.yaml',
  goal: 'goals.yaml',
  metric: 'metrics.yaml',
  person: 'people.yaml',
  feedback: 'feedback.yaml',
  experiment: 'experiments.yaml',
  meeting: 'meetings.yaml',
  decision: 'decisions/',
}

const SINGLETONS: Target[] = ['company', 'founder']

export function fileFor(target: Target): string {
  return FILES[target]
}

export function isSingleton(target: Target): boolean {
  return SINGLETONS.includes(target)
}

/**
 * The deterministic dedup key. An id always wins; otherwise each entity has one
 * natural identity field, because that is what a founder would recognize as "the
 * same thing" — two feedback items with the same verbatim are one item however
 * they were phrased around it.
 */
const IDENTITY: Record<Target, (fields: Record<string, unknown>) => string | null> = {
  company: () => 'company',
  founder: () => 'founder',
  goal: (f) => text(f.statement),
  metric: (f) => text(f.name),
  person: (f) => text(f.name),
  feedback: (f) => text(f.verbatim),
  experiment: (f) => text(f.hypothesis),
  meeting: (f) => text(f.purpose) && `${String(f.date ?? '')}|${text(f.purpose)}`,
  decision: (f) => text(f.question),
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? normalizeForMatch(value).toLowerCase() : null
}

function identityOf(target: Target, fields: Record<string, unknown>): string | null {
  return IDENTITY[target](fields)
}

function readEntities(root: string, target: Target): Record<string, unknown>[] {
  const file = FILES[target]
  if (file.endsWith('/')) return readDecisions(root)
  const path = join(root, file)
  if (!existsSync(path)) return []
  const parsed = parseYaml(readFileSync(path, 'utf8')) as unknown
  if (isSingleton(target)) {
    return parsed && typeof parsed === 'object' ? [parsed as Record<string, unknown>] : []
  }
  return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : []
}

function readDecisions(root: string): Record<string, unknown>[] {
  const dir = join(root, 'decisions')
  if (!existsSync(dir)) return []
  // Frontmatter only — the body is prose and never participates in identity.
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const raw = readFileSync(join(dir, f), 'utf8')
      const match = raw.match(/^---\n([\s\S]*?)\n---/)
      return match ? ((parseYaml(match[1]!) ?? {}) as Record<string, unknown>) : {}
    })
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

function differs(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') {
    return normalizeForMatch(a).toLowerCase() !== normalizeForMatch(b).toLowerCase()
  }
  return JSON.stringify(a) !== JSON.stringify(b)
}

/**
 * Builds the merge plan. Everything here is pure and deterministic: the same
 * extraction against the same workspace always produces the same plan, which is
 * what makes ingestion testable without a model.
 */
export function buildPlan(input: {
  root: string
  sourceText: string
  extraction: Extraction
  sourceId: string
}): MergePlan {
  const items: PlanItem[] = []
  const seenThisRun = new Map<string, string>()

  for (const proposal of input.extraction.proposals) {
    const target = proposal.target
    const file = FILES[target]
    const fields = proposal.fields

    // The extractor's quote must exist in the input. This is the ingestion-side
    // equivalent of the knowledge base's quote gate: it catches an extractor that
    // has started summarizing instead of citing.
    if (!containsQuote(input.sourceText, proposal.quote)) {
      items.push({
        proposal,
        disposition: 'rejected',
        file,
        existingId: null,
        existingIndex: null,
        changes: [],
        reason: 'quote not found in the source text — the extractor invented or paraphrased it',
      })
      continue
    }

    if (proposal.confidence < UNRESOLVED_THRESHOLD) {
      items.push({
        proposal,
        disposition: 'unresolved',
        file,
        existingId: null,
        existingIndex: null,
        changes: [],
        reason: `confidence ${proposal.confidence.toFixed(2)} is below ${UNRESOLVED_THRESHOLD}`,
      })
      continue
    }

    const existing = readEntities(input.root, target)
    const proposedId = typeof fields.id === 'string' ? fields.id : null
    const identity = identityOf(target, fields)

    let matchIndex = proposedId ? existing.findIndex((e) => e.id === proposedId) : -1
    if (matchIndex === -1 && identity) {
      matchIndex = existing.findIndex((e) => identityOf(target, e) === identity)
    }
    const match = matchIndex === -1 ? undefined : existing[matchIndex]

    if (!match) {
      const key = `${target}:${identity ?? proposedId ?? JSON.stringify(fields)}`
      const firstSeen = seenThisRun.get(key)
      if (firstSeen) {
        items.push({
          proposal,
          disposition: 'duplicate',
          file,
          existingId: null,
          existingIndex: null,
          changes: [],
          reason: `same as an earlier item in this document (${firstSeen})`,
        })
        continue
      }
      seenThisRun.set(key, proposal.quote.slice(0, 40))
      items.push({
        proposal,
        disposition: 'add',
        file,
        existingId: null,
        existingIndex: null,
        changes: [],
        reason: 'no existing entity matches',
      })
      continue
    }

    const changes: FieldChange[] = []
    const additions: FieldChange[] = []
    for (const [field, to] of Object.entries(fields)) {
      if (field === 'id' || isEmpty(to)) continue
      const from = match[field]
      if (isEmpty(from)) additions.push({ field, from: null, to })
      else if (differs(from, to)) changes.push({ field, from, to })
    }

    const existingId = typeof match.id === 'string' ? match.id : identity
    if (changes.length === 0 && additions.length === 0) {
      items.push({
        proposal,
        disposition: 'duplicate',
        file,
        existingId,
        existingIndex: matchIndex,
        changes: [],
        reason: 'already recorded, nothing new',
      })
      continue
    }

    items.push({
      proposal,
      // Filling an empty field is safe. Replacing a value the founder already
      // wrote is not, and needs its own approval.
      disposition: changes.length > 0 ? 'conflict' : 'update',
      file,
      existingId,
      existingIndex: matchIndex,
      changes: [...changes, ...additions],
      reason:
        changes.length > 0
          ? `${changes.length} existing value(s) would change`
          : `${additions.length} empty field(s) would be filled`,
    })
  }

  return {
    sourceId: input.sourceId,
    sourceType: input.extraction.source_type,
    summary: input.extraction.summary,
    items,
  }
}

export function countBy(plan: MergePlan): Record<Disposition, number> {
  const counts: Record<Disposition, number> = {
    add: 0,
    update: 0,
    conflict: 0,
    duplicate: 0,
    unresolved: 0,
    rejected: 0,
  }
  for (const item of plan.items) counts[item.disposition]++
  return counts
}
