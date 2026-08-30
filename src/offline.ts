import { CONTEXT_KEYS, selectContext, type Workspace } from './context.ts'
import { loadExperts, selectExperts, type Expert } from './experts.ts'
import { consult, type Passage } from './knowledge/consult.ts'
import { detectSignals, type Signal } from './signals.ts'
import { loadSkills, requireSkill, type Skill } from './skills.ts'

/**
 * The advisory brief with no model in it.
 *
 * This is not a fallback. A model's imitation of Paul Graham is strictly worse
 * evidence than Paul Graham's actual sentences, and a founder walking a checklist
 * against their own overdue decisions is doing the thinking the reasoning pass
 * would otherwise do for them. What is missing here is synthesis and the
 * challenger — real losses, but not the whole product.
 */

export type OfflineBrief = {
  query: string
  skill: Skill
  signals: Signal[]
  passages: Passage[]
  experts: Expert[]
  corpusUnavailable: string | null
  /** Retrieved but dropped for failing to rank on the skill's vocabulary too. */
  discarded: number
  /** False means keyword-only retrieval, which the reader needs to know. */
  semantic: boolean
}

export async function buildOfflineBrief(input: {
  query: string
  workspace: Workspace
  skillId: string
  now: Date
}): Promise<OfflineBrief> {
  const skill = requireSkill(loadSkills(), input.skillId)
  const experts = selectExperts(loadExperts(), skill.experts)

  const consultation = await consult({
    query: input.query,
    domain: skill.corpusTerms.join(' ') || skill.purpose,
    ...(skill.experts.length ? { authors: skill.experts } : {}),
    limit: 5,
  })

  // Signals are filtered to the skill that would act on them, plus anything
  // blocking: an overdue decision matters whatever you came here to ask.
  const all = detectSignals(input.workspace, input.now)
  const signals = all.filter((s) => s.severity === 'blocking' || s.skill === skill.id)

  return {
    query: input.query,
    skill,
    signals,
    passages: consultation.ok ? consultation.passages : [],
    experts,
    corpusUnavailable: consultation.ok ? null : consultation.reason,
    discarded: consultation.ok ? consultation.discarded : 0,
    semantic: Boolean(process.env.OPENAI_API_KEY),
  }
}

function numberedSteps(procedure: string): string[] {
  return procedure
    .split(/\n(?=\d+\.\s)/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

export function renderOfflineBrief(brief: OfflineBrief, workspace: Workspace, now: Date): string {
  const lines: string[] = [
    `"${brief.query}"`,
    '',
    'No model was called. Below is what FounderOS would have reasoned over: the',
    'procedure, your own state, and what the authors actually wrote. You do the',
    'synthesis — which is the part a model would have done for you.',
    '',
  ]

  if (brief.signals.length > 0) {
    lines.push(`WHAT YOUR OWN CONTEXT ALREADY SAYS (${brief.signals.length})`, '')
    for (const signal of brief.signals) {
      lines.push(`  ${signal.severity === 'blocking' ? '!!' : ' !'} ${signal.title}`)
      lines.push(`       ${signal.detail}`)
    }
    lines.push('')
  }

  lines.push(`THE ${brief.skill.id.toUpperCase()} PROCEDURE — walk it yourself`, '')
  for (const step of numberedSteps(brief.skill.procedure)) {
    lines.push(`  ${step}`)
  }
  lines.push('')

  lines.push('WHERE THIS USUALLY GOES WRONG', '')
  for (const mode of brief.skill.failureModes.split('\n- ').slice(1)) {
    lines.push(`  · ${mode.replace(/\s+/g, ' ').trim()}`)
  }
  lines.push('')

  const principles = brief.experts.flatMap((e) => e.principles)
  if (principles.length > 0) {
    lines.push('PRINCIPLES THAT APPLY', '')
    for (const p of principles.slice(0, 6)) {
      lines.push(`  [${p.id}] ${p.title}`)
      lines.push(`       ${p.claim.replace(/\s+/g, ' ')}`)
      if (p.quoted && p.quote) lines.push(`       "${p.quote}"`)
    }
    lines.push('')
  }

  if (brief.passages.length > 0) {
    lines.push(
      'IN THEIR OWN WORDS',
      brief.semantic
        ? ''
        : '  Retrieved by keyword, not meaning. Read the titles: a passage can match your\n' +
          '  words and be about something else entirely — "raising prices" and "raising\n' +
          '  money" are indistinguishable to this search. Semantic retrieval fixes it:\n' +
          '  set OPENAI_API_KEY, then `founderos knowledge embed`.',
      '',
    )
    for (const p of brief.passages) {
      lines.push(`  [${p.id}] ${p.author} — "${p.title}"`)
      lines.push(`  ${p.text.replace(/\s+/g, ' ')}`)
      lines.push('')
    }
  } else if (brief.corpusUnavailable) {
    lines.push('CORPUS UNAVAILABLE', `  ${brief.corpusUnavailable}`, '  fix: ./scripts/setup.sh', '')
  } else {
    lines.push(
      'NOTHING IN THE CORPUS ON THIS',
      '',
      `  ${brief.discarded} passage(s) matched loosely and were dropped for not actually`,
      `  being about ${brief.skill.id}. The authors here did not write about it — that is`,
      '  worth knowing, and better than near-misses dressed up as their opinion.',
      '',
    )
  }

  const selected = selectContext(workspace, brief.skill.requiresContext)
  const sizes = Object.entries(selected).map(([k, v]) =>
    Array.isArray(v) ? `${k} (${v.length})` : k,
  )
  lines.push(
    'WHAT THE REASONING PASS WOULD HAVE ADDED',
    '',
    `  It would read ${sizes.join(', ')} and produce one constraint, at most three`,
    '  priorities, an explicit list of what to drop, and a next action — then a',
    '  second pass would attack that answer before you saw it.',
    '',
    '  founderos ask "..."   once ANTHROPIC_API_KEY is set and funded',
    '  founderos doctor      to see exactly what is missing',
  )

  return lines.join('\n')
}

export function hasReasoningCredentials(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY)
}

export { CONTEXT_KEYS }
