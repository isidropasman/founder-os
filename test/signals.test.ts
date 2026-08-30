import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { stringify as stringifyYaml } from 'yaml'
import { openWorkspace } from '../src/context.ts'
import { detectSignals, renderSignals, signalsForPrompt, type Signal } from '../src/signals.ts'

// Fixed so the same workspace always yields the same findings. Reading the real
// clock here would make these tests start failing on their own months from now.
const NOW = new Date('2026-08-18T00:00:00Z')
const roots: string[] = []

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

function workspace(files: Record<string, unknown> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'founderos-signals-'))
  cpSync('context/example', root, { recursive: true })
  for (const [name, value] of Object.entries(files)) {
    writeFileSync(join(root, name), stringifyYaml(value))
  }
  roots.push(root)
  return root
}

function detect(files?: Record<string, unknown>): Signal[] {
  return detectSignals(openWorkspace(workspace(files)), NOW)
}

function ids(signals: Signal[]): string[] {
  return signals.map((s) => s.id)
}

test('a metric moving away from its goal is blocking', () => {
  const found = detect().find((s) => s.id === 'metric-wrong-way:monthly_logo_churn_pct')
  assert.ok(found, 'churn rising against a 4% target should be caught')
  assert.equal(found.severity, 'blocking')
  assert.ok(found.detail.includes('9.1'))
})

test('a metric moving toward its goal is not flagged', () => {
  const found = detect({
    'metrics.yaml': [{ name: 'mrr', value: 3420, as_of: '2026-08-01', trend: 'up', source: 'stripe' }],
    'goals.yaml': [
      {
        id: 'g-revenue',
        statement: 'Reach $10k MRR',
        horizon: '2026-12-31',
        metric: 'mrr',
        target: 10000,
        status: 'active',
      },
    ],
  })
  assert.ok(!ids(found).some((id) => id.startsWith('metric-wrong-way')))
})

test('a goal with no matching metric is flagged, a measured one is not', () => {
  const found = detect()
  assert.ok(ids(found).includes('goal-unmeasured:g-redesign'), 'redesign_shipped is not a metric')
  assert.ok(!ids(found).includes('goal-unmeasured:g-revenue'), 'mrr is a real metric')
})

test('an overdue decision review is blocking, a future one is silent', () => {
  const overdue = detect({
    // Same decision, review date already passed.
    'metrics.yaml': [],
  })
  assert.ok(!ids(overdue).includes('decision-unreviewed:d-2026-07-14-rebuild-invoice-editor'))

  const past = detectSignals(openWorkspace(workspace()), new Date('2026-10-01T00:00:00Z'))
  const found = past.find((s) => s.id === 'decision-unreviewed:d-2026-07-14-rebuild-invoice-editor')
  assert.ok(found, 'a review date 17 days in the past should surface')
  assert.equal(found.severity, 'blocking')
  assert.equal(found.skill, 'learning')
})

test('a low-confidence assumption surfaces with its stated test', () => {
  const found = detect().find((s) => s.id.startsWith('decision-untested:'))
  assert.ok(found)
  assert.ok(found.detail.includes('Ask five churned accounts'))
  assert.equal(found.skill, 'decision')
})

test('a concluded experiment without a learning is flagged; with one it is not', () => {
  const withLearning = detect()
  assert.ok(!ids(withLearning).some((id) => id.startsWith('experiment-no-learning')))

  const without = detect({
    'experiments.yaml': [
      {
        id: 'exp-x',
        hypothesis: 'A reminder lifts activation',
        method: 'email',
        metric: 'activation',
        started: '2026-07-01',
        ends: '2026-08-01',
        status: 'concluded',
        result: 'No movement.',
        learning: null,
      },
    ],
  })
  assert.ok(ids(without).includes('experiment-no-learning:exp-x'))
})

test('open threads only go cold after silence, and name what is owed', () => {
  const found = detect().find((s) => s.id === 'thread-cold:p-jane')
  assert.ok(found, 'Jane has open threads and 29 days of silence')
  assert.ok(found.detail.includes('retention cohort data'))
  assert.equal(found.skill, 'meeting-prep')

  // Same workspace read a week after the last touch: not yet cold.
  const fresh = detectSignals(openWorkspace(workspace()), new Date('2026-07-25T00:00:00Z'))
  assert.ok(!ids(fresh).includes('thread-cold:p-jane'))
})

test('a repeated negative theme is blocking only once it repeats enough', () => {
  const twice = detect()
  assert.ok(!ids(twice).some((id) => id.startsWith('theme-repeated')), 'two onboarding complaints is not a pattern')

  const thrice = detect({
    'feedback.yaml': [1, 2, 3].map((n) => ({
      id: `fb-${n}`,
      date: '2026-08-01',
      person_id: null,
      channel: 'support',
      verbatim: `Complaint number ${n} about setting things up.`,
      theme: 'onboarding',
      sentiment: 'negative',
    })),
  })
  const found = thrice.find((s) => s.id === 'theme-repeated:onboarding')
  assert.ok(found)
  assert.equal(found.severity, 'blocking')
  assert.equal(found.refs.length, 3)
})

test('positive feedback never counts toward a complaint pattern', () => {
  const found = detect({
    'feedback.yaml': [1, 2, 3].map((n) => ({
      id: `fb-${n}`,
      date: '2026-08-01',
      person_id: null,
      channel: 'support',
      verbatim: `Praise number ${n}.`,
      theme: 'onboarding',
      sentiment: 'positive',
    })),
  })
  assert.ok(!ids(found).some((id) => id.startsWith('theme-repeated')))
})

test('signals are deterministic and sorted with blockers first', () => {
  const a = detect()
  const b = detect()
  assert.deepEqual(ids(a), ids(b), 'the same workspace must give the same findings')

  const severities = a.map((s) => s.severity)
  const rank = { blocking: 0, attention: 1, hygiene: 2 } as const
  for (let i = 1; i < severities.length; i++) {
    assert.ok(rank[severities[i - 1]!] <= rank[severities[i]!], 'out of severity order')
  }
})

test('an empty workspace produces no findings and says so', () => {
  const clean = detect({
    'goals.yaml': [],
    'metrics.yaml': [],
    'people.yaml': [],
    'feedback.yaml': [],
    'experiments.yaml': [],
    'meetings.yaml': [],
  })
  // decisions/ still holds the example decision, whose assumption is shaky.
  assert.ok(clean.every((s) => s.id.startsWith('decision-')))
  assert.equal(renderSignals([]), 'Nothing overdue, unmeasured or unreviewed. Rare — enjoy it.')
})

test('the prompt form is one compact line per finding with its refs', () => {
  const rendered = signalsForPrompt(detect())
  assert.equal(signalsForPrompt([]), '')
  for (const line of rendered.split('\n')) {
    assert.match(line, /^- \[(blocking|attention|hygiene)\] .+ \(.+\)$/)
    assert.ok(line.length < 220, `prompt line too long: ${line.length}`)
  }
})
