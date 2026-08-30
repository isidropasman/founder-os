import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import {
  CONTEXT_KEYS,
  companySummary,
  openWorkspace,
  renderContext,
  selectContext,
  type ContextKey,
} from './context.ts'
import { loadExperts, selectExperts } from './experts.ts'
import { challengePrompt, contextDumpPrompt, judgePrompt, reasonPrompt, vanillaPrompt } from './prompts.ts'
import { createProvider, modelForRole } from './provider.ts'
import { route } from './router.ts'
import { loadSkills, requireSkill } from './skills.ts'
import { run, type Usage } from './pipeline.ts'
import { briefToProse } from './render.ts'

const CASES_DIR = 'evals/cases'
const ROUTER_DIR = 'evals/router'
const RESULTS_DIR = 'evals/results'
const DEFAULT_SKILL = 'focus'

const CaseFileSchema = z.object({
  context: z.string(),
  cases: z
    .array(
      z.object({
        id: z.string(),
        condition: z.string(),
        query: z.string(),
        skill: z.string().default('focus'),
        notes: z.string().default(''),
      }),
    )
    .min(1),
})

type EvalCase = {
  id: string
  condition: string
  query: string
  skill: string
  notes: string
  context: string
}

export const RouterCaseSchema = z.object({
  query: z.string(),
  expect: z.object({
    skills: z.array(z.string()),
    context_keys_include: z.array(z.enum(CONTEXT_KEYS)).default([]),
    // YAML turns a bare `null` into the null value, not the string. Both spellings
    // mean the same thing to a human writing the case file, so accept both.
    better_question: z
      .union([z.enum(['any', 'null', 'present']), z.null()])
      .default('any')
      .transform((v) => v ?? ('null' as const)),
  }),
})

export const DIMENSIONS = [
  'context_usage',
  'startup_judgment',
  'specificity',
  'evidence',
  'assumption_challenging',
  'actionability',
  'honesty_about_uncertainty',
] as const

type Dimension = (typeof DIMENSIONS)[number]

const MECHANISMS = [
  'better_context_selection',
  'skill_framework',
  'expert_knowledge',
  'challenger',
  'provenance_evidence',
  'action_structuring',
  'decision_memory',
  'none',
] as const

const LOSS_REASONS = [
  'router_error',
  'missing_context',
  'skill_too_prescriptive',
  'expert_noise',
  'weak_expert_pack',
  'challenger_degraded_answer',
  'overlong_prompt',
  'under_specific_output',
  'judge_ambiguity',
  'other',
] as const

const scoreShape = Object.fromEntries(DIMENSIONS.map((d) => [d, z.number().min(1).max(5)])) as Record<
  Dimension,
  z.ZodNumber
>

const VerdictSchema = z.object({
  scores_a: z.object(scoreShape),
  scores_b: z.object(scoreShape),
  preferred: z.enum(['A', 'B', 'tie']),
  judge_confidence: z
    .enum(['high', 'medium', 'low'])
    .describe('How clear-cut the preference was. "low" means the answers were close.'),
  advantage_source: z.enum(MECHANISMS),
  advantage_evidence: z.string(),
})

type Verdict = z.infer<typeof VerdictSchema>

const DiagnosisSchema = z.object({
  reason: z.enum(LOSS_REASONS),
  explanation: z.string(),
})

type Diagnosis = z.infer<typeof DiagnosisSchema>

/**
 * The ablation ladder. Each rung adds exactly one FounderOS mechanism, so the
 * delta between adjacent rungs is that mechanism's contribution. Reference arms
 * sit below the ladder and are not part of it.
 */
type Arm = {
  id: string
  kind: 'reference' | 'ladder'
  isolates: string
  run: (testCase: EvalCase) => Promise<{ answer: string; usage: Usage }>
}

const NO_USAGE: Usage = { tokensIn: 0, tokensOut: 0, ms: 0, calls: 0 }

