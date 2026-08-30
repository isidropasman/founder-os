import { openWorkspace, selectContext } from '../../src/context.ts'

export const dynamic = 'force-dynamic'

type Row = Record<string, unknown>

export default function Company() {
  let workspace
  try {
    workspace = openWorkspace(process.env.FOUNDEROS_CONTEXT ?? './context/example')
  } catch {
    return (
      <div className="in">
        <h1>Nothing recorded yet.</h1>
        <p className="sub">
          Run <code>founderos init</code> to start.
        </p>
      </div>
    )
  }

  const selected = selectContext(workspace, [
    'company',
    'founder',
    'goals',
    'metrics',
    'feedback',
    'decisions_all',
  ])
  const company = selected.company as Row
  const founder = selected.founder as Row
  const goals = (selected.goals as Row[]).filter((g) => g.status === 'active')
  const metrics = selected.metrics as Row[]
  const open = (selected.decisions_all as Row[]).filter((d) => d.status === 'open')

  return (
    <div className="stack">
      <section className="in">
        <p className="eyebrow">{String(company.name)}</p>
        <h1>{String(company.one_liner)}</h1>
        <p className="sub">
          {String(company.stage)} · {String(company.team_size)} people · sells to{' '}
          {String(company.icp)}
        </p>
      </section>

      <section className="in" style={{ animationDelay: '60ms' }}>
        <h2>Where you are</h2>
        <div className="rows" style={{ marginTop: '1rem' }}>
          {metrics.map((metric) => (
            <div className="row" key={String(metric.name)}>
              <div className="row__body">
                <p className="row__title">{String(metric.name).replace(/_/g, ' ')}</p>
              </div>
              <span className="row__aside">{String(metric.value)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="in" style={{ animationDelay: '90ms' }}>
        <h2>Where you are going</h2>
        <div className="rows" style={{ marginTop: '1rem' }}>
          {goals.map((goal) => (
            <div className="row" key={String(goal.id)}>
              <div className="row__body">
                <p className="row__title">{String(goal.statement)}</p>
                <p className="row__note">by {String(goal.horizon)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {open.length > 0 && (
        <section className="in" style={{ animationDelay: '120ms' }}>
          <h2>Still open</h2>
          <div className="rows" style={{ marginTop: '1rem' }}>
            {open.map((decision) => (
              <div className="row" key={String(decision.id)}>
                <div className="row__body">
                  <p className="row__title">{String(decision.question)}</p>
                  <p className="row__note">{String(decision.decision)}</p>
                </div>
                <span className="row__aside">review {String(decision.review_date)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {Array.isArray(founder.weak_spots) && founder.weak_spots.length > 0 && (
        <section className="in" style={{ animationDelay: '150ms' }}>
          <h2>What you told it about yourself</h2>
          <p className="quiet" style={{ marginTop: '0.9rem' }}>
            {(founder.weak_spots as string[]).join(' · ')}
          </p>
          <p className="meta" style={{ marginTop: '0.75rem' }}>
            This is what stops it only ever suggesting things you enjoy.
          </p>
        </section>
      )}
    </div>
  )
}
