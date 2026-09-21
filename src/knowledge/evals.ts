import { readFileSync, readdirSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import {
  BrainAnswerSchema,
  validateBrainAnswer,
  type BrainAnswer,
  type BrainEvidence,
} from '../brain/contract.ts'
import type { Db } from './db.ts'
import type { Embedder } from './embed.ts'
import { searchMeasured } from './retrieve.ts'
import { containsQuote } from './text.ts'

const RETRIEVAL_EVALS_DIR = 'evals/retrieval'
const RETRIEVAL_BASELINE_PATH = 'evals/baselines/retrieval.json'
const DETERMINISTIC_UTILITY_EVALS_DIR = 'evals/utility'
const UTILITY_SCORES_PATH = 'evals/results/utility.json'

export const FOUNDER_CATEGORIES = [
  'pmf', 'customer-discovery', 'pricing', 'gtm', 'hiring', 'fundraising',
] as const

export type FounderCategory = (typeof FOUNDER_CATEGORIES)[number]

export const RETRIEVAL_THRESHOLDS = {
  minMrr: 0.8,
  minRecallAt10: 0.8,
  maxP95Ms: 250,
  maxMrrDrop: 0.05,
  maxRecallDrop: 0.05,
  maxP95Multiplier: 3,
} as const

export const UTILITY_THRESHOLD = 4

const RetrievalEvalCaseSchema = z.object({
  id: z.string().min(1),
  query: z.string().min(1),
  expectedPassageIds: z.array(z.string().min(1)).min(1),
  filters: z
    .object({
      authors: z.array(z.string().min(1)).optional(),
      topics: z.array(z.string().min(1)).optional(),
    })
    .optional(),
})

export type RetrievalEvalCase = z.infer<typeof RetrievalEvalCaseSchema>

export type RetrievalEvalCaseResult = {
  id: string
  expectedPassageIds: string[]
  retrievedPassageIds: string[]
  reciprocalRank: number
  recallAt10: number
  latencyMs: number
}

export type RetrievalEvalReport = {
  cases: RetrievalEvalCaseResult[]
  aggregate: { mrr: number; recallAt10: number; p50Ms: number; p95Ms: number }
}

export type RetrievalBaseline = {
  version: 1
  mrr: number
  recallAt10: number
  p95Ms: number
}

export type RetrievalGate = { passed: boolean; failures: string[] }

export type CitationFidelity = { passed: boolean; fidelity: number; sourceCitations: number; issues: string[] }

export type UtilityScore = { category: FounderCategory; score: number }

export type UtilityGate = {
  passed: boolean
  meanByCategory: Partial<Record<FounderCategory, number>>
  blockedCategories: FounderCategory[]
  failures: string[]
}

const DeterministicUtilityCaseSchema = z.object({
  id: z.string().min(1),
  category: z.enum(FOUNDER_CATEGORIES),
  evidence: z.object({
    startupPaths: z.array(z.string().min(1)).default([]),
    passages: z.record(z.string().min(1), z.string().min(1)),
    ruleIds: z.array(z.string().min(1)).default([]),
  }),
  answer: BrainAnswerSchema,
  expectations: z.object({
    minAssertions: z.number().int().min(1),
    requiredText: z.array(z.string().min(1)).min(1),
    requiredBasisKinds: z.array(z.enum(['startup_data', 'source', 'rule', 'inference'])).min(1),
  }),
})

export type DeterministicUtilityCase = z.infer<typeof DeterministicUtilityCaseSchema>

export type DeterministicUtilityCaseResult = {
  id: string
  category: FounderCategory
  passed: boolean
  citationFidelity: number
  utilitySignalRate: number
  failures: string[]
}

export type DeterministicUtilityReport = {
  passed: boolean
  cases: DeterministicUtilityCaseResult[]
  aggregate: { citationFidelity: number; utilitySignalRate: number }
}

export type QuoteVerification = { ok: true } | { ok: false; reason: string }

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.ceil((percentileValue / 100) * sorted.length) - 1
  return sorted[Math.max(0, index)] ?? 0
}

export function verifyDisplayedQuote(input: { passage: string; quote: string }): QuoteVerification {
  return containsQuote(input.passage, input.quote)
    ? { ok: true }
    : { ok: false, reason: 'Quote is not contiguous in the cited passage.' }
}

export function evaluateCitationFidelity(answer: BrainAnswer, evidence: BrainEvidence): CitationFidelity {
  const sourceCitations = answer.assertions.flatMap((assertion) => assertion.basis).filter((basis) => basis.kind === 'source').length
  const checked = validateBrainAnswer(answer, evidence)
  const issues = checked.ok ? [] : checked.issues
  return {
    passed: checked.ok && sourceCitations > 0,
    fidelity: checked.ok && sourceCitations > 0 ? 1 : 0,
    sourceCitations,
    issues: sourceCitations === 0 ? [...issues, 'No source citation was supplied.'] : issues,
  }
}

