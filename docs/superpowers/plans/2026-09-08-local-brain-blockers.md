# Local Brain Blockers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the evidence, retrieval, and evaluation blockers that do not require external credentials, and make the remaining live checks explicit.

**Architecture:** Keep hybrid retrieval in PostgreSQL and add a deterministic reranking stage after RRF. The Brain action enables semantic retrieval only when the OpenAI embedder is configured and the local corpus has indexed vectors; timing crosses retrieval, assembly, and generation. Deterministic evals establish thresholds and baselines; live provider/embedding evidence remains a typed blocked state until credentials are supplied.

**Tech Stack:** TypeScript strict, Next.js App Router, PostgreSQL + pgvector, Zod, Node test runner, pnpm.

**Spec:** [2026-09-07-local-brain-design.md](../specs/2026-09-07-local-brain-design.md)

## Global Constraints

- Do not call an external model, embedding API, Codex CLI, or Claude CLI in this run.
- Raw third-party sources remain local and gitignored; manifests and checksums are versioned.
- Do not use `any`; expected operational failures use typed unions.
- Do not commit or push.
- Each production behaviour starts with a deterministic failing test.

### Task 1: Hybrid retrieval readiness, reranking, and timing

**Files:** `src/knowledge/embed.ts`, `src/knowledge/retrieve.ts`, `src/knowledge/consult.ts`, `src/brain/answer.ts`, `app/ask/actions.ts`, `test/knowledge*.test.ts`, `test/brain.test.ts`.

- [ ] Add failing tests for semantic capability gating, post-RRF reranking, and end-to-end timing.
- [ ] Add the smallest semantic readiness check that requires both an API key and stored embeddings.
- [ ] Rerank the fused candidate pool with deterministic query coverage before applying the limit, and expose rerank timing.
- [ ] Thread retrieval, assembly, generation, and total timing through the Brain response.
- [ ] Run the focused retrieval and brain tests.

### Task 2: Deterministic evaluation gates

**Files:** `src/knowledge/evals.ts`, `src/knowledge/cli.ts`, `app/evals/page.tsx`, `evals/baselines/*`, `test/knowledge-evals.test.ts`.

- [ ] Add failing tests for citation-fidelity, category utility, and baseline-regression gate results.
- [ ] Implement the parsers and deterministic evaluators, including explicit thresholds.
- [ ] Add a checked-in retrieval baseline from the local evaluated corpus.
- [ ] Render gate status and measured latency in Evals.
- [ ] Run the focused evaluation tests and `pnpm knowledge:eval`.

### Task 3: Initial local multi-author corpus

**Files:** `knowledge/sources/*/manifest.yaml`, `scripts/fetch-initial-cohort.sh`, `evals/retrieval/*.yaml`, `test/knowledge-evals.test.ts`.

- [ ] Add failing manifest/cohort coverage assertions.
- [ ] Add reviewed direct-publication manifests for the new authors, with citation-only local use and checksums.
- [ ] Fetch raw documents locally, verify checksums, migrate and ingest the corpus.
- [ ] Re-baseline and run the six-category retrieval suite against the ingested corpus.

### Task 4: Live-evidence boundary

**Files:** `docs/local-brain-live-e2e.md`, `src/doctor.ts`, `test/doctor.test.ts`.

- [ ] Add an explicit blocked-check status and the exact non-destructive commands required for OpenAI embeddings, Codex CLI, and Claude CLI E2E.
- [ ] Do not run those commands in this credential-free session.

### Task 5: Full verification

- [ ] Run `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm knowledge:verify`, `pnpm knowledge:eval`, and `git diff --check`.
- [ ] Re-check the original goal only from the fresh evidence and list any remaining blockers.

### Task 6: Audit closure for local evidence UI

**Files:** `app/ask/brief.tsx`, `app/ingest/actions.ts`, `app/ingest/console.tsx`, `app/knowledge/page.tsx`, `src/knowledge/retrieve.ts`, `migrations/004_source_retrieval_status.sql`, `src/doctor.ts`, `test/brain.test.ts`, `test/web-ingest.test.ts`, `test/web-library.test.ts`, `test/doctor.test.ts`.

- [ ] Add failing tests that require Brain source citations to link to their exact source-version passage, Ingest previews to expose normalized passages and the current stored checksum, Library to accept a retrieval-status filter, and diagnosis to point at the checked-in cohort fetch script.
- [ ] Persist the approved retrieval status in `sources`, expose it in the unified retrieval record, and apply `retrievalStatuses` before ranking.
- [ ] Extend the Ingest preview with a bounded normalized passage excerpt and a `new` / `unchanged` / `changed` checksum comparison against the indexed source.
- [ ] Render Brain citation links and the new Ingest and Library evidence fields without widening the answer contract or reading unapproved source files.
- [ ] Run focused Brain, Ingest, Library, doctor, retrieval and evaluation tests, then the full verification suite.
