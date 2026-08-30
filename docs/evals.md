# FounderOS — Eval strategy

Two kinds of eval. One is cheap, deterministic, and runs on every commit. The
other is expensive, noisy, and answers the only question that matters.

## The hypothesis under test

Not "FounderOS beats a blank chat" — that is easy and proves nothing. The
hypothesis is:

> FounderOS produces materially better founder judgment than giving the same
> frontier model access to all relevant startup context directly.

The `context-dump` arm *is* that null hypothesis, and it is a product gate, not
a benchmark line item. If FounderOS cannot consistently beat it, the answer is
to simplify aggressively rather than rationalize the added architecture.

## A. Router evals (deterministic, CI)

A case is a query + the expected routing. Assert on skills and required context
keys; ignore `intent` and `reasoning` (free text).

```yaml
# evals/router/pricing.yaml
query: Should we increase our pricing?
expect:
  skills: [pricing]
  context_keys_include: [company, metrics]
  better_question: any        # any | null | present
```

Pass = exact set match on `skills`, superset on `context_keys`. ~20 cases.
Runs in seconds on the cheap model, catches the most common regression (a new
skill's `use_when` swallowing traffic from an existing one).

## B. Judgment evals (the real one)

### Arms — a ladder, not a list

Two reference arms sit outside the ladder, purely as a floor:

| Arm | What it is |
|---|---|
| `gpt-vanilla` | GPT, query only, no context |
| `claude-vanilla` | Claude, query only, no context |

The ladder is the part that matters. Each rung adds **exactly one** FounderOS
mechanism to the one below it:

| Rung | What it adds | Isolates |
|---|---|---|
| `context-dump` | Frontier model + **all** context, free text | **The null hypothesis** |
| `context-selected` | Same, but only the skill's `requires_context` | Context selection |
| `skill` | The procedure + the structured output contract | Skill framework |
| `skill+experts` | Sourced expert principles | Expert knowledge |
| `founderos` | The challenger pass | Challenger |

Every arm is judged head-to-head against `founderos`, so a rung's gap to the
baseline is the *sum* of every mechanism above it. The marginal contribution of
one mechanism is the difference between two adjacent gaps — that arithmetic is
what the report's ablation table prints. A mechanism at or below 0 is not paying
for itself and becomes a deletion candidate.

**Known limitation:** the `skill` rung introduces the procedure and the structured
output together, so their contributions are not separated. Splitting them needs a
sixth rung, which isn't worth building until the combined rung shows a positive
number.

`context-dump` is the one that matters. Beating a blank chat is easy and proves
nothing. If `founderos` doesn't beat `context-dump`, the honest response is to
ship `context-dump` with a nice CLI and delete the rest.

### Cases

Cases are grouped by fixture, so the company and the questions asked of it stay
in one file:

```yaml
# evals/cases/acme-seed.yaml
context: ./evals/fixtures/acme-seed
cases:
  - id: acme-premise
    condition: misleading-premise
    query: What should I prioritize to make the redesign land well?
    notes: >
      Nothing in the context links the editor to churn. A good answer helps with
      the question asked AND flags that it is the lower-leverage one.
```

`condition` is what the case is *testing for* — the report slices results by it,
so a systematic weakness (say, every `misleading-premise` case losing) shows up
as a pattern rather than as scattered individual losses.

The suite ships 5 frozen fixtures and 20 cases:

| Fixture | The situation | Conditions covered |
|---|---|---|
| `acme-seed` | 22% activation, 9.1% churn, founder rebuilding the editor | architecture distraction, misleading premise, fundraising pull, pricing uncertainty |
| `no-traction` | 8 weeks post-launch, 14 signups, 9 features, 2 user conversations | no traction, excessive feature building, weak pull, too many initiatives |
| `pmf-pull` | 22%/mo growth, 61 waitlist, 31h support, 3 P1s on paying accounts | clear PMF, product bugs, strong pull, fundraising pull |
| `unclear-icp` | Three segments paying, incompatible roadmaps, shiny out-of-ICP pilot | unclear ICP, critical sales opportunity, conflicting feedback, meetings pending |
| `fundraising` | 7 weeks raising, 34 meetings, 0 term sheets, growth 6/mo → 1/mo | fundraising distraction, misleading premise, no traction, too many initiatives |

Each fixture is built so a defensible answer exists and a plausible wrong answer
is available — the `notes` field records both, which is what makes a loss
readable later.

Context fixtures are **committed and frozen**. An eval whose inputs drift is not
an eval — `test/contracts.test.ts` asserts every fixture loads, validates, and
hashes stably, and that every case points at a real one.

Fixtures are separate from `context/example`, which is the getting-started
workspace and is expected to be edited. They must not share files.

### Judging

Pairwise, blind, position-randomized. A judge model receives the query, the
context fixture, and two anonymized answers, and scores each dimension 1–5 plus
an overall preference:

| Dimension | The question the judge answers |
|---|---|
| context usage | Does it use specific facts from this company, or generic advice? |
| startup judgment | Would an experienced operator agree with the call? |
| specificity | Are the actions concrete enough to start today? |
| evidence | Are claims tied to something, or asserted? |
| assumption challenging | Does it surface what could make this wrong? |
| actionability | Is there one clear next action? |
| honesty about uncertainty | Does confidence match the evidence available? |

Rules that keep this from being self-congratulatory:

- **The judge is a different provider than the arm being judged**, wherever
  possible. Run the whole suite twice with the judges swapped and report both.
- Position randomized, arm labels stripped, output formats normalized to plain
  markdown before judging (otherwise the judge rewards the arm with headings).
- Report per-dimension deltas, not one blended score. A blended score hides that
  FounderOS wins on context and loses on readability.
- **N is small and the noise is large.** Report win/loss/tie counts and treat
  anything under a 2:1 win ratio as "no signal", not as a win.

Human spot-check: the founder reads 5 randomized pairs per suite run and records
their own preference. When human and judge disagree, the judge rubric is wrong.

### Winning-mechanism attribution

An aggregate score tells you *whether* FounderOS is better. It does not tell you
*which part* is earning its complexity — and that is the number that decides
what to keep. So every verdict also carries `advantage_source`, a single value
from a closed set:

| mechanism | what it credits |
|---|---|
| `better_context_selection` | used the right facts; the other missed them or drowned in them |
| `skill_framework` | followed a sharper procedure instead of free-associating |
| `expert_knowledge` | applied a named principle the other lacked |
| `challenger` | anticipated the counterargument, downside, or a cheaper test |
| `provenance_evidence` | claims traceable to a source where the other's were not |
| `action_structuring` | same insight, converted into something doable |
| `decision_memory` | used a past decision, assumption, or outcome |
| `none` | tie, or the edge was style rather than substance |

The judge is blind — it does not know which answer is FounderOS, so it is
scoring *what created the edge*, not *which system deserves credit*. The
attribution is resolved after the fact by the arm labels.

The report tabulates mechanisms **only over the cases where FounderOS beat
`context-dump`**, because that is the only comparison that tests the real
hypothesis. Beating a blank chat via `better_context_selection` is expected and
tells us nothing. A mechanism that never appears in that table across a full
suite is a candidate for deletion.

### Loss classification

A win tells you what is working; a loss has to tell you what to change. Every
loss gets a second, non-blind pass that sees the question, both answers, and the
judge's stated reason, and assigns one root cause:

`router_error` · `missing_context` · `skill_too_prescriptive` · `expert_noise` ·
`weak_expert_pack` · `challenger_degraded_answer` · `overlong_prompt` ·
`under_specific_output` · `judge_ambiguity` · `other`

The classifier is instructed to prefer a mechanism over a per-question quirk: if
the fix would be "special-case this question", the answer is one of the mechanism
categories instead. That is what keeps Step 6 fixes general.

`judge_ambiguity` is a first-class outcome, not a cop-out — it says the two
answers were equivalent and the verdict is noise, which is different from
FounderOS being worse.

### Output

`evals/results/<date>.md` — router results, the win matrix with per-dimension
deltas, the ablation ladder with marginal contributions, mechanism attribution,
loss classification, results sliced by condition, and cost/latency per arm.
`evals/results/latest.json` holds the raw comparisons for re-analysis without
re-running.

### Controlling spend

The full suite is 20 cases × 7 arms = 140 generations plus 120 judgings, on
frontier models. That is not a command to run casually. The runner prints the
count before starting and takes three narrowing flags:

```bash
pnpm eval --limit 3                       # first 3 cases, all arms
pnpm eval --cases acme-weekly,cadence-push
pnpm eval --arms context-dump             # baseline vs the null hypothesis only
pnpm eval:router                          # deterministic, cents
```

`--arms` always keeps `founderos`, since every comparison is against it.

## C. Regression cases

Any bad answer becomes a case: copy the trace's context hash and query into
`evals/cases/`, write down what was wrong in `notes`, and add the assertion if
it can be made deterministic (e.g. "must not recommend hiring" → substring
assert; "must mention the churn number" → substring assert). Cheap asserts first;
promote to judge-scored only if they can't be expressed as a string check.

## D. Gates

- **Phase 3 gate:** if `founderos` does not beat `context-dump` on context usage
  and assumption challenging, stop adding features. Fix or simplify.
- **Every new layer** (expert packs, a new skill, retrieval) ships with an
  ablation arm and must show a delta on at least one dimension, or it gets
  reverted. This is Principle 1 made executable.
- **CI runs router evals only.** Judgment evals are run manually before a release
  and after any prompt change; they cost real money and shouldn't gate a typo fix.