function pipelineArm(
  id: string,
  isolates: string,
  opts: { challenge: boolean; useExperts: boolean; useCorpus?: boolean },
): Arm {
  return {
    id,
    kind: 'ladder',
    isolates,
    async run(testCase) {
      const result = await run({
        query: testCase.query,
        workspace: openWorkspace(testCase.context),
        pinnedSkill: testCase.skill,
        challenge: opts.challenge,
        useExperts: opts.useExperts,
        useCorpus: opts.useCorpus ?? false,
      })
      return { answer: briefToProse(result.brief), usage: result.usage }
    },
  }
}

function textArm(
  id: string,
  kind: Arm['kind'],
  isolates: string,
  modelEnv: string,
  fallbackModel: string,
  build: (testCase: EvalCase) => { system: string; prompt: string },
): Arm {
  return {
    id,
    kind,
    isolates,
    async run(testCase) {
      const provider = createProvider(process.env[modelEnv] ?? fallbackModel)
      const { system, prompt } = build(testCase)
      const result = await provider.text({ system, prompt })
      return {
        answer: result.value,
        usage: { tokensIn: result.tokensIn, tokensOut: result.tokensOut, ms: result.ms, calls: 1 },
      }
    },
  }
}

function fullContext(contextDir: string): string {
  return renderContext(selectContext(openWorkspace(contextDir), CONTEXT_KEYS))
}

/** The context the routed skill declares it needs — this is what `context-selected` isolates. */
function skillContext(testCase: EvalCase): string {
  const skill = requireSkill(loadSkills(), testCase.skill)
  return renderContext(selectContext(openWorkspace(testCase.context), skill.requiresContext))
}

const CLAUDE = 'anthropic:claude-opus-5'

export const ARMS: Arm[] = [
  textArm('gpt-vanilla', 'reference', '—', 'FOUNDEROS_MODEL_VANILLA_GPT', 'openai:gpt-5', (c) =>
    vanillaPrompt(c.query),
  ),
  textArm('claude-vanilla', 'reference', '—', 'FOUNDEROS_MODEL_VANILLA_CLAUDE', CLAUDE, (c) =>
    vanillaPrompt(c.query),
  ),
  textArm(
    'context-dump',
    'ladder',
    'baseline: all context, no FounderOS',
    'FOUNDEROS_MODEL_VANILLA_CLAUDE',
    CLAUDE,
    (c) => contextDumpPrompt(c.query, fullContext(c.context)),
  ),
  textArm(
    'context-selected',
    'ladder',
    'context selection',
    'FOUNDEROS_MODEL_VANILLA_CLAUDE',
    CLAUDE,
    (c) => contextDumpPrompt(c.query, skillContext(c)),
  ),
  pipelineArm('skill', 'skill framework + structured output', { challenge: false, useExperts: false }),
  pipelineArm('skill+experts', 'expert knowledge', { challenge: false, useExperts: true }),
  pipelineArm('skill+corpus', 'the knowledge base', {
    challenge: false,
    useExperts: true,
    useCorpus: true,
  }),
  pipelineArm('founderos', 'challenger', { challenge: true, useExperts: true, useCorpus: true }),
]

const BASELINE = 'founderos'
const NULL_HYPOTHESIS = 'context-dump'

/**
 * Every model call in the suite passes through one semaphore. Bounding requests
 * rather than cases keeps the ceiling predictable no matter how many arms are
 * enabled — a per-case pool would multiply by arm count and hit rate limits.
 */
function createLimiter(limit: number) {
  let active = 0
  const queue: (() => void)[] = []

  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((resolve) => queue.push(resolve))
    active++
    try {
      return await task()
    } finally {
      active--
      queue.shift()?.()
    }
  }
}

type Limiter = ReturnType<typeof createLimiter>

/**
 * Measured on real runs (2026-08-17): reasoning lands near 2k output tokens, the
 * challenger near 2.7k because it emits a critique plus a full revised brief.
 * Input is counted exactly by building the real prompts — only output is guessed.
 */
const OUTPUT_TOKEN_ESTIMATE: Record<string, number> = {
  route: 200,
  reason: 2000,
  challenge: 2700,
  judge: 900,
  text: 1200,
}

