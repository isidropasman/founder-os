import {
  companySummary,
  openWorkspace,
  renderContext,
  selectContext,
  type ContextKey,
  type Workspace,
} from './context.ts'
import { collectBasis, validateBasis } from './basis.ts'
import { loadExperts, selectExperts, validateCitations, type Expert } from './experts.ts'
import {
  challengeSchemaFor,
  citationsOf,
  outputSchemaFor,
  type AnyBrief,
  type Challenge,
} from './outputs.ts'
import { challengePrompt, reasonPrompt } from './prompts.ts'
import { createProvider, modelForRole, type Completion, type Provider } from './provider.ts'
import { route, type RouterOutput } from './router.ts'
import { loadSkills, requireSkill, type Skill } from './skills.ts'
import { consult, renderPassages, type Passage } from './knowledge/consult.ts'
import { detectSignals, signalsForPrompt } from './signals.ts'
import { newRunId, writeTrace, type Trace, type TraceStep } from './trace.ts'

export type RunOptions = {
  query: string
  workspace?: Workspace
  /** Pin a skill, bypassing the router. Used by evals and by `--skill`. */
  pinnedSkill?: string
  challenge?: boolean
  useExperts?: boolean
  now?: Date
  /** Consult the knowledge base. Off makes the `--no-corpus` ablation arm possible. */
  useCorpus?: boolean
  /**
   * Per-step provider overrides. The only reason this exists is replay: without
   * it the pipeline can only be exercised by paying for it.
   */
  providers?: Partial<Record<'route' | 'reason' | 'challenge', Provider>>
}

export type Usage = { tokensIn: number; tokensOut: number; ms: number; calls: number }

export type RunResult = {
  runId: string
  routing: RouterOutput
  brief: AnyBrief
  challenge: Challenge | null
  contextKeys: ContextKey[]
  tracePath: string
  usage: Usage
  trace: Trace
}

export function sumUsage(steps: readonly TraceStep[]): Usage {
  return steps.reduce(
    (total, s) => ({
      tokensIn: total.tokensIn + s.tokensIn,
      tokensOut: total.tokensOut + s.tokensOut,
      ms: total.ms + s.ms,
      calls: total.calls + 1,
    }),
    { tokensIn: 0, tokensOut: 0, ms: 0, calls: 0 },
  )
}

const MAX_CITATION_RETRIES = 1

function step(name: string, system: string, prompt: string, c: Completion<unknown>): TraceStep {
  return {
    name,
    model: c.model,
    system,
    prompt,
    raw: c.raw,
    tokensIn: c.tokensIn,
    tokensOut: c.tokensOut,
    ms: c.ms,
  }
}

async function reasonWithValidCitations(
  provider: Provider,
  input: {
    query: string
    skill: Skill
    experts: Expert[]
    context: string
    signals: string
    passages: Passage[]
    selected: Record<string, unknown>
  },
  steps: TraceStep[],
): Promise<AnyBrief> {
  let citationErrors: string[] | undefined

  for (let attempt = 0; attempt <= MAX_CITATION_RETRIES; attempt++) {
    const rendered = { ...input, passages: renderPassages(input.passages) }
    const { system, prompt } = reasonPrompt(
      citationErrors ? { ...rendered, citationErrors } : rendered,
    )
    const result = await provider.object({
      system,
      prompt,
      schema: outputSchemaFor(input.skill.output),
      maxOutputTokens: 8000,
    })
    steps.push(step(attempt === 0 ? 'reason' : `reason:retry-${attempt}`, system, prompt, result))

    const check = validateCitations(
      input.experts,
      citationsOf(result.value),
      input.passages.map((p) => p.id),
    )
    // A basis that resolves to nothing is the same failure as an invented quote:
    // it looks like evidence and cannot be followed.
    const grounding = validateBasis(collectBasis(result.value), {
      selected: input.selected,
      experts: input.experts,
      passages: input.passages,
    })
    if (check.ok && grounding.ok) return result.value
    citationErrors = [...(check.ok ? [] : check.errors), ...(grounding.ok ? [] : grounding.errors)]
  }

  throw new Error(
    `The model cited support that does not exist, twice:\n${citationErrors?.map((e) => `  ${e}`).join('\n')}`,
  )
}

