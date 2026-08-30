import Link from 'next/link'
import { openWorkspace, selectContext } from '../src/context.ts'
import { detectSignals } from '../src/signals.ts'
import { isConfigured, progress } from '../src/setup.ts'

export const dynamic = 'force-dynamic'

export default function Today() {
  const root = process.env.FOUNDEROS_CONTEXT ?? './context/example'

  // Landing in someone else's company with no way in was the first thing wrong
  // with this product. An unconfigured workspace goes to setup instead.
  let workspace
  try {
    if (!isConfigured(root)) throw new Error('not configured')
    workspace = openWorkspace(root)
  } catch {
    return (
      <div className="stack in">
        <section>
          <p className="eyebrow">Nothing set up yet</p>
          <h1>Tell it about your company, and it starts telling you things.</h1>
          <p className="sub">
            About fifteen questions. It reads your numbers against your goals, checks what you
            decided and never revisited, and cites where every suggestion came from.
          </p>
          <p style={{ marginTop: '2rem' }}>
            <Link className="btn" href="/setup" style={{ textDecoration: 'none', display: 'inline-block' }}>
              Set up your company
            </Link>
          </p>
        </section>
      </div>
    )
  }

  const selected = selectContext(workspace, ['company'])
  const company = selected.company as Record<string, unknown>
  const signals = detectSignals(workspace, new Date())
  const lead = signals[0]
  const rest = signals.slice(1, 5)
  const missing = progress(root).filter((step) => !step.done)

  return (
    <div className="stack">
      <section className="headline in">
        <p className="eyebrow">
          {String(company.name)} · {String(company.runway_months)} months of runway
        </p>

        {lead ? (
          <>
            {lead.severity === 'blocking' && <span className="headline__flag">Needs a decision</span>}
            <h1>{lead.title}</h1>
            <p className="sub">{lead.detail}</p>
            {lead.skill && (
              <p style={{ marginTop: '1.75rem' }}>
                <Link
                  className="btn"
                  href={`/ask?skill=${lead.skill}&q=${encodeURIComponent(lead.title)}`}
                  style={{ textDecoration: 'none', display: 'inline-block' }}
                >
                  Think this through
                </Link>
              </p>
            )}
          </>
        ) : (
          <>
            <h1>Nothing is overdue.</h1>
            <p className="sub">
              No rule found anything to escalate — which is not the same as nothing being wrong.
            </p>
          </>
        )}
      </section>

      {rest.length > 0 && (
        <section className="in" style={{ animationDelay: '60ms' }}>
          <h2>Also worth knowing</h2>
          <div className="rows" style={{ marginTop: '1rem' }}>
            {rest.map((signal) => (
              <div className="row" key={signal.id}>
                <span className="row__dot" data-level={signal.severity} aria-hidden="true" />
                <div className="row__body">
                  <p className="row__title">{signal.title}</p>
                </div>
                {signal.skill && (
                  <Link
                    className="row__aside link"
                    href={`/ask?skill=${signal.skill}&q=${encodeURIComponent(signal.title)}`}
                  >
                    {signal.skill}
                  </Link>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="in" style={{ animationDelay: '120ms' }}>
        <p className="meta">Derived by rule from your own record. No model was called.</p>
        {missing.length > 0 && (
          <p className="quiet" style={{ marginTop: '1.25rem' }}>
            {missing[0]!.unlocks}{' '}
            <Link className="link" href="/setup">
              Add {missing[0]!.title.toLowerCase()}
            </Link>
            .
          </p>
        )}
      </section>
    </div>
  )
}
