import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { isSeq, parse as parseYaml, parseDocument, stringify as stringifyYaml, YAMLSeq } from 'yaml'
import type { Target } from './extract.ts'
import { fileFor, isSingleton, type MergePlan, type PlanItem } from './plan.ts'

export const UNRESOLVED_FILE = 'unresolved.yaml'

export type Provenance = {
  source: string
  source_type: string
  imported_at: string
  quote: string
}

export type ApplyOptions = {
  /** Conflicts replace a value the founder wrote, so they need their own approval. */
  overwrite?: boolean
  now?: Date
}

export type ApplyReport = {
  added: number
  updated: number
  skippedConflicts: number
  unresolved: number
  files: string[]
}

function today(now: Date): string {
  return now.toISOString().slice(0, 10)
}

function provenanceFor(plan: MergePlan, item: PlanItem, now: Date): Provenance {
  return {
    source: plan.sourceId,
    source_type: plan.sourceType,
    imported_at: today(now),
    quote: item.proposal.quote,
  }
}

/**
 * Appends to a YAML sequence through the document API rather than
 * parse-modify-stringify, so the comments in a scaffolded workspace survive the
 * founder's first ingest.
 */
function appendToSeq(path: string, entry: Record<string, unknown>): void {
  if (!existsSync(path)) {
    writeFileSync(path, stringifyYaml([entry]))
    return
  }
  const doc = parseDocument(readFileSync(path, 'utf8'))
  if (doc.contents === null || !isSeq(doc.contents)) {
    const existing = (doc.toJS() as unknown[] | null) ?? []
    writeFileSync(path, stringifyYaml([...existing, entry]))
    return
  }
  ;(doc.contents as YAMLSeq).add(doc.createNode(entry))
  writeFileSync(path, String(doc))
}

function updateInSeq(
  path: string,
  index: number | null,
  fields: Record<string, unknown>,
  provenance: Provenance,
): boolean {
  if (!existsSync(path) || index === null || index < 0) return false
  const doc = parseDocument(readFileSync(path, 'utf8'))
  const items = doc.toJS() as Record<string, unknown>[] | null
  if (!Array.isArray(items) || index >= items.length) return false

  for (const [field, value] of Object.entries(fields)) {
    if (field === 'id') continue
    doc.setIn([index, field], doc.createNode(value))
  }
  doc.setIn([index, 'provenance'], doc.createNode(provenance))
  writeFileSync(path, String(doc))
  return true
}

function updateSingleton(path: string, fields: Record<string, unknown>, provenance: Provenance): void {
  const doc = existsSync(path) ? parseDocument(readFileSync(path, 'utf8')) : parseDocument('{}')
  for (const [field, value] of Object.entries(fields)) {
    doc.setIn([field], doc.createNode(value))
  }
  doc.setIn(['provenance'], doc.createNode(provenance))
  writeFileSync(path, String(doc))
}

function writeDecision(root: string, fields: Record<string, unknown>, provenance: Provenance): string {
  const dir = join(root, 'decisions')
  mkdirSync(dir, { recursive: true })
  const date = typeof fields.date === 'string' ? fields.date : provenance.imported_at
  const slug = String(fields.question ?? 'decision')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  const path = join(dir, `${date}-${slug}.md`)
  const frontmatter = stringifyYaml({ ...fields, date, provenance }).trimEnd()
  writeFileSync(path, `---\n${frontmatter}\n---\n\nImported from ${provenance.source}.\n`)
  return path
}

type UnresolvedEntry = { target: string; provenance?: { quote?: string } }

function appendUnresolved(root: string, plan: MergePlan, items: PlanItem[], now: Date): number {
  if (items.length === 0) return 0
  const path = join(root, UNRESOLVED_FILE)

  // Re-ingesting a source must not pile up the same open question again.
  const existing = existsSync(path)
    ? ((parseYaml(readFileSync(path, 'utf8')) as UnresolvedEntry[] | null) ?? [])
    : []
  const seen = new Set(existing.map((e) => `${e.target}|${e.provenance?.quote ?? ''}`))

  let written = 0
  for (const item of items) {
    const provenance = provenanceFor(plan, item, now)
    if (seen.has(`${item.proposal.target}|${provenance.quote}`)) continue
    seen.add(`${item.proposal.target}|${provenance.quote}`)
    appendToSeq(path, {
      target: item.proposal.target,
      fields: item.proposal.fields,
      confidence: item.proposal.confidence,
      reason: item.reason,
      provenance,
    })
    written++
  }
  return written
}

/**
 * Writes an approved plan. Adds and empty-field updates are applied; conflicts are
 * only applied with `overwrite`, because they replace something the founder wrote
 * themselves. Low-confidence items are preserved in unresolved.yaml rather than
 * merged or discarded.
 */
export function applyPlan(root: string, plan: MergePlan, options: ApplyOptions = {}): ApplyReport {
  const now = options.now ?? new Date()
  const report: ApplyReport = {
    added: 0,
    updated: 0,
    skippedConflicts: 0,
    unresolved: 0,
    files: [],
  }
  const touched = new Set<string>()

  for (const item of plan.items) {
    const target: Target = item.proposal.target
    const provenance = provenanceFor(plan, item, now)
    const fields = { ...item.proposal.fields, provenance }
    const path = join(root, fileFor(target))

    if (item.disposition === 'conflict' && !options.overwrite) {
      report.skippedConflicts++
      continue
    }

    if (item.disposition === 'add') {
      if (target === 'decision') {
        touched.add(writeDecision(root, item.proposal.fields, provenance))
      } else if (isSingleton(target)) {
        updateSingleton(path, item.proposal.fields, provenance)
        touched.add(path)
      } else {
        appendToSeq(path, fields)
        touched.add(path)
      }
      report.added++
      continue
    }

    if (item.disposition === 'update' || item.disposition === 'conflict') {
      if (isSingleton(target)) {
        updateSingleton(path, item.proposal.fields, provenance)
      } else if (target === 'decision') {
        // Decisions are one file each and are never rewritten in place: an update
        // to a past decision is a review, which is the `learning` skill's job.
        report.skippedConflicts++
        continue
      } else if (!updateInSeq(path, item.existingIndex, item.proposal.fields, provenance)) {
        appendToSeq(path, fields)
      }
      touched.add(path)
      report.updated++
    }
  }

  const unresolved = plan.items.filter((i) => i.disposition === 'unresolved')
  report.unresolved = appendUnresolved(root, plan, unresolved, now)
  if (report.unresolved > 0) touched.add(join(root, UNRESOLVED_FILE))

  report.files = [...touched].sort()
  return report
}
