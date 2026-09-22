import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Provider } from '../src/provider.ts'
import type { Portfolio, PortfolioPacket } from '../src/portfolio/contracts.ts'
import { persistPortfolioEvaluation, runPortfolioEvaluation } from '../src/portfolio/evals.ts'
import { assemblePortfolioContext, generatePortfolioPacket } from '../src/portfolio/reason.ts'

const NOW = '2026-09-08T20:00:00.000Z'

const portfolio: Portfolio = {
  founderId: 'isidro',
  projects: [
    { id: 'zent', name: 'Zent', recordedAt: NOW, observedAt: NOW, origin: 'founder', confidence: 1 },
    { id: 'veris', name: 'Veris', recordedAt: NOW, observedAt: NOW, origin: 'founder', confidence: 1 },
  ],
  records: [
    { id: 'zent-mrr', kind: 'metric', scope: 'project', projectId: 'zent', recordedAt: NOW, observedAt: NOW, origin: 'founder', confidence: 1, evidenceIds: [], text: 'MRR is 2000.', numericValue: 2000, sourceStatus: 'approved', causal: false },
    { id: 'zent-churn', kind: 'signal', scope: 'project', projectId: 'zent', recordedAt: NOW, observedAt: NOW, origin: 'founder', confidence: 0.9, evidenceIds: [], text: 'Three churned customers cite activation.', numericValue: null, sourceStatus: 'approved', causal: false },
    { id: 'veris-signal', kind: 'signal', scope: 'project', projectId: 'veris', recordedAt: NOW, observedAt: NOW, origin: 'founder', confidence: 0.8, evidenceIds: [], text: 'One prospect asked for a demo.', numericValue: null, sourceStatus: 'approved', causal: false },
    { id: 'veris-noise-1', kind: 'hypothesis', scope: 'project', projectId: 'veris', recordedAt: '2026-09-01T20:00:00.000Z', observedAt: NOW, origin: 'founder', confidence: 0.1, evidenceIds: [], text: 'Noise one.', numericValue: null, sourceStatus: 'approved', causal: false },
    { id: 'veris-noise-2', kind: 'hypothesis', scope: 'project', projectId: 'veris', recordedAt: '2026-09-02T20:00:00.000Z', observedAt: NOW, origin: 'founder', confidence: 0.1, evidenceIds: [], text: 'Noise two.', numericValue: null, sourceStatus: 'approved', causal: false },
    { id: 'veris-noise-3', kind: 'hypothesis', scope: 'project', projectId: 'veris', recordedAt: '2026-09-03T20:00:00.000Z', observedAt: NOW, origin: 'founder', confidence: 0.1, evidenceIds: [], text: 'Noise three.', numericValue: null, sourceStatus: 'approved', causal: false },
    { id: 'veris-noise-4', kind: 'hypothesis', scope: 'project', projectId: 'veris', recordedAt: '2026-09-04T20:00:00.000Z', observedAt: NOW, origin: 'founder', confidence: 0.1, evidenceIds: [], text: 'Noise four.', numericValue: null, sourceStatus: 'approved', causal: false },
  ],
  relations: [],
  packets: [],
  decisions: [],
  actions: [],
  outcomes: [],
}

function portfolioWithStaleHistory(): Portfolio {
  return {
    ...portfolio,
    records: [
      ...portfolio.records,
      ...Array.from({ length: 24 }, (_, index) => ({
        id: `zent-stale-${index + 1}`,
        kind: 'hypothesis' as const,
        scope: 'project' as const,
        projectId: 'zent',
        recordedAt: '2026-08-01T20:00:00.000Z',
        observedAt: null,
        origin: 'founder' as const,
        confidence: 0.1,
        evidenceIds: [],
        text: `Stale hypothesis ${index + 1}: ${'unverified '.repeat(100)}`,
        numericValue: null,
        sourceStatus: 'approved' as const,
        causal: false,
      })),
    ],
  }
}

