import { countBy, type Disposition, type MergePlan, type PlanItem } from './plan.ts'

const MARKS: Record<Disposition, string> = {
  add: '+',
  update: '~',
  conflict: '!',
  duplicate: '=',
  unresolved: '?',
  rejected: 'x',
}

const HEADINGS: Record<Disposition, string> = {
  add: 'NEW FACTS',
  update: 'FILLS AN EMPTY FIELD',
  conflict: 'WOULD CHANGE SOMETHING YOU WROTE',
  duplicate: 'ALREADY KNOWN',
  unresolved: 'HELD AS UNRESOLVED',
  rejected: 'REJECTED',
}

const ORDER: Disposition[] = ['add', 'update', 'conflict', 'unresolved', 'duplicate', 'rejected']

function summarize(item: PlanItem): string {
  const f = item.proposal.fields
  for (const key of ['statement', 'verbatim', 'question', 'hypothesis', 'name', 'purpose', 'one_liner']) {
    const value = f[key]
    if (typeof value === 'string' && value.trim()) {
      return value.length > 92 ? `${value.slice(0, 92)}…` : value
    }
  }
  return Object.entries(f)
    .filter(([k]) => k !== 'id')
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(' ')
    .slice(0, 92)
}

function renderValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(String).join(', ')
  return String(value)
}

export function renderPlan(plan: MergePlan, options: { applied: boolean }): string {
  const counts = countBy(plan)
  const lines: string[] = [
    `${plan.sourceId}`,
    `  ${plan.summary}`,
    `  detected as: ${plan.sourceType}`,
    '',
  ]

  for (const disposition of ORDER) {
    const items = plan.items.filter((i) => i.disposition === disposition)
    if (items.length === 0) continue

    lines.push(`${HEADINGS[disposition]}  (${items.length})`)
    for (const item of items) {
      lines.push(
        `  ${MARKS[disposition]} ${item.proposal.target.padEnd(11)} ${summarize(item)}`,
      )
      if (disposition === 'conflict' || disposition === 'update') {
        for (const change of item.changes) {
          lines.push(
            change.from === null
              ? `      ${change.field}: (empty) → ${renderValue(change.to)}`
              : `      ${change.field}: ${renderValue(change.from)} → ${renderValue(change.to)}`,
          )
        }
      }
      if (disposition !== 'add') lines.push(`      ${item.reason}`)
      if (disposition === 'unresolved' || disposition === 'rejected') {
        lines.push(`      from: "${item.proposal.quote.slice(0, 80)}"`)
      }
    }
    lines.push('')
  }

  if (plan.items.length === 0) {
    lines.push('Nothing found in this document that belongs in the startup context.', '')
  }

  if (!options.applied) {
    const willWrite = counts.add + counts.update
    lines.push(
      willWrite === 0 && counts.unresolved === 0
        ? 'Nothing to write.'
        : `Preview only. --apply writes ${willWrite} change(s)` +
            (counts.unresolved ? ` and holds ${counts.unresolved} unresolved item(s)` : '') +
            '.',
    )
    if (counts.conflict > 0) {
      lines.push(
        `${counts.conflict} conflict(s) need --apply --overwrite; they replace values you wrote.`,
      )
    }
  }

  return lines.join('\n')
}