/** Rough but stable: good enough to size a top-up, never presented as billing. */
function approxTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function estimate(cases: EvalCase[], arms: Arm[]): string {
  const skills = loadSkills()
  const experts = loadExperts()
  const rows: { arm: string; calls: number; tokensIn: number; tokensOut: number }[] = []
  let judgeCalls = 0
  let judgeIn = 0

  for (const arm of arms) {
    let calls = 0
    let tokensIn = 0
    let tokensOut = 0

    for (const testCase of cases) {
      const skill = requireSkill(skills, testCase.skill)
      const ws = openWorkspace(testCase.context)
      const selected = renderContext(selectContext(ws, skill.requiresContext))

      if (arm.kind === 'reference' || arm.id.startsWith('context-')) {
        const body = arm.id === 'context-dump' ? fullContext(testCase.context) : selected
        const { system, prompt } =
          arm.kind === 'reference'
            ? vanillaPrompt(testCase.query)
            : contextDumpPrompt(testCase.query, body)
        calls++
        tokensIn += approxTokens(system + prompt)
        tokensOut += OUTPUT_TOKEN_ESTIMATE.text!
        continue
      }

      const useExperts = arm.id !== 'skill'
      const loaded = useExperts ? selectExperts(experts, skill.experts) : []
      const reason = reasonPrompt({ query: testCase.query, skill, experts: loaded, context: selected })
      calls++
      tokensIn += approxTokens(reason.system + reason.prompt)
      tokensOut += OUTPUT_TOKEN_ESTIMATE.reason!

      if (arm.id === BASELINE || arm.id === 'skill+corpus') {
        const challenge = challengePrompt({ query: testCase.query, context: selected, draft: {} as never })
        calls++
        tokensIn += approxTokens(challenge.system + challenge.prompt) + OUTPUT_TOKEN_ESTIMATE.reason! * 4
        tokensOut += OUTPUT_TOKEN_ESTIMATE.challenge!
      }
    }

    rows.push({ arm: arm.id, calls, tokensIn, tokensOut })

    if (arm.id !== BASELINE) {
      for (const testCase of cases) {
        judgeCalls++
        judgeIn += approxTokens(fullContext(testCase.context)) * 1 + 3000
      }
    }
  }

  const lines = [
    `${cases.length} case(s) x ${arms.length} arm(s)`,
    '',
    '| arm | calls | ~tokens in | ~tokens out |',
    '|---|---|---|---|',
    ...rows.map((r) => `| ${r.arm} | ${r.calls} | ${r.tokensIn} | ${r.tokensOut} |`),
    `| judging | ${judgeCalls} | ${judgeIn} | ${judgeCalls * OUTPUT_TOKEN_ESTIMATE.judge!} |`,
    '',
    `Total: ${rows.reduce((n, r) => n + r.calls, 0) + judgeCalls} model calls, ` +
      `~${rows.reduce((n, r) => n + r.tokensIn, 0) + judgeIn} in, ` +
      `~${rows.reduce((n, r) => n + r.tokensOut, 0) + judgeCalls * OUTPUT_TOKEN_ESTIMATE.judge!} out.`,
    '',
    'Input is exact (real prompts, built offline). Output is estimated from measured runs.',
    'Multiply by your provider\'s per-token price; this tool deliberately does not hardcode rates.',
  ]
  return lines.join('\n')
}

