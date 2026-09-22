import type { ContextKey, Workspace } from '../context.ts'
import type { Passage } from '../knowledge/consult.ts'
import type { Provider } from '../provider.ts'
import { assembleBrainInput } from './assemble.ts'
import { BrainAnswerSchema, validateBrainAnswer, type BrainAnswer } from './contract.ts'

export type BrainResponse =
  | { mode: 'answer'; assertions: BrainAnswer['assertions']; timing: BrainTiming }
  | { mode: 'retrieval_only'; passages: Passage[]; reason: string; timing: BrainTiming }
  | { mode: 'error'; message: string }

export type BrainTiming = { retrievalMs: number; assemblyMs: number; modelMs: number; totalMs: number }

export type AnswerBrainQuestionInput = {
  question: string
  workspace: Workspace
  contextKeys: readonly ContextKey[]
  passages: Passage[]
  provider?: Provider
  ruleIds?: readonly string[]
  retrievalMs?: number
}

const SYSTEM = `You answer founders from only the supplied private context and retrieved passages.
Return only a JSON object with this exact shape:
{"assertions":[{"text":"one concise statement","basis":[{"kind":"source","passageId":"the supplied passage id","quote":"a contiguous exact quote"}]}]}.
Every assertion needs at least one basis.
For source basis, use an exact quote from the identified passage. Use startup_data only for an exact supplied path. Use inference when the statement is your synthesis rather than supplied evidence. Never attribute an inference to a source.`

export async function answerBrainQuestion(input: AnswerBrainQuestionInput): Promise<BrainResponse> {
  const started = performance.now()
  const assembledStarted = performance.now()
  const assembled = assembleBrainInput(input)
  const assemblyMs = performance.now() - assembledStarted
  const retrievalMs = input.retrievalMs ?? 0
  const timing = (modelMs: number): BrainTiming => ({
    retrievalMs,
    assemblyMs,
    modelMs,
    totalMs: retrievalMs + Math.max(performance.now() - started, modelMs),
  })
  if (!input.provider) {
    return {
      mode: 'retrieval_only',
      passages: assembled.passages,
      reason: 'No local model provider is configured.',
      timing: timing(0),
    }
  }

  try {
    const completion = await input.provider.object({
      system: SYSTEM,
      prompt: assembled.prompt,
      schema: BrainAnswerSchema,
    })
    const checked = BrainAnswerSchema.safeParse(completion.value)
    if (!checked.success) {
      return {
        mode: 'retrieval_only',
        passages: assembled.passages,
        reason: 'The provider returned an invalid answer shape.',
        timing: timing(completion.ms),
      }
    }
    const validated = validateBrainAnswer(checked.data, assembled.evidence)
    if (!validated.ok) {
      return {
        mode: 'retrieval_only',
        passages: assembled.passages,
        reason: `The provider returned ungrounded evidence: ${validated.issues.join('; ')}`,
        timing: timing(completion.ms),
      }
    }
    return {
      mode: 'answer',
      assertions: validated.value.assertions,
      timing: timing(completion.ms),
    }
  } catch (error) {
    return {
      mode: 'retrieval_only',
      passages: assembled.passages,
      reason: error instanceof Error ? error.message : String(error),
      timing: timing(0),
    }
  }
}
