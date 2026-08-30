import assert from 'node:assert/strict'
import { test } from 'node:test'
import { z } from 'zod'
import {
  coerceToSchema,
  decodeDoubleEncoded,
  modelForRole,
  rejectedValue,
  unwrapEnvelope,
} from '../src/provider.ts'

const Schema = z.object({
  verdict: z.enum(['keep', 'revise']),
  flags: z.array(z.string()),
  reversible: z.boolean(),
})

const VALID = { verdict: 'revise' as const, flags: ['a', 'b'], reversible: true }

test('a well-formed object passes through untouched', () => {
  assert.deepEqual(unwrapEnvelope(VALID, Schema), VALID)
})

test('single-key envelopes are unwrapped', () => {
  // Both observed in the wild against claude-opus-5 on 2026-08-17.
  assert.deepEqual(unwrapEnvelope({ parameters: VALID }, Schema), VALID)
  assert.deepEqual(unwrapEnvelope({ body: VALID }, Schema), VALID)
  assert.deepEqual(unwrapEnvelope({ result: { input: VALID } }, Schema), VALID)
})

test('unwrapping stops before it starts guessing', () => {
  assert.equal(unwrapEnvelope({ a: { b: { c: VALID } } }, Schema), null, 'depth is bounded')
  assert.equal(unwrapEnvelope({ x: VALID, y: VALID }, Schema), null, 'ambiguous: two keys')
  assert.equal(unwrapEnvelope({ parameters: { verdict: 'revise' } }, Schema), null, 'still invalid')
  assert.equal(unwrapEnvelope([VALID], Schema), null, 'an array is not an envelope')
  assert.equal(unwrapEnvelope(null, Schema), null)
})

test('the rejected value is recovered from either the cause or the raw text', () => {
  assert.deepEqual(rejectedValue({ cause: { value: { body: VALID } } }), { body: VALID })
  assert.deepEqual(rejectedValue({ text: JSON.stringify({ body: VALID }) }), { body: VALID })
  assert.equal(rejectedValue({ text: 'not json at all' }), undefined)
  assert.equal(rejectedValue({}), undefined)
})

test('model roles resolve from the environment with a documented default', () => {
  assert.match(modelForRole('router'), /:/)
  assert.match(modelForRole('reason'), /:/)
})

test('double-encoded strings are decoded, ordinary prose is not', () => {
  // Observed live: the model answered the enum correctly but shipped it as a
  // JSON string literal, so validation rejected a correct answer.
  assert.equal(decodeDoubleEncoded('"revise"'), 'revise')
  assert.deepEqual(decodeDoubleEncoded({ verdict: '"revise"' }), { verdict: 'revise' })
  assert.deepEqual(decodeDoubleEncoded(['"a"', 'b']), ['a', 'b'])

  // Prose that merely contains or is surrounded by quotes must survive intact.
  assert.equal(decodeDoubleEncoded('He said "not a dealbreaker" and stayed.'), 'He said "not a dealbreaker" and stayed.')
  assert.equal(decodeDoubleEncoded('"unterminated'), '"unterminated')
  assert.equal(decodeDoubleEncoded('"a" and "b"'), '"a" and "b"')
  assert.equal(decodeDoubleEncoded('"42"'), '42')
  assert.equal(decodeDoubleEncoded(7), 7)
  assert.equal(decodeDoubleEncoded(null), null)
})

test('coerceToSchema recovers an answer that is both wrapped and double-encoded', () => {
  const deformed = { body: { verdict: '"revise"', flags: ['x'], reversible: true } }
  assert.deepEqual(coerceToSchema(deformed, Schema), { verdict: 'revise', flags: ['x'], reversible: true })
  assert.equal(coerceToSchema({ verdict: 'nonsense', flags: [], reversible: true }, Schema), null)
})

test('the challenger header says whether the objection still applies', async () => {
  const { renderChallenge } = await import('../src/render.ts')
  const base = {
    strongest_objection: 'Ships a build before the interviews land.',
    unsupported_assumptions: ['a'],
    missing_evidence: [],
    founder_bias_flags: [],
    downside_if_wrong: 'A wasted week.',
    reversible: true,
    cheaper_experiment: null,
    revised: {},
  }

  // The brief shown is the revision, so a "revise" objection describes what was
  // already fixed — reading it as a live complaint is the confusing case.
  const revised = renderChallenge({ ...base, verdict: 'revise' } as never)
  assert.match(revised, /revised the draft\. What it caught:/)

  const kept = renderChallenge({ ...base, verdict: 'keep' } as never)
  assert.match(kept, /kept the draft\. Objection that still stands:/)

  assert.match(revised, /1 more findings/, 'hidden findings are counted, not dropped')
  assert.match(renderChallenge({ ...base, verdict: 'keep' } as never, true), /unsupported: a/)
})
