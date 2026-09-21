import type { Passage } from '../knowledge/consult.ts'
import type { Provider } from '../provider.ts'
import { PortfolioPacketSchema, validatePacketProvenance, type Portfolio, type PortfolioPacket, type PortfolioRecord } from './contracts.ts'

export type PortfolioReasoningArm = 'founderos' | 'context_dump'

export type PortfolioContext = {
  arm: PortfolioReasoningArm
  selection: 'full_within_budget' | 'selected_over_budget' | 'context_dump'
  prompt: string
  selectedRecordIds: string[]
  selectedPassageIds: string[]
}

export type PortfolioGenerationAttempt = {
  prompt: string
  raw: string | null
  reason: string | null
  model: string
  tokensIn: number
  tokensOut: number
  ms: number
}

type PortfolioGenerationBase = {
  arm: PortfolioReasoningArm
  selection: PortfolioContext['selection']
  model: string
  tokensIn: number
  tokensOut: number
  ms: number
  prompt: string
  selectedRecordIds: string[]
  selectedPassageIds: string[]
  attempts: PortfolioGenerationAttempt[]
}

export type PortfolioGeneration =
  | (PortfolioGenerationBase & { ok: true; packet: PortfolioPacket; raw: string })
  | (PortfolioGenerationBase & { ok: false; reason: string; raw: string | null })

const DIRECT_KINDS: readonly PortfolioRecord['kind'][] = ['metric', 'signal', 'constraint', 'meeting', 'experiment', 'evidence']
const DIRECT_EVIDENCE_KINDS: readonly PortfolioRecord['kind'][] = ['metric', 'signal', 'meeting', 'experiment', 'evidence']
export const PORTFOLIO_CONTEXT_TOKEN_BUDGET = 3000

function recordRank(record: PortfolioRecord): number {
  const kind = DIRECT_KINDS.indexOf(record.kind)
  return (kind === -1 ? 0 : DIRECT_KINDS.length - kind) + record.confidence
}

function selectedRecords(portfolio: Portfolio): PortfolioRecord[] {
  const approved = portfolio.records.filter((record) => record.sourceStatus === 'approved')
  const founder = approved
    .filter((record) => record.scope === 'founder')
    .sort((left, right) => recordRank(right) - recordRank(left) || right.recordedAt.localeCompare(left.recordedAt))
    .slice(0, 3)
  const project = portfolio.projects.flatMap((project) =>
    approved
      .filter((record) => record.projectId === project.id)
      .sort((left, right) => recordRank(right) - recordRank(left) || right.recordedAt.localeCompare(left.recordedAt))
      .slice(0, 4),
  )
  return [...founder, ...project]
}

function renderPortfolio(portfolio: Portfolio, records: readonly PortfolioRecord[], includeHistory: boolean): string {
  return JSON.stringify(
    includeHistory
      ? portfolio
      : {
          founderId: portfolio.founderId,
          projects: portfolio.projects,
          records,
          relations: portfolio.relations.filter((relation) => relation.type === 'cross_project' || records.some((record) => relation.evidenceIds.includes(record.id))),
          outcomes: portfolio.outcomes.filter((outcome) => outcome.status === 'complete'),
        },
  )
}

function approximateTokens(value: string): number {
  return Math.ceil(value.length / 4)
}

function founderosRecords(portfolio: Portfolio): { records: PortfolioRecord[]; selection: PortfolioContext['selection'] } {
  const allRecords = portfolio.records
  return approximateTokens(renderPortfolio(portfolio, allRecords, false)) <= PORTFOLIO_CONTEXT_TOKEN_BUDGET
    ? { records: allRecords, selection: 'full_within_budget' }
    : { records: selectedRecords(portfolio), selection: 'selected_over_budget' }
}

function renderPassages(passages: readonly Passage[]): string {
  return passages
    .map((passage) => JSON.stringify({ id: passage.id, sourceId: passage.sourceId, title: passage.title, author: passage.author, text: passage.text }))
    .join('\n')
}

