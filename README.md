# FounderOS

**A decision system for founders who want to be challenged by reality, not flattered by a chatbot.**

FounderOS turns a frontier model into a disciplined operating layer for one startup: it loads the facts you have recorded, applies an explicit procedure, retrieves real source material, challenges its own recommendation, and leaves a trace you can inspect.

It is built around one falsifiable product hypothesis:

> FounderOS should produce better founder judgment than giving the same model the same company context in a prompt.

That is not a slogan. The repository includes the control arm (`context-dump`), an ablation ladder for every major layer, frozen evaluation fixtures, and a rule: if a layer does not improve outcomes, it is a candidate for deletion.

## Why this exists

Generic AI advice is cheap because it is unconstrained. It does not know which metric moved, which decision is still unproven, what a customer actually said, or what you have been avoiding. It also has no cost for agreeing with you.

FounderOS adds five concrete constraints:

| Layer | What it contributes |
|---|---|
| **Startup Memory** | Your goals, metrics, decisions, customers, feedback, experiments, and meetings — private, structured, file-backed. |
| **Skills** | Nine explicit procedures for recurring founder work. A skill is a checklist with failure modes, not a persona prompt. |
| **Knowledge Base** | Source-grounded principles and passages in Postgres + pgvector, searched lexically and semantically when embeddings are configured. |
| **Challenger** | A separate pass that tries to invalidate the recommendation before you see it. |
| **Trace + evals** | The route, selected context, prompts, citations, and final result are recorded; the architecture is measured against simpler alternatives. |

The output is intentionally short: one constraint, up to three priorities, what to ignore, the biggest uncertainty, a next action, and — when it would change the call — a question back to you.

## Try it in three minutes

Requires Node 22+ and pnpm.

```bash
git clone <your-fork-or-clone-url> founderos
cd founderos
nvm use 22
./scripts/setup.sh
```

The setup script installs dependencies, prepares Postgres + pgvector when available, migrates and ingests the knowledge base, fetches the reproducible source corpus, creates `.env`, and ends with a diagnosis.

```bash
pnpm founderos doctor
pnpm founderos status
pnpm founderos ask "Where should I focus this week?" --offline
```

The offline answer is useful on purpose: it is a deterministic brief containing your blocking signals, the selected procedure, failure modes, and real source passages. It does not pretend to be model synthesis.

For the full pipeline, add an Anthropic key to `.env`:

```bash
ANTHROPIC_API_KEY=... pnpm founderos ask "Where should I focus this week?"
```

Every non-ready component is diagnosed with the exact command to fix it and what still works without it. Run `pnpm founderos doctor` instead of guessing.

## What a run does

```text
question
  │
  ├─ 1. Route          Selects a skill, expert packs, and closed context keys
  ├─ 2. Ground         Loads only the relevant startup memory and source material
  ├─ 3. Reason         Produces a structured, concise recommendation
  ├─ 4. Challenge      Attacks the draft and may replace it with a revision
  └─ 5. Trace          Saves inputs, versions, provenance, and outputs to disk
```

The system owns the orchestration. The model provider is behind a small local interface in [`src/provider.ts`](src/provider.ts); Vercel AI SDK is an implementation detail, not the architecture.

### Ask the work you actually do

```bash
pnpm founderos ask "What should I focus on this week?"
pnpm founderos ask "Should we raise prices now?" --skill pricing
pnpm founderos ask "How should I prepare for my call with Priya?" --skill meeting-prep
pnpm founderos ask "Is this ready to ship?" --skill product-review
```

The router can select a skill, or you can pin one to remove routing from the equation. The built-in set covers:

`focus` · `decision` · `pricing` · `positioning` · `customer-discovery` · `founder-sales` · `product-review` · `meeting-prep` · `learning`

Use `--no-challenge`, `--no-experts`, or `--no-corpus` to run a controlled ablation of a real question. Use `--save-run <name>` to turn a paid run into an offline regression fixture.

## Two memories, kept separate

FounderOS does not turn your company notes into a shared database, and it does not treat public knowledge as private memory.

| | Startup Memory | Knowledge Base |
|---|---|---|
| Purpose | What is true about your company | What an author actually wrote |
| Storage | YAML + Markdown | PostgreSQL + pgvector |
| Scope | Private, small, founder-specific | Shared, source-grounded, expandable |
| Retrieval | Explicit closed context keys | Hybrid lexical + semantic retrieval with RRF |
| Change model | Files you can diff and review | Corpus manifest, migration, deterministic ingest |

That boundary is a product decision. Startup memory stays inspectable and easy to back up; the knowledge layer gets the indexing and scale it actually needs.

## Capture context without becoming a YAML operator

```bash
# Paste a note or pipe one in.
pnpm founderos context add "Priya said onboarding was confusing. MRR is 3620 now."

# Preview a file or an entire directory before anything is written.
pnpm founderos context import notes/customer-call.md
pnpm founderos context import notes/customer-call.md --apply

# Process the inbox, then archive successfully handled notes.
pnpm founderos context ingest --apply --archive
pnpm founderos context show --full
```

