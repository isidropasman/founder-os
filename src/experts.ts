import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import { z } from 'zod'
import type { Citation } from './outputs.ts'

const EXPERTS_DIR = 'experts'

const FrontmatterSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.number().int().positive(),
  domains: z.array(z.string()).min(1),
  confidence: z.enum(['high', 'medium', 'low']),
  limitations: z.array(z.string()).default([]),
})

export type Principle = {
  id: string
  title: string
  claim: string
  source: string
  /** True only when Source carries a verbatim quote — this is what makes `kind: "quoted"` legal. */
  quoted: boolean
  /** `<author>/<slug>` into the ingested corpus. Required for a quoted principle. */
  sourceId: string | null
  /** The verbatim text, which `knowledge:verify` locates in the corpus or fails. */
  quote: string | null
  appliesWhen: string
  body: string
}

/** An ordered procedure attributed to an author, as distinct from an assertion. */
export type Framework = {
  id: string
  name: string
  steps: string[]
  whenToUse: string
  sourceId: string | null
}

export type Expert = {
  id: string
  name: string
  version: number
  domains: string[]
  confidence: 'high' | 'medium' | 'low'
  limitations: string[]
  principles: Principle[]
  frameworks: Framework[]
}

const PRINCIPLE_HEADING = /^###\s+(P\d+)\s+—\s+(.+)$/gm

// Only these labels terminate a field. A generic /^[A-Z][A-Za-z ]*:/ looks right
// and is not: "Every other startup mistake is a way of arriving at the same place:"
// matches it, and the field silently truncates to nothing.
const FIELD_LABELS = ['Claim', 'Source', 'Applies when', 'Conflicts with', 'Steps', 'When to use']
const FIELD_LINE = new RegExp(`^(?:${FIELD_LABELS.join('|')}):\\s`, 'm')

/** Fields are `Label: value`, may wrap over lines, and end at the next known label. */
function field(block: string, label: string): string | undefined {
  const start = block.match(new RegExp(`^${label}:\\s*`, 'm'))
  if (start?.index === undefined) return undefined
  const rest = block.slice(start.index + start[0].length)
  const next = rest.match(FIELD_LINE)
  return rest.slice(0, next?.index ?? rest.length).trim() || undefined
}

function parsePrinciples(expertId: string, body: string, path: string): Principle[] {
  const headings = [...body.matchAll(PRINCIPLE_HEADING)]
  const principles: Principle[] = []

  for (const [index, heading] of headings.entries()) {
    const start = heading.index + heading[0].length
    const end = headings[index + 1]?.index ?? body.length
    const block = body.slice(start, end).trim()
    const number = heading[1]
    const title = heading[2]
    if (!number || !title) continue

    const claim = field(block, 'Claim')
    const source = field(block, 'Source')
    if (!claim) throw new Error(`${path} ${number}: missing "Claim:".`)
    if (!source) {
      throw new Error(`${path} ${number}: missing "Source:". A principle without a source is not a principle.`)
    }
    if (!/—\s*(quoted:|paraphrase)/.test(source)) {
      throw new Error(
        `${path} ${number}: Source must end in '— quoted: "..."' or '— paraphrase'. Got: ${source}`,
      )
    }

    const quoted = /—\s*quoted:/.test(source)
    const sourceId = source.match(/^([a-z0-9-]+\/[a-z0-9-]+)\s*—/)?.[1] ?? null
    const quote = source.match(/quoted:\s*"([\s\S]+?)"\s*$/)?.[1]?.trim() ?? null

    // A quoted principle must be locatable. Without a corpus id and the text
    // itself there is nothing for knowledge:verify to check, and an unverifiable
    // quote is exactly the failure mode this whole subsystem exists to prevent.
    if (quoted && !sourceId) {
      throw new Error(
        `${path} ${number}: a quoted principle must start its Source with a corpus id, e.g. "paul-graham/growth — quoted: ...".`,
      )
    }
    if (quoted && !quote) {
      throw new Error(`${path} ${number}: quoted principle has no quote text in double quotes.`)
    }

    principles.push({
      id: `${expertId}/${number}`,
      title,
      claim,
      source,
      quoted,
      sourceId,
      quote,
      appliesWhen: field(block, 'Applies when') ?? 'Always',
      body: block,
    })
  }

  if (principles.length === 0) throw new Error(`${path}: no principles found.`)
  return principles
}