export function evaluateUtilityScores(scores: UtilityScore[]): UtilityGate {
  const byCategory = new Map<FounderCategory, number[]>()
  for (const score of scores) {
    const values = byCategory.get(score.category) ?? []
    values.push(score.score)
    byCategory.set(score.category, values)
  }

  const meanByCategory: Partial<Record<FounderCategory, number>> = {}
  const blockedCategories: FounderCategory[] = []
  const failures: string[] = []
  for (const category of FOUNDER_CATEGORIES) {
    const values = byCategory.get(category)
    if (!values?.length) {
      blockedCategories.push(category)
      continue
    }
    const mean = values.reduce((total, value) => total + value, 0) / values.length
    meanByCategory[category] = mean
    if (mean < UTILITY_THRESHOLD) {
      failures.push(`${category} usefulness ${mean.toFixed(2)} is below ${UTILITY_THRESHOLD.toFixed(2)}`)
    }
  }
  return {
    passed: blockedCategories.length === 0 && failures.length === 0,
    meanByCategory,
    blockedCategories,
    failures,
  }
}

export function loadUtilityScores(path = UTILITY_SCORES_PATH): UtilityScore[] {
  if (!existsSync(path)) return []
  const parsed = z.array(
    z.object({ category: z.enum(FOUNDER_CATEGORIES), score: z.number().min(1).max(5) }),
  ).safeParse(JSON.parse(readFileSync(path, 'utf8')) as unknown)
  if (!parsed.success) throw new Error(`${path} is not a utility score file.`)
  return parsed.data
}

export function loadDeterministicUtilityCases(
  dir = DETERMINISTIC_UTILITY_EVALS_DIR,
): DeterministicUtilityCase[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.yaml'))
    .sort()
    .map((name) => {
      const parsed = DeterministicUtilityCaseSchema.safeParse(parseYaml(readFileSync(join(dir, name), 'utf8')))
      if (!parsed.success) {
        const details = parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; ')
        throw new Error(`${join(dir, name)} is not a deterministic utility evaluation: ${details}`)
      }
      return parsed.data
    })
}

export function runDeterministicUtilityEvals(
  cases: DeterministicUtilityCase[],
): DeterministicUtilityReport {
  const results = cases.map((evaluation) => {
    const evidence: BrainEvidence = {
      startupPaths: new Set(evaluation.evidence.startupPaths),
      passages: new Map(Object.entries(evaluation.evidence.passages)),
      ruleIds: new Set(evaluation.evidence.ruleIds),
    }
    const citation = evaluateCitationFidelity(evaluation.answer, evidence)
    const answerText = evaluation.answer.assertions.map((assertion) => assertion.text).join(' ').toLocaleLowerCase()
    const basisKinds = new Set(
      evaluation.answer.assertions.flatMap((assertion) => assertion.basis.map((basis) => basis.kind)),
    )
    const failures = [...citation.issues]
    let signalsSatisfied = 0
    const totalSignals = 1 + evaluation.expectations.requiredText.length + evaluation.expectations.requiredBasisKinds.length

    if (evaluation.answer.assertions.length >= evaluation.expectations.minAssertions) {
      signalsSatisfied += 1
    } else {
      failures.push(`Expected at least ${evaluation.expectations.minAssertions} assertions.`)
    }
    for (const requiredText of evaluation.expectations.requiredText) {
      if (answerText.includes(requiredText.toLocaleLowerCase())) {
        signalsSatisfied += 1
      } else {
        failures.push(`Answer is missing required action text: ${requiredText}`)
      }
    }
    for (const kind of evaluation.expectations.requiredBasisKinds) {
      if (basisKinds.has(kind)) {
        signalsSatisfied += 1
      } else {
        failures.push(`Answer is missing required basis kind: ${kind}`)
      }
    }

    return {
      id: evaluation.id,
      category: evaluation.category,
      passed: citation.passed && failures.length === 0,
      citationFidelity: citation.fidelity,
      utilitySignalRate: signalsSatisfied / totalSignals,
      failures,
    }
  })
  const count = results.length
  return {
    passed: count > 0 && results.every((result) => result.passed),
    cases: results,
    aggregate: {
      citationFidelity: count === 0 ? 0 : results.reduce((total, result) => total + result.citationFidelity, 0) / count,
      utilitySignalRate: count === 0 ? 0 : results.reduce((total, result) => total + result.utilitySignalRate, 0) / count,
    },
  }
}