Ingestion is designed to be reviewable rather than magical:

- nothing is written without `--apply`;
- a fact must carry a verbatim quote from the input or it is rejected;
- conflicts with founder-authored data require `--overwrite`;
- low-confidence decisions are held in `unresolved.yaml`, not asserted as fact;
- re-ingesting the same content is a deterministic no-op, even under a new filename.

You can start with a scaffold instead of the example workspace:

```bash
pnpm founderos init ~/my-company
export FOUNDEROS_CONTEXT=~/my-company
pnpm founderos context show
```

## Knowledge with receipts

The knowledge layer is not “act like Paul Graham.” It stores sources, verbatim claims, contributor-authored principles, frameworks, and the evidence joining them. A principle marked `quoted` must resolve to an exact span of a fetched source document or verification fails.

```bash
pnpm knowledge search "recruit users manually"
pnpm knowledge search "make a few users love you" --kind framework
pnpm knowledge search "how should I think about what to charge" --semantic
pnpm knowledge verify
```

The corpus itself is fetched locally rather than redistributed. Its committed manifest contains source metadata and SHA-256 checksums; a changed document forces explicit re-verification before its citations are trusted.

The Paul Graham pack contains verified quoted principles. The Michael Seibel pack is deliberately marked paraphrase-only and low confidence until source material can be verified. Missing evidence is represented as a limit, not filled with plausible text.

## Build choices worth inspecting

```text
app/                  Next.js interface: setup, context, ask, knowledge
src/context.ts        Startup-memory schema, validation, hashing, file boundary
src/router.ts         Skill/context/expert selection
src/pipeline.ts       Route → ground → reason → challenge → trace
src/provider.ts       Provider boundary and structured-output normalization
src/knowledge/        Corpus, ingest, retrieval, embeddings, provenance checks
src/ingest/           Preview, conflict handling, quote gate, apply flow
src/eval.ts           Ablations, blind judging, attribution, partial recovery
skills/               Versioned procedures and failure modes
experts/              Versioned expert packs and principle IDs
context/example/      Inspectable starter startup memory
evals/                Frozen fixtures, router cases, behavioral cases
```

Some deliberate non-features matter as much as the code:

- no multi-agent theater — one strong model, with at most route/reason/challenge calls;
- no opaque vector store for your company memory;
- no expert quote accepted on model confidence alone;
- no final answer without an actionable next step;
- no complexity considered sacred once the evals say it is not earning its cost.

## Verify before you trust it

```bash
pnpm verify
```

This runs TypeScript checking, verifies every quoted principle against the fetched corpus, and executes the offline test suite. The pipeline also supports recorded provider responses, so routing, context selection, provenance, challenger handoff, tracing, and rendering can be regression-tested without credentials.

Behavioral quality is intentionally a separate claim. The evaluation harness runs both basic references and an ablation ladder:

```text
Claude / GPT vanilla
        ↓
context-dump → context-selected → skill → skill + experts → FounderOS
                                                               + challenger
```

Each comparison is blind and position-randomized. When FounderOS wins against `context-dump`, the judge attributes the advantage to a closed mechanism such as context selection, procedure, expert knowledge, challenger, provenance, action structure, or decision memory. A win against a blank chat is not treated as proof.

```bash
pnpm eval --estimate
pnpm eval:router
pnpm eval --limit 2 --arms context-dump
```

Live behavioral results are still pending a funded evaluation run. The project does not claim model-quality superiority before that experiment exists; see [`docs/v0-validation.md`](docs/v0-validation.md).

## Documentation

- [Founder’s guide](docs/guide.md) — product usage, answer anatomy, and honest limits
- [Vision](docs/vision.md) — the hypothesis and its disconfirmation criteria
- [Architecture](docs/architecture.md) — boundaries and deliberate cuts
- [Knowledge layer](docs/knowledge.md) — schema, provenance, and retrieval
- [Context ingestion](docs/context-ingestion.md) — quote gate, conflicts, and replay
- [Evaluation strategy](docs/evals.md) — controls, ablations, and result gates
- [Contracts](docs/contracts.md) — data and interface contracts
- [Contributing](docs/contributing.md) — skills, sources, and expert packs
- [Handoff](docs/handoff.md) — exact live-verification steps and known blockers

## Current limits

- Full reasoning and live context extraction require an Anthropic API key.
- Semantic retrieval requires an OpenAI key and embeddings; lexical search works without them.
- The first complete judged eval suite has not run, so superiority over `context-dump` remains unproven.
- The shared source corpus is strongest for Paul Graham today; partner packs remain constrained by source availability and the provenance bar.

Those limits are part of the design, not a footnote. A system that makes claims about judgment should be unusually precise about where its evidence ends.