function canUseRecord(portfolio: Portfolio, projectId: string, record: PortfolioRecord): boolean {
  if (record.scope === 'founder' || record.projectId === projectId) return true
  if (!record.projectId) return false
  return portfolio.relations.some(
    (relation) =>
      relation.type === 'cross_project' &&
      ((relation.fromProjectId === projectId && relation.toProjectId === record.projectId) ||
        (relation.toProjectId === projectId && relation.fromProjectId === record.projectId)),
  )
}

function renderPacketConstraints(portfolio: Portfolio, visibleRecords: readonly PortfolioRecord[], passages: readonly Passage[]): string {
  const projects = portfolio.projects.map((project) => {
    const allowed = visibleRecords.filter((record) => record.sourceStatus === 'approved' && canUseRecord(portfolio, project.id, record))
    const direct = allowed.filter((record) => DIRECT_EVIDENCE_KINDS.includes(record.kind)).map((record) => record.id)
    const baseline = allowed.filter((record) => record.kind === 'metric').map((record) => record.id)
    const assertion = allowed.map((record) => record.id)
    const causal = allowed.filter((record) => record.causal || record.kind === 'experiment').map((record) => record.id)
    const eligible = direct.length > 0 && baseline.length > 0
    return [
      `For project ${project.id}: directEvidenceIds may only use: ${direct.join(', ') || '(none)'}.`,
      `baselineEvidenceId may only use: ${baseline.join(', ') || '(none)'}.`,
      `assertion record bases may only use: ${assertion.join(', ') || '(none)'}.`,
      `causalEvidenceIds may only use: ${causal.join(', ') || '(none)'}.`,
      eligible ? '' : 'Do not select this project because it has no eligible direct evidence and baseline metric.',
    ].join(' ')
  })
  return `Packet constraints:\n- Choose projectId from the listed projects.\n- ${projects.join('\n- ')}\n- Passage ids may only appear in assertion basis with a contiguous verbatim quote: ${passages.map((passage) => passage.id).join(', ') || '(none)'}. They are never directEvidenceIds, baselineEvidenceId, or causalEvidenceIds.\n- Relation ids are never evidence ids.`
}

const SYSTEM = `You are a portfolio decision agent for one founder with multiple projects. Decide one weekly priority and make the opportunity cost explicit. Use only the supplied Portfolio records and Knowledge passages. A portfolio record is private evidence; a passage is an approved, versioned Knowledge Base excerpt. Do not invent ids, quotes, metrics, outcomes, customers, or relationships. Every field listed below must have an assertion with exactly the same text. Every assertion basis must cite one or more record ids and/or passage ids. For a passage basis, quote must be a contiguous verbatim quote from that passage. Use inference only for a clearly labeled inference, never as the sole basis for recommendedPriority. Avoid causal claims unless causalEvidenceIds contains a supplied experiment or causal record.`

function prompt(question: string, portfolioJson: string, visibleRecords: readonly PortfolioRecord[], portfolio: Portfolio, passages: readonly Passage[]): string {
  return `Question:\n${question}\n\nPortfolio:\n${portfolioJson}\n\nApproved knowledge passages:\n${renderPassages(passages)}\n\n${renderPacketConstraints(portfolio, visibleRecords, passages)}\n\nReturn the PortfolioPacket object. Set id to a stable slug, createdAt to an ISO timestamp, status to proposed, and reviewDate to YYYY-MM-DD. Include exact matching assertions for recommendedPriority, stopDoing, opportunityCost, criticalAssumption, minimumAction, and expectedSignal.`
}

export function assemblePortfolioContext(portfolio: Portfolio, question: string, passages: readonly Passage[], arm: PortfolioReasoningArm): PortfolioContext {
  const founderos = arm === 'founderos' ? founderosRecords(portfolio) : null
  const records = founderos?.records ?? portfolio.records
  return {
    arm,
    selection: founderos?.selection ?? 'context_dump',
    prompt: prompt(question, renderPortfolio(portfolio, records, arm === 'context_dump'), records, portfolio, passages),
    selectedRecordIds: records.map((record) => record.id),
    selectedPassageIds: passages.map((passage) => passage.id),
  }
}

