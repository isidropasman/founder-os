'use client'

import { useState, useTransition } from 'react'
import type { PortfolioChallenge } from '../../src/portfolio/advisor.ts'
import type { Portfolio, PortfolioPacket } from '../../src/portfolio/contracts.ts'
import {
  approvePortfolioPacket,
  createPortfolioProject,
  generatePortfolioPacket,
  modifyPortfolioPacket,
  recordPortfolioEvidence,
  rejectPortfolioPacket,
  reviewPortfolioDecision,
  type PortfolioAction,
} from './actions.ts'

function recordId(kind: string, text: string): string {
  const stem = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'record'
  return `${kind}-${Date.now()}-${stem}`
}

export function PortfolioConsole({ initial }: { initial: Portfolio }) {
  const [portfolio, setPortfolio] = useState(initial)
  const [packet, setPacket] = useState<PortfolioPacket | null>(initial.packets.find((item) => item.status === 'proposed' || item.status === 'modified') ?? null)
  const [challenge, setChallenge] = useState<PortfolioChallenge | null>(null)
  const [message, setMessage] = useState('')
  const [projectName, setProjectName] = useState('')
  const [recordProjectId, setRecordProjectId] = useState(initial.projects[0]?.id ?? '')
  const [recordKind, setRecordKind] = useState('metric')
  const [recordText, setRecordText] = useState('')
  const [recordValue, setRecordValue] = useState('')
  const [question, setQuestion] = useState('What is the one priority this week?')
  const [minimumAction, setMinimumAction] = useState(packet?.minimumAction ?? '')
  const [reviewDecisionId, setReviewDecisionId] = useState('')
  const [reviewEvidence, setReviewEvidence] = useState('')
  const [reviewValue, setReviewValue] = useState('')
  const [reviewNote, setReviewNote] = useState('')
  const [pending, start] = useTransition()

  const apply = (result: PortfolioAction) => {
    if (!result.ok) {
      setMessage(result.message)
      return
    }
    setPortfolio(result.portfolio)
    if (result.packet === null) {
      setPacket(null)
    } else if (result.packet) {
      setPacket(result.packet)
      setMinimumAction(result.packet.minimumAction)
    }
    if (result.challenge) setChallenge(result.challenge)
    setMessage('Saved.')
  }

  return (
    <div className="stack">
      <section className="in">
        <p className="eyebrow">One founder · many bets</p>
        <h1>Portfolio</h1>
        <p className="sub">The record is local. A recommendation is not a decision until you approve it.</p>
      </section>

      <section className="in">
        <h2>Add project</h2>
        <form onSubmit={(event) => { event.preventDefault(); start(async () => { const result = await createPortfolioProject(projectName); apply(result); if (result.ok) { setProjectName(''); setRecordProjectId(result.portfolio.projects.at(-1)?.id ?? '') } }) }} style={{ marginTop: '1rem' }}>
          <div className="search"><input className="input" value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="Project name" aria-label="Project name" /><button className="btn" disabled={pending || !projectName.trim()}>Add project</button></div>
        </form>
        {portfolio.projects.length === 0 ? <p className="quiet" style={{ marginTop: '1rem' }}>Create the first project before recording evidence.</p> : <div className="tags" style={{ marginTop: '1rem' }}>{portfolio.projects.map((project) => <span className="tag" key={project.id}>{project.name}</span>)}</div>}
      </section>

      <section className="in">
        <h2>Record evidence</h2>
        <form onSubmit={(event) => { event.preventDefault(); start(async () => { const numericValue = recordValue.trim() ? Number(recordValue) : null; const result = await recordPortfolioEvidence({ id: recordId(recordKind, recordText), kind: recordKind as 'goal' | 'constraint' | 'metric' | 'signal' | 'meeting' | 'hypothesis' | 'experiment' | 'evidence', projectId: recordProjectId || null, observedAt: new Date().toISOString(), text: recordText, numericValue, origin: 'founder', confidence: 1 }); apply(result); if (result.ok) { setRecordText(''); setRecordValue('') } }) }} style={{ marginTop: '1rem' }}>
          <div className="stack" style={{ gap: '0.75rem' }}>
            <select className="input" value={recordProjectId} onChange={(event) => setRecordProjectId(event.target.value)} aria-label="Project for evidence"><option value="">Founder-wide</option>{portfolio.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
            <select className="input" value={recordKind} onChange={(event) => setRecordKind(event.target.value)} aria-label="Evidence type">{['goal', 'constraint', 'metric', 'signal', 'meeting', 'hypothesis', 'experiment', 'evidence'].map((kind) => <option key={kind}>{kind}</option>)}</select>
            <input className="input" value={recordText} onChange={(event) => setRecordText(event.target.value)} placeholder="What happened or what is true?" aria-label="Evidence text" />
            <input className="input" type="number" value={recordValue} onChange={(event) => setRecordValue(event.target.value)} placeholder="Numeric value, if relevant" aria-label="Numeric value" />
            <button className="btn" disabled={pending || !recordText.trim()}>Record evidence</button>
          </div>
        </form>
        {portfolio.records.length > 0 && <div className="rows" style={{ marginTop: '1rem' }}>{portfolio.records.map((record) => <div className="row" key={record.id}><div className="row__body"><p className="row__title">{record.text}</p><p className="row__note">{record.kind} · {record.scope === 'project' ? record.projectId : 'founder-wide'} · {record.sourceStatus}</p></div>{record.numericValue !== null && <span className="row__aside">{record.numericValue}</span>}</div>)}</div>}
      </section>

      <section className="in">
        <h2>Weekly decision</h2>
        <form onSubmit={(event) => { event.preventDefault(); start(async () => apply(await generatePortfolioPacket(question))) }} style={{ marginTop: '1rem' }}>
          <div className="search"><input className="input" value={question} onChange={(event) => setQuestion(event.target.value)} aria-label="Portfolio question" /><button className="btn" disabled={pending || portfolio.projects.length === 0}>Generate weekly decision</button></div>
        </form>
        {packet && <div className="rows" style={{ marginTop: '1.5rem' }}>
          <div className="row"><div className="row__body"><p className="row__title">{packet.recommendedPriority}</p><p className="row__note">Stop: {packet.stopDoing}</p><p className="row__note">Cost: {packet.opportunityCost}</p><p className="row__note">Evidence: {packet.directEvidenceIds.join(', ')} · Baseline: {packet.baselineEvidenceId} · Review {packet.reviewDate}</p><p className="row__note">Inference: {packet.inferences.join(' ')}</p></div></div>
          <input className="input" value={minimumAction} onChange={(event) => setMinimumAction(event.target.value)} aria-label="Minimum action" />
          <div className="tags"><button className="btn" onClick={() => start(async () => apply(await modifyPortfolioPacket(packet, { minimumAction })))} disabled={pending}>Modify</button><button className="btn" onClick={() => start(async () => apply(await approvePortfolioPacket(packet)))} disabled={pending}>Approve</button><button className="tag" onClick={() => start(async () => apply(await rejectPortfolioPacket(packet, 'Founder rejected the recommendation.')))} disabled={pending}>Reject</button></div>
          {challenge && <p className="quiet">Challenger: {challenge.cheapestExperiment}{challenge.contradictoryEvidenceIds.length > 0 ? ` · Contradictions: ${challenge.contradictoryEvidenceIds.join(', ')}` : ''}{challenge.crossProjectConflicts.length > 0 ? ` · ${challenge.crossProjectConflicts.join(' ')}` : ''}</p>}
        </div>}
      </section>

      <section className="in">
        <h2>Review outcome</h2>
        <form onSubmit={(event) => { event.preventDefault(); start(async () => apply(await reviewPortfolioDecision(reviewDecisionId, reviewEvidence ? reviewEvidence.split(',').map((value) => value.trim()).filter(Boolean) : [], reviewValue.trim() ? Number(reviewValue) : null, reviewNote || 'No measurement recorded.'))) }} style={{ marginTop: '1rem' }}>
          <div className="stack" style={{ gap: '0.75rem' }}><select className="input" value={reviewDecisionId} onChange={(event) => setReviewDecisionId(event.target.value)} aria-label="Decision to review"><option value="">Choose an approved decision</option>{portfolio.decisions.map((decision) => <option key={decision.id} value={decision.id}>{decision.id}</option>)}</select><input className="input" value={reviewEvidence} onChange={(event) => setReviewEvidence(event.target.value)} placeholder="Observed evidence ids, comma separated" aria-label="Outcome evidence ids" /><input className="input" type="number" value={reviewValue} onChange={(event) => setReviewValue(event.target.value)} placeholder="Observed value" aria-label="Observed value" /><input className="input" value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="What happened?" aria-label="Outcome note" /><button className="btn" disabled={pending || !reviewDecisionId}>Record review</button></div>
        </form>
        {portfolio.outcomes.map((outcome) => <p className="row__note" key={outcome.id} style={{ marginTop: '0.75rem' }}>{outcome.status} · {outcome.note}{outcome.learning ? ` · Learning: ${outcome.learning.changed}` : ''}</p>)}
      </section>
      <p aria-live="polite" className={message === 'Saved.' ? 'meta' : 'quiet quiet--alert'}>{pending ? 'Working…' : message}</p>
    </div>
  )
}