function packet(evidenceId: string): PortfolioPacket {
  const recommendedPriority = 'Interview three churned Zent customers.'
  const stopDoing = 'Pause the Veris demo follow-up this week.'
  const opportunityCost = 'Delays one Veris prospect conversation by one week.'
  const criticalAssumption = 'The churn reason is repeated.'
  const minimumAction = 'Book three interviews by Friday.'
  const expectedSignal = 'At least two interviews name activation.'
  return {
    id: 'portfolio-eval', question: 'What should I prioritize?', projectId: 'zent', createdAt: NOW, status: 'proposed',
    recommendedPriority, stopDoing, opportunityCost, directEvidenceIds: [evidenceId],
    inferences: [], alternatives: [{ option: 'Build a Zent integration', rejectedBecause: 'The observed churn problem is not specific enough.' }],
    criticalAssumption, minimumAction, expectedSignal, baselineEvidenceId: 'zent-mrr', reviewDate: '2026-09-15', causalEvidenceIds: [],
    assertions: [
      { text: recommendedPriority, basis: [{ kind: 'record', id: evidenceId }] },
      { text: stopDoing, basis: [{ kind: 'record', id: evidenceId }] },
      { text: opportunityCost, basis: [{ kind: 'record', id: evidenceId }] },
      { text: criticalAssumption, basis: [{ kind: 'record', id: evidenceId }] },
      { text: minimumAction, basis: [{ kind: 'record', id: evidenceId }] },
      { text: expectedSignal, basis: [{ kind: 'record', id: 'zent-mrr' }] },
    ],
  }
}

const provider: Provider = {
  id: 'fake:one-model',
  text: async () => ({ value: '', raw: '', model: 'fake:one-model', tokensIn: 0, tokensOut: 0, ms: 0 }),
  object: async <T>(request: { prompt: string }) => ({
    value: (request.prompt.includes('veris-noise-1') ? packet('veris-signal') : packet('zent-churn')) as T,
    raw: '{}', model: 'fake:one-model', tokensIn: 100, tokensOut: 50, ms: 12,
  }),
}

test('founderos keeps every record in a small portfolio while context_dump retains its full object history', () => {
  const passages = [{ id: 'tester/discovery#0001', sourceId: 'tester/discovery', title: 'Discovery', author: 'Tester', text: 'Talk to customers before building.' }]
  const founderos = assemblePortfolioContext(portfolio, 'What should I prioritize?', passages, 'founderos')
  const dump = assemblePortfolioContext(portfolio, 'What should I prioritize?', passages, 'context_dump')

  assert.ok(founderos.selectedRecordIds.includes('zent-churn'))
  assert.ok(founderos.selectedRecordIds.includes('veris-noise-1'))
  assert.ok(dump.selectedRecordIds.includes('veris-noise-4'))
  assert.equal(founderos.selection, 'full_within_budget')
  assert.equal(dump.selection, 'context_dump')
  assert.deepEqual(founderos.selectedRecordIds, dump.selectedRecordIds)
  assert.ok(founderos.prompt.length < dump.prompt.length)
  assert.match(founderos.prompt, /For project zent: directEvidenceIds may only use: zent-mrr, zent-churn/)
  assert.match(founderos.prompt, /baselineEvidenceId may only use: zent-mrr/)
  assert.match(founderos.prompt, /Passage ids may only appear in assertion basis/)
})

test('founderos keeps full context within budget and selects only when history exceeds it', () => {
  const passages = [{ id: 'tester/discovery#0001', sourceId: 'tester/discovery', title: 'Discovery', author: 'Tester', text: 'Talk to customers before building.' }]
  const small = assemblePortfolioContext(portfolio, 'What should I prioritize?', passages, 'founderos')
  const noisy = portfolioWithStaleHistory()
  const large = assemblePortfolioContext(noisy, 'What should I prioritize?', passages, 'founderos')

  assert.equal(small.selection, 'full_within_budget')
  assert.deepEqual(small.selectedRecordIds, portfolio.records.map((record) => record.id))
  assert.equal(large.selection, 'selected_over_budget')
  assert.ok(large.selectedRecordIds.length < noisy.records.length)
})

test('repairs a provenance-invalid packet once using project evidence constraints', async () => {
  const prompts: string[] = []
  const repairingProvider: Provider = {
    id: 'fake:one-model',
    text: async () => ({ value: '', raw: '', model: 'fake:one-model', tokensIn: 0, tokensOut: 0, ms: 0 }),
    object: async <T>(request: { prompt: string }) => {
      prompts.push(request.prompt)
      const value = prompts.length === 1 ? packet('veris-signal') : packet('zent-churn')
      return { value: value as T, raw: JSON.stringify(value), model: 'fake:one-model', tokensIn: 100, tokensOut: 50, ms: 12 }
    },
  }

  const generated = await generatePortfolioPacket({
    portfolio,
    question: 'What should I prioritize?',
    passages: [{ id: 'tester/discovery#0001', sourceId: 'tester/discovery', title: 'Discovery', author: 'Tester', text: 'Talk to customers before building.' }],
    arm: 'founderos',
    provider: repairingProvider,
  })

  assert.equal(generated.ok, true)
  assert.equal(prompts.length, 2)
  assert.equal(generated.attempts.length, 2)
  assert.match(prompts[1]!, /directEvidenceIds: veris-signal belongs to another project/)
  assert.match(prompts[1]!, /For project zent: directEvidenceIds may only use: zent-mrr, zent-churn/)
})

