import { loadExperts } from '../experts.ts'
import { loadCorpus, type Corpus } from './corpus.ts'
import type { Db } from './db.ts'
import { toVectorLiteral, type Embedder } from './embed.ts'
import { locateQuote } from './verify.ts'

export type IngestReport = {
  authors: number
  sources: number
  claims: number
  principles: number
  frameworks: number
  evidence: number
  unlocatedQuotes: string[]
}

export function claimId(sourceId: string, ordinal: number): string {
  return `${sourceId}#${String(ordinal).padStart(4, '0')}`
}

/**
 * Ingestion is idempotent and deterministic: same corpus in, same rows out, no
 * model involved. Re-running after editing a source replaces that source's claims
 * wholesale rather than accumulating orphans.
 */
export async function ingest(db: Db, corpus: Corpus = loadCorpus()): Promise<IngestReport> {
  const experts = loadExperts()
  const report: IngestReport = {
    authors: 0,
    sources: 0,
    claims: 0,
    principles: 0,
    frameworks: 0,
    evidence: 0,
    unlocatedQuotes: [],
  }

  const client = await db.connect()
  try {
    await client.query('BEGIN')

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
        `INSERT INTO sources (id, author_id, title, kind, url, year, retrieved_at, checksum, raw_text)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, kind = EXCLUDED.kind,
           url = EXCLUDED.url, year = EXCLUDED.year, retrieved_at = EXCLUDED.retrieved_at,
           checksum = EXCLUDED.checksum, raw_text = EXCLUDED.raw_text`,
        [
          source.id,
          source.authorId,
          source.title,
          source.kind,
          source.url,
          source.year,
          source.retrievedAt,
          source.checksum,
          source.text,
        ],
      )
      report.sources++

      await client.query('DELETE FROM claims WHERE source_id = $1', [source.id])
      for (const c of source.chunks) {
        await client.query(
          `INSERT INTO claims (id, source_id, ordinal, text, char_start, char_end)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [claimId(source.id, c.ordinal), source.id, c.ordinal, c.text, c.charStart, c.charEnd],
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

        const located = locateQuote(corpus, principle.sourceId, principle.quote)
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

    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }

  return report
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
