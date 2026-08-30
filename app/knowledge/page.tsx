import { connect } from '../../src/knowledge/db.ts'
import { search, stats } from '../../src/knowledge/retrieve.ts'

export const dynamic = 'force-dynamic'

const STARTERS = ['recruit users manually', 'the best startup ideas', 'make a few users love you']

export default async function Library({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const query = (await searchParams).q ?? ''
  const db = connect()

  let hits: Awaited<ReturnType<typeof search>> = []
  let counts: Record<string, number> | null = null
  let failure = ''

  try {
    counts = await stats(db)
    if (query) hits = await search(db, query, { limit: 8, kinds: ['claim'] })
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
            <input
              className="input"
              name="q"
              defaultValue={query}
              placeholder="Search the essays…"
              aria-label="Search the library"
              autoComplete="off"
            />
            <button className="btn" type="submit">
              Search
            </button>
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

      {query && hits.length === 0 && !failure && (
        <p className="sub">Nothing matched. They may simply not have written about it.</p>
      )}

      {hits.length > 0 && (
        <section className="in">
          <p className="meta">Matched on keywords, not meaning.</p>
          <div style={{ marginTop: '1rem' }}>
            {hits.map((hit) => (
              <div className="excerpt" key={hit.id}>
                <div className="excerpt__head">
                  <span className="excerpt__title">{hit.title}</span>
                  <span className="excerpt__id">{hit.id}</span>
                </div>
                <p className="excerpt__text">{hit.text}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
