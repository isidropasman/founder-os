# FounderOS — Contracts

> Covers **Startup Memory** (private, filesystem) plus the skill, expert, router
> and output contracts. The **Knowledge Base** (shared, Postgres + pgvector) has
> its own schema and provenance rules in [knowledge.md](knowledge.md).
>
> Since this document was first written: the context model gained `feedback`,
> `experiments` and `meetings`; there are now 9 skills and 8 output schemas; and
> expert packs gained machine-checkable source ids plus `### F1` frameworks.
> `src/outputs.ts`, `src/context.ts` and `templates/` are the authority.

Everything here is validated with Zod at load time. A malformed skill, expert,
or context file fails the run with a file path and a line — never a silent default.

## 1. Data model (V0: six entities)

Files live in `context/`. `context/example/` ships in the repo; a real workspace
is gitignored or pointed at with `FOUNDEROS_CONTEXT=~/my-company`.

```
context/
  company.yaml
  founder.yaml
  goals.yaml
  metrics.yaml
  people.yaml
  decisions/
    2026-08-14-raise-prices.md
```

### company.yaml
```yaml
name: Acme
one_liner: Invoicing for freelance designers
stage: seed            # idea | pre-seed | seed | series-a+
business_model: b2b-saas
icp: Solo designers billing >$5k/mo
pricing: $19/mo flat, single tier
runway_months: 11
team_size: 4
constraints:
  - Two engineers, no designer
  - Founder does all sales
```

### founder.yaml
```yaml
name: Isidro
role: ceo
strengths: [product, technical depth]
weak_spots: [avoids sales calls, over-indexes on refactoring]
known_biases:
  - Prefers building over talking to users
working_style: Deep work mornings, ~4 focus hours/day
```

### goals.yaml
```yaml
- id: g-revenue
  statement: Reach $10k MRR
  horizon: 2026-12-31
  metric: mrr
  target: 10000
  status: active        # active | achieved | abandoned
```

### metrics.yaml
```yaml
- name: mrr
  value: 3400
  as_of: 2026-08-01
  trend: up             # up | flat | down
  source: stripe
```

### people.yaml
```yaml
- id: p-jane
  name: Jane Roe
  role: Partner
  org: Some Fund
  relationship: investor    # investor | customer | advisor | candidate | team
  last_touch: 2026-07-20
  notes: Passed on seed, asked to see 3 months of retention
```

### decisions/*.md
Markdown with YAML frontmatter. One file per decision, filename
`YYYY-MM-DD-slug.md`.

```yaml
---
id: d-2026-08-14-raise-prices
date: 2026-08-14
question: Should we increase pricing from $19 to $39?
options:
  - Keep $19
  - Raise to $39 for new customers only
  - Raise to $39 for everyone
decision: Raise to $39 for new customers only
confidence: 0.6
review_date: 2026-10-14
assumptions:
  - text: Current customers are not price-sensitive above $30
    confidence: 0.5
    how_to_test: Ask 5 of them directly this week
evidence:
  - claim: Nobody has churned citing price in 6 months
    source: stripe-churn-export-2026-08
expert_citations:
  - principle_id: april-dunford/P3
    kind: quoted        # quoted | inferred
next_experiment: Sell 5 new accounts at $39 before touching existing ones
next_action: DM 5 existing customers today asking what they'd pay
status: open          # open | reviewed
outcome: null         # filled at review
learning: null        # filled at review
---

Free-form notes.
```

**Outcome and Learning are fields, not entities.** The `review_date` is what
makes them get filled: `founderos review` lists decisions past their review date.
That loop — decide, revisit, learn — is the memory. Nothing else is needed for V0.

### Context keys

The Router selects from a **closed enum**, defined in `src/context.ts`:

```
company | founder | goals | metrics | people | decisions_recent | decisions_all
```

Closed on purpose. A free-form string like `"pricing_history"` cannot be
resolved to a file and produces silent empty context — the exact failure mode
that makes a system look smart and be wrong. New key → new loader → new enum
member, in one PR.

## 2. Skill contract

