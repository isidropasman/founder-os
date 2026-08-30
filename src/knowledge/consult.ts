import { connect, check, type Db } from './db.ts'
import { embedderFor } from './embed.ts'
import { search } from './retrieve.ts'

export type Passage = {
  id: string
  sourceId: string
  title: string
  author: string
  text: string
}

export type Consultation =
  | { ok: true; passages: Passage[]; query: string; discarded: number }
  | { ok: false; reason: string }

const MAX_PASSAGE_CHARS = 900
const DEFAULT_LIMIT = 6
const CANDIDATES = 25
/** Same constant as the retrieval-side fusion; see src/knowledge/retrieve.ts. */
const RRF_K = 60

/**
 * A passage is shown only if BOTH the founder's wording and the skill's domain
 * vocabulary independently rank it. Hand-rolled stemming was tried first and was
 * worse than nothing: matching "value" by prefix pulled in "valuation", which is
 * precisely the confusion that made a pricing question return venture-funding
 * essays. Postgres already stems properly — requiring agreement between two of its
 * rankings is a real signal, a substring test is not.
 */
/**
 * The bridge between the Knowledge Base and the reasoning pass. Without this the
 * model only ever sees the dozen hand-written principles, and the 2800 claims sit
 * in Postgres doing nothing.
 *
 * Lexical by default: it needs no credentials, so consulting the corpus is free.
 * Semantic retrieval joins in only when embeddings exist.
 */
export async function consult(input: {
  /** The founder's question, in their words. */
  query: string
  /**
   * The skill's domain vocabulary, searched as a second query and fused with the
   * first. Merging both into one string lets a single ambiguous word dominate:
   * "should we raise prices" retrieved three essays about raising money, because
   * `raise` outweighed everything the pricing skill cares about. Fusing two
   * rankings instead rewards passages that both queries agree on.
   */
  domain?: string
  authors?: string[]
  limit?: number
  semantic?: boolean
  db?: Db
}): Promise<Consultation> {
  const db = input.db ?? connect()
  const owned = !input.db

  try {
    const health = await check(db)
    if (!health.ok) return { ok: false, reason: health.reason }

    const perAuthor = input.authors?.length ? input.authors : [undefined]
    const limit = input.limit ?? DEFAULT_LIMIT
    const queries = [input.query, input.domain].filter((q): q is string => Boolean(q?.trim()))

    const scores = new Map<string, number>()
    const matchedBy = new Map<string, Set<string>>()
    const found = new Map<string, Passage>()

    // Searching per author rather than once globally stops a single prolific
    // author from filling every slot when several are relevant.
    for (const author of perAuthor) {
      for (const query of queries) {
        const hits = await search(db, query, {
          limit: CANDIDATES,
          kinds: ['claim'],
          ...(author ? { authorId: author } : {}),
          ...(input.semantic ? { embedder: embedderFor() } : {}),
        })
        for (const [index, hit] of hits.entries()) {
          scores.set(hit.id, (scores.get(hit.id) ?? 0) + 1 / (RRF_K + index + 1))
          matchedBy.set(hit.id, (matchedBy.get(hit.id) ?? new Set()).add(query))
          if (found.has(hit.id)) continue
          found.set(hit.id, {
            id: hit.id,
            sourceId: hit.sourceId ?? hit.id.split('#')[0]!,
            title: hit.title,
            author: hit.authorId,
            text:
              hit.text.length > MAX_PASSAGE_CHARS
                ? `${hit.text.slice(0, MAX_PASSAGE_CHARS).trimEnd()}…`
                : hit.text,
          })
        }
      }
    }

    const ranked = [...found.values()].sort(
      (a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) || a.id.localeCompare(b.id),
    )

    const relevant =
      queries.length > 1
        ? ranked.filter((p) => (matchedBy.get(p.id)?.size ?? 0) === queries.length)
        : ranked

    return {
      ok: true,
      passages: relevant.slice(0, limit),
      query: queries.join(' | '),
      discarded: ranked.length - relevant.length,
    }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  } finally {
    if (owned) await db.end()
  }
}

/**
 * Rendered with ids the model can cite. Every line is verbatim source text, so a
 * quote drawn from here is traceable to a document by construction rather than by
 * the model's good intentions.
 */
export function renderPassages(passages: Passage[]): string {
  return passages
    .map((p) => `[${p.id}] ${p.author} — "${p.title}"\n${p.text.replace(/\n+/g, ' ')}`)
    .join('\n\n')
}

/** Claim ids look like `paul-graham/ds#0002`; principle ids like `paul-graham/P3`. */
export function isClaimId(id: string): boolean {
  return /#\d+$/.test(id)
}
