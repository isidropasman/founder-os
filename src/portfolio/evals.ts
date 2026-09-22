import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import { challengePortfolioPacket } from './advisor.ts'
import { validatePortfolioPacket, type Portfolio, type PortfolioPacket } from './contracts.ts'
import { generatePortfolioPacket, type PortfolioGeneration } from './reason.ts'
import type { Passage } from '../knowledge/consult.ts'
import type { Provider } from '../provider.ts'

export type PortfolioArmInput = { mode: 'scoped' | 'context_dump'; question: string; context: string }
export type PortfolioPacketProducer = (input: PortfolioArmInput) => Promise<unknown>

export type PortfolioArmReport = {
  evidenceIntegrity: boolean
  projectContamination: boolean
  concreteData: boolean
  contradictoryEvidenceCoverage: boolean
  portfolioTradeOff: boolean
  falsePremiseChallenge: boolean
  actionClarity: boolean
  outcomeCompletion: number
}

export type PortfolioComparison = { scoped: PortfolioArmReport; contextDump: PortfolioArmReport }

function report(portfolio: Portfolio, candidate: unknown): PortfolioArmReport {
  const checked = validatePortfolioPacket(candidate, portfolio)
  const packet = candidate as PortfolioPacket
  const issues = checked.ok ? [] : checked.issues
  const challenge = checked.ok ? challengePortfolioPacket(portfolio, checked.value) : null
  const complete = portfolio.outcomes.filter((outcome) => outcome.status === 'complete').length
  return {
    evidenceIntegrity: checked.ok,
    projectContamination: issues.some((issue) => issue.includes('another project')),
    concreteData: checked.ok && portfolio.records.some((record) => record.id === packet.baselineEvidenceId && record.numericValue !== null),
    contradictoryEvidenceCoverage: challenge?.contradictoryEvidenceIds.length ? packet.directEvidenceIds.some((id) => challenge.contradictoryEvidenceIds.includes(id)) : true,
    portfolioTradeOff: checked.ok && packet.stopDoing.length > 0 && packet.opportunityCost.length > 0,
    falsePremiseChallenge: challenge?.untestedAssumptions.length === 1,
    actionClarity: checked.ok && packet.minimumAction.length > 0 && packet.reviewDate.length > 0,
    outcomeCompletion: portfolio.outcomes.length === 0 ? 0 : complete / portfolio.outcomes.length,
  }
}

export async function comparePortfolioArms(portfolio: Portfolio, question: string, produce: PortfolioPacketProducer): Promise<PortfolioComparison> {
  const scopedContext = JSON.stringify({ projects: portfolio.projects, records: portfolio.records.filter((record) => record.scope === 'founder' || record.projectId !== null), relations: portfolio.relations })
  const rawContext = JSON.stringify(portfolio)
  const scoped = await produce({ mode: 'scoped', question, context: scopedContext })
  const contextDump = await produce({ mode: 'context_dump', question, context: rawContext })
  return { scoped: report(portfolio, scoped), contextDump: report(portfolio, contextDump) }
}

export type PortfolioEvalScore = {
  judgment: number
  grounding: number
  projectContamination: number
  tradeOff: number
  validPacket: boolean
  tokensIn: number
  tokensOut: number
  latencyMs: number
}

const BlindJudgeSchema = z.object({
  scoresA: z.object({ judgment: z.number().min(1).max(5), tradeOff: z.number().min(1).max(5) }),
  scoresB: z.object({ judgment: z.number().min(1).max(5), tradeOff: z.number().min(1).max(5) }),
  preferred: z.enum(['A', 'B', 'tie']),
  rationale: z.string().min(1),
})

type BlindJudgeVerdict = z.infer<typeof BlindJudgeSchema>

export type PortfolioBlindJudge = {
  model: string
  rounds: [
    { order: 'founderos_first'; verdict: BlindJudgeVerdict; raw: string; tokensIn: number; tokensOut: number; latencyMs: number },
    { order: 'context_dump_first'; verdict: BlindJudgeVerdict; raw: string; tokensIn: number; tokensOut: number; latencyMs: number },
  ]
  tokensIn: number
  tokensOut: number
  latencyMs: number
}

export type PortfolioEvalResult = {
  id: string
  createdAt: string
  caseId: string
  question: string
  model: string
  input: { portfolio: Portfolio; question: string }
  passages: Passage[]
  founderos: PortfolioGeneration
  contextDump: PortfolioGeneration
  scores: { founderos: PortfolioEvalScore; contextDump: PortfolioEvalScore } | null
  differences: { judgment: number; grounding: number; projectContamination: number; tradeOff: number; tokensIn: number; tokensOut: number; latencyMs: number } | null
  judge: PortfolioBlindJudge | null
  verdict: 'founderos_wins' | 'no_signal' | 'context_dump_wins' | 'invalid_run'
  nonContributingLayers: string[]
  blockingReasons: string[]
}

