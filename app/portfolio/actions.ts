'use server'

import { buildPortfolioPacket, challengePortfolioPacket } from '../../src/portfolio/advisor.ts'
import { consult } from '../../src/knowledge/consult.ts'
import { generatePortfolioPacket as generateGroundedPortfolioPacket } from '../../src/portfolio/reason.ts'
import { createProvider, modelForWorkspaceRole, providerIsReady } from '../../src/provider.ts'
import {
  approvePacket,
  modifyPacket,
  rejectPacket,
  reviewDecision,
  type PacketPatch,
  type Portfolio,
  type PortfolioPacket,
} from '../../src/portfolio/contracts.ts'
import { addFounderRecord, createProject, loadPortfolio, portfolioPath, savePortfolio, type FounderRecordInput } from '../../src/portfolio/store.ts'

export type PortfolioAction = { ok: true; portfolio: Portfolio; packet?: PortfolioPacket | null; challenge?: ReturnType<typeof challengePortfolioPacket> } | { ok: false; message: string }

function failed(issues: string[]): PortfolioAction {
  return { ok: false, message: issues.join(' ') }
}

function persist(result: ReturnType<typeof createProject>): PortfolioAction {
  if (!result.ok) return failed(result.issues)
  savePortfolio(portfolioPath(), result.value)
  return { ok: true, portfolio: result.value, packet: null }
}

export async function createPortfolioProject(name: string): Promise<PortfolioAction> {
  return persist(createProject(loadPortfolio(), name, new Date().toISOString()))
}

export async function recordPortfolioEvidence(input: FounderRecordInput): Promise<PortfolioAction> {
  const result = addFounderRecord(loadPortfolio(), input, new Date().toISOString())
  if (!result.ok) return failed(result.issues)
  savePortfolio(portfolioPath(), result.value)
  return { ok: true, portfolio: result.value }
}

export async function generatePortfolioPacket(question: string): Promise<PortfolioAction> {
  try {
    const portfolio = loadPortfolio()
    const model = modelForWorkspaceRole(process.env.FOUNDEROS_CONTEXT ?? './context/example', 'reason')
    const packet = (await providerIsReady(model))
      ? await (async () => {
          const narrowedKnowledge = await consult({ query: question, domain: 'startup prioritization customer discovery opportunity cost focus', limit: 4 })
          const knowledge = narrowedKnowledge.ok && narrowedKnowledge.passages.length > 0
            ? narrowedKnowledge
            : await consult({ query: question, limit: 4 })
          if (!knowledge.ok || knowledge.passages.length === 0) throw new Error(knowledge.ok ? 'No approved Knowledge Base passages matched this decision.' : knowledge.reason)
          const generated = await generateGroundedPortfolioPacket({ portfolio, question, passages: knowledge.passages, arm: 'founderos', provider: createProvider(model) })
          if (!generated.ok) throw new Error(generated.reason)
          return generated.packet
        })()
      : buildPortfolioPacket(portfolio, { now: new Date().toISOString(), question })
    const checked = modifyPacket(portfolio, packet, {})
    if (!checked.ok) return failed(checked.issues)
    const stored = checked.value.packets.find((item) => item.id === packet.id)
    if (!stored) return { ok: false, message: 'The generated packet was not persisted.' }
    const challenge = challengePortfolioPacket(checked.value, stored)
    savePortfolio(portfolioPath(), checked.value)
    return { ok: true, portfolio: checked.value, packet: stored, challenge }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export async function approvePortfolioPacket(packet: PortfolioPacket): Promise<PortfolioAction> {
  const result = approvePacket(loadPortfolio(), packet)
  if (!result.ok) return failed(result.issues)
  savePortfolio(portfolioPath(), result.value)
  return { ok: true, portfolio: result.value }
}

export async function modifyPortfolioPacket(packet: PortfolioPacket, patch: PacketPatch): Promise<PortfolioAction> {
  const result = modifyPacket(loadPortfolio(), packet, patch)
  if (!result.ok) return failed(result.issues)
  const stored = result.value.packets.find((item) => item.id === packet.id)
  if (!stored) return { ok: false, message: 'The modified packet was not persisted.' }
  savePortfolio(portfolioPath(), result.value)
  return { ok: true, portfolio: result.value, packet: stored }
}

export async function rejectPortfolioPacket(packet: PortfolioPacket, reason: string): Promise<PortfolioAction> {
  const next = rejectPacket(loadPortfolio(), packet, reason)
  savePortfolio(portfolioPath(), next)
  return { ok: true, portfolio: next, packet: null }
}

export async function reviewPortfolioDecision(decisionId: string, evidenceIds: string[], observedValue: number | null, note: string): Promise<PortfolioAction> {
  const result = reviewDecision(loadPortfolio(), decisionId, { reviewedAt: new Date().toISOString(), evidenceIds, observedValue, note })
  if (!result.ok) return failed(result.issues)
  savePortfolio(portfolioPath(), result.value)
  return { ok: true, portfolio: result.value }
}
