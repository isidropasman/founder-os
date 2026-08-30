import { z } from 'zod'

export const CitationSchema = z.object({
  principle_id: z.string().describe('An expert principle id exactly as given, e.g. "paul-graham/P2".'),
  kind: z
    .enum(['quoted', 'inferred'])
    .describe('"quoted" only if the principle carries a verbatim quote; otherwise "inferred".'),
})

export type Citation = z.infer<typeof CitationSchema>

/**
 * Length is expressed twice on purpose: the description sets the target the model
 * aims at, the `.max()` is a ceiling roughly 40% above it. A hard limit at the
 * target would reject answers that are merely a few words long, and a rejected
 * answer costs a whole retry.
 */
function brief(words: number, describe: string) {
  return z.string().max(words * 9).describe(`${describe} Max ~${words} words.`)
}

/**
 * Where this specific claim comes from. Attached per claim, not per document, so
 * the interface can show it where the founder is reading rather than as a
 * footnote. Every entry must resolve or the run fails.
 */
const basis = z
  .array(z.string())
  .min(1)
  .describe(
    'Ids supporting THIS claim: "metrics.<name>", "decisions.<id>", "goals.<id>", ' +
      '"feedback.<id>", "people.<id>", "founder.weak_spots", a principle id, a passage id, ' +
      'or the literal "inference" when it is your own judgment with nothing behind it. ' +
      'Never cite an id you were not given.',
  )

const Assumption = z.object({
  text: brief(20, 'The assumption.'),
  confidence: z.number().min(0).max(1),
  how_to_test: brief(20, 'Something doable this week.'),
})

const Evidence = z.object({
  claim: brief(18, 'The claim.'),
  source: brief(10, 'Where in the context this came from. Never invent a source.'),
})

/**
 * Every brief carries this tail. `question_for_you` is the escape hatch that keeps
 * the rest short: when a missing fact would change the recommendation, the model
 * asks for it instead of covering both branches in prose.
 */
const common = {
  confidence: z.number().min(0).max(1),
  next_action: brief(30, 'One action startable within 24 hours. Name the person, number or artifact.'),
  question_for_you: brief(
    22,
    'The one thing you would need to know to be materially more confident, phrased as a direct question to the founder. Null if the context already answers it. Ask instead of hedging.',
  )
    .nullable(),
  expert_citations: z.array(CitationSchema).max(4),
}

export const FocusBriefSchema = z.object({
  constraint: brief(25, 'The single thing limiting this business right now.'),
  constraint_basis: basis,
  priorities: z
    .array(
      z.object({
        what: brief(20, 'The action.'),
        why: brief(22, 'Why it moves the constraint. One reason, the strongest.'),
        moves_constraint: z.boolean(),
        basis,
      }),
    )
    .min(1)
    .max(3),
  ignore: z
    .array(brief(14, 'One thing to drop.'))
    .min(1)
    .max(4)
    .describe('What to explicitly stop this week. Never empty.'),
  biggest_uncertainty: brief(25, 'What, if wrong, makes priority #1 worthless.'),
  ...common,
})

export const DecisionBriefSchema = z.object({
  recommendation: brief(20, 'The call.'),
  recommendation_basis: basis,
  why: brief(30, 'The reasoning, compressed.'),
  options_rejected: z
    .array(z.object({ option: brief(12, 'The option.'), why_not: brief(18, 'Why it loses.') }))
    .min(1)
    .max(3)
    .describe('A recommendation with nothing rejected is not a decision.'),
  evidence: z.array(Evidence).max(4),
  assumptions: z.array(Assumption).min(1).max(3),
  strongest_counterargument: brief(25, 'The best case against this, in its strongest form.'),
  reversible: z.boolean(),
  next_experiment: brief(22, 'The cheapest test.').nullable(),
  revisit_when: brief(15, 'An observable event, not just a date.'),
  ...common,
})

export const MeetingBriefSchema = z.object({
  their_goal: brief(18, 'What the other side wants, inferred from context.'),
  your_goal: brief(18, 'The single outcome that makes this worth having.'),
  open_threads: z.array(brief(16, 'Unfinished business from prior contact.')).max(4),
  questions_to_ask: z.array(brief(18, 'A question whose answer changes what you do.')).min(1).max(4),
  likely_objections: z
    .array(z.object({ objection: brief(14, 'In their words.'), response: brief(20, 'Concede what is true.') }))
    .max(3),
  what_not_to_say: z.array(brief(14, 'What would damage this relationship.')).min(1).max(3),
  success_looks_like: brief(18, 'How you will know it went well.'),
  ...common,
})

export const ReviewBriefSchema = z.object({
  verdict: z.enum(['ship', 'fix-first', 'rethink']),
  what_works: z.array(brief(12, 'Do not touch this.')).max(3),
  problems: z
    .array(
      z.object({
        problem: brief(16, 'The problem.'),
        severity: z.enum(['blocker', 'major', 'minor']),
        evidence: brief(14, 'The metric or verbatim behind it.'),
      }),
    )
    .min(1)
    .max(5),
  not_worth_fixing: z.array(brief(12, 'Explicit non-goal.')).min(1).max(3),
  biggest_uncertainty: brief(20, 'What you could not judge from the context.'),
  ...common,
})

