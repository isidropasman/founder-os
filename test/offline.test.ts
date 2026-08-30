import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openWorkspace } from '../src/context.ts'
import { buildOfflineBrief, hasReasoningCredentials, renderOfflineBrief } from '../src/offline.ts'

const WORKSPACE = './evals/fixtures/acme-seed'
const NOW = new Date('2026-08-18T00:00:00Z')

async function brief(skillId = 'focus', query = 'Where should I focus this week?') {
  return buildOfflineBrief({ query, workspace: openWorkspace(WORKSPACE), skillId, now: NOW })
}

test('the offline brief carries the procedure, failure modes and principles', async () => {
  const b = await brief()
  const ws = openWorkspace(WORKSPACE)
  const rendered = renderOfflineBrief(b, ws, NOW)

  assert.match(rendered, /THE FOCUS PROCEDURE/)
  assert.match(rendered, /WHERE THIS USUALLY GOES WRONG/)
  assert.match(rendered, /PRINCIPLES THAT APPLY/)
  assert.match(rendered, /Where should I focus this week\?/)
  assert.match(rendered, /No model was called/, 'it must never read as a model answer')
})

test('it surfaces the founder\'s own blocking signals', async () => {
  const b = await brief()
  assert.ok(b.signals.length > 0)
  assert.ok(
    b.signals.every((s) => s.severity === 'blocking' || s.skill === 'focus'),
    'irrelevant hygiene noise must not be included',
  )
  assert.match(renderOfflineBrief(b, openWorkspace(WORKSPACE), NOW), /WHAT YOUR OWN CONTEXT/)
})

test('quoted principles show the author\'s actual words', async () => {
  const b = await brief()
  const quoted = b.experts.flatMap((e) => e.principles).filter((p) => p.quoted)
  assert.ok(quoted.length > 0)
  const rendered = renderOfflineBrief(b, openWorkspace(WORKSPACE), NOW)
  assert.ok(rendered.includes(quoted[0]!.quote!), 'the verbatim quote must reach the reader')
})

test('keyword retrieval is labelled as such, so nobody reads a near-miss as an opinion', async () => {
  const b = await brief()
  if (b.passages.length === 0) return
  const rendered = renderOfflineBrief(b, openWorkspace(WORKSPACE), NOW)
  if (!b.semantic) {
    assert.match(rendered, /Retrieved by keyword, not meaning/)
    assert.match(rendered, /raising prices" and "raising\n  money" are indistinguishable/)
  }
})

test('it always says what the reasoning pass would have added', async () => {
  const rendered = renderOfflineBrief(await brief(), openWorkspace(WORKSPACE), NOW)
  assert.match(rendered, /WHAT THE REASONING PASS WOULD HAVE ADDED/)
  assert.match(rendered, /founderos ask/)
  assert.match(rendered, /founderos doctor/)
})

test('every skill can produce an offline brief', async () => {
  const { loadSkills } = await import('../src/skills.ts')
  for (const skill of loadSkills().values()) {
    const b = await brief(skill.id, 'What should I do?')
    const rendered = renderOfflineBrief(b, openWorkspace(WORKSPACE), NOW)
    assert.ok(rendered.length > 400, `${skill.id} produced almost nothing`)
    assert.match(rendered, new RegExp(`THE ${skill.id.toUpperCase()} PROCEDURE`))
  }
})

test('credential detection drives the automatic fallback', () => {
  const saved = { a: process.env.ANTHROPIC_API_KEY, o: process.env.OPENAI_API_KEY }
  try {
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY
    assert.equal(hasReasoningCredentials(), false)
    process.env.ANTHROPIC_API_KEY = 'x'
    assert.equal(hasReasoningCredentials(), true)
  } finally {
    if (saved.a) process.env.ANTHROPIC_API_KEY = saved.a
    else delete process.env.ANTHROPIC_API_KEY
    if (saved.o) process.env.OPENAI_API_KEY = saved.o
  }
})
