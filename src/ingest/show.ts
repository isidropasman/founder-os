import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { CONTEXT_KEYS, selectContext, type Workspace } from '../context.ts'
import { UNRESOLVED_FILE } from './apply.ts'

type Row = Record<string, unknown>

function rows(selected: Record<string, unknown>, key: string): Row[] {
  const value = selected[key]
  return Array.isArray(value) ? (value as Row[]) : []
}

function s(value: unknown, fallback = '—'): string {
  return value === null || value === undefined || value === '' ? fallback : String(value)
}

function section(title: string, lines: string[]): string[] {
  if (lines.length === 0) return []
  return [title, ...lines, '']
}

/**
 * A founder-readable overview, not a dump. `--full` prints every row; the default
 * shows what changed recently and what is waiting on a decision, because that is
 * what someone actually opens this to check.
 */
export function renderContextOverview(ws: Workspace, options: { full?: boolean } = {}): string {
  const selected = selectContext(ws, CONTEXT_KEYS)
  const limit = options.full ? Number.POSITIVE_INFINITY : 5
  const company = selected.company as Row | undefined
  const founder = selected.founder as Row | undefined

  const out: string[] = [`${ws.root}`, `  ${ws.hash}`, '']

  if (company) {
    out.push(
      `${s(company.name)} — ${s(company.one_liner)}`,
      `  ${s(company.stage)} · ${s(company.business_model)} · ${s(company.team_size)} people · ${s(company.runway_months)}mo runway`,
      `  sells to: ${s(company.icp)}`,
      `  pricing:  ${s(company.pricing)}`,
      '',
    )
  }

  if (founder) {
    out.push(
      `${s(founder.name)} (${s(founder.role)})`,
      `  works: ${s(founder.working_style)}`,
      ...(Array.isArray(founder.weak_spots) && founder.weak_spots.length
        ? [`  watch: ${(founder.weak_spots as string[]).join(' · ')}`]
        : []),
      '',
    )
  }

  const goals = rows(selected, 'goals').filter((g) => options.full || g.status === 'active')
  out.push(
    ...section(
      `GOALS (${goals.length})`,
      goals.map((g) => `  ${s(g.statement)} — ${s(g.metric)} → ${s(g.target)} by ${s(g.horizon)}`),
    ),
  )

  const metrics = rows(selected, 'metrics')
  const arrow = { up: '↑', down: '↓', flat: '→' } as Record<string, string>
  out.push(
    ...section(
      `METRICS (${metrics.length})`,
      metrics.map((m) => `  ${arrow[String(m.trend)] ?? ' '} ${s(m.name).padEnd(38)} ${s(m.value)}  (${s(m.as_of)})`),
    ),
  )

  const experiments = rows(selected, 'experiments')
  const running = experiments.filter((e) => e.status === 'running')
  out.push(
    ...section(
      `BETS IN FLIGHT (${running.length} running of ${experiments.length})`,
      (options.full ? experiments : running.length ? running : experiments.slice(0, limit)).map(
        (e) => `  [${s(e.status)}] ${s(e.hypothesis)}${e.result ? `\n      → ${s(e.result)}` : ''}`,
      ),
    ),
  )

  const people = rows(selected, 'people')
  const byRelationship = new Map<string, Row[]>()
  for (const p of people) {
    const key = s(p.relationship, 'other')
    byRelationship.set(key, [...(byRelationship.get(key) ?? []), p])
  }
  out.push(
    ...section(
      `PEOPLE (${people.length})`,
      [...byRelationship.entries()].flatMap(([relationship, group]) => [
        `  ${relationship}: ${group.map((p) => s(p.name)).join(', ')}`,
      ]),
    ),
  )

  const decisions = rows(selected, 'decisions_all')
  const open = decisions.filter((d) => d.status === 'open')
  out.push(
    ...section(
      `OPEN DECISIONS (${open.length} of ${decisions.length})`,
      open.slice(0, limit).map((d) => {
        const due = s(d.review_date)
        return `  ${s(d.question)}\n      → ${s(d.decision)} (confidence ${s(d.confidence)}, review ${due})`
      }),
    ),
  )

  const feedback = [...rows(selected, 'feedback')].sort((a, b) => s(b.date).localeCompare(s(a.date)))
  out.push(
    ...section(
      `RECENT FEEDBACK (${feedback.length})`,
      feedback.slice(0, limit).map((f) => {
        const mark = { positive: '+', negative: '−', neutral: '·' }[s(f.sentiment)] ?? '·'
        const quote = s(f.verbatim)
        return `  ${mark} [${s(f.theme)}] "${quote.length > 96 ? `${quote.slice(0, 96)}…` : quote}"`
      }),
    ),
  )

  const meetings = [...rows(selected, 'meetings')].sort((a, b) => s(b.date).localeCompare(s(a.date)))
  const threads = meetings.flatMap((m) =>
    (Array.isArray(m.open_threads) ? (m.open_threads as string[]) : []).map(
      (t) => `  ${s(m.date)} ${s(m.purpose)}: ${t}`,
    ),
  )
  out.push(...section(`MEETINGS (${meetings.length})`, meetings.slice(0, limit).map((m) => `  ${s(m.date)} ${s(m.purpose)} — ${s(m.outcome, 'no outcome recorded')}`)))
  out.push(...section(`OPEN THREADS (${threads.length})`, threads.slice(0, limit)))

  const unresolvedPath = join(ws.root, UNRESOLVED_FILE)
  if (existsSync(unresolvedPath)) {
    const items = (parseYaml(readFileSync(unresolvedPath, 'utf8')) as Row[] | null) ?? []
    out.push(
      ...section(
        `UNRESOLVED FROM INGESTION (${items.length})`,
        items
          .slice(0, limit)
          .map((i) => `  ? ${s(i.target)}: ${s(i.reason)}`)
          .concat(items.length ? [`  review and edit ${unresolvedPath}`] : []),
      ),
    )
  }

  if (!options.full) out.push('--full shows every row.')
  return out.join('\n')
}