function scoreGeneration(portfolio: Portfolio, generation: PortfolioGeneration): PortfolioEvalScore {
  if (!generation.ok) {
    return { judgment: 0, grounding: 0, projectContamination: 1, tradeOff: 0, validPacket: false, tokensIn: generation.tokensIn, tokensOut: generation.tokensOut, latencyMs: generation.ms }
  }
  const packet = generation.packet
  const assertionsWithDirectEvidence = packet.assertions.filter((assertion) => assertion.basis.some((basis) => basis.kind !== 'inference')).length
  const statements = [packet.recommendedPriority, packet.stopDoing, packet.opportunityCost, packet.criticalAssumption, packet.minimumAction, packet.expectedSignal]
  const allStatementsProvenanced = statements.every((statement) => packet.assertions.some((assertion) => assertion.text === statement))
  const nonTargetRecord = packet.assertions.some((assertion) => assertion.basis.some((basis) => {
    if (basis.kind !== 'record') return false
    const record = portfolio.records.find((item) => item.id === basis.id)
    if (!record?.projectId || record.projectId === packet.projectId) return false
    return !portfolio.relations.some((relation) => relation.type === 'cross_project' && ((relation.fromProjectId === packet.projectId && relation.toProjectId === record.projectId) || (relation.toProjectId === packet.projectId && relation.fromProjectId === record.projectId)))
  }))
  const judgment = Number(packet.recommendedPriority.length > 0) + Number(packet.minimumAction.length > 0) + Number(packet.reviewDate.length > 0) + Number(packet.alternatives.length > 0) + Number(packet.criticalAssumption.length > 0)
  const grounding = allStatementsProvenanced ? assertionsWithDirectEvidence / statements.length : 0
  const tradeOff = Number(packet.stopDoing.length > 0) + Number(packet.opportunityCost.length > 0) + Number(packet.alternatives.length > 0)
  return {
    judgment,
    grounding,
    projectContamination: Number(nonTargetRecord),
    tradeOff,
    validPacket: true,
    tokensIn: generation.tokensIn,
    tokensOut: generation.tokensOut,
    latencyMs: generation.ms,
  }
}

function verdict(
  founderos: PortfolioEvalScore,
  contextDump: PortfolioEvalScore,
  founderosGeneration: PortfolioGeneration,
  contextDumpGeneration: PortfolioGeneration,
): PortfolioEvalResult['verdict'] {
  if ((!founderosGeneration.ok && founderosGeneration.raw === null) || (!contextDumpGeneration.ok && contextDumpGeneration.raw === null)) return 'invalid_run'
  const founderosQuality = founderos.judgment + founderos.grounding + founderos.tradeOff - founderos.projectContamination
  const dumpQuality = contextDump.judgment + contextDump.grounding + contextDump.tradeOff - contextDump.projectContamination
  if (founderosQuality > dumpQuality && founderos.grounding >= contextDump.grounding && founderos.projectContamination <= contextDump.projectContamination) return 'founderos_wins'
  if (dumpQuality > founderosQuality) return 'context_dump_wins'
  return 'no_signal'
}

function nonContributingLayers(founderos: PortfolioEvalScore, contextDump: PortfolioEvalScore): string[] {
  const layers: string[] = []
  if (founderos.judgment <= contextDump.judgment || founderos.tradeOff <= contextDump.tradeOff) layers.push('minimal-context selection')
  if (founderos.grounding <= contextDump.grounding) layers.push('packet provenance gate')
  if (founderos.projectContamination >= contextDump.projectContamination) layers.push('project-boundary filter')
  return layers
}

const BLIND_JUDGE_SYSTEM = 'You are a blind strategic judge. You receive two anonymized portfolio decision packets, A and B. Do not infer or reward how their context was assembled. Score only strategic judgment and whether the stated trade-off is explicit, concrete, and proportional to the evidence. Use the full 1-5 scale. Return the required object.'

function blindJudgePrompt(first: PortfolioPacket, second: PortfolioPacket): string {
  const render = (packet: PortfolioPacket) => JSON.stringify({
    recommendedPriority: packet.recommendedPriority,
    stopDoing: packet.stopDoing,
    opportunityCost: packet.opportunityCost,
    alternatives: packet.alternatives,
    criticalAssumption: packet.criticalAssumption,
    minimumAction: packet.minimumAction,
    expectedSignal: packet.expectedSignal,
  })
  return `Packet A:\n${render(first)}\n\nPacket B:\n${render(second)}\n\nJudge A versus B.`
}

