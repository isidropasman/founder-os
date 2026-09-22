import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  approvePacket,
  emptyPortfolio,
  modifyPacket,
  rejectPacket,
  reviewDecision,
  validatePacketProvenance,
  validatePortfolioPacket,
  type Portfolio,
  type PortfolioPacket,
} from '../src/portfolio/contracts.ts'
import { buildPortfolioPacket, challengePortfolioPacket } from '../src/portfolio/advisor.ts'
import { addFounderRecord, createProject, loadPortfolio, savePortfolio } from '../src/portfolio/store.ts'
import { comparePortfolioArms } from '../src/portfolio/evals.ts'

const NOW = '2026-09-08T20:00:00.000Z'

function portfolio(): Portfolio {
  return {
    founderId: 'isidro',
    projects: [
      { id: 'zent', name: 'Zent', recordedAt: NOW, observedAt: NOW, origin: 'founder', confidence: 1 },
      { id: 'veris', name: 'Veris', recordedAt: NOW, observedAt: NOW, origin: 'founder', confidence: 1 },
    ],
    records: [
      { id: 'zent-mrr', kind: 'metric', scope: 'project', projectId: 'zent', recordedAt: NOW, observedAt: NOW, origin: 'founder', confidence: 1, evidenceIds: [], text: 'MRR is 2000', numericValue: 2000, sourceStatus: 'approved', causal: false },
      { id: 'zent-signal', kind: 'signal', scope: 'project', projectId: 'zent', recordedAt: NOW, observedAt: NOW, origin: 'founder', confidence: 0.8, evidenceIds: [], text: 'Three customers asked for integrations', numericValue: null, sourceStatus: 'approved', causal: false },
      { id: 'veris-signal', kind: 'signal', scope: 'project', projectId: 'veris', recordedAt: NOW, observedAt: NOW, origin: 'founder', confidence: 0.8, evidenceIds: [], text: 'Veris prospect replied', numericValue: null, sourceStatus: 'approved', causal: false },
      { id: 'blocked-source', kind: 'evidence', scope: 'project', projectId: 'zent', recordedAt: NOW, observedAt: NOW, origin: 'import', confidence: 1, evidenceIds: [], text: 'Blocked source', numericValue: null, sourceStatus: 'blocked', causal: false },
    ],
    relations: [],
    packets: [],
    decisions: [],
    actions: [],
    outcomes: [],
  }
}

function packet(overrides: Partial<PortfolioPacket> = {}): PortfolioPacket {
  return {
    id: 'packet-1',
    question: 'What is the one priority this week?',
    projectId: 'zent',
    createdAt: NOW,
    status: 'proposed',
    recommendedPriority: 'Interview three churned Zent customers.',
    stopDoing: 'Pause the Veris feature proposal.',
    opportunityCost: 'Delays a Veris experiment by one week.',
    directEvidenceIds: ['zent-signal'],
    inferences: ['Interviews are likely to identify the highest-leverage retention problem.'],
    alternatives: [{ option: 'Build integrations now', rejectedBecause: 'The request pattern is not yet specific.' }],
    criticalAssumption: 'The churned customers will identify a recurring problem.',
    minimumAction: 'Book three interviews by Friday.',
    expectedSignal: 'At least two interviews name the same problem.',
    baselineEvidenceId: 'zent-mrr',
    reviewDate: '2026-09-15',
    causalEvidenceIds: [],
    assertions: [
      { text: 'Interview three churned Zent customers.', basis: [{ kind: 'record', id: 'zent-signal' }, { kind: 'record', id: 'zent-mrr' }] },
      { text: 'Interviews are likely to identify the highest-leverage retention problem.', basis: [{ kind: 'inference' }] },
    ],
    ...overrides,
  }
}

const passages = [{ id: 'tester/pricing#0001', sourceId: 'tester/pricing', title: 'Pricing', author: 'Tester', text: 'Talk to customers before changing the product.' }]

test('rejects a packet passage absent from approved retrieval', () => {
  const result = validatePacketProvenance(packet({ assertions: [{ text: 'Use source.', basis: [{ kind: 'passage', id: 'missing#0001', quote: 'Use source.' }] }] }), portfolio(), passages)

  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.issues.join('\n'), /passage is not available/)
})

