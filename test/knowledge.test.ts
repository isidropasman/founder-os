import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { after, before, describe, test } from 'node:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadCorpus } from '../src/knowledge/corpus.ts'
import { check, connect, migrate, reset, type Db } from '../src/knowledge/db.ts'
import { hashEmbedder } from '../src/knowledge/embed.ts'
import { embedAll, ingest, type IngestReport, type IngestResult } from '../src/knowledge/ingest.ts'
import { parseSourceManifestEntry } from '../src/knowledge/policy.ts'
import { rerankFusedHits, search, stats, type Hit } from '../src/knowledge/retrieve.ts'
import { chunk } from '../src/knowledge/text.ts'
import { consult } from '../src/knowledge/consult.ts'
import { verifyQuotes } from '../src/knowledge/verify.ts'

const TEST_DB =
  process.env.FOUNDEROS_TEST_DATABASE_URL ?? 'postgres://localhost:5432/founderos_test'
const FIXTURE = 'test/fixtures/knowledge'

let db: Db | null = null
let skipReason = ''

function completedIngest(result: IngestResult): IngestReport {
  if (!result.ok) assert.fail(result.reason)
  return result.report
}

test('rejects a source entry without a reviewed acquisition policy', () => {
  const result = parseSourceManifestEntry({
    id: 'pmf',
    file: 'pmf.txt',
    title: 'PMF',
    kind: 'essay',
    retrieved_at: '2026-09-07',
  })
  assert.equal(result.ok, false)
  if (!result.ok) assert.ok(result.issues.includes('retrieval.status: Required'))
})

test('does not load a review-required source into the retrievable corpus', () => {
  const corpus = loadCorpus(FIXTURE)
  assert.equal(corpus.sources.has('review-required/draft'), false)
  assert.deepEqual(corpus.skipped, [
    { sourceId: 'review-required/draft', reason: 'retrieval policy is review_required' },
  ])
})

test('refuses a source file that escapes its author directory', () => {
  assert.throws(
    () => loadCorpus('test/fixtures/unsafe-corpus'),
    /source file must stay inside its author directory/,
  )
})