async function runBlindJudge(provider: Provider, founderos: PortfolioPacket, contextDump: PortfolioPacket): Promise<{ ok: true; value: PortfolioBlindJudge } | { ok: false; reason: string }> {
  try {
    const first = await provider.object({ system: BLIND_JUDGE_SYSTEM, prompt: blindJudgePrompt(founderos, contextDump), schema: BlindJudgeSchema })
    const second = await provider.object({ system: BLIND_JUDGE_SYSTEM, prompt: blindJudgePrompt(contextDump, founderos), schema: BlindJudgeSchema })
    if (first.model !== provider.id || second.model !== provider.id) return { ok: false, reason: 'blind judge returned a different model than the evaluated arms' }
    return {
      ok: true,
      value: {
        model: provider.id,
        rounds: [
          { order: 'founderos_first', verdict: first.value, raw: first.raw, tokensIn: first.tokensIn, tokensOut: first.tokensOut, latencyMs: first.ms },
          { order: 'context_dump_first', verdict: second.value, raw: second.raw, tokensIn: second.tokensIn, tokensOut: second.tokensOut, latencyMs: second.ms },
        ],
        tokensIn: first.tokensIn + second.tokensIn,
        tokensOut: first.tokensOut + second.tokensOut,
        latencyMs: first.ms + second.ms,
      },
    }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

function applyBlindJudge(
  score: PortfolioEvalScore,
  first: BlindJudgeVerdict['scoresA'],
  second: BlindJudgeVerdict['scoresA'],
): PortfolioEvalScore {
  return { ...score, judgment: (first.judgment + second.judgment) / 2, tradeOff: (first.tradeOff + second.tradeOff) / 2 }
}

function invalidRun(input: Omit<PortfolioEvalResult, 'scores' | 'differences' | 'judge' | 'verdict' | 'nonContributingLayers' | 'blockingReasons'>, reasons: string[]): PortfolioEvalResult {
  return { ...input, scores: null, differences: null, judge: null, verdict: 'invalid_run', nonContributingLayers: [], blockingReasons: reasons }
}

export async function runPortfolioEvaluation(input: {
  id: string
  createdAt: string
  caseId: string
  portfolio: Portfolio
  question: string
  passages: Passage[]
  provider: Provider
}): Promise<PortfolioEvalResult> {
  const founderos = await generatePortfolioPacket({ portfolio: input.portfolio, question: input.question, passages: input.passages, arm: 'founderos', provider: input.provider })
  const contextDump = await generatePortfolioPacket({ portfolio: input.portfolio, question: input.question, passages: input.passages, arm: 'context_dump', provider: input.provider })
  const base = {
    id: input.id,
    createdAt: input.createdAt,
    caseId: input.caseId,
    question: input.question,
    model: input.provider.id,
    input: { portfolio: input.portfolio, question: input.question },
    passages: input.passages,
    founderos,
    contextDump,
  }
  const providerFailures = [founderos, contextDump]
    .flatMap((generation) => !generation.ok && generation.raw === null ? [`${generation.arm}: ${generation.reason}`] : [])
  if (providerFailures.length > 0) return invalidRun(base, providerFailures)

  const founderosScore = scoreGeneration(input.portfolio, founderos)
  const contextDumpScore = scoreGeneration(input.portfolio, contextDump)
  const judged = founderos.ok && contextDump.ok
    ? await runBlindJudge(input.provider, founderos.packet, contextDump.packet)
    : null
  if (judged && !judged.ok) return invalidRun(base, [`blind judge: ${judged.reason}`])
  const scores = judged?.ok
    ? {
        founderos: applyBlindJudge(founderosScore, judged.value.rounds[0].verdict.scoresA, judged.value.rounds[1].verdict.scoresB),
        contextDump: applyBlindJudge(contextDumpScore, judged.value.rounds[0].verdict.scoresB, judged.value.rounds[1].verdict.scoresA),
      }
    : { founderos: founderosScore, contextDump: contextDumpScore }
  const resultVerdict = verdict(scores.founderos, scores.contextDump, founderos, contextDump)
  return {
    ...base,
    scores,
    differences: {
      judgment: scores.founderos.judgment - scores.contextDump.judgment,
      grounding: scores.founderos.grounding - scores.contextDump.grounding,
      projectContamination: scores.contextDump.projectContamination - scores.founderos.projectContamination,
      tradeOff: scores.founderos.tradeOff - scores.contextDump.tradeOff,
      tokensIn: scores.contextDump.tokensIn - scores.founderos.tokensIn,
      tokensOut: scores.contextDump.tokensOut - scores.founderos.tokensOut,
      latencyMs: scores.contextDump.latencyMs - scores.founderos.latencyMs,
    },
    judge: judged?.ok ? judged.value : null,
    verdict: resultVerdict,
    nonContributingLayers: resultVerdict === 'invalid_run' ? [] : nonContributingLayers(scores.founderos, scores.contextDump),
    blockingReasons: [founderos, contextDump].flatMap((generation) => generation.ok ? [] : [`${generation.arm}: ${generation.reason}`]),
  }
}

export function persistPortfolioEvaluation(result: PortfolioEvalResult, root = 'evals/results'): string {
  const path = join(root, `portfolio-${result.caseId}-${result.id}.json`)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(result, null, 2)}\n`)
  return path
}
