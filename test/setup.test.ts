import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { parse as parseYaml } from 'yaml'
import { openWorkspace, selectContext } from '../src/context.ts'
import { isConfigured, progress, saveStep, STEPS } from '../src/setup.ts'

const roots: string[] = []
const NOW = new Date('2026-08-18T00:00:00Z')

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'founderos-setup-'))
  roots.push(root)
  return root
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

test('every step says what it unlocks, in a sentence', () => {
  assert.ok(STEPS.length >= 4)
  for (const step of STEPS) {
    assert.ok(step.unlocks.length > 20, `${step.id} does not say what it buys`)
    assert.ok(step.fields.length > 0 && step.fields.length <= 7, `${step.id} asks too much at once`)
    for (const field of step.fields) assert.ok(field.label, `${step.id}.${field.name} has no label`)
  }
})

test('the founder step asks the question no other tool asks', () => {
  const founder = STEPS.find((s) => s.id === 'founder')
  assert.ok(founder?.fields.some((f) => f.name === 'weak_spots'))
  assert.match(founder!.unlocks, /challenger/i)
})

test('a saved company produces a workspace the rest of the app can open', () => {
  const root = workspace()
  saveStep(root, 'company', {
    name: 'Testco',
    one_liner: 'Testing things',
    stage: 'seed',
    icp: 'People who test',
    pricing: '$1',
  }, NOW)

  assert.equal(isConfigured(root), true)
  const selected = selectContext(openWorkspace(root), ['company'])
  assert.equal((selected.company as Record<string, unknown>).name, 'Testco')
})

test('saving fills the fields a schema needs but a founder should not be asked for', () => {
  const root = workspace()
  saveStep(root, 'metrics', [{ name: 'mrr', value: 3420 }], NOW)
  const metrics = parseYaml(readFileSync(join(root, 'metrics.yaml'), 'utf8')) as Record<string, unknown>[]
  assert.equal(metrics[0]!.as_of, '2026-08-18', 'as_of should default to today')
  assert.equal(metrics[0]!.trend, 'flat')

  saveStep(root, 'goals', [{ statement: 'Reach $10k MRR', metric: 'mrr', target: 10000 }], NOW)
  const goals = parseYaml(readFileSync(join(root, 'goals.yaml'), 'utf8')) as Record<string, unknown>[]
  assert.equal(goals[0]!.status, 'active')
  assert.match(String(goals[0]!.id), /^g-reach/, 'an id should be derived, not demanded')
})

test('going back and adding a field keeps the earlier answers', () => {
  const root = workspace()
  saveStep(root, 'company', { name: 'Testco', one_liner: 'One' }, NOW)
  saveStep(root, 'company', { runway_months: 11 }, NOW)

  const company = parseYaml(readFileSync(join(root, 'company.yaml'), 'utf8')) as Record<string, unknown>
  assert.equal(company.name, 'Testco', 'the second save wiped the first')
  assert.equal(company.runway_months, 11)
})

test('blank rows are dropped rather than written as empty records', () => {
  const root = workspace()
  const result = saveStep(root, 'metrics', [{ name: 'mrr', value: 1 }, { name: '', value: '' }], NOW)
  assert.equal(result.wrote, 1)
})

test('progress reports what is missing instead of blocking', () => {
  const root = workspace()
  saveStep(root, 'company', { name: 'Testco', one_liner: 'One' }, NOW)

  const state = progress(root)
  assert.equal(state.find((s) => s.id === 'company')?.done, true)
  assert.equal(state.find((s) => s.id === 'founder')?.done, false)
  assert.ok(state.every((s) => s.unlocks.length > 0), 'every pending step must say what it buys')

  // Partial setup is usable — that is the point.
  assert.equal(isConfigured(root), true)
})

test('an unknown step is rejected rather than writing somewhere unexpected', () => {
  assert.throws(() => saveStep(workspace(), 'nonsense', {}, NOW), /Unknown setup step/)
})

test('a workspace with only step 1 is usable, not broken', async () => {
  // The design says setup is incremental. Requiring founder.yaml made a
  // half-finished setup crash on every screen instead of degrading.
  const root = workspace()
  saveStep(root, 'company', {
    name: 'Testco',
    one_liner: 'One',
    stage: 'seed',
    icp: 'Someone',
    pricing: 'free',
  }, NOW)

  const ws = openWorkspace(root)
  const selected = selectContext(ws, ['company', 'founder', 'goals', 'metrics', 'decisions_recent'])
  assert.deepEqual((selected.founder as Record<string, unknown>).weak_spots, [])
  assert.deepEqual(selected.goals, [])

  const { detectSignals } = await import('../src/signals.ts')
  assert.deepEqual(detectSignals(ws, NOW), [], 'no data means no findings, not a crash')
})
