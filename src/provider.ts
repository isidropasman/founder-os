import { anthropic } from '@ai-sdk/anthropic'
import { openai } from '@ai-sdk/openai'
import { generateObject, generateText, type LanguageModel } from 'ai'
import type { ZodType } from 'zod'

export type ModelRole = 'router' | 'reason' | 'challenge' | 'judge'

export type CompletionRequest = {
  system: string
  prompt: string
  maxOutputTokens?: number
}

export type Completion<T> = {
  value: T
  raw: string
  model: string
  tokensIn: number
  tokensOut: number
  ms: number
}

/**
 * The FounderOS-owned provider contract. Everything above this file talks to
 * these two methods and nothing else — the AI SDK is an implementation detail
 * of `createProvider`, replaceable in this file alone.
 */
export type Provider = {
  readonly id: string
  text(req: CompletionRequest): Promise<Completion<string>>
  object<T>(req: CompletionRequest & { schema: ZodType<T> }): Promise<Completion<T>>
}

const ROLE_DEFAULTS: Record<ModelRole, string> = {
  router: 'anthropic:claude-haiku-4-5',
  reason: 'anthropic:claude-opus-5',
  challenge: 'anthropic:claude-opus-5',
  judge: 'anthropic:claude-opus-5',
}

const SHORTHAND: Record<string, string> = {
  claude: 'anthropic:claude-opus-5',
  gpt: 'openai:gpt-5',
}

export function modelForRole(role: ModelRole): string {
  return process.env[`FOUNDEROS_MODEL_${role.toUpperCase()}`] ?? ROLE_DEFAULTS[role]
}

const CREDENTIAL_HINT: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY — get one at console.anthropic.com, then put it in .env',
  openai: 'OPENAI_API_KEY — get one at platform.openai.com, then put it in .env',
}

/** Raw provider errors are unreadable to someone meeting this tool for the first time. */
export function explainProviderError(spec: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const vendor = spec.split(':')[0] ?? ''
  const hint = CREDENTIAL_HINT[vendor]

  if (/api key/i.test(message) && hint) {
    return `No ${vendor} credentials.\n  Set ${hint}\n  Meanwhile these still work with no key: founderos status, context show, knowledge search`
  }
  if (/credit balance|quota|billing/i.test(message)) {
    return `Your ${vendor} account is out of credit.\n  Top up, then retry.\n  Meanwhile these still work: founderos status, context show, knowledge search`
  }
  if (/model|not_found|404/i.test(message) && /gpt|openai/.test(spec)) {
    return `The model id "${spec}" was rejected.\n  Check the current list and set FOUNDEROS_MODEL_VANILLA_GPT in .env.\n  ${message}`
  }
  return message
}

function resolve(spec: string): LanguageModel {
  const resolved = SHORTHAND[spec] ?? spec
  const separator = resolved.indexOf(':')
  if (separator === -1) {
    throw new Error(`Model spec "${spec}" must be "<provider>:<model-id>", "claude", or "gpt".`)
  }
  const vendor = resolved.slice(0, separator)
  const id = resolved.slice(separator + 1)
  if (vendor === 'anthropic') return anthropic(id)
  if (vendor === 'openai') return openai(id)
  throw new Error(`Unknown provider "${vendor}" in model spec "${spec}".`)
}

/**
 * Structured output sometimes arrives wrapped in a single-key envelope — the model
 * emits `{"parameters": {...}}` or `{"body": {...}}` instead of the object itself.
 * Observed on 2026-08-17 against claude-opus-5: the challenger schema failed this
 * way roughly half the time while an equally large sibling schema never did, so it
 * is not a size or nesting limit and not something a prompt tweak can be trusted
 * to fix. Normalizing it here keeps the quirk at the provider boundary, which is
 * the only place that should know the shape of a provider's mistakes.
 */
export function unwrapEnvelope<T>(value: unknown, schema: ZodType<T>, depth = 2): T | null {
  const direct = schema.safeParse(value)
  if (direct.success) return direct.data
  if (depth === 0 || typeof value !== 'object' || value === null || Array.isArray(value)) return null

  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length !== 1) return null
  return unwrapEnvelope(entries[0]![1], schema, depth - 1)
}

/**
 * Undoes double-encoded strings: the model emits `"\"revise\""` where the schema
 * wants `revise`, so an enum that was answered correctly still fails validation.
 * Only strings that are themselves valid JSON string literals are touched, so
 * ordinary prose containing quotes is left alone.
 */
