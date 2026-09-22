import { loadExperts } from '../experts.ts'
import type { PoolClient } from 'pg'
import { loadCorpus, type Corpus, type Source } from './corpus.ts'
import type { Db } from './db.ts'
import { toVectorLiteral, type Embedder } from './embed.ts'
import { locateQuote } from './verify.ts'

export type IngestReport = {
  authors: number
  sources: number
  sourceVersions: number
  claims: number
  principles: number
  frameworks: number
  evidence: number
  unlocatedQuotes: string[]
  skipped: { sourceId: string; reason: string }[]
}

export type IngestResult =
  | { ok: true; report: IngestReport }
  | { ok: false; report: IngestReport; reason: string }

export function claimId(sourceId: string, ordinal: number): string {
  return `${sourceId}#${String(ordinal).padStart(4, '0')}`
}

async function sourceVersion(
  db: PoolClient,
  source: Source,
): Promise<string> {
  const existing = await db.query<{ id: string }>(
    'SELECT id FROM source_versions WHERE source_id = $1 AND checksum = $2',
    [source.id, source.checksum],
  )
  if (existing.rows[0]) return existing.rows[0].id

  const previous = await db.query<{ id: string }>(
    'SELECT id FROM source_versions WHERE source_id = $1 ORDER BY retrieved_at DESC, id DESC LIMIT 1',
    [source.id],
  )
  const versionId = previous.rows[0]
    ? `${source.id}@${source.checksum.replace(/^sha256:/, '')}`
    : source.id
  const inserted = await db.query<{ id: string }>(
    `INSERT INTO source_versions (id, source_id, checksum, raw_text, retrieved_at, supersedes_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (source_id, checksum) DO UPDATE SET checksum = EXCLUDED.checksum
     RETURNING id`,
    [versionId, source.id, source.checksum, source.text, source.retrievedAt, previous.rows[0]?.id ?? null],
  )
  const insertedId = inserted.rows[0]?.id
  if (!insertedId) throw new Error(`Source version was not created for ${source.id}.`)
  return insertedId
}

/**
 * Ingestion is idempotent and deterministic: same corpus in, same rows out, no
 * model involved. Re-running after editing a source replaces that source's claims
 * wholesale rather than accumulating orphans.
 */