function loadEvalCases(): EvalCase[] {
  return readdirSync(CASES_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .flatMap((f) => {
      const path = join(CASES_DIR, f)
      const parsed = CaseFileSchema.safeParse(parseYaml(readFileSync(path, 'utf8')))
      if (!parsed.success) throw new Error(`${path} is invalid: ${parsed.error.message}`)
      return parsed.data.cases.map((c) => ({ ...c, context: parsed.data.context }))
    })
}

async function runRouterEvals(): Promise<{ passed: number; total: number; failures: string[] }> {
  const cases = readdirSync(ROUTER_DIR)
    .filter((f) => f.endsWith('.yaml'))
    .sort()
    .map((f) => {
      const parsed = RouterCaseSchema.safeParse(parseYaml(readFileSync(join(ROUTER_DIR, f), 'utf8')))
      if (!parsed.success) throw new Error(`${join(ROUTER_DIR, f)} is invalid: ${parsed.error.message}`)
      return parsed.data
    })

  const skills = [...loadSkills().values()]
  const experts = [...loadExperts().values()]
  const provider = createProvider(modelForRole('router'))
  const ws = openWorkspace()
  const company = companySummary(ws)
  const failures: string[] = []
  let passed = 0

  for (const c of cases) {
    const { value } = await route({ provider, query: c.query, company, skills, experts })
    const problems: string[] = []

    const got = [...value.skills].sort().join(',')
    const want = [...c.expect.skills].sort().join(',')
    if (got !== want) problems.push(`skills: want [${want}], got [${got}]`)

    const missing = (c.expect.context_keys_include ?? []).filter(
      (k) => !value.context_keys.includes(k as ContextKey),
    )
    if (missing.length) problems.push(`context_keys missing: ${missing.join(', ')}`)

    if (c.expect.better_question === 'null' && value.better_question !== null) {
      problems.push(`better_question should be null, got: ${value.better_question}`)
    }
    if (c.expect.better_question === 'present' && value.better_question === null) {
      problems.push('better_question should be present, got null')
    }

    if (problems.length === 0) passed++
    else failures.push(`"${c.query}"\n    ${problems.join('\n    ')}`)
  }

  return { passed, total: cases.length, failures }
}

export type Comparison = {
  caseId: string
  condition: string
  challenger: string
  verdict: Verdict
  baselineWasA: boolean
  diagnosis: Diagnosis | null
}

export function won(c: Comparison): boolean {
  return c.verdict.preferred === (c.baselineWasA ? 'A' : 'B')
}

export function lost(c: Comparison): boolean {
  return !won(c) && c.verdict.preferred !== 'tie'
}

export function meanDelta(comparisons: Comparison[], dimension: Dimension): number {
  if (comparisons.length === 0) return 0
  const total = comparisons.reduce((sum, c) => {
    const base = c.baselineWasA ? c.verdict.scores_a : c.verdict.scores_b
    const other = c.baselineWasA ? c.verdict.scores_b : c.verdict.scores_a
    return sum + (base[dimension] - other[dimension])
  }, 0)
  return total / comparisons.length
}

function tally<T extends string>(values: T[]): [T, number][] {
  const counts = new Map<T, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])
}

