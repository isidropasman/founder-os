# FounderOS V0 — Validation report

> ## ⛔ NOT RUN. This document contains no results.
>
> The evaluation harness, fixtures, cases, ablation ladder and failure classifier
> are built and tested. **Nothing has been executed against a real model**, because
> no `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is available in this environment.
>
> Every "Results" heading below is empty on purpose. Do not cite this document as
> evidence of anything until the commands in *How to fill this in* have run and the
> numbers have been pasted in.

## Hypothesis

> Does FounderOS produce materially better founder judgment than a frontier model
> receiving the full startup context directly?

The comparison that answers this is `founderos` vs `context-dump`. The vanilla arms
are a reference floor and are explicitly **not** the product hypothesis — beating a
blank chat proves nothing.

Secondary question, which decides what survives: **which mechanism** creates the
value. That is what the ablation ladder measures.

## Models

_Fill in from the run. Configured defaults:_

| Role | Default | Env var |
|---|---|---|
| Router | `claude-haiku-4-5` | `FOUNDEROS_MODEL_ROUTER` |
| Reasoning | `claude-opus-5` | `FOUNDEROS_MODEL_REASON` |
| Challenger | `claude-opus-5` | `FOUNDEROS_MODEL_CHALLENGE` |
| Judge | `claude-opus-5` | `FOUNDEROS_MODEL_JUDGE` |
| Vanilla / context-dump (Claude) | `claude-opus-5` | `FOUNDEROS_MODEL_VANILLA_CLAUDE` |
| Vanilla (GPT) | `gpt-5` — **unverified, check before running** | `FOUNDEROS_MODEL_VANILLA_GPT` |

⚠️ The judge defaults to the same provider as most arms. `docs/evals.md` requires
running the suite twice with judges swapped and reporting both. A single-provider
judge result is preliminary.

## Dataset

20 behavioural cases across 5 frozen fixtures, plus 5 deterministic router cases.
Full breakdown in `docs/evals.md` § Cases. Conditions covered: unclear ICP, strong
pull, weak pull, no traction, clear PMF, product bugs on paying accounts, pricing
uncertainty, conflicting feedback, excessive feature building, critical sales
opportunity, too many concurrent initiatives, architecture distraction, fundraising
distraction, pending customer meetings, and misleading premise.

## Results

_Empty. Paste the win matrix and per-dimension deltas from `evals/results/<date>.md`._

### FounderOS vs context-dump (the hypothesis)

### FounderOS vs vanilla (reference floor)

### Results by condition

## Ablations

_Empty. Paste the ablation ladder table._

The ladder measures the marginal contribution, in mean judge points, of:
context selection → skill framework → expert knowledge → challenger.

A mechanism at or below 0 is a deletion candidate under Step 7.

## Failure analysis

_Empty. Paste the loss classification table and the individual losses._

Each loss should end up either as a general fix or as a committed regression case.

## Cost / latency

_Empty. Paste the per-arm calls / tokens / mean latency table._

## Decision

_Not yet reachable._ One of:

- **A** — FounderOS clearly adds value over `context-dump` → proceed.
- **B** — Some components add value → simplify the architecture around them and
  delete the rest.
- **C** — `context-dump` performs equally well → simplify to a much thinner product
  (a context manager with a good CLI).

## Next milestone

_Not yet reachable._ It must follow from the evidence above, not from the roadmap.
Adding a second skill is **not** the default answer.

---

## How to fill this in

```bash
nvm use 22
cp .env.example .env          # add ANTHROPIC_API_KEY and OPENAI_API_KEY
                              # verify the OpenAI model id before running

# Step 1 — one real run, then read the trace by hand
pnpm founderos ask "Where should I focus this week?"
cat traces/<run-id>.json      # check routing, context keys, citations, challenger

# Step 2 — cheap first, to catch config errors before spending
pnpm eval:router
pnpm eval --limit 2 --arms context-dump

# Then the full suite
pnpm eval
```

Then paste the sections of `evals/results/<date>.md` into the headings above and
record the decision.
