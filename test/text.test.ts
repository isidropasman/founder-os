import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hashEmbedder, EMBEDDING_DIMENSIONS } from '../src/knowledge/embed.ts'
import { chunk, containsQuote, htmlToText, normalizeForMatch } from '../src/knowledge/text.ts'

test('htmlToText strips markup, decodes entities and keeps paragraphs', () => {
  const text = htmlToText(
    '<html><head><style>p{}</style></head><body><p>First &amp; foremost.</p>' +
      '<p>Second&nbsp;line&#8212;dashed.</p><script>x()</script></body></html>',
  )
  assert.ok(text.includes('First & foremost.'))
  assert.ok(text.includes('Second line—dashed.'))
  assert.ok(!text.includes('x()'))
  assert.ok(!text.includes('<'))
  assert.match(text, /foremost\.\n\nSecond/)
})

test('normalizeForMatch survives hard wrapping and typographic quotes', () => {
  const source = 'you should\nrelease something’s minimal — early'
  const written = "you should release something's minimal - early"
  assert.equal(normalizeForMatch(source), normalizeForMatch(written))
})

test('containsQuote finds a quote that spans a line break in the source', () => {
  const source = 'A startup is a company designed\nto grow fast. Everything else follows.'
  assert.ok(containsQuote(source, 'A startup is a company designed to grow fast.'))
  assert.ok(!containsQuote(source, 'A startup is a company designed to grow slowly.'))
})

test('chunks are contiguous verbatim slices that index back into the source', () => {
  const paragraph = (n: number) => `Paragraph ${n}. ${'word '.repeat(60)}`.trim()
  const text = [1, 2, 3, 4, 5, 6].map(paragraph).join('\n\n')
  const chunks = chunk(text)

  assert.ok(chunks.length > 1, 'expected the text to split')
  for (const c of chunks) {
    assert.equal(text.slice(c.charStart, c.charEnd), c.text, 'offsets must reproduce the chunk')
  }
  for (const [i, c] of chunks.entries()) {
    assert.equal(c.ordinal, i)
    if (i > 0) assert.ok(c.charStart >= chunks[i - 1]!.charEnd, 'chunks must not overlap')
  }
  // Every paragraph must survive somewhere, or a quote could vanish between chunks.
  for (const n of [1, 2, 3, 4, 5, 6]) {
    assert.ok(chunks.some((c) => c.text.includes(`Paragraph ${n}.`)), `lost paragraph ${n}`)
  }
})

test('chunking a single short paragraph yields exactly one chunk', () => {
  const chunks = chunk('Just one short paragraph.')
  assert.equal(chunks.length, 1)
  assert.equal(chunks[0]!.text, 'Just one short paragraph.')
})

test('the hash embedder is deterministic, normalized and dimensioned', async () => {
  const [a] = await hashEmbedder.embed(['raise prices on new customers'])
  const [b] = await hashEmbedder.embed(['raise prices on new customers'])
  assert.ok(a && b)
  assert.equal(a.length, EMBEDDING_DIMENSIONS)
  assert.deepEqual(a, b, 'same input must give the same vector across calls')
  assert.ok(Math.abs(Math.hypot(...a) - 1) < 1e-9, 'vector must be L2 normalized')
  assert.equal(hashEmbedder.semantic, false)
})

test('the hash embedder puts shared vocabulary closer than disjoint vocabulary', async () => {
  const [base, overlapping, disjoint] = await hashEmbedder.embed([
    'raise prices on new customers only',
    'raise prices on new accounts only',
    'ship the redesigned invoice editor',
  ])
  assert.ok(base && overlapping && disjoint)
  const dot = (x: number[], y: number[]) => x.reduce((s, v, i) => s + v * y[i]!, 0)
  assert.ok(dot(base, overlapping) > dot(base, disjoint))
})
