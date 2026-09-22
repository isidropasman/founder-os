import { z } from 'zod'
import type { Passage } from '../knowledge/consult.ts'
import { containsQuote } from '../knowledge/text.ts'

const ISO = z.string().datetime()
const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const Scope = z.enum(['founder', 'project'])
const Origin = z.enum(['founder', 'import', 'model', 'rule'])
const RecordKind = z.enum(['goal', 'constraint', 'metric', 'signal', 'meeting', 'hypothesis', 'experiment', 'evidence'])

const ProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  recordedAt: ISO,
  observedAt: ISO,
  origin: Origin,
  confidence: z.number().min(0).max(1),
})

const RecordSchema = z.object({
  id: z.string().min(1),
  kind: RecordKind,
  scope: Scope,
  projectId: z.string().min(1).nullable(),
  recordedAt: ISO,
  observedAt: ISO.nullable(),
  origin: Origin,
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(z.string()),
  text: z.string().min(1),
  numericValue: z.number().nullable(),
  sourceStatus: z.enum(['approved', 'blocked']),
  causal: z.boolean(),
})

const RelationSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['supports', 'contradicts', 'tests', 'cross_project']),
  fromProjectId: z.string().min(1),
  toProjectId: z.string().min(1),
  recordedAt: ISO,
  observedAt: ISO.nullable(),
  origin: Origin,
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(z.string()),
})

const AlternativeSchema = z.object({ option: z.string().min(1), rejectedBecause: z.string().min(1) })

const AssertionBasisSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('record'), id: z.string().min(1) }),
  z.object({ kind: z.literal('passage'), id: z.string().min(1), quote: z.string().min(1) }),
  z.object({ kind: z.literal('inference') }),
])

const AssertionSchema = z.object({
  text: z.string().min(1),
  basis: z.array(AssertionBasisSchema).min(1),
})

export const PortfolioPacketSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  projectId: z.string().min(1),
  createdAt: ISO,
  status: z.enum(['proposed', 'modified', 'approved', 'rejected']),
  recommendedPriority: z.string().min(1),
  stopDoing: z.string().min(1),
  opportunityCost: z.string().min(1),
  directEvidenceIds: z.array(z.string()).min(1),
  inferences: z.array(z.string()),
  alternatives: z.array(AlternativeSchema).min(1),
  criticalAssumption: z.string().min(1),
  minimumAction: z.string().min(1),
  expectedSignal: z.string().min(1),
  baselineEvidenceId: z.string().min(1),
  reviewDate: Day,
  causalEvidenceIds: z.array(z.string()),
  assertions: z.array(AssertionSchema).min(1),
})

const DecisionSchema = z.object({
  id: z.string().min(1),
  packetId: z.string().min(1),
  projectId: z.string().min(1),
  approvedAt: ISO,
  recordedAt: ISO,
  observedAt: ISO.nullable(),
  origin: Origin,
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(z.string()),
  status: z.enum(['open', 'reviewed']),
})

const ActionSchema = z.object({
  id: z.string().min(1),
  decisionId: z.string().min(1),
  projectId: z.string().min(1),
  text: z.string().min(1),
  recordedAt: ISO,
  observedAt: ISO.nullable(),
  origin: Origin,
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(z.string()),
  status: z.enum(['open', 'done']),
})

const LearningSchema = z.object({
  predicted: z.string().min(1),
  happened: z.string().min(1),
  changed: z.string().min(1),
  appliesToProjectId: z.string().min(1),
  evidenceIds: z.array(z.string()).min(1),
})

const OutcomeSchema = z.object({
  id: z.string().min(1),
  decisionId: z.string().min(1),
  projectId: z.string().min(1),
  status: z.enum(['pending', 'complete']),
  recordedAt: ISO,
  observedAt: ISO.nullable(),
  origin: Origin,
  confidence: z.number().min(0).max(1),
  evidenceIds: z.array(z.string()),
  observedValue: z.number().nullable(),
  note: z.string().min(1),
  learning: LearningSchema.nullable(),
})

export const PortfolioSchema = z.object({
  founderId: z.string().min(1),
  projects: z.array(ProjectSchema),
  records: z.array(RecordSchema),
  relations: z.array(RelationSchema),
  packets: z.array(PortfolioPacketSchema),
  decisions: z.array(DecisionSchema),
  actions: z.array(ActionSchema),
  outcomes: z.array(OutcomeSchema),
})

export type Portfolio = z.infer<typeof PortfolioSchema>
export type PortfolioPacket = z.infer<typeof PortfolioPacketSchema>
export type PortfolioRecord = z.infer<typeof RecordSchema>
export type PortfolioProject = z.infer<typeof ProjectSchema>
export type PortfolioOutcome = z.infer<typeof OutcomeSchema>
export type PortfolioAssertion = z.infer<typeof AssertionSchema>
export type PacketPatch = Partial<Pick<PortfolioPacket, 'recommendedPriority' | 'stopDoing' | 'opportunityCost' | 'criticalAssumption' | 'minimumAction' | 'expectedSignal' | 'baselineEvidenceId' | 'reviewDate'>>
export type Validation<T> = { ok: true; value: T } | { ok: false; issues: string[] }

