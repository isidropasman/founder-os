# Portfolio Evaluation Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run comparable portfolio evaluations through an authenticated local Codex CLI, score strategic quality blind, and persist only valid comparisons.

**Architecture:** The runner uses one provider instance for `founderos`, `context_dump`, and the blind judge. A generated packet must pass provenance before scoring; provider failures produce `invalid_run` with no scores or conclusion. Fixtures express independent prioritization, shared-constraint, opportunity-cost, and conflicting-signal cases.

**Tech Stack:** TypeScript, Zod, YAML, existing Provider abstraction, local `codex-cli` harness, Node test runner.

**Spec:** User request from 2026-09-08.

## Global Constraints

- Do not modify or replace credentials.
- Do not commit or push.
- Both evaluated arms use the same provider/model and identical approved KB passages.
- A provider failure produces no quality, grounding, contamination, cost, latency, deltas, or layer conclusion.
- Tests use fake providers; only the explicit eval command calls the authenticated provider.

---

### Task 1: Make provider choice explicit and document it

**Files:**
- Modify: `scripts/portfolio-eval.ts`
- Modify: `package.json`
- Create: `docs/portfolio-evals.md`

- [ ] Add `--provider` support with `FOUNDEROS_MODEL_REASON` as the default.
- [ ] Add an authenticated-local command using `codex-cli` without reading or changing API keys.
- [ ] Document `ANTHROPIC_API_KEY` and `codex login` setup, fixture selection, persisted result location, and no-secret behavior.

### Task 2: Add a blind strategic judge and valid-run gate

**Files:**
- Modify: `src/portfolio/evals.ts`
- Test: `test/portfolio-reason.test.ts`

- [ ] Write tests asserting a provider failure yields `invalid_run`, null metrics, no deltas, and no conclusion.
- [ ] Add a judge schema that only receives anonymized packet A/B and rubric, then position-swap to reduce order bias.
- [ ] Score judgment, grounding, trade-off and contamination per arm only after generation and judging succeed.
- [ ] Persist judge traces, scores, usage, winner, and cost/latency deltas.

### Task 3: Add independent portfolio trade-off fixtures

**Files:**
- Create: `evals/portfolio/tradeoff-prioritization.yaml`
- Create: `evals/portfolio/tradeoff-opportunity-cost.yaml`
- Create: `evals/portfolio/tradeoff-conflicting-signals.yaml`
- Test: `test/portfolio-evals.test.ts`

- [ ] Validate fixture format and unique IDs.
- [ ] Cover prioritization, shared constraint, opportunity cost, and contradictory evidence.
- [ ] Execute all fixtures and aggregate only valid results.

### Task 4: Run and verify

**Files:**
- Test: `test/portfolio-reason.test.ts`

- [ ] Execute the suite, corpus verification, build, and `pnpm eval:portfolio:codex`.
- [ ] Report only observed valid-run results; if the provider is unavailable, report its exact blocker without a quality conclusion.
