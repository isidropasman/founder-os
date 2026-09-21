# Adaptive Portfolio Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the complete portfolio context when it fits an explicit budget and select records only when history is large enough to make truncation meaningful.

**Architecture:** `founderos` estimates the serialized portfolio context at four characters per token. At or below a 3,000-token budget it uses every approved record; above it reuses the current bounded per-project selector. `context_dump` remains the complete baseline. The chosen strategy and record IDs persist with each arm so results can be segmented by selection behavior.

**Tech Stack:** TypeScript, existing portfolio evaluator, YAML fixtures, Node test runner.

**Spec:** Follow-up user direction from 2026-09-21 after the first valid `founderos` versus `context_dump` batch.

## Global Constraints

- Do not change credentials, commit, or push.
- Preserve the provenance and repair gates unchanged.
- Both arms retain identical question, model, and approved passages.
- The small-portfolio path must not claim a selection advantage it did not apply.

---

### Task 1: Add an explicit adaptive context strategy

**Files:**
- Modify: `src/portfolio/reason.ts`
- Test: `test/portfolio-reason.test.ts`

**Interfaces:**
- `PortfolioContext.selection` is `'full_within_budget' | 'selected_over_budget' | 'context_dump'`.
- `assemblePortfolioContext` uses all approved records for `founderos` at or below `PORTFOLIO_CONTEXT_TOKEN_BUDGET` and bounded records above it.

- [ ] **Step 1: Write failing tests.**

```ts
assert.equal(founderos.selection, 'full_within_budget')
assert.deepEqual(founderos.selectedRecordIds, portfolio.records.map((record) => record.id))
assert.equal(noisyFounderos.selection, 'selected_over_budget')
assert.ok(noisyFounderos.selectedRecordIds.length < noisyPortfolio.records.length)
```

- [ ] **Step 2: Confirm the current selector always truncates.**

Run: `node --import tsx --test test/portfolio-reason.test.ts`

- [ ] **Step 3: Implement the approximate-token budget and strategy metadata.**

```ts
export const PORTFOLIO_CONTEXT_TOKEN_BUDGET = 3000
function approximateTokens(value: string): number { return Math.ceil(value.length / 4) }
```

- [ ] **Step 4: Run focused tests and typecheck.**

### Task 2: Add a history-heavy trade-off fixture

**Files:**
- Create: `evals/portfolio/tradeoff-noisy-history.yaml`
- Modify: `test/portfolio-evals.test.ts`

**Interfaces:**
- Fixture has two projects, a shared one-task constraint, current validated revenue signals, and more than the 3,000-token context budget in stale low-confidence history.

- [ ] **Step 1: Add the fixture to the validation list and assert five unique fixture IDs.**

- [ ] **Step 2: Run fixture test and confirm it fails because the fixture is absent.**

- [ ] **Step 3: Add 24 dated low-confidence hypothesis records, keeping the current evidence and shared constraint independently identifiable.**

- [ ] **Step 4: Run fixture validation and full verification.**

### Task 3: Run the comparative batch

**Files:**
- Output: `evals/results/portfolio-*.json`

- [ ] **Step 1: Run `pnpm eval:portfolio:codex`.**
- [ ] **Step 2: Compare the full-context small cases separately from the selected noisy-history case.**
- [ ] **Step 3: Run `pnpm build && git diff --check`.**