export async function run(options: RunOptions): Promise<RunResult> {
  const now = options.now ?? new Date()
  const runId = newRunId(now)
  const ws = options.workspace ?? openWorkspace()
  const withChallenge = options.challenge ?? true
  const withExperts = options.useExperts ?? true
  const withCorpus = options.useCorpus ?? true

  const skills = loadSkills()
  const experts = loadExperts()
  const steps: TraceStep[] = []

  const trace: Trace = {
    run_id: runId,
    query: options.query,
    flags: {
      challenge: withChallenge,
      experts: withExperts,
      corpus: withCorpus,
      pinned: Boolean(options.pinnedSkill),
    },
    versions: { skills: {}, experts: {}, context_hash: ws.hash },
    steps,
    final: null,
    error: null,
  }

  try {
    let routing: RouterOutput

    if (options.pinnedSkill) {
      const skill = requireSkill(skills, options.pinnedSkill)
      routing = {
        intent: 'pinned',
        skills: [skill.id],
        experts: withExperts ? skill.experts : [],
        context_keys: skill.requiresContext,
        depth: 'deep',
        better_question: null,
        reasoning: 'Skill pinned by caller; router skipped.',
      }
    } else {
      const routerProvider = options.providers?.route ?? createProvider(modelForRole('router'))
      const routed = await route({
        provider: routerProvider,
        query: options.query,
        company: companySummary(ws),
        skills: [...skills.values()],
        experts: [...experts.values()],
      })
      steps.push(step('route', routed.system, routed.prompt, routed))
      routing = routed.value
    }

    const skillId = routing.skills[0]
    if (!skillId) {
      throw new Error(
        'The router selected no skill. V0 only answers questions a skill covers — add one, or pass --skill.',
      )
    }
    const skill = requireSkill(skills, skillId)
    trace.versions.skills[skill.id] = skill.version

    // The skill's declared needs always win; the router may add context, never subtract.
    const contextKeys = [...new Set([...skill.requiresContext, ...routing.context_keys])]
    const selectedContext = selectContext(ws, contextKeys)
    const context = renderContext(selectedContext)

    const expertIds = withExperts ? (routing.experts.length ? routing.experts : skill.experts) : []
    const loadedExperts = selectExperts(experts, expertIds)
    for (const expert of loadedExperts) trace.versions.experts[expert.id] = expert.version

    // Computed here, not by the model: a rule cannot hallucinate an overdue review,
    // and handing these over means the expensive call spends its budget on judgment
    // rather than on rediscovering them from raw YAML.
    const signals = signalsForPrompt(detectSignals(ws, now))

    // The question alone is too thin to retrieve on, and too ambiguous: "raise
    // prices" and "raise money" share their strongest term. The skill's declared
    // corpus vocabulary disambiguates it.
    let passages: Passage[] = []
    if (withCorpus) {
      const consultation = await consult({
        query: options.query,
        domain: skill.corpusTerms.join(' ') || skill.purpose,
        ...(expertIds.length ? { authors: expertIds } : {}),
      })
      if (consultation.ok) {
        passages = consultation.passages
      } else {
        // A missing database degrades the answer; it must not kill the run.
        trace.corpus_unavailable = consultation.reason
        process.stderr.write(`corpus unavailable, answering without it: ${consultation.reason}\n`)
      }
    }
    trace.passages = passages.map((p) => p.id)

    const brief = await reasonWithValidCitations(
      options.providers?.reason ?? createProvider(modelForRole('reason')),
      {
        query: options.query,
        skill,
        experts: loadedExperts,
        context,
        signals,
        passages,
        selected: selectedContext,
      },
      steps,
    )

    let challenge: Challenge | null = null
    let finalBrief: AnyBrief = brief

    if (withChallenge) {
      const { system, prompt } = challengePrompt({ query: options.query, context, draft: brief })
      const challenger = options.providers?.challenge ?? createProvider(modelForRole('challenge'))
      const result = await challenger.object({
        system,
        prompt,
        schema: challengeSchemaFor(skill.output),
        // Critique plus a full revised brief: roughly double any other call here.
        maxOutputTokens: 16000,
      })
      steps.push(step('challenge', system, prompt, result))

      const check = validateCitations(
        loadedExperts,
        citationsOf(result.value.revised),
        passages.map((p) => p.id),
      )
      if (!check.ok) {
        // The challenger only ever narrows citations; a bad one means it invented
        // something. Keep the validated draft rather than shipping an unsourced claim.
        result.value.revised = brief
      }
      challenge = result.value
      finalBrief = result.value.revised
    }

    trace.final = { brief: finalBrief, challenge, routing }
    const tracePath = writeTrace(trace)
    return {
      runId,
      routing,
      brief: finalBrief,
      challenge,
      contextKeys,
      tracePath,
      usage: sumUsage(steps),
      trace,
    }
  } catch (error) {
    trace.error = error instanceof Error ? error.message : String(error)
    writeTrace(trace)
    throw error
  }
}
