import type { Challenge } from './outputs.ts'

const LABEL = (key: string): string => key.replace(/_/g, ' ').toUpperCase()

/** Shown last and on their own, because they are the two lines a founder acts on. */
const TAIL_FIELDS = ['next_action', 'question_for_you', 'confidence', 'expert_citations']

function value(input: unknown, indent: string): string[] {
  if (input === null || input === undefined) return [`${indent}—`]
  if (Array.isArray(input)) {
    return input.flatMap((item) =>
      typeof item === 'object' && item !== null
        ? Object.entries(item as Record<string, unknown>).map(
            ([k, v], i) => `${indent}${i === 0 ? '· ' : '  '}${k}: ${String(v)}`,
          )
        : [`${indent}· ${String(item)}`],
    )
  }
  if (typeof input === 'object') {
    return Object.entries(input as Record<string, unknown>).map(([k, v]) => `${indent}${k}: ${String(v)}`)
  }
  return [`${indent}${String(input)}`]
}

/**
 * One renderer for every brief shape. The schemas already order their fields the
 * way a founder should read them, so re-encoding that order in eight bespoke
 * renderers would just be the same information maintained twice.
 */
export function renderBrief(brief: unknown): string {
  if (typeof brief !== 'object' || brief === null) return String(brief)
  const record = brief as Record<string, unknown>
  const lines: string[] = []

  for (const [key, v] of Object.entries(record)) {
    if (TAIL_FIELDS.includes(key)) continue
    lines.push(LABEL(key))
    lines.push(...value(v, '  '))
    lines.push('')
  }

  if (record.next_action) lines.push('NEXT ACTION', `  ${String(record.next_action)}`, '')

  const citations = record.expert_citations as { principle_id: string; kind: string }[] | undefined
  const grounded = citations?.length
    ? `  ·  grounded in ${citations.map((c) => c.principle_id).join(', ')}`
    : ''
  if (typeof record.confidence === 'number') {
    lines.push(`confidence ${record.confidence.toFixed(2)}${grounded}`)
  }

  if (record.question_for_you) {
    lines.push('', `? ${String(record.question_for_you)}`)
  }

  return lines.join('\n').trimEnd()
}

/**
 * The challenger is diagnostic, not the answer. By default the founder sees the
 * verdict, the single best objection and a cheaper test; the rest is in the trace
 * and behind --verbose.
 */
export function renderChallenge(challenge: Challenge, verbose = false): string {
  // The brief above is the REVISED one, but the objection was raised against the
  // draft. Without saying which, the founder reads a complaint about something
  // that is no longer on the page.
  const header =
    challenge.verdict === 'keep'
      ? 'CHALLENGER  kept the draft. Objection that still stands:'
      : `CHALLENGER  ${challenge.verdict}d the draft. What it caught:`

  const lines = [`${header}${challenge.reversible ? '' : '  ·  not reversible'}`]
  lines.push(`  ${challenge.strongest_objection}`)
  if (challenge.cheaper_experiment) lines.push(`  cheaper first: ${challenge.cheaper_experiment}`)

  if (!verbose) {
    const more =
      challenge.unsupported_assumptions.length +
      challenge.missing_evidence.length +
      challenge.founder_bias_flags.length
    if (more > 0) lines.push(`  (${more} more findings — --verbose, or read the trace)`)
    return lines.join('\n')
  }

  for (const a of challenge.unsupported_assumptions) lines.push(`  unsupported: ${a}`)
  for (const e of challenge.missing_evidence) lines.push(`  missing: ${e}`)
  for (const b of challenge.founder_bias_flags) lines.push(`  bias: ${b}`)
  lines.push(`  downside if wrong: ${challenge.downside_if_wrong}`)
  return lines.join('\n')
}

/** Normalized to plain prose so a judge cannot reward the arm with nicer formatting. */
export function briefToProse(brief: unknown): string {
  if (typeof brief !== 'object' || brief === null) return String(brief)
  return Object.entries(brief)
    .filter(([key]) => key !== 'expert_citations')
    .map(([key, v]) => {
      const body = Array.isArray(v)
        ? v
            .map((item) =>
              typeof item === 'object' && item !== null
                ? Object.values(item as Record<string, unknown>).join(' — ')
                : String(item),
            )
            .join('; ')
        : typeof v === 'object' && v !== null
          ? Object.values(v as Record<string, unknown>).join(' — ')
          : String(v)
      return `${key.replace(/_/g, ' ')}: ${body}`
    })
    .join('\n')
}