test('refuses a source file symlink that resolves outside its author directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'founderos-unsafe-corpus-'))
  try {
    mkdirSync(join(root, 'tester'))
    writeFileSync(join(root, 'outside.txt'), 'private material')
    symlinkSync('../outside.txt', join(root, 'tester', 'source.txt'))
    writeFileSync(
      join(root, 'tester', 'manifest.yaml'),
      `author:
  id: tester
  name: Tester
  kind: person
  confidence: high
  source_policy:
    retrieval:
      method: local_text
      status: approved
      retrieved_at: 2026-09-08
    redistribution: permitted
sources:
  - id: private
    file: source.txt
    title: Private material
    kind: essay
    retrieved_at: 2026-09-08
`,
    )

    assert.throws(
      () => loadCorpus(root),
      /resolved source file must stay inside its author directory/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('refuses non-HTTP canonical source URLs', () => {
  const result = parseSourceManifestEntry({
    id: 'unsafe-url',
    file: 'source.txt',
    title: 'Unsafe URL',
    kind: 'essay',
    url: 'javascript:alert(1)',
    retrieved_at: '2026-09-07',
    retrieval: { method: 'local_text', status: 'approved', retrieved_at: '2026-09-07' },
    redistribution: 'citation_only',
  })

  assert.equal(result.ok, false)
})

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
  test('reranks fused candidates by query coverage before applying the result limit', () => {
    const hits: Hit[] = [
      {
        id: 'tester/growth#0000', kind: 'claim', authorId: 'tester', title: 'Growth',
        text: 'Launch a broad campaign and measure conversion.', sourceId: 'tester/growth', sourceVersionId: 'tester/growth', retrievalStatus: 'approved',
        lexicalRank: 1, vectorRank: 1, score: 1,
      },
      {
        id: 'tester/pricing#0000', kind: 'claim', authorId: 'tester', title: 'Pricing',
        text: 'Price the product from the value customers receive.', sourceId: 'tester/pricing', sourceVersionId: 'tester/pricing', retrievalStatus: 'approved',
        lexicalRank: 2, vectorRank: 2, score: 0.99,
      },
    ]

    const ranked = rerankFusedHits('price product', hits)

    assert.equal(ranked[0]?.id, 'tester/pricing#0000')
    assert.ok(ranked[0]!.rerankScore! > ranked[1]!.rerankScore!)
  })

  test('records a failed ingestion run without indexing claims', async (t) => {
    if (!db) return t.skip(skipReason)
    await reset(db)
    await migrate(db)

    const corpus = loadCorpus(FIXTURE)
    const pricing = corpus.sources.get('tester/pricing')
    assert.ok(pricing)
    const result = await ingest(db, {
      authors: new Map(),
      sources: new Map([[pricing.id, pricing]]),
    })

    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.report.claims, 0)

    const run = await db.query<{ status: string }>(
      'SELECT status FROM ingestion_runs ORDER BY id DESC LIMIT 1',
    )
    const claims = await db.query<{ n: string }>('SELECT count(*)::text AS n FROM claims')
    assert.equal(run.rows[0]?.status, 'failed')
    assert.equal(claims.rows[0]?.n, '0')
  })

  test('preserves prior source versions when an approved source changes', async (t) => {
    if (!db) return t.skip(skipReason)
    await reset(db)
    await migrate(db)

    const original = loadCorpus(FIXTURE)
    completedIngest(await ingest(db, original))
    const pricing = original.sources.get('tester/pricing')
    assert.ok(pricing)

    const text = `${pricing.text}\n\nA changed source must keep its earlier version.`
    const changed = {
      authors: original.authors,
      sources: new Map(original.sources),
    }
    changed.sources.set(pricing.id, {
      ...pricing,
      checksum: 'sha256:changed-pricing-source-version',
      text,
      chunks: chunk(text),
    })

    completedIngest(await ingest(db, changed))

    const versions = await db.query<{ id: string; source_id: string }>(
      "SELECT id, source_id FROM source_versions WHERE source_id = 'tester/pricing' ORDER BY id",
    )
    assert.equal(versions.rows.length, 2)
    assert.ok(versions.rows.some((row) => row.id === 'tester/pricing'))
    assert.ok(
      versions.rows.some((row) => row.id === 'tester/pricing@changed-pricing-source-version'),
      'version ids retain the full checksum to avoid prefix collisions',
    )

    const claims = await db.query<{ source_version_id: string }>(
      "SELECT source_version_id FROM claims WHERE source_id = 'tester/pricing'",
    )
    assert.equal(new Set(claims.rows.map((row) => row.source_version_id)).size, 2)
  })

  test('retrieval filters claims to an explicit source version', async (t) => {
    if (!db) return t.skip(skipReason)
    await reset(db)
    await migrate(db)

    const original = loadCorpus(FIXTURE)
    const pricing = original.sources.get('tester/pricing')
    assert.ok(pricing)
    completedIngest(await ingest(db, original))

    const text = `${pricing.text}\n\nA new version has a different pricing conclusion.`
    completedIngest(
      await ingest(db, {
        authors: original.authors,
        sources: new Map([
          [
            pricing.id,
            {
              ...pricing,
              checksum: 'sha256:retrieval-source-version-filter',
              text,
              chunks: chunk(text),
            },
          ],
        ]),
      }),
    )

    const version = await db.query<{ id: string }>(
      "SELECT id FROM source_versions WHERE source_id = 'tester/pricing' ORDER BY id DESC LIMIT 1",
    )
    const hits = await search(db, 'raise prices for new customers', {
      sourceVersionIds: [version.rows[0]!.id],
    })

    assert.ok(hits.length > 0)
    assert.ok(hits.every((hit) => hit.sourceVersionId === version.rows[0]!.id))
  })

  test('ingestion is deterministic and idempotent', async (t) => {
    if (!db) return t.skip(skipReason)
    const corpus = loadCorpus(FIXTURE)
    assert.equal(corpus.sources.size, 2)

    const first = completedIngest(await ingest(db, corpus))
    const second = completedIngest(await ingest(db, corpus))
    assert.deepEqual(second, first, 're-ingesting the same corpus must not change the counts')

    const counts = await stats(db)
    assert.equal(counts.sources, 2)
    assert.ok((counts.claims ?? 0) > 0)
  })

  test('an ingestion run is linked to every source version it processed', async (t) => {
    if (!db) return t.skip(skipReason)
    await reset(db)
    await migrate(db)

    const corpus = loadCorpus(FIXTURE)
    completedIngest(await ingest(db, corpus))

    const sources = await db.query<{ n: string }>('SELECT count(*)::text AS n FROM ingestion_run_sources')
    assert.equal(sources.rows[0]?.n, String(corpus.sources.size))
  })

  test('persists the acquisition method, retrieval status and use condition with each source', async (t) => {
    if (!db) return t.skip(skipReason)
    await reset(db)
    await migrate(db)
    completedIngest(await ingest(db, loadCorpus(FIXTURE)))

    const source = await db.query<{ retrieval_method: string; retrieval_status: string; redistribution: string }>(
      "SELECT retrieval_method, retrieval_status, redistribution FROM sources WHERE id = 'tester/pricing'",
    )
    assert.deepEqual(source.rows[0], {
      retrieval_method: 'local_text',
      retrieval_status: 'approved',
      redistribution: 'permitted',
    })
  })

  test('lexical search finds the right source without any embeddings', async (t) => {
    if (!db) return t.skip(skipReason)
    completedIngest(await ingest(db, loadCorpus(FIXTURE)))

    const hits = await search(db, 'raise prices on new customers', { limit: 5 })
    assert.ok(hits.length > 0, 'expected lexical hits')
    assert.ok(hits[0]!.id.startsWith('tester/pricing'), `got ${hits[0]!.id}`)
    assert.equal(hits[0]!.vectorRank, null, 'no embeddings written yet')
    assert.equal(hits[0]!.lexicalRank, 1)
  })

  test('filters narrow by kind and author', async (t) => {
    if (!db) return t.skip(skipReason)
    completedIngest(await ingest(db, loadCorpus(FIXTURE)))

    const claims = await search(db, 'hiring coordination team', { kinds: ['claim'] })
    assert.ok(claims.every((h) => h.kind === 'claim'))
    assert.ok(claims.every((h) => h.retrievalStatus === 'approved'))

    const other = await search(db, 'hiring coordination team', { authorId: 'nobody' })
    assert.equal(other.length, 0, 'an unknown author must return nothing, not everything')

    const unapproved = await search(db, 'hiring coordination team', { retrievalStatuses: ['blocked'] })
    assert.equal(unapproved.length, 0, 'a retrieval-status filter must run before ranking')
  })

  test('does not retrieve a source after its approval is revoked', async (t) => {
    if (!db) return t.skip(skipReason)
    completedIngest(await ingest(db, loadCorpus(FIXTURE)))
    await db.query("UPDATE sources SET retrieval_status = 'blocked' WHERE id = 'tester/pricing'")

    const hits = await search(db, 'raise prices on new customers', { limit: 5 })

    assert.ok(hits.every((hit) => hit.sourceId !== 'tester/pricing'))
  })

  test('hybrid search fuses lexical and vector rankings', async (t) => {
    if (!db) return t.skip(skipReason)
    completedIngest(await ingest(db, loadCorpus(FIXTURE)))
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

  test('reports whether consultation actually used semantic retrieval', async (t) => {
    if (!db) return t.skip(skipReason)
    await reset(db)
    await migrate(db)
    completedIngest(await ingest(db, loadCorpus(FIXTURE)))

    const lexical = await consult({ query: 'raise prices for new customers', db })
    assert.equal(lexical.ok, true)
    if (!lexical.ok) return
    assert.equal(lexical.semantic, false)

    await embedAll(db, hashEmbedder)
    const hybrid = await consult({ query: 'raise prices for new customers', db, embedder: hashEmbedder })
    assert.equal(hybrid.ok, true)
    if (!hybrid.ok) return
    assert.equal(hybrid.semantic, true)
  })

  test('embedding is incremental — a second pass writes nothing new', async (t) => {
    if (!db) return t.skip(skipReason)
    completedIngest(await ingest(db, loadCorpus(FIXTURE)))
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
    const report = completedIngest(await ingest(db, real))
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
