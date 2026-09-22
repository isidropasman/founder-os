import { connect } from '../../src/knowledge/db.ts'
import { configuredSemanticEmbedder } from '../../src/knowledge/embed.ts'
import { stats } from '../../src/knowledge/retrieve.ts'
import {
  evaluateRetrievalGate,
  evaluateUtilityScores,
  loadDeterministicUtilityCases,
  loadRetrievalBaseline,
  loadRetrievalEvalCases,
  loadUtilityScores,
  runDeterministicUtilityEvals,
  runRetrievalEvals,
} from '../../src/knowledge/evals.ts'

export const dynamic = 'force-dynamic'

export default async function Evals() {
  const db = connect()
  let report: Awaited<ReturnType<typeof runRetrievalEvals>> | null = null
  let retrievalGate: ReturnType<typeof evaluateRetrievalGate> | null = null
  let deterministicUtility: ReturnType<typeof runDeterministicUtilityEvals> | null = null
  let utilityGate: ReturnType<typeof evaluateUtilityScores> | null = null
  let semantic = false
  let failure = ''
  try {
    const configuredEmbedder = configuredSemanticEmbedder()
    semantic = Boolean(configuredEmbedder && ((await stats(db)).claims_embedded ?? 0) > 0)
    report = await runRetrievalEvals(db, loadRetrievalEvalCases(), {
      ...(semantic && configuredEmbedder ? { embedder: configuredEmbedder } : {}),
    })
    retrievalGate = evaluateRetrievalGate(report, loadRetrievalBaseline())
    deterministicUtility = runDeterministicUtilityEvals(loadDeterministicUtilityCases())
    utilityGate = evaluateUtilityScores(loadUtilityScores())
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    await db.end()
  }

  return (
    <div className="stack">
      <section className="in">
        <h1>Retrieval evidence, measured.</h1>
        <p className="sub">Each case names expected passages. MRR and recall describe retrieval only; they do not claim answer quality.</p>
      </section>
      {failure ? <p className="quiet quiet--alert">{failure} Run <code>pnpm knowledge migrate</code> and <code>pnpm knowledge ingest</code>.</p> : null}
      {report ? (
        <section className="in">
          <p className="meta">{semantic ? 'hybrid lexical + semantic' : 'lexical only'} · MRR {report.aggregate.mrr.toFixed(3)} · recall@10 {report.aggregate.recallAt10.toFixed(3)} · p50 {report.aggregate.p50Ms.toFixed(1)}ms · p95 {report.aggregate.p95Ms.toFixed(1)}ms</p>
          <p className={retrievalGate?.passed ? 'quiet' : 'quiet quiet--alert'}>
            Retrieval regression gate: {retrievalGate?.passed ? 'pass' : retrievalGate?.failures.join(' · ')}
          </p>
          <p className={deterministicUtility?.passed ? 'quiet' : 'quiet quiet--alert'}>
            Fixture utility gate: {deterministicUtility?.passed
              ? `pass · citation fidelity ${deterministicUtility.aggregate.citationFidelity.toFixed(3)} · utility signals ${deterministicUtility.aggregate.utilitySignalRate.toFixed(3)}`
              : deterministicUtility?.cases
                  .filter((evaluation) => !evaluation.passed)
                  .flatMap((evaluation) => evaluation.failures)
                  .join(' · ')}
          </p>
          <p className={utilityGate?.blockedCategories.length ? 'quiet quiet--alert' : 'quiet'}>
            {utilityGate?.blockedCategories.length
              ? `Human utility gate blocked: ${utilityGate.blockedCategories.join(', ')} need real scored answers.`
              : utilityGate?.passed
                ? 'Human utility gate: pass'
                : `Human utility gate: ${utilityGate?.failures.join(' · ')}`}
          </p>
          <div className="rows eval-rows">
            {report.cases.map((result) => (
              <div className="row" key={result.id}>
                <div className="row__body">
                  <p className="row__title">{result.id}</p>
                  <p className="row__note">Expected: {result.expectedPassageIds.join(', ')}<br />Retrieved: {result.retrievedPassageIds.join(', ') || 'none'}</p>
                </div>
                <span className="row__aside">RR {result.reciprocalRank.toFixed(2)}<br />{result.latencyMs.toFixed(1)}ms</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}