test('rejects an external assertion whose quote is not contiguous in its passage', () => {
  const result = validatePacketProvenance(packet({ assertions: [{ text: 'Use source.', basis: [{ kind: 'passage', id: 'tester/pricing#0001', quote: 'Invented quote.' }] }] }), portfolio(), passages)

  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.issues.join('\n'), /quote is not available/)
})

test('rejects a packet whose evidence belongs to another project', () => {
  const result = validatePortfolioPacket(packet({ directEvidenceIds: ['veris-signal'] }), portfolio())

  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.issues.join('\n'), /another project/)
})

test('rejects blocked evidence and packets without baseline or review date', () => {
  const blocked = validatePortfolioPacket(packet({ directEvidenceIds: ['blocked-source'] }), portfolio())
  const incomplete = validatePortfolioPacket(packet({ baselineEvidenceId: '', reviewDate: '' }), portfolio())

  assert.equal(blocked.ok, false)
  assert.equal(incomplete.ok, false)
})

test('rejects a non-evidence record as direct support', () => {
  const withGoal: Portfolio = {
    ...portfolio(),
    records: [...portfolio().records, { id: 'zent-goal', kind: 'goal', scope: 'project', projectId: 'zent', recordedAt: NOW, observedAt: NOW, origin: 'founder', confidence: 1, evidenceIds: [], text: 'Reach 10k MRR', numericValue: null, sourceStatus: 'approved', causal: false }],
  }
  const result = validatePortfolioPacket(packet({ directEvidenceIds: ['zent-goal'] }), withGoal)

  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.issues.join('\n'), /evidence type/)
})

test('rejects causal language without an experiment or causal evidence', () => {
  const result = validatePortfolioPacket(
    packet({ recommendedPriority: 'Interviewing churned customers will cause retention to increase.' }),
    portfolio(),
  )

  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.issues.join('\n'), /causal/)
})

test('rejected packets never create a decision or action', () => {
  const next = rejectPacket(portfolio(), packet(), 'Need more evidence')

  assert.equal(next.decisions.length, 0)
  assert.equal(next.actions.length, 0)
  assert.equal(next.packets[0]?.status, 'rejected')
})

test('modified packets must still be approved before creating a decision and action', () => {
  const modified = modifyPacket(portfolio(), packet(), { minimumAction: 'Book two interviews by Friday.' })
  assert.equal(modified.ok, true)
  if (!modified.ok) return
  assert.equal(modified.value.packets[0]?.status, 'modified')

  const approved = approvePacket(modified.value, modified.value.packets[0]!)
  assert.equal(approved.ok, true)
  if (!approved.ok) return
  assert.equal(approved.value.decisions.length, 1)
  assert.equal(approved.value.actions[0]?.decisionId, 'packet-1')
})

test('records a pending outcome when review has no measurement', () => {
  const approved = approvePacket(portfolio(), packet())
  assert.equal(approved.ok, true)
  if (!approved.ok) return

  const reviewed = reviewDecision(approved.value, 'packet-1', { reviewedAt: NOW, evidenceIds: [], observedValue: null, note: 'No interviews yet.' })
  assert.equal(reviewed.ok, true)
  if (!reviewed.ok) return
  assert.equal(reviewed.value.outcomes[0]?.status, 'pending')
})

test('records a complete outcome and a traceable learning with measured evidence', () => {
  const approved = approvePacket(portfolio(), packet())
  assert.equal(approved.ok, true)
  if (!approved.ok) return
  const withMeasurement: Portfolio = {
    ...approved.value,
    records: [...approved.value.records, { id: 'interview-count', kind: 'metric', scope: 'project', projectId: 'zent', recordedAt: NOW, observedAt: NOW, origin: 'founder', confidence: 1, evidenceIds: ['zent-signal'], text: 'Two interviews named activation.', numericValue: 2, sourceStatus: 'approved', causal: false }],
  }

  const reviewed = reviewDecision(withMeasurement, 'packet-1', { reviewedAt: NOW, evidenceIds: ['interview-count'], observedValue: 2, note: 'Two interviews named activation.' })
  assert.equal(reviewed.ok, true)
  if (!reviewed.ok) return
  const outcome = reviewed.value.outcomes[0]
  assert.equal(outcome?.status, 'complete')
  assert.ok(outcome?.learning)
  assert.equal(outcome?.learning?.appliesToProjectId, 'zent')
})