One file: `skills/<id>.md`. Not a directory. A directory per skill is warranted
when a skill has multiple examples and evals of its own — right now they'd be
directories with one file in them.

```markdown
---
id: focus
version: 1
purpose: Decide what a founder should work on this week and what to drop.
use_when:
  - Founder is overwhelmed or asks what to prioritize
  - Weekly planning
dont_use_when:
  - The question is a single binary choice (use `decision`)
  - The founder needs to prepare for a specific meeting (use `meeting-prep`)
requires_context: [company, founder, goals, metrics, decisions_recent]
experts: [paul-graham, michael-seibel]
output: focus_brief
related: [decision]
---

## Procedure

1. State the single constraint on the business right now. Not three — one.
   If the goals and metrics disagree about what the constraint is, say so.
2. List everything the founder appears to be spending time on (from goals,
   recent decisions, stated working style).
3. Score each against the constraint: does it move it this week, or not?
4. Pick at most three priorities. If two are the same bet, merge them.
5. Name what to explicitly stop or ignore. This is not optional output.
6. Name the biggest unresolved uncertainty — the thing that, if wrong, makes
   the top priority worthless.
7. Reduce priority #1 to one action that can start within 24 hours.

## Failure modes

- Listing the founder's whole backlog back at them, reordered. If the output
  isn't shorter than the input, it failed.
- Picking priorities that are all in the founder's comfort zone (check
  `founder.weak_spots`).
- Recommending "talk to users" with no specific users, count, or question.
- Hedging: "it depends on your goals" when goals.yaml is right there.
```

Frontmatter schema:

| field | type | required | notes |
|---|---|---|---|
| `id` | string | ✓ | matches filename |
| `version` | int | ✓ | bump on any body change; recorded in traces |
| `purpose` | string | ✓ | one line, shown to the Router |
| `use_when` | string[] | ✓ | Router menu |
| `dont_use_when` | string[] | ✓ | Router menu — this is what prevents over-routing |
| `requires_context` | ContextKey[] | ✓ | always loaded, router can only add |
| `experts` | ExpertId[] | – | default candidates; router may narrow |
| `output` | OutputId | ✓ | key into `src/outputs.ts` |
| `related` | SkillId[] | – | |

Body sections: `## Procedure` (required, numbered), `## Failure modes` (required).
Both are injected verbatim into the reasoning system prompt.

## 3. Expert knowledge contract

One file: `experts/<id>.md`.

```markdown
---
id: april-dunford
name: April Dunford
domains: [positioning, pricing, b2b-go-to-market]
confidence: high         # high | medium | low — how well-sourced this pack is
limitations:
  - B2B software; weak signal for consumer or marketplace
  - Little written on pricing mechanics below $50/mo
sources:
  - title: Obviously Awesome
    kind: book
    year: 2019
  - title: Positioning talk, BoS 2019
    kind: talk
    url: https://example.com/...
---

### P1 — Positioning precedes pricing
Claim: You cannot price correctly until you know which market category the
buyer places you in, because the price anchor comes from the alternatives.
Source: Obviously Awesome, ch. 2 — paraphrase
Applies when: Pricing changes, new segment entry
Conflicts with: —

### P2 — The best alternative is the anchor, not your costs
Claim: Buyers price against what they'd do instead — including doing nothing.
Source: BoS 2019 talk, 14:20 — quoted: "Your competitive alternative sets the
range. Cost-plus pricing is a way to be wrong on purpose."
Applies when: Any pricing decision
Conflicts with: —
```

Rules:

- Every principle has a stable ID (`<expert-id>/P<n>`). IDs are never reused or
  renumbered — append only.
- `Source:` is mandatory and must end in `— quoted: "..."` or `— paraphrase`.
- **A principle with no source does not go in the pack.** That is the entire
  difference between this and "you are Paul Graham".

### Provenance enforcement

The distinction between *"the expert said X"* and *"we infer the expert would
say X"* is enforced mechanically, not by asking the model nicely:

1. Every output schema has `expert_citations: {principle_id, kind}[]`.
2. `kind: "quoted"` is only valid if the referenced principle's Source contains
   a verbatim quote.