export function report(input: {
  comparisons: Comparison[]
  usage: Map<string, Usage>
  cases: EvalCase[]
  router: Awaited<ReturnType<typeof runRouterEvals>> | null
  arms: Arm[]
}): string {
  const { comparisons, usage, cases, router, arms } = input
  const lines: string[] = [
    '# Eval run',
    '',
    `Judge: \`${modelForRole('judge')}\`  ·  Baseline: \`${BASELINE}\`  ·  Null hypothesis: \`${NULL_HYPOTHESIS}\``,
    `Cases: ${cases.length}  ·  Arms: ${arms.map((a) => a.id).join(', ')}`,
    '',
  ]

  if (router) {
    lines.push('## Router', '', `${router.passed}/${router.total} passed.`, '')
    for (const f of router.failures) lines.push(`- ${f}`)
    if (router.failures.length) lines.push('')
  }

  lines.push(`## ${BASELINE} vs each arm`, '')
  lines.push(`| arm | win | loss | tie | ${DIMENSIONS.join(' | ')} |`)
  lines.push(`|---|---|---|---|${DIMENSIONS.map(() => '---').join('|')}|`)
  for (const arm of arms.filter((a) => a.id !== BASELINE)) {
    const subset = comparisons.filter((c) => c.challenger === arm.id)
    if (subset.length === 0) continue
    const wins = subset.filter(won).length
    const ties = subset.filter((c) => c.verdict.preferred === 'tie').length
    const deltas = DIMENSIONS.map((d) => meanDelta(subset, d).toFixed(2)).join(' | ')
    lines.push(`| ${arm.id} | ${wins} | ${subset.length - wins - ties} | ${ties} | ${deltas} |`)
  }
  lines.push(
    '',
    `Deltas are mean(${BASELINE}) − mean(arm) per dimension on a 1–5 scale.`,
    'N is small and judge noise is large: treat anything under a 2:1 win ratio as no signal.',
    '',
  )

  lines.push('## Ablation ladder', '')
  lines.push(
    `Every arm is judged against \`${BASELINE}\`, so a rung's gap to the baseline is the sum of`,
    'every mechanism above it. The marginal contribution of one mechanism is therefore the',
    'difference between two adjacent gaps.',
    '',
    '| rung | mechanism it adds | gap to baseline | marginal contribution |',
    '|---|---|---|---|',
  )
  const ladder = arms.filter((a) => a.kind === 'ladder')
  const gap = (armId: string): number | null => {
    if (armId === BASELINE) return 0
    const subset = comparisons.filter((c) => c.challenger === armId)
    if (subset.length === 0) return null
    return DIMENSIONS.reduce((sum, d) => sum + meanDelta(subset, d), 0) / DIMENSIONS.length
  }
  for (const [index, arm] of ladder.entries()) {
    const here = gap(arm.id)
    const below = index === 0 ? null : gap(ladder[index - 1]!.id)
    const marginal = here !== null && below !== null ? (below - here).toFixed(2) : '—'
    lines.push(
      `| ${arm.id} | ${arm.isolates} | ${here === null ? 'not run' : here.toFixed(2)} | ${marginal} |`,
    )
  }
  lines.push(
    '',
    'Marginal contribution is in mean judge points across all seven dimensions. A mechanism',
    'at or below 0 is not paying for itself and is a deletion candidate.',
    '',
    '**Caveat:** the `skill` rung introduces the procedure and the structured output together.',
    'This suite cannot separate them — a further arm would be needed, and is not worth building',
    'until the combined rung shows a positive contribution.',
    '',
  )

  const nullWins = comparisons.filter((c) => c.challenger === NULL_HYPOTHESIS && won(c))
  lines.push(`## Where ${BASELINE} creates incremental value`, '')
  lines.push(
    `Attributed over the ${nullWins.length} case(s) where \`${BASELINE}\` beat \`${NULL_HYPOTHESIS}\` —`,
    'the only comparison that tests the real hypothesis.',
    '',
  )
  if (nullWins.length === 0) {
    lines.push('_No wins to attribute. The added architecture is not earning its complexity._', '')
  } else {
    lines.push('| mechanism | cases |', '|---|---|')
    for (const [mechanism, count] of tally(nullWins.map((c) => c.verdict.advantage_source))) {
      lines.push(`| ${mechanism} | ${count} |`)
    }
    lines.push('')
  }

  const losses = comparisons.filter(lost)
  lines.push('## Failure analysis', '')
  if (losses.length === 0) {
    lines.push('_No losses._', '')
  } else {
    lines.push('| reason | cases |', '|---|---|')
    for (const [reason, count] of tally(losses.map((l) => l.diagnosis?.reason ?? 'other'))) {
      lines.push(`| ${reason} | ${count} |`)
    }
    lines.push('', '### Individual losses — this is the backlog', '')
    for (const loss of losses) {
      lines.push(
        `- **${loss.caseId}** (${loss.condition}) lost to \`${loss.challenger}\`` +
          ` — _${loss.diagnosis?.reason ?? 'undiagnosed'}_: ${loss.diagnosis?.explanation ?? ''}`,
        `  - judge (${loss.verdict.judge_confidence} confidence): ${loss.verdict.advantage_evidence}`,
      )
    }
    lines.push('')
  }

  lines.push('## Results by condition', '')
  lines.push(`| condition | ${BASELINE} vs ${NULL_HYPOTHESIS} |`, '|---|---|')
  for (const condition of [...new Set(cases.map((c) => c.condition))].sort()) {
    const subset = comparisons.filter(
      (c) => c.condition === condition && c.challenger === NULL_HYPOTHESIS,
    )
    if (subset.length === 0) continue
    const w = subset.filter(won).length
    const t = subset.filter((c) => c.verdict.preferred === 'tie').length
    lines.push(`| ${condition} | ${w}W ${subset.length - w - t}L ${t}T |`)
  }

  lines.push('', '## Cost and latency', '', '| arm | calls | tokens in | tokens out | mean ms |', '|---|---|---|---|---|')
  for (const arm of arms) {
    const u = usage.get(arm.id)
    if (!u) continue
    lines.push(
      `| ${arm.id} | ${u.calls} | ${u.tokensIn} | ${u.tokensOut} | ${Math.round(u.ms / Math.max(cases.length, 1))} |`,
    )
  }
  lines.push('', 'Totals are across the whole suite; `mean ms` is per case.', '')

  lines.push('## Judge confidence', '')
  for (const [level, count] of tally(comparisons.map((c) => c.verdict.judge_confidence))) {
    lines.push(`- ${level}: ${count}`)
  }

  return lines.join('\n')
}

