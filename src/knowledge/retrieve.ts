import type { Db } from './db.ts'
import { toVectorLiteral, type Embedder } from './embed.ts'
import type { RetrievalStatus } from './policy.ts'

export type Kind = 'claim' | 'principle' | 'framework'

export type Hit = {
  id: string
  kind: Kind
  authorId: string
  title: string
  text: string
  sourceId: string | null
  sourceVersionId: string | null
  retrievalStatus: RetrievalStatus | null
  lexicalRank: number | null
  vectorRank: number | null
  score: number
  rerankScore?: number
}

export type SearchOptions = {
  limit?: number
  kinds?: Kind[]
  authorId?: string
  sourceIds?: string[]
  sourceVersionIds?: string[]
  topics?: string[]
  formats?: string[]
  retrievalStatuses?: RetrievalStatus[]
  embedder?: Embedder
}

export type RetrievalTiming = {
  lexicalMs: number
  vectorMs: number
  fusionMs: number
  rerankMs: number
  totalMs: number
}

export type SearchResult = { hits: Hit[]; timing: RetrievalTiming }

const DEFAULT_LIMIT = 10
const CANDIDATES = 50
const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her', 'was', 'one', 'our',
  'out', 'his', 'has', 'had', 'how', 'its', 'who', 'get', 'she', 'him', 'they', 'them', 'this',
  'that', 'with', 'from', 'have', 'been', 'were', 'what', 'when', 'your', 'about', 'would',
  'there', 'their', 'which', 'should', 'could', 'into', 'more', 'than', 'then', 'some', 'any',
  'does', 'doing', 'just', 'like', 'over', 'only', 'very', 'much', 'many', 'well', 'also', 'or',
])

