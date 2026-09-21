import { connect } from '../../src/knowledge/db.ts'
import { loadCorpus } from '../../src/knowledge/corpus.ts'
import { searchMeasured, stats, type Hit, type Kind } from '../../src/knowledge/retrieve.ts'
import { PassageLink } from './passage.tsx'

export const dynamic = 'force-dynamic'

const STARTERS = ['recruit users manually', 'the best startup ideas', 'make a few users love you']

export default async function Library({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; author?: string; kind?: string; format?: string; 'retrieval-status'?: string; topic?: string; 'source-version'?: string; passage?: string }>
}) {
  const params = await searchParams
  const query = params.q ?? ''
  const supportedKinds: Kind[] = ['claim', 'principle', 'framework']
  const supportedFormats = ['essay', 'talk', 'book', 'post', 'transcript', 'note'] as const
  const supportedRetrievalStatuses = ['approved', 'review_required', 'blocked'] as const
  const kind = supportedKinds.find((value) => value === params.kind)
  const format = supportedFormats.find((value) => value === params.format)
  const retrievalStatus = supportedRetrievalStatuses.find((value) => value === params['retrieval-status'])
  const sourceVersionIds = params['source-version']?.split(',').filter(Boolean)
  const db = connect()

  let result: Awaited<ReturnType<typeof searchMeasured>> | null = null
  let counts: Record<string, number> | null = null
  let failure = ''
  let corpus: ReturnType<typeof loadCorpus> | null = null
  let selectedPassage: Hit | null = null

  try {
    counts = await stats(db)
    corpus = loadCorpus()
    if (params.passage) {
      const selected = await db.query<{
        id: string
        author_id: string
        title: string
        text: string
        source_id: string
        source_version_id: string
        retrieval_status: 'approved' | 'review_required' | 'blocked'
      }>(
        `SELECT c.id, s.author_id, s.title, c.text, c.source_id, c.source_version_id, s.retrieval_status
           FROM claims c JOIN sources s ON s.id = c.source_id
          WHERE c.id = $1 AND c.source_version_id = $2 AND s.retrieval_status = 'approved'`,
        [params.passage, params['source-version']],
      )
      const row = selected.rows[0]
      if (row) {
        selectedPassage = {
          id: row.id,
          kind: 'claim',
          authorId: row.author_id,
          title: row.title,
          text: row.text,
          sourceId: row.source_id,
          sourceVersionId: row.source_version_id,
          retrievalStatus: row.retrieval_status,
          lexicalRank: null,
          vectorRank: null,
          score: 0,
        }
      }
    }
    if (query) {
      result = await searchMeasured(db, query, {
        limit: 8,
        ...(params.author ? { authorId: params.author } : {}),
        ...(kind ? { kinds: [kind] } : {}),
        ...(format ? { formats: [format] } : {}),
        ...(retrievalStatus ? { retrievalStatuses: [retrievalStatus] } : {}),
        ...(params.topic ? { topics: [params.topic] } : {}),
        ...(sourceVersionIds?.length ? { sourceVersionIds } : {}),
      })
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    await db.end()
  }

  return (
    <div className="stack">
      <section className="in">
        <h1>The library</h1>
        <p className="sub">
          {counts
            ? `${counts.claims?.toLocaleString()} passages from ${counts.sources} essays. Verbatim, never paraphrased.`
            : 'Not reachable right now.'}
        </p>

        <form style={{ marginTop: '2rem' }}>
          <div className="search">
            <input className="input" name="q" defaultValue={query} placeholder="Search the evidence…" aria-label="Search the library" autoComplete="off" />
            <button className="btn" type="submit">
              Search
            </button>
          </div>
          <div className="filter-grid" aria-label="Library filters">
            <input className="input" name="author" defaultValue={params.author ?? ''} placeholder="Author id" aria-label="Filter by author" />
            <select className="input" name="kind" defaultValue={kind ?? ''} aria-label="Filter by record type">
              <option value="">Any record</option>
              {supportedKinds.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <select className="input" name="format" defaultValue={format ?? ''} aria-label="Filter by source format">
              <option value="">Any source format</option>
              {supportedFormats.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <select className="input" name="retrieval-status" defaultValue={retrievalStatus ?? ''} aria-label="Filter by retrieval status">
              <option value="">Any retrieval status</option>
              {supportedRetrievalStatuses.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <input className="input" name="topic" defaultValue={params.topic ?? ''} placeholder="Topic" aria-label="Filter by topic" />
            <input className="input" name="source-version" defaultValue={params['source-version'] ?? ''} placeholder="Source version" aria-label="Filter by source version" />
          </div>
          {!query && (
            <div className="tags" style={{ marginTop: '0.9rem' }}>
              {STARTERS.map((s) => (
                <a className="tag" key={s} href={`/knowledge?q=${encodeURIComponent(s)}`}>
                  {s}
                </a>
              ))}
            </div>
          )}
        </form>
      </section>

      {failure && (
        <p className="quiet quiet--alert">
          {failure} Run <code>./scripts/setup.sh</code>.
        </p>
      )}

      {query && result?.hits.length === 0 && !failure && (
        <p className="sub">Nothing matched. They may simply not have written about it.</p>
      )}

      {selectedPassage ? (
        <section className="in">
          <p className="meta">Exact passage · source version {selectedPassage.sourceVersionId}</p>
          <div className="excerpt">
            <div className="excerpt__head"><span className="excerpt__title">{selectedPassage.title}</span><span className="excerpt__id">{selectedPassage.id}</span></div>
            <p className="excerpt__text">{selectedPassage.text}</p>
          </div>
        </section>
      ) : null}

      {result && result.hits.length > 0 && (
        <section className="in">
          <p className="meta">
            lexical {result.timing.lexicalMs.toFixed(1)}ms · vector {result.timing.vectorMs.toFixed(1)}ms · fusion {result.timing.fusionMs.toFixed(1)}ms · total {result.timing.totalMs.toFixed(1)}ms
          </p>
          <div style={{ marginTop: '1rem' }}>
            {result.hits.map((hit) => {
              const source = hit.sourceId ? corpus?.sources.get(hit.sourceId) : null
              const modes = [hit.lexicalRank ? `lex#${hit.lexicalRank}` : null, hit.vectorRank ? `vec#${hit.vectorRank}` : null]
                .filter((value): value is string => Boolean(value))
                .join(' ')
              return (
              <div className="excerpt" key={hit.id}>
                <div className="excerpt__head">
                  <span className="excerpt__title">{hit.title}</span>
                  {hit.sourceVersionId ? <PassageLink passageId={hit.id} sourceVersionId={hit.sourceVersionId} /> : <span className="excerpt__id">{hit.id}</span>}
                </div>
                <p className="excerpt__text">{hit.text}</p>
                <p className="meta excerpt__meta">
                  {source ? `${source.authorId} · ${source.kind} · ${hit.retrievalStatus ?? source.policy.status} via ${source.policy.method}` : `${hit.authorId} · local record`}
                  {source ? ` · ${source.policy.redistribution}` : ''}
                  {hit.sourceVersionId ? ` · version ${hit.sourceVersionId}` : ''}
                  {source ? ` · ${source.checksum.slice(0, 19)}…` : ''}
                  {modes ? ` · ${modes}` : ''}
                </p>
                {source?.url ? <a className="link excerpt__source" href={source.url}>Open canonical source</a> : null}
              </div>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}