export const DiscoveryPlanSchema = z.object({
  question_to_answer: brief(20, 'The one thing these conversations must resolve.'),
  who_to_talk_to: z
    .array(
      z.object({
        who: brief(10, 'Named where the context has names.'),
        why_them: brief(14, 'What makes them informative.'),
        how_to_reach: brief(10, 'The channel.'),
      }),
    )
    .min(1)
    .max(4),
  questions: z
    .array(brief(16, 'A past-behaviour question. No hypotheticals, no pitching.'))
    .min(3)
    .max(6),
  what_would_disconfirm: brief(20, 'What you could hear that kills the hypothesis.'),
  sample_size: brief(12, 'Counts and a stopping rule.'),
  ...common,
})

export const PositioningBriefSchema = z.object({
  competitive_alternative: brief(16, 'What the buyer does instead, including nothing.'),
  target_segment: brief(14, 'The segment.'),
  unique_attributes: z.array(brief(12, 'An attribute the alternative lacks.')).min(1).max(4),
  value_delivered: z.array(brief(12, 'What that attribute is worth to this segment.')).min(1).max(4),
  market_category: brief(10, 'The category already in the buyer\'s head.'),
  statement: brief(30, 'One sentence a customer would recognize as true.'),
  who_this_is_not_for: brief(14, 'Who to exclude.'),
  ...common,
})

export const SalesPlanSchema = z.object({
  where_deals_stall: brief(18, 'No pipeline, no conversion, or no close.'),
  target_accounts: z
    .array(z.object({ who: brief(10, 'Named.'), why_now: brief(14, 'What makes them ready.') }))
    .min(1)
    .max(5),
  opening: brief(40, 'The actual first line to send or say, verbatim.'),
  qualification: z.array(brief(12, 'What disqualifies fast.')).min(1).max(4),
  objections: z
    .array(z.object({ objection: brief(12, 'In their words.'), response: brief(18, 'The reply.') }))
    .max(3),
  weekly_volume: brief(16, 'Concrete counts against the founder time available.'),
  ...common,
})

export const LearningRecordSchema = z.object({
  what_happened: brief(20, 'In numbers where the context has them.'),
  what_was_predicted: brief(20, 'Quoted from the original decision or hypothesis.'),
  gap: brief(20, 'Where prediction and outcome diverged.'),
  root_cause: brief(20, 'A wrong model, or correct reasoning with bad luck.'),
  generalizable: z.boolean().describe('False if this was luck or a one-off.'),
  learning: brief(25, 'One sentence that would change a specific future decision.'),
  update_to_beliefs: z.array(brief(14, 'What to hold with more or less confidence now.')).max(3),
  ...common,
})

export const OUTPUT_SCHEMAS = {
  focus_brief: FocusBriefSchema,
  decision_brief: DecisionBriefSchema,
  meeting_brief: MeetingBriefSchema,
  review_brief: ReviewBriefSchema,
  discovery_plan: DiscoveryPlanSchema,
  positioning_brief: PositioningBriefSchema,
  sales_plan: SalesPlanSchema,
  learning_record: LearningRecordSchema,
} as const

export type OutputId = keyof typeof OUTPUT_SCHEMAS
export const OUTPUT_IDS = Object.keys(OUTPUT_SCHEMAS) as [OutputId, ...OutputId[]]

export type FocusBrief = z.infer<typeof FocusBriefSchema>
export type DecisionBrief = z.infer<typeof DecisionBriefSchema>
export type AnyBrief = z.infer<(typeof OUTPUT_SCHEMAS)[OutputId]>

/** Present in every brief, so the pipeline can validate provenance without knowing the shape. */
export function citationsOf(brief: unknown): Citation[] {
  const parsed = z.object({ expert_citations: z.array(CitationSchema) }).safeParse(brief)
  return parsed.success ? parsed.data.expert_citations : []
}

export function questionOf(brief: unknown): string | null {
  const parsed = z.object({ question_for_you: z.string().nullable() }).safeParse(brief)
  return parsed.success ? parsed.data.question_for_you : null
}

export const ChallengeSchema = z.object({
  strongest_objection: brief(
    30,
    'The single best argument against the draft. One, in its strongest form — not a list.',
  ),
  unsupported_assumptions: z.array(brief(16, 'Stated as fact, supported by nothing in the context.')).max(3),
  missing_evidence: z.array(brief(14, 'The fact that would settle this.')).max(3),
  founder_bias_flags: z
    .array(brief(16, 'Grounded in the founder context, not generic founder psychology.'))
    .max(2),
  downside_if_wrong: brief(20, 'What it costs if this is wrong.'),
  reversible: z.boolean(),
  cheaper_experiment: brief(22, 'A cheaper way to resolve the biggest uncertainty first.').nullable(),
  verdict: z.enum(['keep', 'revise', 'reframe']),
})

export type Challenge = z.infer<typeof ChallengeSchema> & { revised: AnyBrief }

/**
 * Dispatching on a runtime skill id into a map of differently-shaped schemas is
 * exactly where structural inference gives up. The two casts below are the only
 * ones in the codebase; they are correct by construction (every member of
 * OUTPUT_SCHEMAS produces an AnyBrief) and confined to these two functions so
 * nothing downstream has to widen.
 */
export function outputSchemaFor(output: OutputId): z.ZodType<AnyBrief> {
  return OUTPUT_SCHEMAS[output] as unknown as z.ZodType<AnyBrief>
}

/**
 * The challenger returns a critique plus a revision of whatever shape the skill
 * produced, so its schema is built per skill rather than fixed.
 */
export function challengeSchemaFor(output: OutputId): z.ZodType<Challenge> {
  return ChallengeSchema.extend({ revised: OUTPUT_SCHEMAS[output] }) as unknown as z.ZodType<Challenge>
}
