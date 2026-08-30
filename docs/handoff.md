# FounderOS — Handoff

Everything buildable without model credentials is built and verified. This document
is the exact list of what to run when you have keys, and what is still blocked.

## State

| | |
|---|---|
| Offline verification | **127/127 tests, typecheck clean, 12/12 quotes located** |
| Knowledge Base | Postgres 18.4 + pgvector 0.8.6, **224 sources → 2800 claims**, wired into the reasoning pass |
| Skills | 9 (`focus` + 8 new), all with eval coverage |
| Eval suite | 29 behavioural cases across 5 frozen fixtures, 12 router cases, 7 arms |
| Context ingestion | add / import / ingest / show, deterministic after extraction |
| Live pipeline | **Runs.** First real runs on 2026-08-17 exposed three structured-output failures, all fixed — see below |
| Eval suite (judged) | **Not run** — Anthropic credit exhausted 2026-08-18 |
| Offline pipeline replay | Full pipeline testable with no credentials (`test/pipeline.test.ts`) |
| Deterministic signals | `founderos status` — rule-based findings, zero model cost |
| YC / partner packs | **BLOCKED_ON_SOURCE_MATERIAL** — see below |
| Version control | Committed on `phase-0-vertical-slice`. **Not pushed** — that needs your call |
| Onboarding | `./scripts/setup.sh` + `founderos doctor` + `docs/guide.md` |
| Usable with no key | `status`, `context`, `knowledge search`, `ask --offline`, and the whole web UI |
| Web interface | `pnpm dev` — 4 routes, server components reading the core directly. **Never seen rendered** |

## First: verify nothing rotted

Everything here runs with no API key. If this is not green, fix it before spending money.

```bash
nvm use 22
./scripts/setup.sh    # dependencies, Postgres, schema, 242 essays, .env
pnpm verify           # typecheck + quote verification + 127 tests
founderos doctor      # what is configured, what is missing, the exact fix
```

Expected: `127 pass, 0 fail`, and `All quoted principles located in the corpus.`

Sanity-check retrieval and ingestion by hand, still with no key:

```bash
pnpm knowledge status
pnpm knowledge search "recruit users manually" --limit 3
pnpm knowledge search "make a few users love you" --kind framework

pnpm founderos context show
cp -r context/example /tmp/ws
FOUNDEROS_EXTRACTOR=fixture pnpm founderos context import \
  test/fixtures/inbox/customer-call.md --context /tmp/ws
```

The last command replays a recorded extraction and should show 3 new facts,
2 conflicts, 1 unresolved and 1 rejected — with nothing written.

## Then: add credentials

```bash
cp .env.example .env
```

Set `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`.

⚠️ **Verify `FOUNDEROS_MODEL_VANILLA_GPT` before spending anything.** The default
`gpt-5` is a guessed id. If it is wrong, the `gpt-vanilla` arm 404s on case one and
the run is wasted.

## Step 1 — one real run, then read the trace

```bash
pnpm founderos ask "Where should I focus this week?"
```

Then open the trace it prints and check by hand:

- `versions.context_hash` present, and `versions.skills` / `versions.experts` recorded
- `steps[0]` is `route` — did it pick `focus`, and are the context keys sensible?
- No context leaked in that the skill did not need
- `steps[1]` is `reason` — is the skill procedure in the system prompt verbatim?
- `expert_citations` reference principle ids that exist (the run fails if not)
- `steps[2]` is `challenge` — is the critique independent, or does it just agree?
- The final `next_action` names a person, number, or artifact

Run each new skill once the same way:

```bash
for s in decision pricing meeting-prep product-review customer-discovery positioning founder-sales learning; do
  pnpm founderos ask "..." --skill $s
done
```

## Step 2 — embeddings

The database currently has **no** embeddings (hash vectors were used to test the
fusion path and then cleared). Real semantic search needs:

```bash
pnpm knowledge embed --clear          # only if hash vectors were re-added
FOUNDEROS_EMBEDDINGS=openai pnpm knowledge embed
pnpm knowledge search "how should I think about what to charge" --semantic
```

Compare `--semantic` against lexical-only on a few queries. If fusion does not beat
lexical alone, RRF is cheap to remove and the vector column can go.

## Step 3 — evals, cheap first

```bash
pnpm eval --estimate                      # sizes the run, calls nothing
pnpm eval:router                          # ~12 cheap Haiku calls
pnpm eval --limit 2 --arms context-dump   # validates config end to end
pnpm eval --concurrency 8                 # the full suite
```

The full suite is roughly 203 generations plus 174 judgings on frontier models.
Narrow with `--limit`, `--cases`, `--arms`; widen throughput with `--concurrency`
(default 5, one global semaphore over every model call).

Serially this suite is 4-6 hours, because a single `ask` takes 2-3 minutes. Partial
results are written to `evals/results/partial.json` after **every** case, and a
failing arm drops that one comparison instead of killing the run.