3. Any `principle_id` not present in the loaded packs fails validation → one
   retry with the error → hard fail.
4. Rendered output shows quoted citations as *April Dunford: "..."* and inferred
   ones as *Inferred from April Dunford P1*.

This is ~25 lines of code and it is the difference between a research tool and
a plausible-sounding one.

## 4. Router contract

```ts
const RouterOutput = z.object({
  intent: z.string(),                          // free text, for traces/analytics
  skills: z.array(SkillId).min(0).max(2),
  experts: z.array(ExpertId).max(3),
  context_keys: z.array(ContextKey),
  depth: z.enum(["quick", "deep"]),
  better_question: z.string().nullable(),      // null = the asked question is the right one
  reasoning: z.string(),                       // one sentence, for the trace
});
```

- `skills: []` is legal and means "no skill applies, answer directly". This is
  the honest version of an `ask` mode.
- Max 2 skills, max 3 experts. Hard caps beat prompt pleading, and they keep
  the reasoning prompt inside a budget we can reason about.
- Runs on a cheap model. If router accuracy on the eval set is below ~90%, the
  fix is better `dont_use_when` text before a bigger model.

## 5. Output contracts

`src/outputs.ts`. Two schemas at V0.

```ts
const Citation = z.object({
  principle_id: z.string(),
  kind: z.enum(["quoted", "inferred"]),
});

const FocusBrief = z.object({
  constraint: z.string(),                    // the one thing limiting the business
  priorities: z.array(z.object({
    what: z.string(),
    why: z.string(),
    moves_constraint: z.boolean(),
  })).max(3),
  ignore: z.array(z.string()).min(1),        // min(1): "what to drop" is mandatory
  biggest_uncertainty: z.string(),
  next_action: z.string(),                   // startable within 24h
  confidence: z.number().min(0).max(1),
  expert_citations: z.array(Citation),
});

const DecisionBrief = z.object({
  recommendation: z.string(),
  why: z.string(),
  evidence: z.array(z.object({ claim: z.string(), source: z.string() })),
  assumptions: z.array(z.object({
    text: z.string(),
    confidence: z.number(),
    how_to_test: z.string(),
  })).min(1),
  strongest_counterargument: z.string(),
  confidence: z.number().min(0).max(1),
  next_experiment: z.string().nullable(),
  next_action: z.string(),
  revisit_when: z.string(),
  expert_citations: z.array(Citation),
});
```

The schema is the opinionated-output enforcement. `ignore.min(1)` and a required
`strongest_counterargument` are why the output can't degrade into consulting prose.

## 6. Challenger contract

```ts
const Challenge = z.object({
  unsupported_assumptions: z.array(z.string()),
  missing_evidence: z.array(z.string()),
  founder_bias_flags: z.array(z.string()),      // grounded in founder.known_biases
  downside_if_wrong: z.string(),
  reversible: z.boolean(),
  cheaper_experiment: z.string().nullable(),
  verdict: z.enum(["keep", "revise", "reframe"]),
});
// returned alongside a revised brief of the same shape as the draft
```

The Challenger prompt **does not receive the reasoning trace** — only the
question, the selected context, and the draft. Showing it the reasoning makes it
agree with the reasoning.

## 7. Trace contract

`traces/<runId>.json`, written on every run, including failures.

```jsonc
{
  "run_id": "2026-08-15T19-57-46-a3f9",
  "query": "...",
  "flags": { "challenge": true, "decide": false },
  "versions": {
    "skills": { "focus": 1 },
    "experts": { "paul-graham": 3 },
    "context_hash": "sha256:..."       // makes an eval run reproducible
  },
  "steps": [
    { "name": "route", "model": "...", "prompt": "...", "raw": "...",
      "parsed": {}, "tokens_in": 0, "tokens_out": 0, "ms": 0 }
  ],
  "final": {},
  "error": null
}
```

Traces are the eval input, the debugging tool, and the regression-case source.
They cost ~20 lines and pay for themselves the first time an answer is wrong.