function emptyReport(): IngestReport {
  return {
    authors: 0,
    sources: 0,
    sourceVersions: 0,
    claims: 0,
    principles: 0,
    frameworks: 0,
    evidence: 0,
    unlocatedQuotes: [],
    skipped: [],
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function ingest(db: Db, corpus: Corpus = loadCorpus()): Promise<IngestResult> {
  const experts = loadExperts()
  const report = emptyReport()
  report.skipped = [...(corpus.skipped ?? [])]
  const sourceVersions = new Map<string, string>()

  const client = await db.connect()
  let runId: string | null = null
  let transactionOpen = false
  try {
    const run = await client.query<{ id: string }>(
      `INSERT INTO ingestion_runs (status, normalizer)
       VALUES ('running', 'deterministic-v1')
       RETURNING id`,
    )
    runId = run.rows[0]?.id ?? null
    if (!runId) throw new Error('Ingestion run was not created.')

    await client.query('BEGIN')
    transactionOpen = true

    for (const author of corpus.authors.values()) {
      await client.query(
        `INSERT INTO authors (id, name, kind, confidence, domains, limitations)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, kind = EXCLUDED.kind,
           confidence = EXCLUDED.confidence, domains = EXCLUDED.domains,
           limitations = EXCLUDED.limitations`,
        [author.id, author.name, author.kind, author.confidence, author.domains, author.limitations],
      )
      report.authors++
    }

    // An expert pack may exist without a fetched corpus (paraphrase-only packs).
    // Register those authors too, so principles always have a parent row.
    for (const expert of experts.values()) {
      if (corpus.authors.has(expert.id)) continue
      await client.query(
        `INSERT INTO authors (id, name, kind, confidence, domains, limitations)
         VALUES ($1,$2,'person',$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, confidence = EXCLUDED.confidence,
           domains = EXCLUDED.domains, limitations = EXCLUDED.limitations`,
        [expert.id, expert.name, expert.confidence, expert.domains, expert.limitations],
      )
      report.authors++
    }

    for (const source of corpus.sources.values()) {
      await client.query(
        `INSERT INTO sources (id, author_id, title, kind, url, year, topics, retrieval_method, retrieval_status, redistribution, retrieved_at, checksum, raw_text)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, kind = EXCLUDED.kind,
           url = EXCLUDED.url, year = EXCLUDED.year, topics = EXCLUDED.topics,
           retrieval_method = EXCLUDED.retrieval_method, retrieval_status = EXCLUDED.retrieval_status,
           redistribution = EXCLUDED.redistribution,
           retrieved_at = EXCLUDED.retrieved_at, checksum = EXCLUDED.checksum, raw_text = EXCLUDED.raw_text`,
        [
          source.id,
          source.authorId,
          source.title,
          source.kind,
          source.url,
          source.year,
          source.topics,
          source.policy.method,
          source.policy.status,
          source.policy.redistribution,
          source.retrievedAt,
          source.checksum,
          source.text,
        ],
      )
      report.sources++

      const versionId = await sourceVersion(client, source)
      report.sourceVersions++
      sourceVersions.set(source.id, versionId)

      await client.query(
        `INSERT INTO ingestion_run_sources (run_id, source_version_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [runId, versionId],
      )

      await client.query('DELETE FROM claims WHERE source_version_id = $1', [versionId])
      for (const c of source.chunks) {
        await client.query(
          `INSERT INTO claims (id, source_id, source_version_id, ordinal, text, char_start, char_end)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [claimId(versionId, c.ordinal), source.id, versionId, c.ordinal, c.text, c.charStart, c.charEnd],
        )
        report.claims++
      }
    }

    for (const expert of experts.values()) {
      for (const principle of expert.principles) {
        await client.query(
          `INSERT INTO principles (id, author_id, title, statement, kind, applies_when)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, statement = EXCLUDED.statement,
             kind = EXCLUDED.kind, applies_when = EXCLUDED.applies_when`,
          [
            principle.id,
            expert.id,
            principle.title,
            principle.claim,
            principle.quoted ? 'quoted' : 'paraphrase',
            principle.appliesWhen,
          ],
        )
        report.principles++

        await client.query('DELETE FROM principle_evidence WHERE principle_id = $1', [principle.id])
        if (!principle.quote || !principle.sourceId) continue

        const located = locateQuote(
          corpus,
          principle.sourceId,
          principle.quote,
          sourceVersions.get(principle.sourceId) ?? principle.sourceId,
        )
        if (!located) {
          report.unlocatedQuotes.push(principle.id)
          continue
        }
        await client.query(
          `INSERT INTO principle_evidence (principle_id, claim_id, quote) VALUES ($1,$2,$3)
           ON CONFLICT DO NOTHING`,
          [principle.id, located.claimId, principle.quote],
        )
        report.evidence++
      }

      for (const framework of expert.frameworks) {
        await client.query(
          `INSERT INTO frameworks (id, author_id, name, steps, when_to_use, source_id, steps_text)
           VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, steps = EXCLUDED.steps,
             when_to_use = EXCLUDED.when_to_use, source_id = EXCLUDED.source_id,
             steps_text = EXCLUDED.steps_text`,
          [
            framework.id,
            expert.id,
            framework.name,
            framework.steps,
            framework.whenToUse,
            framework.sourceId && corpus.sources.has(framework.sourceId) ? framework.sourceId : null,
            framework.steps.join(' '),
          ],
        )
        report.frameworks++
      }
    }

    await client.query(
      `UPDATE ingestion_runs
          SET status = 'succeeded', finished_at = now(), claim_count = $2
        WHERE id = $1`,
      [runId, report.claims],
    )
    await client.query('COMMIT')
    transactionOpen = false
    return { ok: true, report }
  } catch (error) {
    if (transactionOpen) await client.query('ROLLBACK')
    if (runId) {
      await client.query(
        `UPDATE ingestion_runs
            SET status = 'failed', finished_at = now(), failure = $2
          WHERE id = $1`,
        [runId, errorMessage(error)],
      )
    }
    return { ok: false, report: emptyReport(), reason: errorMessage(error) }
  } finally {
    client.release()
  }
}

const EMBED_BATCH = 64

export type EmbedReport = { table: string; embedded: number }[]

export async function embedAll(db: Db, embedder: Embedder): Promise<EmbedReport> {
  const report: EmbedReport = []

  for (const [table, column] of [
    ['claims', 'text'],
    ['principles', 'title || \' \' || statement'],
    ['frameworks', 'name || \' \' || when_to_use'],
  ] as const) {
    let embedded = 0
    for (;;) {
      const pending = await db.query<{ id: string; content: string }>(
        `SELECT id, ${column} AS content FROM ${table} WHERE embedding IS NULL LIMIT ${EMBED_BATCH}`,
      )
      if (pending.rows.length === 0) break
      const vectors = await embedder.embed(pending.rows.map((r) => r.content))
      for (const [index, row] of pending.rows.entries()) {
        const vector = vectors[index]
        if (!vector) throw new Error(`Embedder returned no vector for ${table} ${row.id}`)
        await db.query(`UPDATE ${table} SET embedding = $2::vector WHERE id = $1`, [
          row.id,
          toVectorLiteral(vector),
        ])
        embedded++
      }
    }
    report.push({ table, embedded })
  }

  return report
}