export function evaluateRetrievalGate(
  report: RetrievalEvalReport,
  baseline: RetrievalBaseline,
): RetrievalGate {
  const failures: string[] = []
  if (report.aggregate.mrr < RETRIEVAL_THRESHOLDS.minMrr) {
    failures.push(`MRR ${report.aggregate.mrr.toFixed(3)} is below ${RETRIEVAL_THRESHOLDS.minMrr.toFixed(3)}`)
  }
  if (report.aggregate.recallAt10 < RETRIEVAL_THRESHOLDS.minRecallAt10) {
    failures.push(`recall@10 ${report.aggregate.recallAt10.toFixed(3)} is below ${RETRIEVAL_THRESHOLDS.minRecallAt10.toFixed(3)}`)
  }
  if (report.aggregate.p95Ms > RETRIEVAL_THRESHOLDS.maxP95Ms) {
    failures.push(`p95 ${report.aggregate.p95Ms.toFixed(1)}ms exceeds ${RETRIEVAL_THRESHOLDS.maxP95Ms.toFixed(1)}ms`)
  }
  if (report.aggregate.mrr < baseline.mrr - RETRIEVAL_THRESHOLDS.maxMrrDrop) {
    failures.push(`MRR regressed from baseline ${baseline.mrr.toFixed(3)}`)
  }
  if (report.aggregate.recallAt10 < baseline.recallAt10 - RETRIEVAL_THRESHOLDS.maxRecallDrop) {
    failures.push(`recall@10 regressed from baseline ${baseline.recallAt10.toFixed(3)}`)
  }
  if (report.aggregate.p95Ms > baseline.p95Ms * RETRIEVAL_THRESHOLDS.maxP95Multiplier) {
    failures.push(`p95 ${report.aggregate.p95Ms.toFixed(1)}ms exceeds ${RETRIEVAL_THRESHOLDS.maxP95Multiplier}× baseline`)
  }
  return failures.length === 0 ? { passed: true, failures } : { passed: false, failures }
}

export function loadRetrievalBaseline(path = RETRIEVAL_BASELINE_PATH): RetrievalBaseline {
  const parsed = z.object({
    version: z.literal(1),
    mrr: z.number().min(0).max(1),
    recallAt10: z.number().min(0).max(1),
    p95Ms: z.number().nonnegative(),
  }).safeParse(JSON.parse(readFileSync(path, 'utf8')) as unknown)
  if (!parsed.success) throw new Error(`${path} is not a retrieval baseline.`)
  return parsed.data
}

export function loadRetrievalEvalCases(dir = RETRIEVAL_EVALS_DIR): RetrievalEvalCase[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.yaml'))
    .sort()
    .map((name) => {
      const parsed = RetrievalEvalCaseSchema.safeParse(parseYaml(readFileSync(join(dir, name), 'utf8')))
      if (!parsed.success) {
        const details = parsed.error.issues
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; ')
        throw new Error(`${join(dir, name)} is not a retrieval evaluation: ${details}`)
      }
      return parsed.data
    })
}

export async function runRetrievalEvals(
  db: Db,
  cases: RetrievalEvalCase[],
  options: { embedder?: Embedder } = {},
): Promise<RetrievalEvalReport> {
  const results: RetrievalEvalCaseResult[] = []

  for (const evaluation of cases) {
    const authorId = evaluation.filters?.authors?.length === 1 ? evaluation.filters.authors[0] : undefined
    const result = await searchMeasured(db, evaluation.query, {
      limit: 10,
      kinds: ['claim'],
      ...(authorId ? { authorId } : {}),
      ...(evaluation.filters?.topics?.length ? { topics: evaluation.filters.topics } : {}),
      ...(options.embedder ? { embedder: options.embedder } : {}),
    })
    const retrievedPassageIds = result.hits.map((hit) => hit.id)
    const expected = new Set(evaluation.expectedPassageIds)
    const firstMatch = retrievedPassageIds.findIndex((id) => expected.has(id))
    const matched = retrievedPassageIds.filter((id) => expected.has(id)).length

    results.push({
      id: evaluation.id,
      expectedPassageIds: evaluation.expectedPassageIds,
      retrievedPassageIds,
      reciprocalRank: firstMatch === -1 ? 0 : 1 / (firstMatch + 1),
      recallAt10: matched / expected.size,
      latencyMs: result.timing.totalMs,
    })
  }

  const count = results.length
  const latencies = results.map((result) => result.latencyMs)
  return {
    cases: results,
    aggregate: {
      mrr: count === 0 ? 0 : results.reduce((total, result) => total + result.reciprocalRank, 0) / count,
      recallAt10: count === 0 ? 0 : results.reduce((total, result) => total + result.recallAt10, 0) / count,
      p50Ms: percentile(latencies, 50),
      p95Ms: percentile(latencies, 95),
    },
  }
}
