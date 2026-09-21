# Portfolio Knowledge Evals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ground portfolio decision packets in approved, versioned Knowledge Base passages and compare the same model's selected-context reasoning against a raw context dump.

**Architecture:** Keep the portfolio ledger as canonical private memory and retrieve external evidence only through the existing approved-corpus consultation boundary. A new packet schema carries per-assertion private and passage references; the shared evaluator invokes one injected provider twice with different context assembly, persists both complete traces, and judges only validated packets.

**Tech Stack:** TypeScript strict mode, Zod, PostgreSQL/pgvector via the existing Knowledge Base, AI SDK provider abstraction, YAML fixtures, node:test.

**Spec:** User request, 2026-09-08.

## Global Constraints

- Use exactly one model spec for `founderos` and `context_dump` in any comparison.
- Only approved source passages returned by `consult` may be sent as external evidence or cited by a packet.
- Every non-inference packet assertion needs at least one private record or approved passage reference.
- Persist redacted inputs, raw model output, validated packet, timings, token usage, and comparison result under ignored `evals/results/`.
- Do not change the source policy, ingest pipeline, existing ask flow, commit, or push.

---

### Task 1: Evidence-native packet contract

**Files:**
- Modify: `src/portfolio/contracts.ts`
- Modify: `src/portfolio/store.ts`
- Modify: `test/portfolio.test.ts`

**Interfaces:**
- Add `PortfolioAssertion = { text, basis: [{ kind: 'record'; id } | { kind: 'passage'; id; quote } | { kind: 'inference' }] }`.
- Add `assertions` to `PortfolioPacket` and `passageIds` to private portfolio records.
- Add `validatePacketProvenance(packet, portfolio, passages)`.

- [ ] **Step 1: Write failing provenance tests**

```ts
test('rejects a packet passage absent from approved retrieval', () => {
  const result = validatePacketProvenance(packetWithPassage('missing#0001'), portfolio, passages)
  assert.equal(result.ok, false)
})

test('rejects an external assertion whose quote is not contiguous in its passage', () => {
  const result = validatePacketProvenance(packetWithQuote('invented'), portfolio, passages)
  assert.equal(result.ok, false)
})
```

- [ ] **Step 2: Run tests and verify red**

Run: `pnpm exec node --import tsx --test test/portfolio.test.ts`
Expected: missing contract export.

- [ ] **Step 3: Implement provenance resolution and record links**

```ts
export function validatePacketProvenance(
  packet: PortfolioPacket,
  portfolio: Portfolio,
  passages: readonly Passage[],
): Validation<PortfolioPacket>
```

- [ ] **Step 4: Run focused tests and verify green**

Run: `pnpm exec node --import tsx --test test/portfolio.test.ts`
Expected: PASS.

### Task 2: Minimal portfolio context and grounded model generation

**Files:**
- Create: `src/portfolio/reason.ts`
- Modify: `src/portfolio/advisor.ts`
- Modify: `test/portfolio.test.ts`

**Interfaces:**
- `assemblePortfolioContext(portfolio)` returns a small selected record set and portfolio trade-off summary.
- `generatePortfolioPacket({ portfolio, question, passages, provider, mode })` returns a discriminated result with packet, raw output, usage and timing.

- [ ] **Step 1: Write failing selected-context and provider tests**

```ts
test('founderos context excludes unrelated project evidence while retaining shared constraints', () => {
  const context = assemblePortfolioContext(portfolio)
  assert.doesNotMatch(context.prompt, /unrelated signal/)
  assert.match(context.prompt, /shared founder constraint/)
})
```

- [ ] **Step 2: Run focused tests and verify red**

Run: `pnpm exec node --import tsx --test test/portfolio.test.ts`
Expected: missing reason module.

- [ ] **Step 3: Implement the two context arms**

```ts
export type PortfolioReasoningMode = 'founderos' | 'context_dump'
export async function generatePortfolioPacket(input: GeneratePacketInput): Promise<PortfolioGeneration>
```

- [ ] **Step 4: Run focused tests and verify green**

Run: `pnpm exec node --import tsx --test test/portfolio.test.ts`
Expected: PASS.

### Task 3: Persisted same-model comparison and cases

**Files:**
- Rewrite: `src/portfolio/evals.ts`
- Create: `evals/portfolio/tradeoff-shared-constraint.yaml`
- Create: `evals/portfolio/priority-opportunity-cost.yaml`
- Modify: `test/portfolio.test.ts`

**Interfaces:**
- `runPortfolioEvaluation(input)` runs the same provider/model for both arms, validates both, scores dimensions, and writes a result artifact.
- Result contains per-arm prompts, raw output, packet, retrieval IDs, usage, latency, validation issues, scores, and delta.

- [ ] **Step 1: Write failing same-model and persistence tests**

```ts
test('evaluation uses one provider for both arms and persists both traces', async () => {
  const report = await runPortfolioEvaluation({ provider, fixture, resultsDir })
  assert.equal(report.founderos.model, report.contextDump.model)
  assert.ok(existsSync(report.path))
})
```

- [ ] **Step 2: Run focused tests and verify red**

Run: `pnpm exec node --import tsx --test test/portfolio.test.ts`
Expected: missing evaluation runner.

- [ ] **Step 3: Implement scoring and persisted artifacts**

```ts
export async function runPortfolioEvaluation(input: PortfolioEvaluationInput): Promise<PortfolioEvaluationReport>
```

- [ ] **Step 4: Run fixture tests and verify green**

Run: `pnpm exec node --import tsx --test test/portfolio.test.ts`
Expected: PASS.

### Task 4: Eval UI and actual provider run

**Files:**
- Modify: `app/evals/page.tsx`
- Modify: `app/evals/*` only as required for a portfolio comparison view
- Modify: `test/web-portfolio.test.ts`

**Interfaces:**
- The Evals page displays the latest persisted portfolio result, per-dimension deltas, validation failures, model, cost and latency.

- [ ] **Step 1: Write a failing render test for portfolio eval output**

```ts
test('eval UI renders a saved portfolio comparison and its verdict', () => {
  assert.match(html, /Portfolio decision eval/)
})
```

- [ ] **Step 2: Run test and verify red**

Run: `pnpm exec node --import tsx --test test/web-portfolio.test.ts`
Expected: failure because the Evals page does not render portfolio results.

- [ ] **Step 3: Add the narrow result view and execute one fixture with the configured model**

Run a single `tradeoff-shared-constraint` fixture. If corpus, credentials, or provider access fails, preserve the error artifact and report the block rather than manufacturing a winner.

- [ ] **Step 4: Full verification**

Run: `pnpm test && pnpm typecheck && pnpm build && pnpm knowledge:verify && git diff --check`
Expected: all commands exit 0; report actual eval verdict and artifact path separately.

## Self-review

- Every recommendation is provenance-validated in Task 1.
- Selected context, same model, and raw dump differ only by context assembly in Tasks 2–3.
- Trade-off fixtures, persistence, cost, latency and verdict are Task 3.
- UI and actual run are Task 4.