const FRAMEWORK_HEADING = /^###\s+(F\d+)\s+—\s+(.+)$/gm

function parseFrameworks(expertId: string, body: string, path: string): Framework[] {
  const headings = [...body.matchAll(FRAMEWORK_HEADING)]
  const frameworks: Framework[] = []

  for (const [index, heading] of headings.entries()) {
    const start = heading.index + heading[0].length
    const end = headings[index + 1]?.index ?? body.length
    const block = body.slice(start, end).trim()
    const number = heading[1]
    const name = heading[2]
    if (!number || !name) continue

    const stepsBlock = field(block, 'Steps')
    if (!stepsBlock) throw new Error(`${path} ${number}: missing "Steps:".`)
    const steps = stepsBlock
      .split('\n')
      .map((line) => line.replace(/^\s*\d+[.)]\s*/, '').trim())
      .filter(Boolean)
    if (steps.length === 0) throw new Error(`${path} ${number}: "Steps:" is empty.`)

    frameworks.push({
      id: `${expertId}/${number}`,
      name,
      steps,
      whenToUse: field(block, 'When to use') ?? '',
      sourceId: field(block, 'Source')?.match(/^([a-z0-9-]+\/[a-z0-9-]+)/)?.[1] ?? null,
    })
  }

  return frameworks
}

export function loadExperts(dir = EXPERTS_DIR): Map<string, Expert> {
  const experts = new Map<string, Expert>()
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const path = join(dir, file)
    const { data, content } = matter(readFileSync(path, 'utf8'))
    const parsed = FrontmatterSchema.safeParse(data)
    if (!parsed.success) {
      throw new Error(
        `${path} frontmatter failed validation:\n${parsed.error.issues
          .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('\n')}`,
      )
    }
    const fm = parsed.data
    if (fm.id !== file.replace(/\.md$/, '')) {
      throw new Error(`${path}: frontmatter id "${fm.id}" does not match the filename.`)
    }
    experts.set(fm.id, {
      ...fm,
      principles: parsePrinciples(fm.id, content, path),
      frameworks: parseFrameworks(fm.id, content, path),
    })
  }
  return experts
}

export function selectExperts(experts: Map<string, Expert>, ids: readonly string[]): Expert[] {
  return ids.map((id) => {
    const expert = experts.get(id)
    if (!expert) {
      throw new Error(`Unknown expert "${id}". Available: ${[...experts.keys()].join(', ')}`)
    }
    return expert
  })
}

export type CitationCheck = { ok: true } | { ok: false; errors: string[] }

/**
 * The provenance guarantee, enforced mechanically rather than by asking the model
 * nicely: a citation must name a principle that exists, and may only claim
 * `quoted` when that principle actually carries a verbatim quote.
 */
export function validateCitations(
  loaded: Expert[],
  citations: Citation[],
  /** Claim ids retrieved from the knowledge base for this run. */
  citableClaims: readonly string[] = [],
): CitationCheck {
  const byId = new Map(loaded.flatMap((e) => e.principles.map((p) => [p.id, p] as const)))
  const claims = new Set(citableClaims)
  const errors: string[] = []

  for (const citation of citations) {
    // A corpus claim is verbatim source text, so citing one as "quoted" is always
    // legitimate — but only if it was actually retrieved for this run.
    if (claims.has(citation.principle_id)) continue

    const principle = byId.get(citation.principle_id)
    if (!principle) {
      errors.push(
        `Cited "${citation.principle_id}", which is neither a loaded principle nor a retrieved passage. ` +
          `Valid principles: ${[...byId.keys()].join(', ')}` +
          (claims.size ? `. Valid passages: ${[...claims].join(', ')}` : ''),
      )
      continue
    }
    if (citation.kind === 'quoted' && !principle.quoted) {
      errors.push(
        `Cited "${citation.principle_id}" as quoted, but that principle is a paraphrase. Use kind: "inferred".`,
      )
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}
