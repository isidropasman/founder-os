import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { loadCorpus } from '../src/knowledge/corpus.ts'
import { check, connect, migrate, reset, type Db } from '../src/knowledge/db.ts'
import { ingest, type IngestResult } from '../src/knowledge/ingest.ts'
import { embedAll } from '../src/knowledge/ingest.ts'
import { hashEmbedder, type Embedder } from '../src/knowledge/embed.ts'
import {
  evaluateCitationFidelity,
  evaluateRetrievalGate,
  evaluateUtilityScores,
  loadDeterministicUtilityCases,
  loadRetrievalEvalCases,
  runDeterministicUtilityEvals,
  runRetrievalEvals,
  verifyDisplayedQuote,
  type RetrievalEvalCase,
} from '../src/knowledge/evals.ts'

const TEST_DB =
  process.env.FOUNDEROS_EVAL_TEST_DATABASE_URL ?? 'postgres://localhost:5432/founderos_evals_test'

let db: Db | null = null
let skipReason = ''

function completedIngest(result: IngestResult): void {
  if (!result.ok) assert.fail(result.reason)
}

before(async () => {
  const candidate = connect(TEST_DB)
  const health = await check(candidate)
  if (!health.ok) {
    await candidate.end()
    skipReason = health.reason
    return
  }
  db = candidate
  await reset(db)
  await migrate(db)
  completedIngest(await ingest(db, loadCorpus('test/fixtures/knowledge')))
})

after(async () => {
  await db?.end()
})

test('reports reciprocal rank, recall, and measured latency for a fixture corpus', async (t) => {
  if (!db) return t.skip(skipReason)
  const evaluation: RetrievalEvalCase = {
    id: 'pricing-new-customers',
    query: 'raise prices for new customers',
    expectedPassageIds: ['tester/pricing#0000'],
  }

  const report = await runRetrievalEvals(db, [evaluation])

  assert.equal(report.cases[0]?.reciprocalRank, 1)
  assert.equal(report.cases[0]?.recallAt10, 1)
  assert.ok((report.cases[0]?.latencyMs ?? 0) >= 0)
  assert.equal(report.aggregate.mrr, 1)
  assert.equal(report.aggregate.recallAt10, 1)
})

test('uses the supplied embedder while evaluating retrieval', async (t) => {
  if (!db) return t.skip(skipReason)
  await embedAll(db, hashEmbedder)
  let calls = 0
  const trackingEmbedder: Embedder = {
    id: 'tracking-hash',
    semantic: false,
    async embed(texts) {
      calls++
      return hashEmbedder.embed(texts)
    },
  }
  const evaluation: RetrievalEvalCase = {
    id: 'pricing-semantic-path',
    query: 'raise prices for new customers',
    expectedPassageIds: ['tester/pricing#0000'],
  }

  await runRetrievalEvals(db, [evaluation], { embedder: trackingEmbedder })

  assert.equal(calls, 1)
})

test('rejects a displayed quote that skips text inside its cited passage', () => {
  const result = verifyDisplayedQuote({
    passage: 'Talk to customers every week before changing the product.',
    quote: 'Talk to customers changing the product.',
  })

  assert.deepEqual(result, { ok: false, reason: 'Quote is not contiguous in the cited passage.' })
})

test('ships retrieval cases across the six founder decision areas', () => {
  const cases = loadRetrievalEvalCases()
  assert.deepEqual(
    cases.map((evaluation) => evaluation.id),
    ['customer-discovery', 'fundraising', 'gtm', 'hiring', 'pmf', 'pricing'],
  )
})

test('initial cohort has approved multi-author coverage for every founder category', () => {
  const corpus = loadCorpus()
  const authorIds = new Set(corpus.authors.keys())
  for (const author of ['sam-altman', 'steve-blank', 'andrew-chen', 'tomasz-tunguz']) {
    assert.ok(authorIds.has(author), `missing ${author}`)
  }
  assert.equal(
    corpus.skipped?.filter((source) => source.reason.startsWith('retrieval policy is ')).length ?? 0,
    0,
  )
  const topics = new Set([...corpus.authors.values()].flatMap((author) => author.domains))
  for (const category of ['pmf', 'customer-discovery', 'pricing', 'gtm', 'hiring', 'fundraising']) {
    assert.ok(topics.has(category), `missing ${category} coverage`)
  }
})

test('citation fidelity fails when a source quote does not resolve to the cited passage', () => {
  const result = evaluateCitationFidelity(
    {
      assertions: [
        {
          text: 'Talk to users.',
          basis: [{ kind: 'source', passageId: 'tester/discovery#0000', quote: 'Invented quote.' }],
        },
      ],
    },
    {
      startupPaths: new Set(),
      passages: new Map([['tester/discovery#0000', 'Talk to users before building.']]),
      ruleIds: new Set(),
    },
  )

  assert.equal(result.passed, false)
  assert.equal(result.fidelity, 0)
})

test('utility gate reports every founder category without a scored real answer', () => {
  const result = evaluateUtilityScores([])

  assert.equal(result.passed, false)
  assert.deepEqual(result.blockedCategories, [
    'pmf', 'customer-discovery', 'pricing', 'gtm', 'hiring', 'fundraising',
  ])
})

test('deterministic utility fixtures cover every founder category with grounded, actionable answers', () => {
  const report = runDeterministicUtilityEvals(loadDeterministicUtilityCases())

  assert.equal(report.passed, true)
  assert.equal(report.aggregate.citationFidelity, 1)
  assert.equal(report.aggregate.utilitySignalRate, 1)
  assert.deepEqual(
    report.cases.map((evaluation) => evaluation.category).sort(),
    ['customer-discovery', 'fundraising', 'gtm', 'hiring', 'pmf', 'pricing'],
  )
})

test('retrieval gate rejects a regression against its explicit baseline', () => {
  const result = evaluateRetrievalGate(
    { cases: [], aggregate: { mrr: 0.7, recallAt10: 0.79, p50Ms: 8, p95Ms: 31 } },
    { version: 1, mrr: 0.85, recallAt10: 0.9, p95Ms: 10 },
  )

  assert.equal(result.passed, false)
  assert.ok(result.failures.some((failure) => failure.includes('recall@10')))
  assert.ok(result.failures.some((failure) => failure.includes('p95')))
})
