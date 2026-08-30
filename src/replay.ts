import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { Completion, Provider } from './provider.ts'
import type { Trace } from './trace.ts'

export const RUNS_DIR = 'test/fixtures/runs'

const RecordingSchema = z.object({
  label: z.string(),
  note: z.string().default(''),
  steps: z
    .array(
      z.object({
        /** `route`, `reason`, `challenge` — matched in order within each name. */
        name: z.string(),
        raw: z.string(),
      }),
    )
    .min(1),
})

export type Recording = z.infer<typeof RecordingSchema>

export function loadRecording(name: string, dir = RUNS_DIR): Recording {
  const path = join(dir, `${name}.json`)
  if (!existsSync(path)) {
    throw new Error(`No recorded run "${name}" at ${path}. Record one with: ask --record <name>`)
  }
  const parsed = RecordingSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
  if (!parsed.success) throw new Error(`${path} is not a valid recording: ${parsed.error.message}`)
  return parsed.data
}

/**
 * Turns a paid run into a fixture. Traces already hold every raw response, so a
 * real run becomes a regression test at no extra cost.
 */
export function recordFromTrace(trace: Trace, label: string, note = '', dir = RUNS_DIR): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${label}.json`)
  const recording: Recording = {
    label,
    note,
    steps: trace.steps.map((s) => ({ name: s.name, raw: s.raw })),
  }
  writeFileSync(path, `${JSON.stringify(recording, null, 2)}\n`)
  return path
}

/**
 * Replays recorded responses in order, so the pipeline — routing, context
 * selection, citation validation, the challenger handoff, tracing — can be
 * exercised end to end with no credentials.
 *
 * It matches by step name and call order, NOT by prompt hash. That makes it
 * robust to prompt edits, and means it validates plumbing rather than prompt
 * content: a recording keeps passing after a prompt change that would alter a
 * real model's answer. Prompt quality is what the eval suite is for.
 */
export function replayProvider(recording: Recording, stepName: string): Provider {
  const queue = recording.steps.filter((s) => s.name.startsWith(stepName)).map((s) => s.raw)
  let consumed = 0

  const next = (): string => {
    const raw = queue[consumed++]
    if (raw === undefined) {
      throw new Error(
        `Recording "${recording.label}" has no response ${consumed} for step "${stepName}" ` +
          `(it holds ${queue.length}). The pipeline made more calls than were recorded.`,
      )
    }
    return raw
  }

  const completion = <T>(value: T, raw: string): Completion<T> => ({
    value,
    raw,
    model: `replay:${recording.label}`,
    tokensIn: 0,
    tokensOut: 0,
    ms: 0,
  })

  return {
    id: `replay:${recording.label}`,
    async text() {
      const raw = next()
      return completion(raw, raw)
    },
    async object(req) {
      const raw = next()
      const parsed = req.schema.safeParse(JSON.parse(raw))
      if (!parsed.success) {
        // A recording that no longer fits the schema is a real signal: the shape
        // changed underneath it, and any test relying on it is now lying.
        throw new Error(
          `Recording "${recording.label}" step "${stepName}" no longer matches its schema:\n` +
            parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n'),
        )
      }
      return completion(parsed.data, raw)
    },
  }
}