const CAUSAL_LANGUAGE = /\b(cause|causes|caused|causing|drive|drives|drove|because of|resulted in|led to|therefore)\b/i

function recordById(portfolio: Portfolio, id: string): PortfolioRecord | undefined {
  return portfolio.records.find((record) => record.id === id)
}

function canUseEvidence(portfolio: Portfolio, projectId: string, record: PortfolioRecord): boolean {
  if (record.scope === 'founder' || record.projectId === projectId) return true
  if (!record.projectId) return false
  return portfolio.relations.some(
    (relation) =>
      relation.type === 'cross_project' &&
      ((relation.fromProjectId === projectId && relation.toProjectId === record.projectId) ||
        (relation.toProjectId === projectId && relation.fromProjectId === record.projectId)),
  )
}

function evidenceIssues(portfolio: Portfolio, packet: PortfolioPacket, ids: readonly string[], field: string): string[] {
  const issues: string[] = []
  for (const id of ids) {
    const record = recordById(portfolio, id)
    if (!record) issues.push(`${field}: ${id} is not available`)
    else if (record.sourceStatus !== 'approved') issues.push(`${field}: ${id} is blocked`)
    else if (!canUseEvidence(portfolio, packet.projectId, record)) issues.push(`${field}: ${id} belongs to another project`)
    else if (field === 'directEvidenceIds' && !['metric', 'signal', 'meeting', 'experiment', 'evidence'].includes(record.kind)) issues.push(`${field}: ${id} has an invalid evidence type`)
  }
  return issues
}

export function emptyPortfolio(founderId: string): Portfolio {
  return { founderId, projects: [], records: [], relations: [], packets: [], decisions: [], actions: [], outcomes: [] }
}

export function validatePortfolioPacket(input: unknown, portfolio: Portfolio): Validation<PortfolioPacket> {
  const parsed = PortfolioPacketSchema.safeParse(input)
  if (!parsed.success) return { ok: false, issues: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) }
  const packet = parsed.data
  const issues: string[] = []
  if (!portfolio.projects.some((project) => project.id === packet.projectId)) issues.push('projectId: project is not available')
  issues.push(...evidenceIssues(portfolio, packet, packet.directEvidenceIds, 'directEvidenceIds'))
  issues.push(...evidenceIssues(portfolio, packet, [packet.baselineEvidenceId], 'baselineEvidenceId'))
  issues.push(...evidenceIssues(portfolio, packet, packet.causalEvidenceIds, 'causalEvidenceIds'))
  const baseline = recordById(portfolio, packet.baselineEvidenceId)
  if (baseline && baseline.kind !== 'metric') issues.push('baselineEvidenceId: baseline must reference a metric')
  const allText = [packet.recommendedPriority, packet.stopDoing, packet.opportunityCost, packet.expectedSignal, ...packet.inferences].join(' ')
  if (CAUSAL_LANGUAGE.test(allText) && packet.causalEvidenceIds.length === 0) issues.push('causal language requires an experiment or explicit causal evidence')
  if (packet.causalEvidenceIds.length > 0) {
    const hasCausalProof = packet.causalEvidenceIds.some((id) => {
      const record = recordById(portfolio, id)
      return record?.causal || record?.kind === 'experiment'
    })
    if (!hasCausalProof) issues.push('causalEvidenceIds: link an experiment or causal evidence')
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: packet }
}

/**
 * A packet may make inferences, but each recommendation has to point back to an
 * approved portfolio record or to a verbatim quote from the retrieved KB slice.
 * The caller supplies that slice so a model cannot smuggle in an arbitrary claim id.
 */
export function validatePacketProvenance(input: unknown, portfolio: Portfolio, passages: readonly Passage[]): Validation<PortfolioPacket> {
  const checked = validatePortfolioPacket(input, portfolio)
  if (!checked.ok) return checked

  const packet = checked.value
  const availablePassages = new Map(passages.map((passage) => [passage.id, passage]))
  const issues: string[] = []
  let recommendationIsGrounded = false
  const assertionsByText = new Map(packet.assertions.map((assertion) => [assertion.text, assertion]))

  for (const assertion of packet.assertions) {
    let assertionHasDirectBasis = false
    for (const basis of assertion.basis) {
      if (basis.kind === 'inference') continue
      assertionHasDirectBasis = true
      if (basis.kind === 'record') {
        issues.push(...evidenceIssues(portfolio, packet, [basis.id], `assertion "${assertion.text}"`))
        continue
      }
      const passage = availablePassages.get(basis.id)
      if (!passage) {
        issues.push(`assertion "${assertion.text}": passage is not available: ${basis.id}`)
      } else if (!containsQuote(passage.text, basis.quote)) {
        issues.push(`assertion "${assertion.text}": quote is not available in ${basis.id}`)
      }
    }
    if (assertion.text === packet.recommendedPriority && assertionHasDirectBasis) recommendationIsGrounded = true
  }

  if (!recommendationIsGrounded) issues.push('recommendedPriority: needs direct record or passage provenance')
  for (const [field, text] of [
    ['stopDoing', packet.stopDoing],
    ['opportunityCost', packet.opportunityCost],
    ['criticalAssumption', packet.criticalAssumption],
    ['minimumAction', packet.minimumAction],
    ['expectedSignal', packet.expectedSignal],
  ] as const) {
    if (!assertionsByText.has(text)) issues.push(`${field}: needs a matching provenance assertion`)
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: packet }
}