Then fill in `docs/v0-validation.md`, which is a template with a **NOT RUN** banner
and empty result sections. The gate is stated there: if `founderos` does not beat
`context-dump`, simplify rather than add.

## Still blocked, and why

**Live context extraction — BLOCKED_ON_CREDENTIALS.** `context add/import/ingest`
run end-to-end offline via `FOUNDEROS_EXTRACTOR=fixture`, which replays recorded
extractions. The `llm` extractor has never run. Its prompt and schema are written
and typed; the extraction *quality* is unmeasured. First thing to do with a key:

```bash
pnpm founderos context import test/fixtures/inbox/customer-call.md --record
```

That captures the model's real output over a note whose correct extraction is
already known by hand, so you can diff the two. The hand-authored fixtures in
`test/fixtures/extractions/` are labelled as such and should be replaced by real
recordings.

**Real embeddings — BLOCKED_ON_CREDENTIALS.** The vector column, HNSW index, fusion
and CLI are exercised end-to-end by the hash embedder, which is deterministic and
*not semantic*. Retrieval quality is unmeasured.

**YC and partner packs — BLOCKED_ON_SOURCE_MATERIAL.** The YC Startup Library is a
client-rendered app; fetching a lesson page yields 54 characters of visible text. I
did not write a YC pack from memory, because inventing quotes defeats the entire
provenance subsystem. `experts/michael-seibel.md` remains paraphrase-only,
`confidence: low`, with every principle flagged unverifiable. To unblock: transcripts
(YouTube captions, or manual), then follow `docs/contributing.md`.

**Postgres for Startup Memory — deliberately not built.** Startup Memory stays
filesystem-backed. The trigger conditions for changing that are in
`docs/architecture.md`; none are met by one founder with 50 KB of context.

## Replay: the pipeline without credentials

`src/replay.ts` turns recorded responses into a provider, so the whole pipeline —
routing, context selection, citation validation, the challenger handoff, tracing,
rendering — runs offline. It matches by step name and call order, not prompt hash,
so it survives prompt edits: it validates plumbing, not prompt quality. A recording
that no longer fits its schema fails loudly, which is the signal you want when a
shape changes underneath it.

Every paid run can become a fixture for free:

```bash
pnpm founderos ask "..." --save-run focus-acme
```

`test/fixtures/runs/focus-acme.json` today is **hand-authored** and labelled as
such. Replace it with a real capture on the first run after topping up.

## What the first live runs found (2026-08-17)

The pipeline now runs end to end. Getting there took fixing three separate
structured-output failures, none of which any offline test could have caught:

1. **Truncation.** The challenger returns a critique *and* a full revised brief in
   one object; at `maxOutputTokens: 4000` it was cut mid-object (`finishReason:
   'length'`) and lost `revised` entirely. Raised to 16000 for the challenge call,
   8000 for reasoning, 8000 default. The cap costs nothing unused.
2. **Envelope wrapping.** The model returned `{"parameters": {…}}` and `{"body":
   {…}}` instead of the object. Normalized in `src/provider.ts`.
3. **Double-encoded strings.** `verdict` arrived as `"\"revise\""` — the enum was
   answered correctly and rejected anyway. Also normalized.

All three are handled at the provider boundary, where a provider's quirks belong,
with unit tests in `test/provider.test.ts`. Failures now attach the original SDK
error as `cause` — the first version of the wrapper swallowed `finishReason` and
cost two debugging round-trips.

**Status:** 2/2 consecutive `pricing` runs green after the fix, 0/2 before. The
`focus` run produces a genuinely specific brief and a challenger that finds real
problems (it caught the draft confusing logo churn on paying customers with
never-activated signups).

**Cost/latency, measured:** ~2-3 minutes and roughly 15-20k tokens per `ask`,
dominated by the challenger.

## Decisions taken while you were away

1. **Third-party sources are gitignored.** Committing 14 Paul Graham essays to an
   open-source repo is a redistribution question I did not want to answer for you.
   The manifest commits id/title/url/year/date/sha256; `scripts/fetch-paul-graham.sh`
   reproduces the corpus; `loadCorpus` refuses to run if a document has drifted from
   its committed checksum. Reversible in one line if you disagree.
2. **`pgvector` was installed via Homebrew** on this machine (`brew install pgvector`),
   and databases `founderos` and `founderos_test` were created. Reversible with
   `brew uninstall pgvector` and `dropdb`.
3. **One generic renderer instead of eight.** The output schemas already order fields
   the way a founder should read them; eight bespoke renderers would maintain that
   ordering twice.
4. **The `skill` ablation rung bundles procedure and structured output.** Separating
   them needs a sixth arm; not worth building until the combined rung shows a positive
   number.

## What I would do first

Not add skills. Run Step 1 and read three traces properly. The most likely finding is
that the prompts are too long and the briefs too uniform — problems invisible to every
test in this repo, and obvious in the first real output.