function repairPrompt(context: PortfolioContext, rejected: unknown, issues: readonly string[]): string {
  return `${context.prompt}\n\nThe previous PortfolioPacket was rejected. Correct the full object without changing the question or inventing evidence.\n\nRejected object:\n${JSON.stringify(rejected)}\n\nValidation errors:\n${issues.map((issue) => `- ${issue}`).join('\n')}\n\nReturn one corrected PortfolioPacket object only.`
}

export async function generatePortfolioPacket(input: {
  portfolio: Portfolio
  question: string
  passages: readonly Passage[]
  arm: PortfolioReasoningArm
  provider: Provider
}): Promise<PortfolioGeneration> {
  const context = assemblePortfolioContext(input.portfolio, input.question, input.passages, input.arm)
  const started = performance.now()
  try {
    const first = await input.provider.object({ system: SYSTEM, prompt: context.prompt, maxOutputTokens: 2200, schema: PortfolioPacketSchema })
    const firstChecked = validatePacketProvenance(first.value, input.portfolio, input.passages)
    const firstAttempt: PortfolioGenerationAttempt = { prompt: context.prompt, raw: first.raw, reason: firstChecked.ok ? null : firstChecked.issues.join(' '), model: first.model, tokensIn: first.tokensIn, tokensOut: first.tokensOut, ms: first.ms }
    const base = {
      arm: input.arm,
      selection: context.selection,
      prompt: context.prompt,
      selectedRecordIds: context.selectedRecordIds,
      selectedPassageIds: context.selectedPassageIds,
    }
    if (firstChecked.ok) {
      return { ...base, ok: true, packet: firstChecked.value, raw: first.raw, model: first.model, tokensIn: first.tokensIn, tokensOut: first.tokensOut, ms: first.ms, attempts: [firstAttempt] }
    }

    const repair = repairPrompt(context, first.value, firstChecked.issues)
    try {
      const second = await input.provider.object({ system: SYSTEM, prompt: repair, maxOutputTokens: 2200, schema: PortfolioPacketSchema })
      const secondChecked = validatePacketProvenance(second.value, input.portfolio, input.passages)
      const secondAttempt: PortfolioGenerationAttempt = { prompt: repair, raw: second.raw, reason: secondChecked.ok ? null : secondChecked.issues.join(' '), model: second.model, tokensIn: second.tokensIn, tokensOut: second.tokensOut, ms: second.ms }
      if (secondChecked.ok) {
        return { ...base, ok: true, packet: secondChecked.value, raw: second.raw, model: second.model, tokensIn: first.tokensIn + second.tokensIn, tokensOut: first.tokensOut + second.tokensOut, ms: first.ms + second.ms, attempts: [firstAttempt, secondAttempt] }
      }
      return { ...base, ok: false, reason: secondChecked.issues.join(' '), raw: second.raw, model: second.model, tokensIn: first.tokensIn + second.tokensIn, tokensOut: first.tokensOut + second.tokensOut, ms: first.ms + second.ms, attempts: [firstAttempt, secondAttempt] }
    } catch (error) {
      const ms = performance.now() - started - first.ms
      const reason = error instanceof Error ? error.message : String(error)
      const repairAttempt: PortfolioGenerationAttempt = { prompt: repair, raw: null, reason, model: input.provider.id, tokensIn: 0, tokensOut: 0, ms }
      return { ...base, ok: false, reason, raw: null, model: input.provider.id, tokensIn: first.tokensIn, tokensOut: first.tokensOut, ms: first.ms + ms, attempts: [firstAttempt, repairAttempt] }
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    const ms = performance.now() - started
    return { ok: false, arm: input.arm, selection: context.selection, reason, raw: null, model: input.provider.id, tokensIn: 0, tokensOut: 0, ms, prompt: context.prompt, selectedRecordIds: context.selectedRecordIds, selectedPassageIds: context.selectedPassageIds, attempts: [{ prompt: context.prompt, raw: null, reason, model: input.provider.id, tokensIn: 0, tokensOut: 0, ms }] }
  }
}