function nowFrom(packet: PortfolioPacket): string {
  return packet.createdAt
}

export function rejectPacket(portfolio: Portfolio, packet: PortfolioPacket, _reason: string): Portfolio {
  return { ...portfolio, packets: [...portfolio.packets.filter((item) => item.id !== packet.id), { ...packet, status: 'rejected' }] }
}

export function modifyPacket(portfolio: Portfolio, packet: PortfolioPacket, patch: PacketPatch): Validation<Portfolio> {
  const modified = { ...packet, ...patch, status: 'modified' as const }
  const checked = validatePortfolioPacket(modified, portfolio)
  if (!checked.ok) return checked
  return { ok: true, value: { ...portfolio, packets: [...portfolio.packets.filter((item) => item.id !== packet.id), checked.value] } }
}

export function approvePacket(portfolio: Portfolio, packet: PortfolioPacket): Validation<Portfolio> {
  const checked = validatePortfolioPacket(packet, portfolio)
  if (!checked.ok) return checked
  if (packet.status === 'rejected') return { ok: false, issues: ['packet is rejected and cannot be approved'] }
  const approved = { ...checked.value, status: 'approved' as const }
  const decision = {
    id: approved.id,
    packetId: approved.id,
    projectId: approved.projectId,
    approvedAt: nowFrom(approved),
    recordedAt: nowFrom(approved),
    observedAt: null,
    origin: 'founder' as const,
    confidence: 1,
    evidenceIds: approved.directEvidenceIds,
    status: 'open' as const,
  }
  const action = {
    id: `${approved.id}:action`,
    decisionId: approved.id,
    projectId: approved.projectId,
    text: approved.minimumAction,
    recordedAt: nowFrom(approved),
    observedAt: null,
    origin: 'founder' as const,
    confidence: 1,
    evidenceIds: approved.directEvidenceIds,
    status: 'open' as const,
  }
  return {
    ok: true,
    value: {
      ...portfolio,
      packets: [...portfolio.packets.filter((item) => item.id !== packet.id), approved],
      decisions: [...portfolio.decisions.filter((item) => item.id !== decision.id), decision],
      actions: [...portfolio.actions.filter((item) => item.id !== action.id), action],
    },
  }
}

export type ReviewInput = { reviewedAt: string; evidenceIds: string[]; observedValue: number | null; note: string }

export function reviewDecision(portfolio: Portfolio, decisionId: string, review: ReviewInput): Validation<Portfolio> {
  const decision = portfolio.decisions.find((item) => item.id === decisionId)
  const packet = portfolio.packets.find((item) => item.id === decisionId)
  if (!decision || !packet) return { ok: false, issues: ['decision is not available'] }
  const issues = evidenceIssues(portfolio, packet, review.evidenceIds, 'outcome evidence')
  if (CAUSAL_LANGUAGE.test(review.note) && !review.evidenceIds.some((id) => {
    const record = recordById(portfolio, id)
    return record?.causal || record?.kind === 'experiment'
  })) issues.push('causal outcome language requires an experiment or causal evidence')
  if (issues.length > 0) return { ok: false, issues }
  const complete = review.evidenceIds.length > 0 && review.observedValue !== null
  const learning = complete
    ? {
        predicted: packet.expectedSignal,
        happened: review.note,
        changed: `Observed ${String(review.observedValue)} against baseline ${String(recordById(portfolio, packet.baselineEvidenceId)?.numericValue ?? 'unknown')}.`,
        appliesToProjectId: packet.projectId,
        evidenceIds: review.evidenceIds,
      }
    : null
  const outcome = {
    id: `${decisionId}:outcome`,
    decisionId,
    projectId: packet.projectId,
    status: complete ? 'complete' as const : 'pending' as const,
    recordedAt: review.reviewedAt,
    observedAt: complete ? review.reviewedAt : null,
    origin: 'founder' as const,
    confidence: complete ? 1 : 0,
    evidenceIds: review.evidenceIds,
    observedValue: review.observedValue,
    note: review.note,
    learning,
  }
  return {
    ok: true,
    value: {
      ...portfolio,
      decisions: portfolio.decisions.map((item) => item.id === decisionId ? { ...item, status: complete ? 'reviewed' as const : item.status } : item),
      outcomes: [...portfolio.outcomes.filter((item) => item.id !== outcome.id), outcome],
    },
  }
}