test('evaluation persists both arms from the same model and marks an ungrounded dump as a loss', async () => {
  const result = await runPortfolioEvaluation({
    id: 'test-run', createdAt: NOW, caseId: 'shared-constraint', portfolio: portfolioWithStaleHistory(), question: 'What should I prioritize?',
    passages: [{ id: 'tester/discovery#0001', sourceId: 'tester/discovery', title: 'Discovery', author: 'Tester', text: 'Talk to customers before building.' }], provider,
  })

  assert.equal(result.model, 'fake:one-model')
  assert.equal(result.founderos.ok, true)
  assert.equal(result.contextDump.ok, false)
  assert.equal(result.verdict, 'founderos_wins')
  assert.ok(result.scores)
  if (!result.scores) return
  assert.equal(result.scores.founderos.grounding, 1)
  assert.equal(result.scores.contextDump.validPacket, false)

  const root = mkdtempSync(join(tmpdir(), 'founderos-portfolio-eval-'))
  try {
    const path = persistPortfolioEvaluation(result, root)
    const persisted = readFileSync(path, 'utf8')
    assert.match(persisted, /"founderos"/)
    assert.match(persisted, /"contextDump"/)
    assert.match(persisted, /"selectedRecordIds"/)
    assert.match(persisted, /"differences"/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a provider failure produces an invalid run without scores, deltas, or layer conclusions', async () => {
  const unavailable: Provider = {
    id: 'codex-cli',
    text: async () => ({ value: '', raw: '', model: 'codex-cli', tokensIn: 0, tokensOut: 0, ms: 0 }),
    object: async () => { throw new Error('authenticated harness is unavailable') },
  }

  const result = await runPortfolioEvaluation({
    id: 'provider-error', createdAt: NOW, caseId: 'shared-constraint', portfolio, question: 'What should I prioritize?',
    passages: [{ id: 'tester/discovery#0001', sourceId: 'tester/discovery', title: 'Discovery', author: 'Tester', text: 'Talk to customers before building.' }], provider: unavailable,
  })

  assert.equal(result.verdict, 'invalid_run')
  assert.equal(result.scores, null)
  assert.equal(result.differences, null)
  assert.deepEqual(result.nonContributingLayers, [])
  assert.match(result.blockingReasons.join(' '), /harness is unavailable/)
})

test('a valid comparison uses one model for both arms and position-swapped blind judging', async () => {
  const calls: string[] = []
  const blindProvider: Provider = {
    id: 'codex-cli',
    text: async () => ({ value: '', raw: '', model: 'codex-cli', tokensIn: 0, tokensOut: 0, ms: 0 }),
    object: async <T>(request: { system: string }) => {
      calls.push(request.system)
      const value: unknown = request.system.includes('blind strategic judge')
        ? { scoresA: { judgment: 5, tradeOff: 5 }, scoresB: { judgment: 3, tradeOff: 3 }, preferred: 'A', rationale: 'A makes the trade-off explicit.' }
        : packet('zent-churn')
      return { value: value as T, raw: JSON.stringify(value), model: 'codex-cli', tokensIn: 100, tokensOut: 50, ms: 12 }
    },
  }

  const result = await runPortfolioEvaluation({
    id: 'blind-judge', createdAt: NOW, caseId: 'shared-constraint', portfolio, question: 'What should I prioritize?',
    passages: [{ id: 'tester/discovery#0001', sourceId: 'tester/discovery', title: 'Discovery', author: 'Tester', text: 'Talk to customers before building.' }], provider: blindProvider,
  })

  assert.equal(calls.length, 4)
  assert.ok(calls.slice(2).every((system) => system.includes('blind strategic judge')))
  assert.equal(result.verdict, 'no_signal')
  assert.equal(result.judge?.model, 'codex-cli')
  assert.deepEqual(result.judge?.rounds.map((round) => round.order), ['founderos_first', 'context_dump_first'])
  assert.equal(result.scores?.founderos.judgment, 4)
  assert.equal(result.scores?.contextDump.judgment, 4)
})
