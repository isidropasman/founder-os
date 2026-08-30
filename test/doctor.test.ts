import assert from 'node:assert/strict'
import { test } from 'node:test'
import { diagnose, renderDiagnosis, worstStatus, type CheckResult } from '../src/doctor.ts'

const result = (over: Partial<CheckResult> = {}): CheckResult => ({
  name: 'Thing',
  status: 'ok',
  detail: 'fine',
  ...over,
})

test('every non-ok check carries a command, never just a complaint', async () => {
  const checks = await diagnose('./context/example')
  assert.ok(checks.length >= 8)
  for (const c of checks) {
    if (c.status === 'ok') continue
    assert.ok(c.fix, `"${c.name}" says it is ${c.status} but offers no fix`)
    assert.ok(c.fix.length > 5)
  }
})

test('a degraded install says what still works, so nobody stops unnecessarily', async () => {
  const checks = await diagnose('./context/example')
  for (const c of checks.filter((x) => x.status === 'degraded')) {
    assert.ok(c.without, `"${c.name}" is degraded but never says what survives`)
  }
})

test('worstStatus is missing > degraded > ok', () => {
  assert.equal(worstStatus([result(), result({ status: 'degraded' })]), 'degraded')
  assert.equal(worstStatus([result({ status: 'degraded' }), result({ status: 'missing' })]), 'missing')
  assert.equal(worstStatus([result(), result()]), 'ok')
})

test('the summary distinguishes "broken" from "usable but degraded"', () => {
  assert.match(renderDiagnosis([result(), result()]), /Everything is configured/)
  assert.match(renderDiagnosis([result(), result({ status: 'degraded', fix: 'do x', without: 'y' })]), /Usable\./)
  assert.match(renderDiagnosis([result({ status: 'missing', fix: 'do x' })]), /1 thing\(s\) missing/)
})

test('a missing workspace points at init rather than a stack trace', async () => {
  const checks = await diagnose('/tmp/definitely-not-a-workspace-xyz')
  const workspace = checks.find((c) => c.name === 'Your company')
  assert.ok(workspace)
  assert.equal(workspace.status, 'missing')
  assert.match(workspace.fix ?? '', /founderos init/)
})

test('provider errors are translated into something actionable', async () => {
  const { explainProviderError } = await import('../src/provider.ts')

  const noKey = explainProviderError('anthropic:claude-opus-5', new Error('API key is invalid.'))
  assert.match(noKey, /ANTHROPIC_API_KEY/)
  assert.match(noKey, /still work with no key/)

  const broke = explainProviderError(
    'anthropic:claude-opus-5',
    new Error('Your credit balance is too low to access the Anthropic API.'),
  )
  assert.match(broke, /out of credit/)
  assert.match(broke, /still work/)

  const badModel = explainProviderError('openai:gpt-5', new Error('model not_found'))
  assert.match(badModel, /FOUNDEROS_MODEL_VANILLA_GPT/)

  // Anything unrecognized must pass through untouched rather than be swallowed.
  assert.equal(explainProviderError('anthropic:x', new Error('socket hang up')), 'socket hang up')
})
