import assert from 'node:assert/strict'
import { readFileSync, rmSync } from 'node:fs'
import { after, test } from 'node:test'
import { openWorkspace } from '../src/context.ts'
import { run } from '../src/pipeline.ts'
import { loadRecording, recordFromTrace, replayProvider } from '../src/replay.ts'
import { renderBrief, renderChallenge } from '../src/render.ts'
import type { Trace } from '../src/trace.ts'

const recording = loadRecording('focus-acme')
const WORKSPACE = './evals/fixtures/acme-seed'
const traces: string[] = []

function providers() {
  return {
    route: replayProvider(recording, 'route'),
    reason: replayProvider(recording, 'reason'),
    challenge: replayProvider(recording, 'challenge'),
  }
}

after(() => {
  for (const path of traces) rmSync(path, { force: true })
})

async function replayRun(overrides: Partial<Parameters<typeof run>[0]> = {}) {
  const result = await run({
    query: 'Where should I focus this week?',
    workspace: openWorkspace(WORKSPACE),
    providers: providers(),
    ...overrides,
  })
  traces.push(result.tracePath)
  return result
}

test('the whole pipeline runs end to end with no credentials', async () => {
  const result = await replayRun()

  assert.equal(result.routing.skills[0], 'focus')
  assert.ok(result.contextKeys.includes('metrics'))
  assert.ok(result.challenge, 'the challenger ran')
  assert.equal(result.challenge.verdict, 'revise')
})

test('the challenger revision is what reaches the founder, not the draft', async () => {
  const result = await replayRun()
  const draft = JSON.parse(recording.steps.find((s) => s.name === 'reason')!.raw)

  assert.notDeepEqual(result.brief, draft, 'the draft was shipped unchanged')
  assert.deepEqual(result.brief, result.challenge?.revised)
})

test('--no-challenge ships the draft and makes no third call', async () => {
  const result = await replayRun({ challenge: false })
  const draft = JSON.parse(recording.steps.find((s) => s.name === 'reason')!.raw)

  assert.equal(result.challenge, null)
  assert.deepEqual(result.brief, draft)
  assert.ok(!result.trace.steps.some((s) => s.name === 'challenge'))
})

test('the skill\'s required context is always loaded, whatever the router asked for', async () => {
  const result = await replayRun()
  // The recording's router omits `people`; `focus` does not require it either, so
  // the point here is the union, not the intersection.
  for (const key of ['company', 'founder', 'goals', 'metrics', 'decisions_recent']) {
    assert.ok(result.contextKeys.includes(key as never), `dropped required key "${key}"`)
  }
})

test('the trace records every step, both model outputs, and the context hash', async () => {
  const result = await replayRun()
  const written = JSON.parse(readFileSync(result.tracePath, 'utf8')) as Trace

  assert.deepEqual(
    written.steps.map((s) => s.name),
    ['route', 'reason', 'challenge'],
  )
  assert.match(written.versions.context_hash, /^sha256:/)
  assert.equal(written.versions.skills.focus, 1)
  assert.ok(Object.keys(written.versions.experts).length > 0)
  for (const step of written.steps) {
    assert.ok(step.system.length > 0, `${step.name} recorded no system prompt`)
    assert.ok(step.prompt.length > 0, `${step.name} recorded no prompt`)
    assert.ok(step.raw.length > 0, `${step.name} recorded no response`)
  }
})

test('a run can be recorded and replayed to the same result', async () => {
  const first = await replayRun()
  const path = recordFromTrace(first.trace, 'roundtrip-check', '', '/tmp')

  const roundTripped = loadRecording('roundtrip-check', '/tmp')
  const second = await run({
    query: 'Where should I focus this week?',
    workspace: openWorkspace(WORKSPACE),
    providers: {
      route: replayProvider(roundTripped, 'route'),
      reason: replayProvider(roundTripped, 'reason'),
      challenge: replayProvider(roundTripped, 'challenge'),
    },
  })
  traces.push(second.tracePath)
  rmSync(path, { force: true })

  assert.deepEqual(second.brief, first.brief)
  assert.deepEqual(second.challenge, first.challenge)
})

test('a recording that no longer fits its schema fails loudly', async () => {
  const stale = {
    label: 'stale',
    note: '',
    steps: [{ name: 'reason', raw: JSON.stringify({ constraint: 'only this field' }) }],
  }
  await assert.rejects(
    () =>
      run({
        query: 'q',
        workspace: openWorkspace(WORKSPACE),
        pinnedSkill: 'focus',
        challenge: false,
        providers: { reason: replayProvider(stale, 'reason') },
      }),
    /no longer matches its schema/,
  )
})

test('the rendered output is compact and leads with the action', async () => {
  const result = await replayRun()
  const rendered = renderBrief(result.brief)

  assert.ok(rendered.length < 2500, `brief rendered to ${rendered.length} chars`)
  assert.ok(rendered.includes('NEXT ACTION'))
  assert.ok(rendered.includes('confidence '))
  assert.ok(rendered.includes('? '), 'the follow-up question should be shown')
  assert.ok(!rendered.includes('EXPERT CITATIONS'), 'citations belong on the confidence line')
})

test('the challenger summary hides the long tail unless asked', async () => {
  const result = await replayRun()
  assert.ok(result.challenge)

  const compact = renderChallenge(result.challenge)
  const verbose = renderChallenge(result.challenge, true)

  assert.ok(compact.length < verbose.length)
  assert.match(compact, /more findings/)
  assert.ok(verbose.includes('downside if wrong'))
})