test('rejects causal outcome language without linked causal evidence', () => {
  const approved = approvePacket(portfolio(), packet())
  assert.equal(approved.ok, true)
  if (!approved.ok) return
  const result = reviewDecision(approved.value, 'packet-1', { reviewedAt: NOW, evidenceIds: [], observedValue: null, note: 'The interviews caused retention to increase.' })

  assert.equal(result.ok, false)
  if (!result.ok) assert.match(result.issues.join('\n'), /causal/)
})

test('empty portfolio is ready for an explicit founder-created project', () => {
  assert.deepEqual(emptyPortfolio('isidro').projects, [])
})

test('builds one scoped weekly priority with a baseline and review date', () => {
  const result = buildPortfolioPacket(portfolio(), { now: NOW, question: 'What is the one priority this week?' })

  assert.equal(result.projectId, 'zent')
  assert.equal(result.baselineEvidenceId, 'zent-mrr')
  assert.equal(result.reviewDate, '2026-09-15')
  assert.ok(result.directEvidenceIds.includes('zent-signal'))
})

test('challenger surfaces contradicting evidence and the cheapest experiment', () => {
  const withContradiction: Portfolio = {
    ...portfolio(),
    records: [...portfolio().records, { id: 'zent-contradiction', kind: 'signal', scope: 'project', projectId: 'zent', recordedAt: NOW, observedAt: NOW, origin: 'founder', confidence: 0.8, evidenceIds: [], text: 'Customers say integrations are not urgent.', numericValue: null, sourceStatus: 'approved', causal: false }],
    relations: [{ id: 'r-1', type: 'contradicts', fromProjectId: 'zent', toProjectId: 'zent', recordedAt: NOW, observedAt: NOW, origin: 'founder', confidence: 0.8, evidenceIds: ['zent-signal', 'zent-contradiction'] }],
  }

  const challenge = challengePortfolioPacket(withContradiction, packet())
  assert.ok(challenge.contradictoryEvidenceIds.includes('zent-contradiction'))
  assert.match(challenge.cheapestExperiment, /interview/i)
})

test('challenger names an explicit cross-project constraint', () => {
  const withConstraint: Portfolio = {
    ...portfolio(),
    relations: [{ id: 'shared-founder-time', type: 'cross_project', fromProjectId: 'zent', toProjectId: 'veris', recordedAt: NOW, observedAt: NOW, origin: 'founder', confidence: 1, evidenceIds: [] }],
  }
  const challenge = challengePortfolioPacket(withConstraint, packet())

  assert.equal(challenge.crossProjectConflicts.length, 1)
})

test('portfolio storage persists only founder-approved records', () => {
  const root = mkdtempSync(join(tmpdir(), 'founderos-portfolio-'))
  try {
    const created = createProject(emptyPortfolio('isidro'), 'Zent', NOW)
    assert.equal(created.ok, true)
    if (!created.ok) return
    const rejected = addFounderRecord(created.value, {
      id: 'model-claim', kind: 'signal', projectId: 'zent', observedAt: NOW, text: 'Extracted claim', numericValue: null, origin: 'model', confidence: 0.5,
    }, NOW)
    assert.equal(rejected.ok, false)
    const added = addFounderRecord(created.value, {
      id: 'zent-mrr', kind: 'metric', projectId: 'zent', observedAt: NOW, text: 'MRR is 2000', numericValue: 2000, origin: 'founder', confidence: 1,
    }, NOW)
    assert.equal(added.ok, true)
    if (!added.ok) return
    savePortfolio(join(root, 'portfolio.yaml'), added.value)
    assert.equal(loadPortfolio(join(root, 'portfolio.yaml')).records[0]?.id, 'zent-mrr')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('portfolio eval compares scoped reasoning against a raw context-dump arm', async () => {
  const calls: string[] = []
  const report = await comparePortfolioArms(portfolio(), 'What should I prioritize?', async (input) => {
    calls.push(input.mode)
    return input.mode === 'scoped' ? packet() : packet({ directEvidenceIds: ['veris-signal'] })
  })

  assert.deepEqual(calls, ['scoped', 'context_dump'])
  assert.equal(report.scoped.evidenceIntegrity, true)
  assert.equal(report.contextDump.projectContamination, true)
})