const DIAGNOSIS_SYSTEM = `A structured founder-advice system (FounderOS) lost a head-to-head
comparison against a simpler baseline. Diagnose why, so the loss can become a regression fix.

You are given the question, what FounderOS routed and loaded, its answer, the answer that beat
it, and the judge's stated reason. Pick the single most likely root cause:

- router_error — routed to the wrong skill, or selected the wrong context keys
- missing_context — the context it loaded genuinely lacked what the answer needed
- skill_too_prescriptive — the procedure forced a shape that hurt this question
- expert_noise — cited principles that did not apply and distorted the answer
- weak_expert_pack — the relevant principle does not exist in the packs
- challenger_degraded_answer — the revision is worse than the draft would have been
- overlong_prompt — the answer looks diluted by too much input
- under_specific_output — right call, but too vague to act on
- judge_ambiguity — the answers are roughly equivalent and the verdict is noise
- other

Prefer a general mechanism over a per-question quirk. If the fix would be "special-case this
question", the reason is probably one of the mechanism categories instead.`

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'router-only': { type: 'boolean', default: false },
      'skip-router': { type: 'boolean', default: false },
      limit: { type: 'string' },
      arms: { type: 'string' },
      cases: { type: 'string' },
      concurrency: { type: 'string' },
      estimate: { type: 'boolean', default: false },
    },
  })
  const gate = createLimiter(values.concurrency ? Number(values.concurrency) : 5)

  if (values.estimate) {
    const armFilterEarly = values.arms?.split(',').map((a) => a.trim())
    const armsEarly = armFilterEarly
      ? ARMS.filter((a) => a.id === BASELINE || armFilterEarly.includes(a.id))
      : ARMS
    let casesEarly = loadEvalCases()
    if (values.cases) {
      const ids = values.cases.split(',').map((c) => c.trim())
      casesEarly = casesEarly.filter((c) => ids.includes(c.id))
    }
    if (values.limit) casesEarly = casesEarly.slice(0, Number(values.limit))
    process.stdout.write(`${estimate(casesEarly, armsEarly)}\n`)
    return
  }

  const router = values['skip-router'] ? null : await runRouterEvals()
  if (router) process.stderr.write(`router: ${router.passed}/${router.total}\n`)

  if (values['router-only']) {
    mkdirSync(RESULTS_DIR, { recursive: true })
    writeFileSync(
      join(RESULTS_DIR, 'router.md'),
      report({ comparisons: [], usage: new Map(), cases: [], router, arms: [] }),
    )
    if (router?.failures.length) process.exitCode = 1
    return
  }

  const armFilter = values.arms?.split(',').map((s) => s.trim())
  const arms = armFilter
    ? ARMS.filter((a) => a.id === BASELINE || armFilter.includes(a.id))
    : ARMS
  const caseFilter = values.cases?.split(',').map((s) => s.trim())
  let cases = loadEvalCases()
  if (caseFilter) cases = cases.filter((c) => caseFilter.includes(c.id))
  if (values.limit) cases = cases.slice(0, Number(values.limit))

  const generations = cases.length * arms.length
  const judgings = cases.length * (arms.length - 1)
  process.stderr.write(
    `\n${cases.length} cases × ${arms.length} arms = ${generations} generations + ${judgings} judgings.\n` +
      `Narrow with --limit N, --cases id1,id2, --arms context-dump.\n\n`,
  )

  const rubric = readFileSync('evals/judge.md', 'utf8')
  const judge = createProvider(modelForRole('judge'))
  const comparisons: Comparison[] = []
  const usage = new Map<string, Usage>()
  let done = 0

  function record(armId: string, u: Usage): void {
    const prior = usage.get(armId) ?? NO_USAGE
    usage.set(armId, {
      tokensIn: prior.tokensIn + u.tokensIn,
      tokensOut: prior.tokensOut + u.tokensOut,
      ms: prior.ms + u.ms,
      calls: prior.calls + u.calls,
    })
  }

  async function judgeCase(testCase: EvalCase, caseIndex: number): Promise<Comparison[]> {
    const answers = new Map<string, string>()
    const results = await Promise.all(
      arms.map(async (arm) => {
        try {
          return { arm, result: await gate(() => arm.run(testCase)) }
        } catch (error) {
          // One arm dying must not lose the whole run's work.
          process.stderr.write(
            `  ${testCase.id} / ${arm.id} FAILED: ${error instanceof Error ? error.message : String(error)}\n`,
          )
          return null
        }
      }),
    )
    for (const entry of results) {
      if (!entry) continue
      answers.set(entry.arm.id, entry.result.answer)
      record(entry.arm.id, entry.result.usage)
    }

    const baseline = answers.get(BASELINE)
    if (!baseline) {
      process.stderr.write(`  ${testCase.id}: baseline produced nothing, skipping case\n`)
      return []
    }
    const context = fullContext(testCase.context)

    const judged = await Promise.all(
      arms
        .filter((a) => a.id !== BASELINE)
        .map(async (arm, armIndex): Promise<Comparison | null> => {
          const other = answers.get(arm.id)
          if (!other) return null
          // Deterministic position swap: reproducible across runs, still balanced
          // across the matrix.
          const baselineWasA = (caseIndex + armIndex) % 2 === 0
          const { system, prompt } = judgePrompt({
            rubric,
            query: testCase.query,
            context,
            a: baselineWasA ? baseline : other,
            b: baselineWasA ? other : baseline,
          })
          const verdict = await gate(() =>
            judge.object({ system, prompt, schema: VerdictSchema, maxOutputTokens: 3000 }),
          )

          const comparison: Comparison = {
            caseId: testCase.id,
            condition: testCase.condition,
            challenger: arm.id,
            verdict: verdict.value,
            baselineWasA,
            diagnosis: null,
          }

          if (lost(comparison)) {
            const diagnosis = await gate(() =>
              judge.object({
                system: DIAGNOSIS_SYSTEM,
                prompt: [
                  `# Question\n${testCase.query}`,
                  `# Case notes\n${testCase.notes}`,
                  `# FounderOS answer\n${baseline}`,
                  `# Answer that beat it (arm: ${arm.id})\n${other}`,
                  `# Judge's stated reason\n${verdict.value.advantage_evidence}`,
                ].join('\n\n'),
                schema: DiagnosisSchema,
                maxOutputTokens: 1000,
              }),
            )
            comparison.diagnosis = diagnosis.value
          }
          return comparison
        }),
    )

    const kept = judged.filter((c): c is Comparison => c !== null)
    const wins = kept.filter(won).length
    process.stderr.write(
      `[${++done}/${cases.length}] ${testCase.id} (${testCase.condition}): ${wins}W of ${kept.length}\n`,
    )
    // Partial results after every case, so a run that dies keeps its work.
    mkdirSync(RESULTS_DIR, { recursive: true })
    comparisons.push(...kept)
    writeFileSync(join(RESULTS_DIR, 'partial.json'), JSON.stringify({ comparisons }, null, 2))
    return kept
  }

  await Promise.all(cases.map((testCase, index) => judgeCase(testCase, index)))

  mkdirSync(RESULTS_DIR, { recursive: true })
  const path = join(RESULTS_DIR, `${new Date().toISOString().slice(0, 10)}.md`)
  writeFileSync(path, report({ comparisons, usage, cases, router, arms }))
  writeFileSync(join(RESULTS_DIR, 'latest.json'), JSON.stringify({ comparisons, cases }, null, 2))
  process.stderr.write(`\nwrote ${path}\n`)
}

// Only run when invoked as a command. Tests import this module for its schemas,
// and an unguarded call would launch the whole suite on `pnpm test`.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
    process.exitCode = 1
  })
}
