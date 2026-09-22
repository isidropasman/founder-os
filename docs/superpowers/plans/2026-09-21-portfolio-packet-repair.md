# Portfolio Packet Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce evaluable portfolio packets by constraining evidence selection to the selected project and repairing one provenance-invalid generation with its exact validation errors.

**Architecture:** `reason.ts` derives admissible direct evidence, baselines, assertion records, and passages from the portfolio before each generation. It embeds those allowlists in the arm prompt. When a structurally valid packet fails FounderOS provenance validation, it makes exactly one same-provider repair call with the rejected object, errors, and same constraints; no failed repair is scored.

**Tech Stack:** TypeScript, Zod, existing Provider contract, Node test runner.

**Spec:** User direction from 2026-09-21: constrain evidence per project, repair once, then rerun blind evaluation.

## Global Constraints

- Do not modify credentials, commit, or push.
- Both arms use the same provider/model and approved KB slice.
- Never relax `validatePacketProvenance` to make a packet pass.
- One repair attempt maximum; provider/schema failures remain invalid runs.

---

### Task 1: Make admissible evidence explicit to the model

**Files:**
- Modify: `src/portfolio/reason.ts`
- Test: `test/portfolio-reason.test.ts`

**Interfaces:**
- Produces `portfolioPacketConstraints(portfolio, passages)` with per-project direct evidence IDs, baseline metric IDs, assertion record IDs, and allowed passage IDs.
- `assemblePortfolioContext` appends the constraints to both arm prompts.

- [ ] **Step 1: Write a failing test**

```ts
assert.match(context.prompt, /For project zent: directEvidenceIds may only use: zent-mrr, zent-churn/)
assert.match(context.prompt, /baselineEvidenceId may only use: zent-mrr/)
assert.match(context.prompt, /Passage ids may only appear in assertion basis/)
```

- [ ] **Step 2: Run the focused test and confirm the constraints are absent.**

Run: `node --import tsx --test test/portfolio-reason.test.ts`

- [ ] **Step 3: Implement the smallest constraint renderer.**

```ts
function packetConstraints(portfolio: Portfolio, passages: readonly Passage[]): string {
  // Render only approved IDs allowed by the existing validation rules.
}
```

- [ ] **Step 4: Re-run the focused test.**

### Task 2: Repair one provenance-invalid packet

**Files:**
- Modify: `src/portfolio/reason.ts`
- Test: `test/portfolio-reason.test.ts`

**Interfaces:**
- `generatePortfolioPacket` performs one repair only when `Provider.object` returned a schema-valid object that failed `validatePacketProvenance`.
- Persisted `PortfolioGeneration` exposes each attempt's prompt, raw output, validation result, usage, and latency.

- [ ] **Step 1: Write a failing test**

```ts
const generated = await generatePortfolioPacket({ ...input, provider: invalidThenValidProvider })
assert.equal(generated.ok, true)
assert.equal(generated.attempts.length, 2)
assert.match(generated.attempts[1]!.prompt, /directEvidenceIds: veris-signal belongs to another project/)
```

- [ ] **Step 2: Run the focused test and confirm it returns the first invalid packet.**

Run: `node --import tsx --test test/portfolio-reason.test.ts`

- [ ] **Step 3: Add one repair call with the same schema/provider.**

```ts
const repaired = await provider.object({
  system: SYSTEM,
  prompt: repairPrompt(context, first.value, validation.issues),
  schema: PortfolioPacketSchema,
})
```

- [ ] **Step 4: Re-run the focused test and full suite.**

Run: `pnpm verify`

### Task 3: Execute the real evaluation

**Files:**
- Output: `evals/results/portfolio-*.json`

- [ ] **Step 1: Run the authenticated batch.**

Run: `pnpm eval:portfolio:codex`

- [ ] **Step 2: Report only valid arm comparisons, judge rounds, and observed cost/latency.**

- [ ] **Step 3: Run production build verification.**

Run: `pnpm build && git diff --check`
