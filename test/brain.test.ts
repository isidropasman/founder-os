import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Answer } from '../app/ask/brief.tsx'
import { openWorkspace } from '../src/context.ts'
import { answerBrainQuestion } from '../src/brain/answer.ts'
import { assembleBrainInput } from '../src/brain/assemble.ts'
import { validateBrainAnswer } from '../src/brain/contract.ts'
import type { Completion, CompletionRequest, Provider } from '../src/provider.ts'
import type { ZodType } from 'zod'
import type { Counsel } from '../app/ask/actions.ts'

const evidence = {
  startupPaths: new Set(['metrics.mrr']),
  passages: new Map([['paul-graham/ds#0002', 'Recruit users manually before scaling acquisition.']]),
  ruleIds: new Set(['focus-blocker']),
}

test('rejects a source assertion when its quote is absent from the passage', () => {
  const result = validateBrainAnswer(
    {
      assertions: [
        {
          text: 'You have PMF.',
          basis: [{ kind: 'source', passageId: 'paul-graham/ds#0002', quote: 'Invented quote.' }],
        },
      ],
    },
    evidence,
  )

  assert.deepEqual(result, {
    ok: false,
    issues: ['assertions[0].basis[0]: quote not found in passage'],
  })
})

test('accepts an unsupported statement only when it is labeled as inference', () => {
  const result = validateBrainAnswer(
    {
      assertions: [{ text: 'Try three interviews this week.', basis: [{ kind: 'inference' }] }],
    },
    evidence,
  )

  assert.equal(result.ok, true)
})

test('renders a Brain source citation as a link to its exact source-version passage', () => {
  const result: Counsel = {
    mode: 'brain',
    query: 'How should I price?',
    skill: 'pricing',
    response: {
      mode: 'answer',
      assertions: [{
        text: 'Test the higher price.',
        basis: [{
          kind: 'source',
          passageId: 'tester/pricing@version#0001',
          quote: 'Raise prices for new customers',
        }],
      }],
      timing: { retrievalMs: 1, assemblyMs: 1, modelMs: 1, totalMs: 3 },
    },
  }

  const html = renderToStaticMarkup(createElement(Answer, { result }))

  assert.match(html, /passage=tester%2Fpricing%40version%230001/)
  assert.match(html, /source-version=tester%2Fpricing%40version/)
})

test('assembles only selected private paths with retrieved passages', () => {
  const assembled = assembleBrainInput({
    question: 'Should we revisit pricing?',
    workspace: openWorkspace('./evals/fixtures/acme-seed'),
    contextKeys: ['metrics'],
    passages: [
      {
        id: 'tester/pricing#0001',
        sourceId: 'tester/pricing',
        title: 'On Pricing',
        author: 'Tester',
        text: 'Raise prices for new customers when the value is clear.',
      },
    ],
  })

  assert.ok(assembled.evidence.startupPaths.has('metrics.0.value'))
  assert.equal(assembled.evidence.passages.get('tester/pricing#0001'), 'Raise prices for new customers when the value is clear.')
  assert.match(assembled.prompt, /Should we revisit pricing\?/)
  assert.doesNotMatch(assembled.prompt, /## company/)
})

test('returns retrieved evidence without generation when no provider is configured', async () => {
  const passages = [
    {
      id: 'tester/pricing#0001',
      sourceId: 'tester/pricing',
      title: 'On Pricing',
      author: 'Tester',
      text: 'Raise prices for new customers when the value is clear.',
    },
  ]
  const result = await answerBrainQuestion({
    question: 'Should we revisit pricing?',
    workspace: openWorkspace('./evals/fixtures/acme-seed'),
    contextKeys: ['metrics'],
    passages,
  })

  assert.equal(result.mode, 'retrieval_only')
  if (result.mode !== 'retrieval_only') return
  assert.deepEqual(result.passages, passages)
  assert.equal(result.reason, 'No local model provider is configured.')
  assert.equal(result.timing.retrievalMs, 0)
  assert.equal(result.timing.modelMs, 0)
  assert.ok(result.timing.assemblyMs >= 0)
  assert.ok(result.timing.totalMs >= result.timing.assemblyMs)
})

test('falls back to retrieved evidence when the provider invents a source quote', async () => {
  const passages = [
    {
      id: 'tester/pricing#0001',
      sourceId: 'tester/pricing',
      title: 'On Pricing',
      author: 'Tester',
      text: 'Raise prices for new customers when the value is clear.',
    },
  ]
  const provider: Provider = {
    id: 'test-provider',
    async text(request: CompletionRequest): Promise<Completion<string>> {
      return { value: request.prompt, raw: request.prompt, model: 'test-provider', tokensIn: 0, tokensOut: 0, ms: 0 }
    },
    async object<T>(request: CompletionRequest & { schema: ZodType<T> }): Promise<Completion<T>> {
      const value = request.schema.parse({
        assertions: [
          {
            text: 'Raise prices now.',
            basis: [{ kind: 'source', passageId: 'tester/pricing#0001', quote: 'Invented quote.' }],
          },
        ],
      })
      return { value, raw: JSON.stringify(value), model: 'test-provider', tokensIn: 0, tokensOut: 0, ms: 0 }
    },
  }

  const result = await answerBrainQuestion({
    question: 'Should we revisit pricing?',
    workspace: openWorkspace('./evals/fixtures/acme-seed'),
    contextKeys: ['metrics'],
    passages,
    provider,
  })

  assert.equal(result.mode, 'retrieval_only')
  if (result.mode === 'retrieval_only') assert.match(result.reason, /quote not found in passage/)
})

test('measures retrieval, assembly, model, and total latency for a grounded answer', async () => {
  const passages = [
    {
      id: 'tester/pricing#0001',
      sourceId: 'tester/pricing',
      title: 'On Pricing',
      author: 'Tester',
      text: 'Raise prices for new customers when the value is clear.',
    },
  ]
  const provider: Provider = {
    id: 'timed-provider',
    async text(): Promise<Completion<string>> {
      return { value: '', raw: '', model: 'timed-provider', tokensIn: 0, tokensOut: 0, ms: 0 }
    },
    async object<T>(request: CompletionRequest & { schema: ZodType<T> }): Promise<Completion<T>> {
      const value = request.schema.parse({
        assertions: [{ text: 'Test the higher price with new customers.', basis: [{ kind: 'source', passageId: 'tester/pricing#0001', quote: 'Raise prices for new customers' }] }],
      })
      return { value, raw: JSON.stringify(value), model: 'timed-provider', tokensIn: 0, tokensOut: 0, ms: 7 }
    },
  }

  const result = await answerBrainQuestion({
    question: 'Should we raise prices?',
    workspace: openWorkspace('./evals/fixtures/acme-seed'),
    contextKeys: ['metrics'],
    passages,
    provider,
    retrievalMs: 11,
  })

  assert.equal(result.mode, 'answer')
  if (result.mode !== 'answer') return
  assert.equal(result.timing.retrievalMs, 11)
  assert.equal(result.timing.modelMs, 7)
  assert.ok(result.timing.assemblyMs >= 0)
  assert.ok(result.timing.totalMs >= result.timing.retrievalMs + result.timing.modelMs)
})