export function decodeDoubleEncoded(value: unknown): unknown {
  if (typeof value === 'string') {
    if (value.length < 2 || !value.startsWith('"') || !value.endsWith('"')) return value
    try {
      const parsed: unknown = JSON.parse(value)
      return typeof parsed === 'string' ? parsed : value
    } catch {
      return value
    }
  }
  if (Array.isArray(value)) return value.map(decodeDoubleEncoded)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, decodeDoubleEncoded(v)]),
    )
  }
  return value
}

/** Applies every known provider-side deformation, then validates. */
export function coerceToSchema<T>(value: unknown, schema: ZodType<T>): T | null {
  return unwrapEnvelope(value, schema) ?? unwrapEnvelope(decodeDoubleEncoded(value), schema)
}

/** The invalid-but-parsed value the AI SDK carries on a schema mismatch. */
export function rejectedValue(error: unknown): unknown {
  const cause = (error as { cause?: { value?: unknown } })?.cause
  if (cause && 'value' in cause) return cause.value
  const text = (error as { text?: string })?.text
  if (typeof text !== 'string') return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Generous by default. The cap costs nothing unused, and a truncated object is a
 * total loss: the first live run died on a challenge response cut at 4000 tokens.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 8000

const RETRY_NUDGE =
  '\n\nReturn the object itself. Do not wrap it in an outer key such as "parameters", "body" or "result".'

export function createProvider(spec: string): Provider {
  const model = resolve(spec)

  return {
    id: spec,

    async text(req) {
      const started = Date.now()
      const result = await generateText({
        model,
        system: req.system,
        prompt: req.prompt,
        maxOutputTokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
      })
      return {
        value: result.text,
        raw: result.text,
        model: spec,
        tokensIn: result.usage.inputTokens ?? 0,
        tokensOut: result.usage.outputTokens ?? 0,
        ms: Date.now() - started,
      }
    },

    async object(req) {
      const started = Date.now()
      let spent = { in: 0, out: 0 }

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const result = await generateObject({
            model,
            schema: req.schema,
            system: req.system,
            prompt: attempt === 0 ? req.prompt : req.prompt + RETRY_NUDGE,
            maxOutputTokens: req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
          })
          return {
            value: result.object,
            raw: JSON.stringify(result.object),
            model: spec,
            tokensIn: spent.in + (result.usage.inputTokens ?? 0),
            tokensOut: spent.out + (result.usage.outputTokens ?? 0),
            ms: Date.now() - started,
          }
        } catch (error) {
          // Only a schema mismatch is worth retrying. An auth, billing or rate-limit
          // error will fail identically the second time, and retrying it doubles the
          // wait and buries the real message under a "did not produce a valid object".
          if ((error as { name?: string }).name !== 'AI_NoObjectGeneratedError') throw error

          const usage = (error as { usage?: { inputTokens?: number; outputTokens?: number } }).usage
          spent = {
            in: spent.in + (usage?.inputTokens ?? 0),
            out: spent.out + (usage?.outputTokens ?? 0),
          }

          // The model produced the right content in the wrong envelope: keep it
          // rather than paying for another generation.
          const salvaged = coerceToSchema(rejectedValue(error), req.schema)
          if (salvaged !== null) {
            return {
              value: salvaged,
              raw: JSON.stringify(salvaged),
              model: spec,
              tokensIn: spent.in,
              tokensOut: spent.out,
              ms: Date.now() - started,
            }
          }

          if (attempt === 1) {
            const truncated = (error as { finishReason?: string }).finishReason === 'length'
            const text = (error as { text?: string }).text ?? ''
            throw new Error(
              truncated
                ? `${spec} ran out of output tokens before finishing the object ` +
                  `(limit ${req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS}). Raise maxOutputTokens for this call.`
                : `${spec} did not produce a valid object, even after a retry.\n` +
                  `  ${error instanceof Error ? error.message : String(error)}\n` +
                  `  raw tail: ${text.slice(-400)}`,
              // Keep the SDK error reachable; wrapping it hid finishReason and the
              // rejected value during the first real debugging session.
              { cause: error },
            )
          }
        }
      }

      throw new Error('unreachable: the retry loop always returns or throws')
    },
  }
}
