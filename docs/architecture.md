# FounderOS — Architecture (V0)

## 1. Critique of the proposed architecture

The proposed pipeline was:

```
User → Context Resolver → Orchestrator → Skills+Experts+Context → Reasoning
     → Challenger → Final Synthesis → Recommendation+Action → Memory
```

Nine boxes. Here is what survives and what doesn't.

### Cut: Context Resolver as a separate stage

The Orchestrator already has to decide what the query is about. That decision
*is* the context selection. Two components would need the same input, the same
model call, and the same taxonomy. **Merged into the Router**, which returns
`context_keys` alongside skills and experts. One call, one place to debug.

### Cut: Final Synthesis as a separate stage

The Challenger has the question, the context, and the draft. It has everything
needed to produce the revised answer. Splitting critique and revision into two
calls buys nothing except latency and a fourth prompt to maintain. **Challenger
returns critique + revised brief in one structured output.** If evals later show
the critique is being written to justify a foregone revision, split it then.

### Cut: `modes` (ask / focus / decide / prepare / review)

Five modes and five skills that map ~1:1 is one taxonomy too many. A mode is
just "which skill is loaded", and `ask` is "no skill". **The Router picks skills
directly.** The word "mode" doesn't exist in the codebase. Bring it back only if
we ever get a skill that needs to behave differently in two modes.

### Cut: PostgreSQL (for V0)

V0 has one founder and maybe 50 KB of structured context. Postgres buys
migrations, a connection string, a docker-compose, and a class of bug where the
eval you ran last week is unreproducible because the data moved. **Context and
decisions are YAML/Markdown files.** They are structured, typed (Zod at load),
version-controlled, diffable, and a contributor can read the whole state with
`ls`. Postgres arrives with the web app and multi-user, and the change is
localized to `src/context.ts` — no interface, no repository pattern, just a
different function body.

*Risk accepted:* concurrent writes and querying "all decisions where confidence
< 0.5" get worse as decision count grows. At 500 decisions that's still a
`readdir` + filter. Revisit at ~2k.

### Cut: 13 first-class entities

`Customer, Meeting, Hypothesis, Experiment, Feedback, Outcome, Learning` as
separate entities are a schema for a product that doesn't exist yet. Outcome and
Learning are already fields on a Decision (as specified). Experiment is a field
on a Decision (`next_experiment`). The rest are unused by the two V0 skills.
**Six entities ship.** See `docs/contracts.md`.

### Cut: monorepo, `packages/`, `apps/`

One package. No Turborepo, no workspace protocol, no cross-package version
skew. `apps/web` gets created the day someone writes a web page. A flat repo is
also the single biggest thing you can do for open-source contribution rate.

### Cut: pgvector / semantic retrieval *(for startup context — see note)*

**Superseded in part.** This cut still holds for Startup Memory: the founder's own
company is small, selected by explicit keys, and putting it behind a vector index
would only make evals nondeterministic. But the threshold named below — "when we
ingest real source documents" — has since been crossed. Expert knowledge now lives
in Postgres + pgvector as a separate subsystem with its own schema and retrieval
path (`docs/knowledge.md`). The two memories stay separate on purpose.

Original reasoning, still valid for context:

Five expert packs and ten skills fit in a prompt. Retrieval over a corpus this
small is worse than the Router picking by ID, and it makes evals nondeterministic.
The threshold for adding it: when loaded expert principles exceed the context
budget, or when we ingest real source documents (essays, transcripts).

### Kept, and load-bearing

- **Router** — one cheap structured call. It's what makes context selection explicit.
- **Skills** — the procedure is the actual IP.
- **Expert packs** — with hard provenance rules.
- **Challenger** — this is the most likely single source of edge over a blank chat.
- **Traces** — every run fully reconstructible from disk. Free debugging, free eval inputs.
- **Provider abstraction** — required by the eval design, not speculative.

### Changed: the "better question" feature

Principle 6 ("challenge whether this is the right question") was going to need
its own stage. Instead the Router returns an optional `better_question` field
and the Challenger can return `verdict: "reframe"`. Costs zero extra calls. The
final output always answers what was asked *and* flags the reframe — never
refuses to answer.

## 2. V0 architecture

