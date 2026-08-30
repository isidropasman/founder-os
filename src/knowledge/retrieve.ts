import type { Db } from './db.ts'
import { toVectorLiteral, type Embedder } from './embed.ts'

export type Kind = 'claim' | 'principle' | 'framework'

export type Hit = {
  id: string
  kind: Kind
  authorId: string
  title: string
  text: string
  sourceId: string | null
  lexicalRank: number | null
  vectorRank: number | null
  score: number
}

export type SearchOptions = {
  limit?: number
  kinds?: Kind[]
  authorId?: string
  /** Omit to run lexical-only, which needs no credentials and no embeddings. */
  embedder?: Embedder
}

const DEFAULT_LIMIT = 10
const CANDIDATES = 50

/**
 * Reciprocal Rank Fusion. Chosen over score normalization because lexical rank
 * and cosine distance are not on comparable scales and never will be — RRF only
 * needs the orderings, so adding or removing a retrieval mode cannot silently
 * change the weighting of the others.
 */
const RRF_K = 60

// Anything shorter carries no retrieval signal, and `or`/`and` would corrupt the
// websearch syntax we build below.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her', 'was', 'one', 'our',
  'out', 'his', 'has', 'had', 'how', 'its', 'who', 'get', 'she', 'him', 'they', 'them', 'this',
  'that', 'with', 'from', 'have', 'been', 'were', 'what', 'when', 'your', 'about', 'would',
  'there', 'their', 'which', 'should', 'could', 'into', 'more', 'than', 'then', 'some', 'any',
  'does', 'doing', 'just', 'like', 'over', 'only', 'very', 'much', 'many', 'well', 'also', 'or',
])

/**
 * `websearch_to_tsquery` ANDs bare terms, so a long query — the pipeline appends
 * the skill's purpose to the founder's question — matches nothing at all and
 * retrieval silently returns zero rows. Joining with OR turns the query into a
 * graded relevance problem, which is what ts_rank_cd is for.
 */
export function toLexicalQuery(query: string): string {
  const terms = [
    ...new Set(
      (query.toLowerCase().match(/[a-z0-9']{3,}/g) ?? []).filter((t) => !STOPWORDS.has(t)),
    ),
  ]
  return terms.join(' OR ')
}

function rrf(rank: number | null): number {
  return rank === null ? 0 : 1 / (RRF_K + rank)
}

type Row = {
  id: string
  kind: Kind
  author_id: string
  title: string
  text: string
  source_id: string | null
}

const UNIFIED = `
  SELECT c.id, 'claim'::text AS kind, s.author_id, s.title, c.text, c.source_id, c.tsv, c.embedding
    FROM claims c JOIN sources s ON s.id = c.source_id
  UNION ALL
  SELECT p.id, 'principle'::text, p.author_id, p.title, p.statement, NULL::text, p.tsv, p.embedding
    FROM principles p
  UNION ALL
  SELECT f.id, 'framework'::text, f.author_id, f.name,
         f.when_to_use || ' | ' || f.steps_text, f.source_id, f.tsv, f.embedding
    FROM frameworks f
`

function filters(kinds: Kind[] | undefined, authorId: string | undefined, from: number): string {
  const clauses: string[] = []
  if (kinds?.length) clauses.push(`kind = ANY($${from++})`)
  if (authorId) clauses.push(`author_id = $${from++}`)
  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
}

export async function search(db: Db, query: string, options: SearchOptions = {}): Promise<Hit[]> {
  const limit = options.limit ?? DEFAULT_LIMIT
  const lexicalQuery = toLexicalQuery(query)
  if (!lexicalQuery) return []
  const extra: unknown[] = []
  if (options.kinds?.length) extra.push(options.kinds)
  if (options.authorId) extra.push(options.authorId)

  const lexical = await db.query<Row & { rank: number }>(
    `WITH u AS (${UNIFIED})
     SELECT id, kind, author_id, title, text, source_id,
            ts_rank_cd(tsv, websearch_to_tsquery('english', $1), 32) AS rank
       FROM u
       ${filters(options.kinds, options.authorId, 3)}
       ${filters(options.kinds, options.authorId, 3) ? 'AND' : 'WHERE'} tsv @@ websearch_to_tsquery('english', $1)
      ORDER BY rank DESC
      LIMIT $2`,
    [lexicalQuery, CANDIDATES, ...extra],
  )

  const byId = new Map<string, Row>()
  const lexicalRanks = new Map<string, number>()
  for (const [index, row] of lexical.rows.entries()) {
    byId.set(row.id, row)
    lexicalRanks.set(row.id, index + 1)
  }

  const vectorRanks = new Map<string, number>()
  if (options.embedder) {
    const [vector] = await options.embedder.embed([query])
    if (!vector) throw new Error('Embedder returned no vector for the query.')
    const semantic = await db.query<Row>(
      `WITH u AS (${UNIFIED})
       SELECT id, kind, author_id, title, text, source_id
         FROM u
        ${filters(options.kinds, options.authorId, 4)}
        ${filters(options.kinds, options.authorId, 4) ? 'AND' : 'WHERE'} embedding IS NOT NULL
        ORDER BY embedding <=> $1::vector
        LIMIT $2`,
      [toVectorLiteral(vector), CANDIDATES, ...extra],
    )
    for (const [index, row] of semantic.rows.entries()) {
      if (!byId.has(row.id)) byId.set(row.id, row)
      vectorRanks.set(row.id, index + 1)
    }
  }

  return [...byId.values()]
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
        lexicalRank,
        vectorRank,
        score: rrf(lexicalRank) + rrf(vectorRank),
      }
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, limit)
}

export async function stats(db: Db): Promise<Record<string, number>> {
  const rows = await db.query<{ label: string; n: string }>(`
    SELECT 'authors' AS label, count(*)::text AS n FROM authors
    UNION ALL SELECT 'sources', count(*)::text FROM sources
    UNION ALL SELECT 'claims', count(*)::text FROM claims
    UNION ALL SELECT 'claims_embedded', count(*)::text FROM claims WHERE embedding IS NOT NULL
    UNION ALL SELECT 'principles', count(*)::text FROM principles
    UNION ALL SELECT 'principle_evidence', count(*)::text FROM principle_evidence
    UNION ALL SELECT 'frameworks', count(*)::text FROM frameworks
  `)
  return Object.fromEntries(rows.rows.map((r) => [r.label, Number(r.n)]))
}
