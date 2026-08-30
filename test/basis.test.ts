import assert from 'node:assert/strict'
import { test } from 'node:test'
import { collectBasis, resolveBasis, validateBasis } from '../src/basis.ts'
import { openWorkspace, selectContext } from '../src/context.ts'
import { loadExperts, selectExperts } from '../src/experts.ts'

const ws = openWorkspace('./evals/fixtures/acme-seed')
const selected = selectContext(ws, ['company', 'founder', 'goals', 'metrics', 'decisions_recent'])
const experts = selectExperts(loadExperts(), ['paul-graham'])
const passages = [
  { id: 'paul-graham/ds#0002', sourceId: 'paul-graham/ds', title: "Do Things that Don't Scale", author: 'paul-graham', text: 'Recruit users manually.' },
]
const ctx = { selected, experts, passages }

test('a metric ref resolves to the founder\'s own number', () => {
  const basis = resolveBasis('metrics.monthly_logo_churn_pct', ctx)
  assert.equal(basis.kind, 'your-data')
  assert.equal(basis.broken, false)
  assert.match(basis.detail ?? '', /9\.1/, 'the actual value must be quotable')
})

test('a decision resolves whether the skill loaded recent or all', () => {
  // focus loads `decisions_recent`; other skills load `decisions_all`. A ref that
  // works for one and not the other reads as a fabrication when it is not.
  const basis = resolveBasis('decisions.d-2026-07-14-rebuild-invoice-editor', ctx)
  assert.equal(basis.broken, false, 'decisions.<id> must resolve under either key')
  assert.match(basis.label, /rebuild the invoice editor/i)
  assert.match(basis.detail ?? '', /confidence 0\.5/)
})

test('a founder field resolves and carries its value', () => {
  const basis = resolveBasis('founder.weak_spots', ctx)
  assert.equal(basis.kind, 'your-data')
  assert.equal(basis.broken, false)
  assert.match(basis.detail ?? '', /sales calls/i)
})

test('principles and passages resolve to a readable attribution', () => {
  const principle = resolveBasis('paul-graham/P5', ctx)
  assert.equal(principle.kind, 'source')
  assert.match(principle.label, /Paul Graham/)
  assert.equal(principle.broken, false)

  const passage = resolveBasis('paul-graham/ds#0002', ctx)
  assert.equal(passage.kind, 'source')
  assert.equal(passage.broken, false)
  assert.match(passage.detail ?? '', /Recruit users manually/)
})

test('a passage that was never retrieved is broken, not quietly shown', () => {
  const basis = resolveBasis('paul-graham/ds#9999', ctx)
  assert.equal(basis.broken, true)
  assert.equal(validateBasis(['paul-graham/ds#9999'], ctx).ok, false)
})

test('inference is a first-class basis, never a failure', () => {
  const basis = resolveBasis('inference', ctx)
  assert.equal(basis.kind, 'inference')
  assert.equal(basis.broken, false)
  assert.equal(validateBasis(['inference'], ctx).ok, true)
  assert.match(basis.detail ?? '', /Nothing in your record/)
})

test('a made-up ref fails validation with a fix in the message', () => {
  const result = validateBasis(['metrics.does_not_exist'], ctx)
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.errors[0]!, /resolves to nothing/)
  assert.match(result.errors[0]!, /"inference"/, 'the error must name the honest alternative')
})

test('basis is collected from list items and top-level claims alike', () => {
  const brief = {
    constraint: 'Activation',
    constraint_basis: ['metrics.mrr'],
    priorities: [{ what: 'x', basis: ['inference'] }, { what: 'y', basis: ['paul-graham/P5'] }],
    ignore: ['something'],
  }
  const refs = collectBasis(brief)
  assert.deepEqual(refs.sort(), ['inference', 'metrics.mrr', 'paul-graham/P5'])
})

test('every claim in the shipped recording is grounded', async () => {
  const { loadRecording } = await import('../src/replay.ts')
  const recording = loadRecording('focus-acme')
  const reason = recording.steps.find((s) => s.name === 'reason')
  assert.ok(reason)

  const refs = collectBasis(JSON.parse(reason.raw))
  assert.ok(refs.length > 0, 'the fixture must demonstrate attribution')
  const result = validateBasis(refs, ctx)
  assert.equal(result.ok, true, result.ok ? '' : result.errors.join('; '))
})
