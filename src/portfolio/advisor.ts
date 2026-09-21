import type { Portfolio, PortfolioPacket, PortfolioRecord } from './contracts.ts'

export type AdvisorInput = { now: string; question: string }

export type PortfolioChallenge = {
  missingEvidence: string[]
  crossProjectConflicts: string[]
  founderBiasFlags: string[]
  untestedAssumptions: string[]
  contradictoryEvidenceIds: string[]
  cheapestExperiment: string
}

function dayAfter(iso: string, days: number): string {
  const date = new Date(iso)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function approved(records: readonly PortfolioRecord[], projectId: string, kind?: PortfolioRecord['kind']): PortfolioRecord[] {
  return records.filter((record) =>
    record.projectId === projectId && record.sourceStatus === 'approved' && (kind === undefined || record.kind === kind),
  )
}

function scoreProject(portfolio: Portfolio, projectId: string): number {
  return approved(portfolio.records, projectId).reduce((total, record) => total + record.confidence, 0)
}

export function buildPortfolioPacket(portfolio: Portfolio, input: AdvisorInput): PortfolioPacket {
  const project = [...portfolio.projects].sort((left, right) => scoreProject(portfolio, right.id) - scoreProject(portfolio, left.id))[0]
  if (!project) throw new Error('Create a project and record evidence before requesting a portfolio decision.')
  const signals = approved(portfolio.records, project.id, 'signal')
  const metrics = approved(portfolio.records, project.id, 'metric')
  const evidence = signals[0] ?? approved(portfolio.records, project.id)[0]
  const baseline = metrics[0]
  if (!evidence || !baseline) throw new Error('Record one approved signal and one approved metric for the project before requesting a decision.')
  const alternate = portfolio.projects.find((item) => item.id !== project.id)
  const action = `Run three customer interviews for ${project.name} before Friday.`
  return {
    id: `packet-${input.now.replace(/[^0-9]/g, '').slice(0, 14)}`,
    question: input.question,
    projectId: project.id,
    createdAt: input.now,
    status: 'proposed',
    recommendedPriority: `Investigate the highest-leverage customer problem in ${project.name}.`,
    stopDoing: alternate ? `Pause new ${alternate.name} work until this review.` : 'Pause new work unrelated to this evidence.',
    opportunityCost: alternate ? `Defers one week of ${alternate.name} progress.` : 'Defers one week of lower-confidence work.',
    directEvidenceIds: [evidence.id],
    inferences: [`The available ${project.name} signal is stronger than the current alternatives.`],
    alternatives: [{ option: 'Build before validating', rejectedBecause: 'The recorded signal does not identify a specific problem yet.' }],
    criticalAssumption: 'Customer interviews will reveal a repeatable problem worth prioritizing.',
    minimumAction: action,
    expectedSignal: 'At least two interviews name the same problem.',
    baselineEvidenceId: baseline.id,
    reviewDate: dayAfter(input.now, 7),
    causalEvidenceIds: [],
    assertions: [
      { text: `Investigate the highest-leverage customer problem in ${project.name}.`, basis: [{ kind: 'record', id: evidence.id }, { kind: 'record', id: baseline.id }] },
      { text: alternate ? `Pause new ${alternate.name} work until this review.` : 'Pause new work unrelated to this evidence.', basis: [{ kind: 'record', id: evidence.id }] },
      { text: alternate ? `Defers one week of ${alternate.name} progress.` : 'Defers one week of lower-confidence work.', basis: [{ kind: 'record', id: evidence.id }] },
      { text: 'Customer interviews will reveal a repeatable problem worth prioritizing.', basis: [{ kind: 'record', id: evidence.id }] },
      { text: action, basis: [{ kind: 'record', id: evidence.id }] },
      { text: 'At least two interviews name the same problem.', basis: [{ kind: 'record', id: baseline.id }] },
      { text: `The available ${project.name} signal is stronger than the current alternatives.`, basis: [{ kind: 'inference' }] },
    ],
  }
}

export function challengePortfolioPacket(portfolio: Portfolio, packet: PortfolioPacket): PortfolioChallenge {
  const direct = new Set(packet.directEvidenceIds)
  const contradictions = portfolio.relations
    .filter((relation) => relation.type === 'contradicts' && relation.evidenceIds.some((id) => direct.has(id)))
    .flatMap((relation) => relation.evidenceIds)
    .filter((id) => !direct.has(id))
  const crossProjectConflicts = portfolio.relations
    .filter((relation) => relation.type === 'cross_project' && (relation.fromProjectId === packet.projectId || relation.toProjectId === packet.projectId))
    .map((relation) => `This priority shares an explicit constraint with ${relation.fromProjectId === packet.projectId ? relation.toProjectId : relation.fromProjectId}.`)
  const missingEvidence = packet.directEvidenceIds.length === 0 ? ['No direct evidence supports the recommendation.'] : []
  return {
    missingEvidence,
    crossProjectConflicts,
    founderBiasFlags: [],
    untestedAssumptions: [packet.criticalAssumption],
    contradictoryEvidenceIds: [...new Set(contradictions)],
    cheapestExperiment: 'Interview three customers before building.',
  }
}
