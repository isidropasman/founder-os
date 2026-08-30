import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { createProvider, modelForRole } from '../provider.ts'

/** The context entities an extraction can propose writing to. */
export const TARGETS = [
  'company',
  'founder',
  'goal',
  'metric',
  'person',
  'feedback',
  'experiment',
  'meeting',
  'decision',
] as const

export type Target = (typeof TARGETS)[number]

export const ProposalSchema = z.object({
  target: z.enum(TARGETS).describe('Which part of the startup context this belongs in.'),
  fields: z
    .record(z.string(), z.unknown())
    .describe('The entity fields, using the exact field names from the schema you were given.'),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Below 0.5 the item is held as unresolved instead of merged.'),
  quote: z
    .string()
    .describe('The span of the input this came from, verbatim. Never paraphrase here.'),
  reasoning: z.string().describe('One short sentence. Why this target and these fields.'),
})

export type Proposal = z.infer<typeof ProposalSchema>

export const ExtractionSchema = z.object({
  summary: z.string().describe('One sentence describing what this document is.'),
  source_type: z.enum([
    'founder-note',
    'company-description',
    'customer-interview',
    'meeting-notes',
    'investor-feedback',
    'pricing-note',
    'decision-note',
    'experiment-note',
    'strategy-note',
    'other',
  ]),
  proposals: z.array(ProposalSchema),
})

export type Extraction = z.infer<typeof ExtractionSchema>

export type ExtractionInput = {
  /** Stable id for provenance: a path for files, `paste:<hash>` for pasted text. */
  sourceId: string
  text: string
}

export type Extractor = {
  readonly id: string
  readonly live: boolean
  extract(input: ExtractionInput): Promise<Extraction>
}

export function hashText(text: string): string {
  return createHash('sha256').update(text.trim()).digest('hex')
}

// Field shapes are described to the model here rather than derived from the Zod
// schemas: the model needs the *intent* of each field ("verbatim, never
// paraphrased") which a JSON Schema dump cannot carry.
const FIELD_GUIDE = `
company     — name, one_liner, stage, business_model, icp, pricing, runway_months, team_size, constraints[]
founder     — name, role, strengths[], weak_spots[], known_biases[], working_style
goal        — id, statement, horizon (YYYY-MM-DD), metric, target (number), status (active|achieved|abandoned)
metric      — name, value (number), as_of (YYYY-MM-DD), trend (up|flat|down), source
person      — id, name, role, org, relationship (investor|customer|advisor|candidate|team), last_touch, notes
feedback    — id, date, person_id (or null), channel (call|email|support|survey|churn-interview|sales-call),
              verbatim (EXACT words of the customer, never your summary), theme, sentiment (positive|neutral|negative)
experiment  — id, hypothesis, method, metric, started, ends, status (running|concluded|abandoned), result, learning
meeting     — id, date, person_id (or null), purpose, outcome, open_threads[]
decision    — id, date, question, options[], decision, confidence (0-1), review_date, assumptions[],
              evidence[], next_action, status (open|reviewed), outcome, learning`

const SYSTEM = `You turn a founder's unstructured notes into structured startup context.

You are an extractor, not an advisor. Do not interpret, evaluate, or give opinions.
Only record what the text actually says.

Target entities and their fields:
${FIELD_GUIDE}

Rules:
- Emit one proposal per distinct fact. A customer call usually yields several: a person,
  one or more feedback items, sometimes a meeting.
- \`quote\` must be a verbatim span of the input. It is checked against the source, and a
  proposal whose quote is not found in the input is rejected.
- \`verbatim\` on feedback must be the customer's actual words. If the note only paraphrases
  them, say so in the field and lower your confidence.
- Never invent ids, dates or numbers. If a date is not stated, omit the field rather than
  guessing. "Last week" is not a date.
- Use ids in kebab-case with a type prefix: g-, p-, fb-, exp-, mtg-, d-.
- Confidence below 0.5 means "this might be here but I am not sure". Use it freely; low
  confidence items are held for review rather than discarded or merged.
- If the text contains no startup context at all, return an empty proposals array.`

export const llmExtractor: Extractor = {
  id: 'llm',
  live: true,
  async extract(input) {
    const provider = createProvider(modelForRole('router'))
    const result = await provider.object({
      system: SYSTEM,
      prompt: `# Source: ${input.sourceId}\n\n${input.text}`,
      schema: ExtractionSchema,
      maxOutputTokens: 8000,
    })
    return result.value
  },
}

/**
 * Replays a recorded extraction keyed by the hash of the input text. Every stage
 * after extraction — classification, dedup, conflict detection, preview, merge —
 * is deterministic, so this makes the whole ingestion pipeline testable and
 * reproducible with no credentials.
 */
export function fixtureExtractor(dir = 'test/fixtures/extractions'): Extractor {
  return {
    id: `fixture:${dir}`,
    live: false,
    async extract(input) {
      const path = join(dir, `${hashText(input.text)}.json`)
      if (!existsSync(path)) {
        throw new Error(
          `No recorded extraction for this input.\n  expected: ${path}\n` +
            `  Record one with: pnpm founderos context import <file> --record`,
        )
      }
      const parsed = ExtractionSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
      if (!parsed.success) throw new Error(`${path} is not a valid extraction: ${parsed.error.message}`)
      return parsed.data
    },
  }
}

export function extractorFor(spec = process.env.FOUNDEROS_EXTRACTOR ?? 'llm'): Extractor {
  return spec === 'fixture' ? fixtureExtractor() : llmExtractor
}
