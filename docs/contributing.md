# Contributing to FounderOS

Everything is a file. Skills, experts, context, evals, traces. If you can write
Markdown and YAML you can contribute the highest-value parts of this project
without touching TypeScript.

## Setup

```bash
nvm use 22            # Node 22+ required
pnpm install
./scripts/db-setup.sh # creates founderos + founderos_test, enables pgvector
pnpm knowledge migrate
./scripts/fetch-paul-graham.sh
pnpm knowledge ingest
pnpm verify           # typecheck + quote verification + tests. Must be green.
```

No API key is needed for any of the above, or for `pnpm verify`. Keys are only
needed to actually *ask* FounderOS a question or run judgment evals.

## The one rule

**Never write a quote you have not verified.** `pnpm knowledge:verify` searches
the fetched source document for every `quoted:` string in every pack. It is not a
formality: the first draft of the Paul Graham pack, written from memory by
someone who had read the essays, contained 9 wrong quotes out of 20. All 9 were
caught here.

If you cannot locate the text, mark it `paraphrase`. That is an honest label, not
a failure.

## Adding a skill

1. Copy `templates/SKILL.md` to `skills/<id>.md`.
2. Write `dont_use_when` first. It is the field that stops your skill swallowing
   traffic from the others, and the router sees it.
3. Pick an `output` from `OUTPUT_SCHEMAS` in `src/outputs.ts`. Add a new schema
   only if none of the eight fits — a new shape means a new thing to render, judge
   and evaluate.
4. Write the `## Procedure` as instructions to a competent advisor. It goes into
   the prompt verbatim.
5. Write `## Failure modes` for *your* skill specifically. The model is told its
   answer is judged against them.
6. Add a router case in `evals/router/` and at least two behavioural cases in
   `evals/cases/`, with a `skill:` field.
7. `pnpm verify`.

## Adding an expert pack

1. Fetch the sources. Add a script under `scripts/` so anyone can reproduce it,
   and a `knowledge/sources/<author>/manifest.yaml` from `templates/manifest.yaml`.
   Do not commit the documents themselves.
2. `pnpm knowledge ingest` then `pnpm knowledge status` to get the checksums, and
   put them in the manifest.
3. Copy `templates/EXPERT.md` to `experts/<id>.md`.
4. Find real quotes rather than recalling them:
   ```bash
   pnpm knowledge search "the idea you are looking for" --author your-author
   ```
5. `pnpm knowledge:verify` until clean.
6. Set `confidence` honestly. A pack with no verbatim quotes is `low`.

## Adding an eval case

Cases live grouped by fixture in `evals/cases/<fixture>.yaml`. A good case has a
**defensible right answer and an available wrong one** — write both into `notes`,
because that is what makes a loss readable six weeks later.

Fixtures under `evals/fixtures/` are frozen. Never edit one to make a case pass;
add a new fixture instead.

## Project layout

```
src/            one package, no monorepo
  knowledge/    the shared knowledge base (Postgres + pgvector)
  ingest/       turning unstructured notes into startup context
skills/         one markdown file per skill
experts/        one markdown file per author
knowledge/      source manifests (documents are gitignored)
context/example the sample startup workspace
evals/          fixtures, cases, judge rubric, results
migrations/     numbered SQL, applied by src/knowledge/db.ts
templates/      copy these
docs/           design and decisions
```

## Design rules that will be enforced in review

- **No complexity without measurable improvement.** New mechanisms ship behind a
  flag and get an ablation arm. If the eval shows no delta, it gets deleted.
- **`src/prompts.ts` stays pure.** Inputs in, strings out, no I/O. That is what
  makes every prompt snapshot-testable with no network.
- **The challenger never sees the reasoning trace.** There is a test for it.
- **Context keys are a closed enum.** A free-form key resolves to nothing and
  produces silent empty context, which is how a system looks smart and is wrong.
- **No `any`.** The two casts in `src/outputs.ts` are the only ones, and they are
  commented.
