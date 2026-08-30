# FounderOS — Repository structure & implementation plan

## Repository structure

```
founderos/
  README.md
  package.json                 # one package. no workspaces, no turborepo.
  tsconfig.json                # strict
  .env.example                 # ANTHROPIC_API_KEY, OPENAI_API_KEY, FOUNDEROS_MODEL_*
  docs/
    vision.md
    architecture.md
    contracts.md
    evals.md
    plan.md
  skills/
    focus.md
    decision.md
  experts/
    paul-graham.md
    april-dunford.md
  context/
    example/                   # committed sample company
      company.yaml
      founder.yaml
      goals.yaml
      metrics.yaml
      people.yaml
      decisions/
  evals/
    router/*.yaml
    cases/*.yaml
    fixtures/<company>/        # frozen context snapshots
    judge.md                   # the judging rubric prompt
    results/
  src/
    cli.ts
    pipeline.ts
    router.ts
    context.ts
    skills.ts
    experts.ts
    outputs.ts
    prompts.ts
    provider.ts
    trace.ts
    eval.ts
  test/
    prompts.test.ts            # snapshot: what the model actually sees
    contracts.test.ts          # every skill/expert file parses
  traces/                      # gitignored
```

No `apps/`, no `packages/`, no `core/`. ~10 source files. A contributor can read
the whole thing in an afternoon, which is the point.

### Stack decisions

- **TypeScript strict**, Node 22, `tsx` for running. No build step until there's
  something to publish.
- **Vercel AI SDK** (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`) as the provider
  layer. This is a deliberate exception to "write it yourself": provider
  abstraction *plus* structured output *plus* retries across two SDKs is a few
  hundred lines of our code and a known source of bugs. It is a provider
  adapter, not an orchestration framework — the banned category (LangChain,
  CrewAI, AutoGen) owns your control flow; this doesn't. `src/provider.ts` stays
  a ~40-line wrapper so swapping it out is a one-file change.
- **Zod** for every schema. Also generates the JSON Schema for structured output.
- **`yaml` + `gray-matter`** for context and frontmatter parsing.
- **`node:test`** for tests. No vitest/jest until something needs them.
- No database, no ORM, no docker-compose, no framework. Postgres arrives in
  Phase 7 with the web app.

Total dependency count target: **under 8**.

## Implementation plan

Each phase ends with something runnable and a check that fails if the phase is
broken. Do not start a phase before the previous one's check passes.

### Phase 0 — Skeleton + provider (½ day)
- `package.json`, `tsconfig.json` (strict), `.env.example`, `.gitignore`.
- `src/provider.ts`: `complete({model, system, prompt, schema?})` → typed result
  + token counts. Anthropic and OpenAI.
- `src/cli.ts`: `founderos ask "<q>"` → raw model answer, no context.
- **Check:** `founderos ask "hello"` returns text from both providers via
  `--model claude` / `--model gpt`.

### Phase 1 — Context + skill + first milestone (2 days)
- `src/context.ts`: load + Zod-validate `context/`, `ContextKey` enum, `select(keys)`.
- `src/skills.ts`: load + validate `skills/*.md`. Write `skills/focus.md`.
- `src/outputs.ts`: `FocusBrief`.
- `src/prompts.ts` (pure), `src/pipeline.ts` with **skill pinned** (no router yet).
- `src/trace.ts`.
- `context/example/` populated.
- **Check:** `founderos ask "where should I focus this week?" --skill focus`
  returns a valid `FocusBrief` referencing real numbers from `context/example`,
  and writes a trace. `test/contracts.test.ts` green.

### Phase 2 — Router (1 day)
- `src/router.ts` + `RouterOutput`, skill/expert menus from frontmatter.
- Wire into pipeline; `--skill` becomes an override.
- 20 router eval cases + `pnpm eval:router`.
- **Check:** router evals ≥ 90% on skills, 100% on `context_keys` superset.

### Phase 3 — Challenger + the gate (1 day)
- Challenger prompt + schema; `--no-challenge` flag.
- **Check:** on a case where the context contains a contradiction (metric says
  churn is up, goal says growth), the challenger flags it and `verdict != "keep"`.

### Phase 4 — Eval harness + answer the hypothesis (2 days)
- `src/eval.ts`: arms, judge, pairwise blind scoring, results table.
- 12 cases, 2 frozen fixtures, `evals/judge.md`.
- **Check:** `pnpm eval` produces `evals/results/<date>.md`.
- **GATE:** FounderOS beats `context-dump` on context usage and assumption
  challenging. If not — simplify, don't add. Publish the result either way.

### Phase 5 — Expert packs (1 day)
- `src/experts.ts`, citation validation, `--no-experts` arm.
- `experts/paul-graham.md`, `experts/april-dunford.md`, sourced properly.
- **Check:** an invalid `principle_id` fails the run; eval shows a delta on the
  evidence dimension, or the packs get cut.

### Phase 6 — Decision skill + memory (1½ days)
- `skills/decision.md`, `DecisionBrief`, `--decide` writes `context/decisions/`.
- `decisions_recent` context key; `founderos review` lists decisions past
  `review_date` and writes `outcome` + `learning`.
- **Check:** decide → the decision appears in the next run's context → `review`
  closes it.

### Phase 7 — Only if Phase 4 said yes
Ranked, do at most one at a time, each with an ablation arm:
`meeting-prep` / `pricing` / `product-review` skills · remaining expert packs ·
Postgres + web app · pgvector over real source documents · integrations.

## What is explicitly not in V0

Modes, Postgres, pgvector, monorepo, web UI, multi-agent debate, ingestion
pipelines, dashboards, integrations, 13-entity schema, per-skill directories,
five expert packs. Each is listed in `docs/architecture.md` with the condition
that would bring it back.
