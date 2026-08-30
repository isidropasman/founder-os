import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

const CSS = readFileSync('app/globals.css', 'utf8')

function componentFiles(dir = 'app'): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? componentFiles(join(dir, entry.name))
      : entry.name.endsWith('.tsx')
        ? [join(dir, entry.name)]
        : [],
  )
}

const COMPONENTS = componentFiles()

test('the interface never falls back to a generic font stack', () => {
  // Next ships system-ui/Roboto in its own error pages; ours must not add to it.
  const generic = /\b(Inter|Roboto|system-ui|-apple-system|Segoe UI|Helvetica Neue)\b/
  assert.ok(!generic.test(CSS), 'globals.css names a generic font')
  for (const file of COMPONENTS) {
    assert.ok(!generic.test(readFileSync(file, 'utf8')), `${file} names a generic font`)
  }
})

test('none of the template tells: no glass, no gradients, no floating cards', () => {
  // The design-system search recommended glassmorphism with a trust-blue and an
  // orange CTA. That is the exact template the brief was to avoid.
  assert.ok(!/backdrop-filter/i.test(CSS), 'glassmorphism crept in')
  assert.ok(!/linear-gradient|radial-gradient/i.test(CSS), 'a gradient crept in')
  assert.equal((CSS.match(/box-shadow/g) ?? []).length, 0, 'a floating card crept in')
})

test('one accent colour, and it stays scarce', () => {
  // An alert colour that is everywhere stops meaning "something is wrong".
  const uses = (CSS.match(/var\(--alert\)/g) ?? []).length
  assert.ok(uses > 0 && uses <= 6, `--alert used ${uses} times; it must stay rare`)

  // Every other declared colour is neutral: no second hue to fight with it.
  const hues = [...CSS.matchAll(/--(?:bg|surface|ink|ink-2|ink-3|line|line-2):\s*(#[0-9a-f]{6})/gi)]
  for (const [, hex] of hues) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex!.slice(i, i + 2), 16))
    assert.ok(Math.max(r!, g!, b!) - Math.min(r!, g!, b!) <= 12, `${hex} is not neutral`)
  }
})

test('the interface is sans-serif, as asked', () => {
  assert.match(CSS, /font-family:\s*'Geist'/)
  assert.ok(!/Georgia|serif;/.test(CSS.replace(/ui-sans-serif, sans-serif/g, '')), 'a serif remains')
})

test('it stays calm: few sections per page', () => {
  for (const file of COMPONENTS.filter((f) => f.endsWith('page.tsx'))) {
    const sections = (readFileSync(file, 'utf8').match(/<section/g) ?? []).length
    assert.ok(sections <= 5, `${file} has ${sections} sections; the brief was "not loaded"`)
  }
})

test('motion is reduced-motion aware and never animates layout', () => {
  assert.match(CSS, /prefers-reduced-motion/)
  assert.ok(!/transition:\s*all/.test(CSS), 'transition: all is unreviewable')
  const animated = [...CSS.matchAll(/transition:\s*([^;]+);/g)].map((m) => m[1]!)
  for (const decl of animated) {
    assert.ok(!/\b(width|height|top|left|margin)\b/.test(decl), `animates layout: ${decl}`)
  }
})

test('focus is always visible, never removed', () => {
  assert.match(CSS, /:focus-visible/)
  const removals = [...CSS.matchAll(/outline:\s*none|outline-none/g)]
  for (const _ of removals) {
    assert.ok(/focus-visible/.test(CSS), 'outline removed without a focus-visible replacement')
  }
})

test('no emoji anywhere in the interface', () => {
  for (const file of [...COMPONENTS, 'app/globals.css']) {
    const content = readFileSync(file, 'utf8')
    assert.ok(!/[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}]/u.test(content), `${file} contains emoji`)
  }
})

test('every page reads the core directly, with no HTTP layer in between', () => {
  const pages = COMPONENTS.filter((f) => f.endsWith('page.tsx'))
  assert.ok(pages.length >= 4, `expected 4 routes, found ${pages.length}`)
  for (const file of pages) {
    const content = readFileSync(file, 'utf8')
    assert.ok(!/fetch\(['"`]\/api/.test(content), `${file} calls an API route that need not exist`)
  }
})

test('server actions are marked and typed', () => {
  const actions = readFileSync('app/ask/actions.ts', 'utf8')
  assert.match(actions, /^'use server'/)
  assert.match(actions, /mode: 'offline'/, 'the no-credential path must be a first-class result')
  assert.match(actions, /mode: 'reasoned'/)
})

test('the offline path is reachable from the web action', async () => {
  const { counselOffline } = await import('../app/ask/actions.ts')
  const result = await counselOffline('Where should I focus this week?', 'focus')
  assert.equal(result.mode, 'offline')
  if (result.mode !== 'offline') return
  assert.ok(result.procedure.length > 3, 'the procedure should reach the browser')
  assert.ok(result.failureModes.length > 0)
  assert.equal(typeof result.semantic, 'boolean')
})
