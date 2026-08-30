import type { ResolvedBasis } from '../../src/basis.ts'
import type { Counsel } from './actions.ts'

const KIND_LABEL: Record<ResolvedBasis['kind'], string> = {
  'your-data': 'Your data',
  source: 'Source',
  rule: 'Rule',
  inference: 'Its own judgment',
}

/**
 * The answer to "who is suggesting this", rendered where the claim is read rather
 * than as a footnote. Inference is shown, not hidden — a claim with nothing behind
 * it should look weaker than one with a number behind it.
 */
function Basis({ refs, attribution }: { refs: unknown; attribution: ResolvedBasis[] }) {
  if (!Array.isArray(refs) || refs.length === 0) return null
  const resolved = refs
    .map((ref) => attribution.find((a) => a.ref === ref))
    .filter((a): a is ResolvedBasis => Boolean(a))
  if (resolved.length === 0) return null

  return (
    <p className="basis">
      {resolved.map((item) => (
        <span className="basis__item" key={item.ref} data-kind={item.kind} title={item.detail ?? ''}>
          <span className="basis__kind">{KIND_LABEL[item.kind]}</span>
          {item.kind === 'inference' ? '' : ` ${item.label}`}
        </span>
      ))}
    </p>
  )
}

const HIDDEN = new Set(['expert_citations', 'confidence', 'question_for_you', 'next_action'])

function label(key: string): string {
  return key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())
}

function Field({
  name,
  value,
  attribution,
}: {
  name: string
  value: unknown
  attribution: ResolvedBasis[]
}) {
  if (value === null || value === undefined || value === '') return null
  if (Array.isArray(value) && value.length === 0) return null

  return (
    <section style={{ marginTop: '2.25rem' }}>
      <h2>{label(name)}</h2>
      {Array.isArray(value) ? (
        <div className="rows" style={{ marginTop: '0.75rem' }}>
          {value.map((item, index) => {
            const record = typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : null
            const head = record
              ? String(record.what ?? record.problem ?? record.option ?? record.text ?? record.claim ?? '')
              : String(item)
            const note = record
              ? Object.entries(record)
                  .filter(([k, v]) => typeof v === 'string' && v !== head && k !== 'severity' && k !== 'basis')
                  .map(([, v]) => String(v))
                  .join(' · ')
              : ''
            return (
              <div className="row" key={index}>
                <div className="row__body">
                  <p className="row__title">{head}</p>
                  {note && <p className="row__note">{note}</p>}
                  <Basis refs={record?.basis} attribution={attribution} />
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <p className="sub" style={{ marginTop: '0.5rem' }}>
          {String(value)}
        </p>
      )}
    </section>
  )
}

function Reasoned({ result }: { result: Extract<Counsel, { mode: 'reasoned' }> }) {
  const brief = result.brief
  const citations = (brief.expert_citations ?? []) as { principle_id: string }[]
  const challenge = result.challenge

  return (
    <div className="in" style={{ marginTop: '1rem' }}>
      {typeof brief.next_action === 'string' && (
        <section>
          <p className="eyebrow">Do this next</p>
          <h1>{brief.next_action}</h1>
        </section>
      )}

      {typeof brief.question_for_you === 'string' && brief.question_for_you && (
        <p className="quiet" style={{ marginTop: '1.75rem' }}>
          {brief.question_for_you}
        </p>
      )}

      {Object.entries(brief)
        .filter(([key]) => !HIDDEN.has(key) && !key.endsWith('_basis'))
        .map(([key, value]) => (
          <div key={key}>
            <Field name={key} value={value} attribution={result.attribution} />
            <Basis refs={brief[`${key}_basis`]} attribution={result.attribution} />
          </div>
        ))}

      {challenge && (
        <section style={{ marginTop: '2.25rem' }}>
          <h2>The strongest objection</h2>
          <p className="sub" style={{ marginTop: '0.5rem' }}>
            {String(challenge.strongest_objection)}
          </p>
        </section>
      )}

      <p className="meta" style={{ marginTop: '2.5rem' }}>
        Confidence {String(brief.confidence)} · {result.attribution.length} sources cited
        {citations.length > 0 && ''}
      </p>
    </div>
  )
}

function Offline({ result }: { result: Extract<Counsel, { mode: 'offline' }> }) {
  const top = result.signals[0]

  return (
    <div className="in" style={{ marginTop: '1rem' }}>
      <p className="quiet">
        No model is configured, so nothing was written for you. Here is what it would have reasoned
        over.
        {result.reason && ` ${result.reason.split('\n')[0]}`}
      </p>

      {top && (
        <section style={{ marginTop: '2.25rem' }}>
          <h2>From your own record</h2>
          <p className="sub" style={{ marginTop: '0.5rem' }}>
            {top.title}
          </p>
        </section>
      )}

      <section style={{ marginTop: '2.25rem' }}>
        <h2>Work through this</h2>
        <ol className="numbered" style={{ marginTop: '0.75rem' }}>
          {result.procedure.map((step, index) => (
            <li key={index}>{step}</li>
          ))}
        </ol>
      </section>

      {result.passages.length > 0 && (
        <section style={{ marginTop: '2.25rem' }}>
          <h2>What they wrote about it</h2>
          {!result.semantic && (
            <p className="meta" style={{ marginTop: '0.4rem' }}>
              Matched on keywords, not meaning — check the titles.
            </p>
          )}
          <div style={{ marginTop: '0.75rem' }}>
            {result.passages.slice(0, 3).map((passage) => (
              <div className="excerpt" key={passage.id}>
                <div className="excerpt__head">
                  <span className="excerpt__title">{passage.title}</span>
                  <span className="excerpt__id">{passage.id}</span>
                </div>
                <p className="excerpt__text">{passage.text}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

export function Answer({ result }: { result: Counsel }) {
  if (result.mode === 'error') {
    return (
      <p className="quiet quiet--alert in" style={{ marginTop: '1rem' }}>
        {result.message}
      </p>
    )
  }
  return result.mode === 'reasoned' ? <Reasoned result={result} /> : <Offline result={result} />
}