export function toLexicalQuery(query: string): string {
  const terms = [
    ...new Set(
      (query.toLowerCase().match(/[a-z0-9']{3,}/g) ?? []).filter((term) => !STOPWORDS.has(term)),
    ),
  ]
  return terms.join(' OR ')
}

const RRF_K = 60

function rrf(rank: number | null): number {
  return rank === null ? 0 : 1 / (RRF_K + rank)
}

function queryTerms(query: string): string[] {
  return [
    ...new Set(
      (query.toLowerCase().match(/[a-z0-9']{3,}/g) ?? []).filter((term) => !STOPWORDS.has(term)),
    ),
  ]
}

export function rerankFusedHits(query: string, hits: Hit[]): Hit[] {
  const terms = queryTerms(query)
  if (terms.length === 0) return hits

  return hits
    .map((hit) => {
      const haystack = `${hit.title} ${hit.text}`.toLowerCase()
      const coverage = terms.filter((term) => haystack.includes(term)).length / terms.length
      return { ...hit, rerankScore: hit.score + coverage * 0.02 }
    })
    .sort((a, b) => (b.rerankScore ?? b.score) - (a.rerankScore ?? a.score) || b.score - a.score || a.id.localeCompare(b.id))
}

type Row = {
  id: string
  kind: Kind
  author_id: string
  title: string
  text: string
  source_id: string | null
  source_version_id: string | null
  retrieval_status: RetrievalStatus | null
}

const UNIFIED = `
  SELECT c.id, 'claim'::text AS kind, s.author_id, s.title, c.text, c.source_id, c.source_version_id,
         s.kind AS source_kind, s.topics, s.retrieval_status, (sv.checksum = s.checksum) AS current_source_version,
         c.tsv, c.embedding
    FROM claims c
    JOIN sources s ON s.id = c.source_id
    JOIN source_versions sv ON sv.id = c.source_version_id
  UNION ALL
  SELECT p.id, 'principle'::text, p.author_id, p.title, p.statement, NULL::text, NULL::text,
         NULL::text, '{}'::text[], NULL::text, true, p.tsv, p.embedding
    FROM principles p
  UNION ALL
  SELECT f.id, 'framework'::text, f.author_id, f.name,
         f.when_to_use || ' | ' || f.steps_text, f.source_id, NULL::text,
         NULL::text, '{}'::text[], NULL::text, true, f.tsv, f.embedding
    FROM frameworks f
`

type FilterQuery = { sql: string; values: unknown[] }

function filters(options: SearchOptions, parameterStart: number): FilterQuery {
  const clauses: string[] = []
  const values: unknown[] = []
  const add = (condition: string, value: unknown): void => {
    clauses.push(condition.replace('?', `$${parameterStart + values.length}`))
    values.push(value)
  }

  if (options.kinds?.length) add('kind = ANY(?)', options.kinds)
  if (options.authorId) add('author_id = ?', options.authorId)
  if (options.sourceIds?.length) add('source_id = ANY(?)', options.sourceIds)
  if (options.sourceVersionIds?.length) add('source_version_id = ANY(?)', options.sourceVersionIds)
  if (options.topics?.length) add('topics && ?', options.topics)
  if (options.formats?.length) add('source_kind = ANY(?)', options.formats)
  if (options.retrievalStatuses?.length) add('retrieval_status = ANY(?)', options.retrievalStatuses)
  if (!options.sourceVersionIds?.length) clauses.push("(kind <> 'claim' OR current_source_version)")
  clauses.push("(kind <> 'claim' OR retrieval_status = 'approved')")

  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values }
}

function lexicalQuery(db: Db, query: string, options: SearchOptions) {
  const filter = filters(options, 3)
  const started = performance.now()
  return db
    .query<Row & { rank: number }>(
      `WITH u AS (${UNIFIED})
       SELECT id, kind, author_id, title, text, source_id, source_version_id, retrieval_status,
              ts_rank_cd(tsv, websearch_to_tsquery('english', $1), 32) AS rank
         FROM u
         ${filter.sql ? `${filter.sql} AND` : 'WHERE'} tsv @@ websearch_to_tsquery('english', $1)
        ORDER BY rank DESC
        LIMIT $2`,
      [query, CANDIDATES, ...filter.values],
    )
    .then((result) => ({ rows: result.rows, elapsedMs: performance.now() - started }))
}

async function vectorQuery(db: Db, query: string, options: SearchOptions) {
  const started = performance.now()
  const [vector] = await options.embedder!.embed([query])
  if (!vector) throw new Error('Embedder returned no vector for the query.')
  const filter = filters(options, 3)
  const result = await db.query<Row>(
    `WITH u AS (${UNIFIED})
     SELECT id, kind, author_id, title, text, source_id, source_version_id, retrieval_status
       FROM u
       ${filter.sql ? `${filter.sql} AND` : 'WHERE'} embedding IS NOT NULL
      ORDER BY embedding <=> $1::vector
      LIMIT $2`,
    [toVectorLiteral(vector), CANDIDATES, ...filter.values],
  )
  return { rows: result.rows, elapsedMs: performance.now() - started }
}

export async function searchMeasured(
  db: Db,
  query: string,
  options: SearchOptions = {},
): Promise<SearchResult> {
  const started = performance.now()
  const lexicalText = toLexicalQuery(query)
  if (!lexicalText) {
    return { hits: [], timing: { lexicalMs: 0, vectorMs: 0, fusionMs: 0, rerankMs: 0, totalMs: 0 } }
  }

  const lexical = lexicalQuery(db, lexicalText, options)
  const vector = options.embedder ? vectorQuery(db, query, options) : null
  const [lexicalResult, vectorResult] = await Promise.all([lexical, vector])

  const fusionStarted = performance.now()
  const byId = new Map<string, Row>()
  const lexicalRanks = new Map<string, number>()
  const vectorRanks = new Map<string, number>()

  for (const [index, row] of lexicalResult.rows.entries()) {
    byId.set(row.id, row)
    lexicalRanks.set(row.id, index + 1)
  }
  for (const [index, row] of (vectorResult?.rows ?? []).entries()) {
    if (!byId.has(row.id)) byId.set(row.id, row)
    vectorRanks.set(row.id, index + 1)
  }

  const candidates = [...byId.values()]
    .map((row) => {
      const lexicalRank = lexicalRanks.get(row.id) ?? null
      const vectorRank = vectorRanks.get(row.id) ?? null
      return {
        id: row.id,
        kind: row.kind,
        authorId: row.author_id,
        title: row.title,
        text: row.text,
        sourceId: row.source_id,
        sourceVersionId: row.source_version_id,
        retrievalStatus: row.retrieval_status,
        lexicalRank,
        vectorRank,
        score: rrf(lexicalRank) + rrf(vectorRank),
        rerankScore: rrf(lexicalRank) + rrf(vectorRank),
      }
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  const fusionMs = performance.now() - fusionStarted
  const rerankStarted = performance.now()
  const hits = rerankFusedHits(query, candidates).slice(0, options.limit ?? DEFAULT_LIMIT)
  const rerankMs = performance.now() - rerankStarted

  return {
    hits,
    timing: {
      lexicalMs: lexicalResult.elapsedMs,
      vectorMs: vectorResult?.elapsedMs ?? 0,
      fusionMs,
      rerankMs,
      totalMs: performance.now() - started,
    },
  }
}

export async function search(db: Db, query: string, options: SearchOptions = {}): Promise<Hit[]> {
  return (await searchMeasured(db, query, options)).hits
}

export async function stats(db: Db): Promise<Record<string, number>> {
  const rows = await db.query<{ label: string; n: string }>(`
    SELECT 'authors' AS label, count(*)::text AS n FROM authors
    UNION ALL SELECT 'sources', count(*)::text FROM sources
    UNION ALL SELECT 'source_versions', count(*)::text FROM source_versions
    UNION ALL SELECT 'ingestion_runs', count(*)::text FROM ingestion_runs
    UNION ALL SELECT 'claims', count(*)::text FROM claims
    UNION ALL SELECT 'claims_embedded', count(*)::text FROM claims WHERE embedding IS NOT NULL
    UNION ALL SELECT 'principles', count(*)::text FROM principles
    UNION ALL SELECT 'principle_evidence', count(*)::text FROM principle_evidence
    UNION ALL SELECT 'frameworks', count(*)::text FROM frameworks
  `)
  return Object.fromEntries(rows.rows.map((row) => [row.label, Number(row.n)]))
}
