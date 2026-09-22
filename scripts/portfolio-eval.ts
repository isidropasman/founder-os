import { readdirSync, readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { consult } from '../src/knowledge/consult.ts'
import { persistPortfolioEvaluation, runPortfolioEvaluation, type PortfolioEvalResult } from '../src/portfolio/evals.ts'
import { PortfolioSchema } from '../src/portfolio/contracts.ts'
import { createProvider, modelForRole, providerIsReady } from '../src/provider.ts'

const EVAL_DIR = 'evals/portfolio'
const EvalCaseSchema = z.object({ id: z.string().min(1), question: z.string().min(1), portfolio: PortfolioSchema })

function fixturePaths(all: boolean, positional: string | undefined): string[] {
  if (positional) return [positional]
  if (!all) return [`${EVAL_DIR}/tradeoff-shared-constraint.yaml`]
  return readdirSync(EVAL_DIR).filter((name) => name.startsWith('tradeoff-') && name.endsWith('.yaml')).sort().map((name) => `${EVAL_DIR}/${name}`)
}

async function approvedPassages(question: string) {
  const narrowed = await consult({ query: question, domain: 'startup prioritization customer discovery opportunity cost focus', limit: 4 })
  return narrowed.ok && narrowed.passages.length > 0 ? narrowed : consult({ query: question, limit: 4 })
}

async function runFixture(path: string, providerSpec: string): Promise<{ path: string; result: PortfolioEvalResult } | { path: string; error: string }> {
  try {
    const parsed = EvalCaseSchema.safeParse(parseYaml(readFileSync(path, 'utf8')))
    if (!parsed.success) return { path, error: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') }
    const knowledge = await approvedPassages(parsed.data.question)
    if (!knowledge.ok || knowledge.passages.length === 0) return { path, error: knowledge.ok ? 'No approved Knowledge Base passages matched this decision.' : knowledge.reason }
    const createdAt = new Date().toISOString()
    const result = await runPortfolioEvaluation({ id: createdAt.replace(/[^0-9]/g, '').slice(0, 14), createdAt, caseId: parsed.data.id, portfolio: parsed.data.portfolio, question: parsed.data.question, passages: knowledge.passages, provider: createProvider(providerSpec) })
    return { path: persistPortfolioEvaluation(result), result }
  } catch (error) {
    return { path, error: error instanceof Error ? error.message : String(error) }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const args = parseArgs({ args: argv[0] === '--' ? argv.slice(1) : argv, options: { all: { type: 'boolean', default: false }, provider: { type: 'string' } }, allowPositionals: true })
  const providerSpec = args.values.provider ?? modelForRole('reason')
  if (!(await providerIsReady(providerSpec))) {
    process.stderr.write(`Provider is not ready for ${providerSpec}.\n`)
    process.exitCode = 1
    return
  }
  const runs = []
  for (const path of fixturePaths(args.values.all, args.positionals[0])) runs.push(await runFixture(path, providerSpec))
  const completed = runs.filter((run): run is { path: string; result: PortfolioEvalResult } => 'result' in run)
  const valid = completed.filter((run) => run.result.verdict !== 'invalid_run')
  const output = {
    provider: providerSpec,
    runs: completed.map(({ path, result }) => ({ path, caseId: result.caseId, verdict: result.verdict, scores: result.scores, differences: result.differences, judge: result.judge ? { model: result.judge.model, tokensIn: result.judge.tokensIn, tokensOut: result.judge.tokensOut, latencyMs: result.judge.latencyMs } : null, blockingReasons: result.blockingReasons })),
    errors: runs.filter((run): run is { path: string; error: string } => 'error' in run),
    aggregate: valid.length === 0 ? null : { validCases: valid.length, founderosWins: valid.filter((run) => run.result.verdict === 'founderos_wins').length, contextDumpWins: valid.filter((run) => run.result.verdict === 'context_dump_wins').length, ties: valid.filter((run) => run.result.verdict === 'no_signal').length },
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  if (completed.some((run) => run.result.verdict === 'invalid_run') || output.errors.length > 0) process.exitCode = 1
}

void main()