```
                    context/*.yaml     skills/*.md     experts/*.md
                          │                 │               │
   query ──► ROUTER ──────┴─────────────────┴───────────────┘
             (cheap model, structured out:                  │
              skills, experts, context_keys,                │
              depth, better_question?)                      │
                          │                                 │
                          ▼                                 │
                    SELECT (pure code: load only what       │
                            the router named)               │
                          │                                 │
                          ▼                                 │
                      REASON  ◄───────────────────────────  ┘
             (strong model, skill procedure + expert
              principles + selected context
              → typed brief per skill's output schema)
                          │
                          ▼
                    CHALLENGER            [--no-challenge]
             (same model, sees question + context + draft,
              NOT the reasoning; returns critique + revised brief)
                          │
                          ▼
                  brief + next_action  ──►  stdout
                          │
                          ├──► traces/<runId>.json   (always)
                          └──► context/decisions/    (only on --decide)
```

Three model calls. Two of them optional (`--no-challenge` skips one; a skill
with a single obvious route can pin `skills:` and skip the router in evals).

## 3. Components and boundaries

| Module | Owns | Must not |
|---|---|---|
| `src/provider.ts` | Model calls, structured output, retries, token accounting | Know about skills, experts, or founders |
| `src/context.ts` | Loading + validating `context/`, selecting by key, appending decisions | Call a model |
| `src/skills.ts` | Loading + validating `skills/*.md`, resolving `requires_context` and `experts` | Call a model, format prompts |
| `src/experts.ts` | Loading expert packs, exposing principles by ID, validating citations | Decide which expert applies |
| `src/outputs.ts` | Zod schemas for every brief type | Anything else |
| `src/prompts.ts` | Turning (skill, context, experts, draft) into prompt strings | Call a model, read the filesystem |
| `src/pipeline.ts` | The three-step flow, flags, trace assembly | Know file formats |
| `src/trace.ts` | Writing/reading run traces | Anything else |
| `src/eval.ts` | Running arms, judging, reporting | Be imported by pipeline |
| `src/cli.ts` | Arg parsing, rendering | Business logic |

The one rule that keeps this honest: **`prompts.ts` is pure** — inputs in,
strings out. Every prompt is therefore snapshot-testable without a network call,
and a contributor can read exactly what the model sees.

## 4. Data flow for one query

`founderos ask "should we increase our pricing?"`

1. **Load manifests** — skill and expert frontmatter only (id, purpose,
   use_when, dont_use_when, domains). Cheap, and the router sees a menu, not the bodies.
2. **Route** — one structured call with: the query, the skill menu, the expert
   menu, the available context keys, and a one-paragraph company summary
   (`company.one_liner` + stage). Returns:
   ```json
   {
     "intent": "pricing_decision",
     "skills": ["pricing"],
     "experts": ["april-dunford"],
     "context_keys": ["company", "metrics", "customers_feedback", "decisions_recent"],
     "depth": "deep",
     "better_question": "Whether pricing is the constraint, or activation is."
   }
   ```
3. **Select** — pure code. Load exactly those context keys, union'd with the
   skill's `requires_context` (the skill's declared needs always win; the router
   can add, not subtract). Load the full bodies of the named skills and experts.
   Refuse and error if a key doesn't exist — no silent empty context.
4. **Reason** — strong model. System prompt = skill procedure + expert principles
   (each with its ID) + output contract. User = query + selected context as YAML.
   Returns a typed `decision_brief`.
5. **Validate** — every `principle_id` cited must exist; every citation is
   `quoted` or `inferred`. Failures are a hard error, not a warning (one retry
   with the error message, then fail loudly).
6. **Challenge** — model sees query + selected context + the brief, and a prompt
   whose only job is to find unsupported assumptions, missing evidence, founder
   bias, downside, reversibility, and a cheaper experiment. Returns critique +
   revised brief + `verdict: keep|revise|reframe`.
7. **Render** — the revised brief, with `strongest_counterargument` and
   `next_action` always visible, and the reframe flagged if present.
8. **Persist** — trace always (`traces/<runId>.json`: every prompt, every raw
   response, model IDs, tokens, latency, versions of every skill/expert/context
   file used). Decision record only if the user passes `--decide` or answers the
   "record this?" prompt.

## 5. Where the edge is supposed to come from

Listed in expected order of contribution, so evals can attack them in order:

1. Structured, *selected* context (vs. no context, and vs. dumping everything).
2. The Challenger pass.
3. The skill procedure.
4. Sourced expert principles.

If (1) is the only one that wins, FounderOS is a context manager with a good CLI
— and that's a real product. Say so and delete the rest.
