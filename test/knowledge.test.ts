import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { loadCorpus } from '../src/knowledge/corpus.ts'
import { check, connect, migrate, reset, type Db } from '../src/knowledge/db.ts'
import { hashEmbedder } from '../src/knowledge/embed.ts'
import { embedAll, ingest } from '../src/knowledge/ingest.ts'
import { search, stats } from '../src/knowledge/retrieve.ts'
import { verifyQuotes } from '../src/knowledge/verify.ts'

const TEST_DB =
  process.env.FOUNDEROS_TEST_DATABASE_URL ?? 'postgres://localhost:5432/founderos_test'
const FIXTURE = 'test/fixtures/knowledge'

let db: Db | null = null
let skipReason = ''

before(async () => {
  const candidate = connect(TEST_DB)
  const health = await check(candidate)
  if (!health.ok) {
    await candidate.end()
    skipReason = `${health.reason} — run scripts/db-setup.sh`
    return
  }
  db = candidate
  await reset(db)
  await migrate(db)
})

after(async () => {
  await db?.end()
})

describe('knowledge retrieval', () => {
  test('ingestion is deterministic and idempotent', async (t) => {
    if (!db) return t.skip(skipReason)
    const corpus = loadCorpus(FIXTURE)
    assert.equal(corpus.sources.size, 2)

    const first = await ingest(db, corpus)
    const second = await ingest(db, corpus)
    assert.deepEqual(second, first, 're-ingesting the same corpus must not change the counts')

    const counts = await stats(db)
    assert.equal(counts.sources, 2)
    assert.ok((counts.claims ?? 0) > 0)
  })

  test('lexical search finds the right source without any embeddings', async (t) => {
    if (!db) return t.skip(skipReason)
    await ingest(db, loadCorpus(FIXTURE))

    const hits = await search(db, 'raise prices on new customers', { limit: 5 })
    assert.ok(hits.length > 0, 'expected lexical hits')
    assert.ok(hits[0]!.id.startsWith('tester/pricing'), `got ${hits[0]!.id}`)
    assert.equal(hits[0]!.vectorRank, null, 'no embeddings written yet')
    assert.equal(hits[0]!.lexicalRank, 1)
  })

  test('filters narrow by kind and author', async (t) => {
    if (!db) return t.skip(skipReason)
    await ingest(db, loadCorpus(FIXTURE))

    const claims = await search(db, 'hiring coordination team', { kinds: ['claim'] })
    assert.ok(claims.every((h) => h.kind === 'claim'))

    const other = await search(db, 'hiring coordination team', { authorId: 'nobody' })
    assert.equal(other.length, 0, 'an unknown author must return nothing, not everything')
  })

  test('hybrid search fuses lexical and vector rankings', async (t) => {
    if (!db) return t.skip(skipReason)
    await ingest(db, loadCorpus(FIXTURE))
    await embedAll(db, hashEmbedder)

    const hits = await search(db, 'afraid to charge more for the product', {
      limit: 10,
      embedder: hashEmbedder,
    })
    assert.ok(hits.length > 0)
    assert.ok(
      hits.some((h) => h.vectorRank !== null),
      'expected at least one hit ranked by the vector side',
    )
    // RRF must be monotonic in the returned ordering.
    for (let i = 1; i < hits.length; i++) {
      assert.ok(hits[i - 1]!.score >= hits[i]!.score, 'results must be sorted by fused score')
    }
    // A hit found by both retrievers must outscore one found by a single retriever
    // at the same rank — that is the whole point of fusing.
    const both = hits.find((h) => h.lexicalRank !== null && h.vectorRank !== null)
    if (both) {
      const single = hits.find((h) => h.lexicalRank === null || h.vectorRank === null)
      if (single) assert.ok(both.score > single.score)
    }
  })

  test('embedding is incremental — a second pass writes nothing new', async (t) => {
    if (!db) return t.skip(skipReason)
    await ingest(db, loadCorpus(FIXTURE))
    await embedAll(db, hashEmbedder)
    const second = await embedAll(db, hashEmbedder)
    assert.ok(
      second.every((row) => row.embedded === 0),
      'everything was already embedded',
    )
  })

  test('provenance links every quoted principle to a claim containing the quote', async (t) => {
    if (!db) return t.skip(skipReason)
    // Uses the real Paul Graham corpus, not the fixture: this is the check that
    // the shipped pack is actually grounded.
    const real = loadCorpus()
    if (real.sources.size === 0) return t.skip('no corpus fetched — run scripts/fetch-paul-graham.sh')

    await reset(db)
    await migrate(db)
    const report = await ingest(db, real)
    assert.deepEqual(report.unlocatedQuotes, [], 'every quote must resolve to a claim')

    const rows = await db.query<{ principle_id: string; quote: string; text: string }>(
      `SELECT pe.principle_id, pe.quote, c.text
         FROM principle_evidence pe JOIN claims c ON c.id = pe.claim_id`,
    )
    assert.ok(rows.rows.length > 0)
    for (const row of rows.rows) {
      const normalize = (s: string) => s.replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim()
      assert.ok(
        normalize(row.text).includes(normalize(row.quote)),
        `${row.principle_id}: stored quote is not inside its linked claim`,
      )
    }
  })
})

describe('quote verification', () => {
  test('every quoted principle in the shipped packs is located in the corpus', () => {
    const corpus = loadCorpus()
    if (corpus.sources.size === 0) return
    const result = verifyQuotes(corpus)
    const errors = result.findings.filter((f) => f.level === 'error')
    assert.deepEqual(
      errors.map((e) => `${e.principleId}: ${e.message}`),
      [],
    )
    assert.ok(result.quoted > 0, 'expected at least one verbatim quote to check')
  })
})
