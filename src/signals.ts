import { CONTEXT_KEYS, selectContext, type Workspace } from './context.ts'

/**
 * Rule-based findings over the startup context. No model, no network, no cost.
 *
 * These exist for two reasons. Standing alone they answer "what needs my
 * attention" more reliably than a model can, because a rule cannot hallucinate a
 * decision that is not overdue. Fed into the reasoning prompt they shorten the
 * expensive call, because the model no longer has to rediscover them from raw
 * YAML — it starts from the findings and spends its budget on judgment.
 */

export const SEVERITIES = ['blocking', 'attention', 'hygiene'] as const
export type Severity = (typeof SEVERITIES)[number]

export type Signal = {
  id: string
  severity: Severity
  title: string
  detail: string
  /** Entity ids this was derived from, so a founder can go look. */
  refs: string[]
  /** The skill that would act on this, when one applies. */
  skill: string | null
}

type Row = Record<string, unknown>

const STALE_TOUCH_DAYS = 21
const STALE_METRIC_DAYS = 30
const REPEATED_THEME_THRESHOLD = 3

function rows(selected: Record<string, unknown>, key: string): Row[] {
  const value = selected[key]
  return Array.isArray(value) ? (value as Row[]) : []
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/**
 * Metric names are snake_case identifiers because that is what a founder types
 * into YAML. A headline should not read `monthly_logo_churn_pct`. Ids stay raw in
 * `refs` so a finding is still traceable to the exact row.
 */
function readable(name: string): string {
  const words = name.replace(/_(pct|usd|count|monthly|total)$/,'').replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

function num(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

function daysBetween(from: string, to: Date): number | null {
  const parsed = Date.parse(from)
  if (Number.isNaN(parsed)) return null
  return Math.floor((to.getTime() - parsed) / 86_400_000)
}

/**
 * `now` is injected rather than read from the clock so the same workspace always
 * produces the same signals in tests, and so a frozen eval fixture cannot drift
 * into new findings as real time passes.
 */
export function detectSignals(ws: Workspace, now: Date): Signal[] {
  const selected = selectContext(ws, CONTEXT_KEYS)
  const signals: Signal[] = []

  const goals = rows(selected, 'goals')
  const metrics = rows(selected, 'metrics')
  const people = rows(selected, 'people')
  const feedback = rows(selected, 'feedback')
  const experiments = rows(selected, 'experiments')
  const meetings = rows(selected, 'meetings')
  const decisions = rows(selected, 'decisions_all')
  const metricNames = new Set(metrics.map((m) => str(m.name)))

  for (const goal of goals) {
    if (str(goal.status) !== 'active') continue
    const id = str(goal.id)

    if (!metricNames.has(str(goal.metric))) {
      signals.push({
        id: `goal-unmeasured:${id}`,
        severity: 'attention',
        title: `“${str(goal.statement)}” has no metric tracking it`,
        detail: `It points at “${readable(str(goal.metric))}”, which is not in metrics.yaml. A goal you cannot measure cannot be dropped on evidence either.`,
        refs: [id],
        skill: 'focus',
      })
    }

    const overdue = daysBetween(str(goal.horizon), now)
    if (overdue !== null && overdue > 0) {
      signals.push({
        id: `goal-overdue:${id}`,
        severity: 'attention',
        title: `“${str(goal.statement)}” is ${overdue} days past its horizon and still active`,
        detail: 'Either it moved, it slipped, or it should be abandoned. Leaving it active hides which.',
        refs: [id],
        skill: 'focus',
      })
    }

    const metric = metrics.find((m) => str(m.name) === str(goal.metric))
    const target = num(goal.target)
    const value = num(metric?.value)
    if (metric && target !== null && value !== null) {
      const wantsUp = value < target
      const trend = str(metric.trend)
      if ((wantsUp && trend === 'down') || (!wantsUp && trend === 'up')) {
        signals.push({
          id: `metric-wrong-way:${str(metric.name)}`,
          severity: 'blocking',
          title: `${readable(str(metric.name))} is moving away from “${str(goal.statement)}”`,
          detail: `At ${value} against a target of ${target}, trending ${trend}.`,
          refs: [id, str(metric.name)],
          skill: 'focus',
        })
      }
    }
  }

  for (const metric of metrics) {
    const age = daysBetween(str(metric.as_of), now)
    if (age !== null && age > STALE_METRIC_DAYS) {
      signals.push({
        id: `metric-stale:${str(metric.name)}`,
        severity: 'hygiene',
        title: `${readable(str(metric.name))} was last updated ${age} days ago`,
        detail: 'Decisions are being made on a number nobody has refreshed.',
        refs: [str(metric.name)],
        skill: null,
      })
    }
  }

  for (const decision of decisions) {
    const id = str(decision.id)
    if (str(decision.status) !== 'open') continue

    const overdue = daysBetween(str(decision.review_date), now)
    if (overdue !== null && overdue > 0) {
      signals.push({
        id: `decision-unreviewed:${id}`,
        severity: 'blocking',
        title: `“${str(decision.question)}” passed its review date ${overdue} days ago`,
        detail: `You decided “${str(decision.decision)}” and never went back to check. That is where learning leaks out.`,
        refs: [id],
        skill: 'learning',
      })
    }

    const assumptions = Array.isArray(decision.assumptions) ? (decision.assumptions as Row[]) : []
    const shaky = assumptions.filter((a) => (num(a.confidence) ?? 1) < 0.5)
    if (shaky.length > 0) {
      signals.push({
        id: `decision-untested:${id}`,
        severity: 'attention',
        title: `“${str(decision.question)}” rests on ${shaky.length} assumption(s) below 0.5 confidence`,
        detail: shaky
          .map((a) => `“${str(a.text)}” — test: ${str(a.how_to_test) || 'none written'}`)
          .join(' · '),
        refs: [id],
        skill: 'decision',
      })
    }
  }

  for (const experiment of experiments) {
    if (str(experiment.status) !== 'concluded') continue
    if (str(experiment.learning).trim()) continue
    signals.push({
      id: `experiment-no-learning:${str(experiment.id)}`,
      severity: 'attention',
      title: `“${str(experiment.hypothesis)}” concluded without a recorded learning`,
      detail: `Result: ${str(experiment.result) || 'not recorded'}. An experiment without a learning is a story.`,
      refs: [str(experiment.id)],
      skill: 'learning',
    })
  }

  // Open threads live on meetings; the person is who you owe.
  const threadsByPerson = new Map<string, string[]>()
  for (const meeting of meetings) {
    const threads = Array.isArray(meeting.open_threads) ? (meeting.open_threads as string[]) : []
    if (threads.length === 0) continue
    const personId = str(meeting.person_id)
    threadsByPerson.set(personId, [...(threadsByPerson.get(personId) ?? []), ...threads])
  }

  for (const person of people) {
    const id = str(person.id)
    const threads = threadsByPerson.get(id) ?? []
    if (threads.length === 0) continue
    const age = daysBetween(str(person.last_touch), now)
    if (age === null || age <= STALE_TOUCH_DAYS) continue
    signals.push({
      id: `thread-cold:${id}`,
      severity: 'attention',
      title: `${str(person.name)} has ${threads.length} open thread(s) and ${age} days of silence`,
      detail: threads.join(' · '),
      refs: [id],
      skill: 'meeting-prep',
    })
  }

  const themes = new Map<string, Row[]>()
  for (const item of feedback) {
    if (str(item.sentiment) !== 'negative') continue
    const theme = str(item.theme)
    if (!theme) continue
    themes.set(theme, [...(themes.get(theme) ?? []), item])
  }
  for (const [theme, items] of themes) {
    if (items.length < REPEATED_THEME_THRESHOLD) continue
    signals.push({
      id: `theme-repeated:${theme}`,
      severity: 'blocking',
      title: `${items.length} customers have complained about “${theme}”`,
      detail: items.map((i) => `“${str(i.verbatim).slice(0, 60)}…”`).join(' · '),
      refs: items.map((i) => str(i.id)),
      skill: 'product-review',
    })
  }

  const order: Record<Severity, number> = { blocking: 0, attention: 1, hygiene: 2 }
  return signals.sort((a, b) => order[a.severity] - order[b.severity] || a.id.localeCompare(b.id))
}

const MARKS: Record<Severity, string> = { blocking: '!!', attention: ' !', hygiene: ' ·' }

export function renderSignals(signals: Signal[]): string {
  if (signals.length === 0) return 'Nothing overdue, unmeasured or unreviewed. Rare — enjoy it.'

  const lines: string[] = []
  for (const severity of SEVERITIES) {
    const group = signals.filter((s) => s.severity === severity)
    if (group.length === 0) continue
    lines.push(`${severity.toUpperCase()} (${group.length})`)
    for (const signal of group) {
      lines.push(`  ${MARKS[signal.severity]} ${signal.title}`)
      lines.push(`       ${signal.detail}`)
      if (signal.skill) lines.push(`       → founderos ask "..." --skill ${signal.skill}`)
    }
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

/** Compact form for the reasoning prompt: findings the model does not have to rediscover. */
export function signalsForPrompt(signals: Signal[]): string {
  if (signals.length === 0) return ''
  return signals
    .map((s) => `- [${s.severity}] ${s.title} (${s.refs.join(', ')})`)
    .join('\n')
}
