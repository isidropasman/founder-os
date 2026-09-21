import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

test('Models exposes one real subscription connection and does not fake unsupported providers', () => {
  const page = readFileSync('app/providers/page.tsx', 'utf8')
  const console = readFileSync('app/providers/console.tsx', 'utf8')
  const actions = readFileSync('app/providers/actions.ts', 'utf8')

  assert.match(page, /ProvidersConsole/)
  assert.match(console, /Use a subscription you already have/)
  assert.match(console, /Codex/)
  assert.match(console, /ChatGPT subscription/)
  assert.match(console, /GitHub Copilot[\s\S]*Not available yet/)
  assert.match(console, /SuperGrok[\s\S]*Not available yet/)
  assert.match(console, /FounderOS never sees or stores your subscription credential/)
  assert.match(actions, /selectCodexConnection/)
  assert.match(actions, /disconnectProvider/)
})
