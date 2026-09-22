# Portfolio Decision Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one founder record multiple private projects and complete a traceable weekly portfolio decision from evidence through outcome and learning.

**Architecture:** Add an application-owned, file-backed portfolio ledger beside the existing single-company workspace. The ledger is the canonical source of typed nodes, relations, decisions, actions and outcomes; a small deterministic advisor produces packets from scoped evidence, and all mutations validate the packet before persistence. The existing knowledge corpus remains external evidence only and is never copied into private facts.

**Tech Stack:** TypeScript strict mode, Zod, YAML, Next.js App Router Server Actions, React, node:test.

**Spec:** `.context/attachments/SBt8tz/pasted_text_2026-09-08_20-14-16.txt`

## Global Constraints

- One founder and multiple projects; no tenancy or managed long-running agent.
- Canonical portfolio memory remains local/application-owned YAML; model input is scoped and minimal.
- Every private record includes scope, project ownership when applicable, recorded/observed time, origin, confidence, and evidence references.
- A decision is written only after explicit approval; an action is linked to an approved decision.
- Causal language is rejected unless an experiment or explicit causal evidence is linked.
- Do not commit or push.

---

### Task 1: Typed portfolio graph and deterministic validation

**Files:**
- Create: `src/portfolio/contracts.ts`
- Create: `src/portfolio/store.ts`
- Test: `test/portfolio.test.ts`

**Interfaces:**
- Produces `Portfolio`, `PortfolioPacket`, `validatePortfolioPacket`, `loadPortfolio`, and `savePortfolio`.
- `validatePortfolioPacket(packet, portfolio)` returns `{ ok: true; value: PortfolioPacket } | { ok: false; issues: string[] }`.

- [ ] **Step 1: Write failing graph-validation tests**

```ts
test('rejects a packet whose evidence belongs to another project', () => {
  const result = validatePortfolioPacket(packetFor('zent'), portfolioWithSignalFor('veris'))
  assert.equal(result.ok, false)
})

test('rejects causal language without an experiment or causal evidence', () => {
  const result = validatePortfolioPacket(packetClaimingCausality, portfolio)
  assert.equal(result.ok, false)
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm test --test-name-pattern='portfolio'`
Expected: failure because `src/portfolio/contracts.ts` does not exist.

- [ ] **Step 3: Implement the smallest validated ledger**

```ts
export type Validation =
  | { ok: true; value: PortfolioPacket }
  | { ok: false; issues: string[] }

export function validatePortfolioPacket(input: unknown, portfolio: Portfolio): Validation {
  // Parse the contract, resolve evidence IDs inside the packet project or founder scope,
  // require baseline and review date, and reject unlinked causal language.
}
```

- [ ] **Step 4: Run focused graph tests and verify they pass**

Run: `pnpm test --test-name-pattern='portfolio'`
Expected: PASS.

### Task 2: Decision, action, review and learning mutations

**Files:**
- Modify: `src/portfolio/store.ts`
- Test: `test/portfolio.test.ts`

**Interfaces:**
- Produces `approvePacket`, `modifyPacket`, `rejectPacket`, and `reviewDecision`.
- `reviewDecision` creates `outcome: 'pending'` when no measurement is linked.

- [ ] **Step 1: Write failing lifecycle tests**

```ts
test('does not persist a decision when a packet is rejected', () => {
  const next = rejectPacket(portfolio, 'packet-1', 'not now')
  assert.equal(next.decisions.length, 0)
})

test('records a pending outcome when the review has no measurement', () => {
  const next = reviewDecision(approvedPortfolio, 'decision-1', { evidenceIds: [] })
  assert.equal(next.outcomes[0]?.status, 'pending')
})
```

- [ ] **Step 2: Run focused lifecycle tests and verify they fail**

Run: `pnpm test --test-name-pattern='rejected|pending outcome'`
Expected: failure because lifecycle functions do not exist.

- [ ] **Step 3: Implement approval-gated lifecycle operations**

```ts
export function approvePacket(portfolio: Portfolio, packet: PortfolioPacket): MutationResult
export function modifyPacket(portfolio: Portfolio, packet: PortfolioPacket, patch: PacketPatch): MutationResult
export function rejectPacket(portfolio: Portfolio, packetId: string, reason: string): Portfolio
export function reviewDecision(portfolio: Portfolio, decisionId: string, review: ReviewInput): MutationResult
```

- [ ] **Step 4: Run focused lifecycle tests and verify they pass**

Run: `pnpm test --test-name-pattern='rejected|pending outcome|approved|modified|outcome'`
Expected: PASS.

### Task 3: Deterministic advisor and challenger contracts

**Files:**
- Create: `src/portfolio/advisor.ts`
- Test: `test/portfolio.test.ts`

**Interfaces:**
- Produces `buildPortfolioPacket(portfolio, input)` and `challengePortfolioPacket(portfolio, packet)`.
- Advisor always emits a project, direct evidence, an inference list, alternatives, baseline, expected signal, and review date.

- [ ] **Step 1: Write failing packet and challenger tests**

```ts
test('builds one scoped weekly priority with a baseline and review date', () => {
  const packet = buildPortfolioPacket(portfolio, { now: DAY, question: WEEKLY_QUESTION })
  assert.equal(packet.projectId, 'zent')
  assert.ok(packet.baseline)
  assert.ok(packet.reviewDate)
})

test('challenger surfaces conflicting projects and the cheapest experiment', () => {
  const challenge = challengePortfolioPacket(portfolioWithConflict, packet)
  assert.ok(challenge.crossProjectConflicts.length > 0)
  assert.ok(challenge.cheapestExperiment)
})
```

- [ ] **Step 2: Run focused advisor tests and verify they fail**

Run: `pnpm test --test-name-pattern='weekly priority|challenger'`
Expected: failure because `src/portfolio/advisor.ts` does not exist.

- [ ] **Step 3: Implement short deterministic reasoning**

```ts
export function buildPortfolioPacket(portfolio: Portfolio, input: AdvisorInput): PortfolioPacket
export function challengePortfolioPacket(portfolio: Portfolio, packet: PortfolioPacket): PortfolioChallenge
```

- [ ] **Step 4: Run focused advisor tests and verify they pass**

Run: `pnpm test --test-name-pattern='weekly priority|challenger'`
Expected: PASS.

### Task 4: Portfolio UI and Server Actions

**Files:**
- Create: `app/portfolio/actions.ts`
- Create: `app/portfolio/console.tsx`
- Create: `app/portfolio/page.tsx`
- Modify: `app/masthead.tsx`
- Modify: `app/globals.css`
- Test: `test/web-portfolio.test.ts`

**Interfaces:**
- Server Actions load/save the portfolio ledger and return discriminated action results.
- The page can create projects and records, generate/view a packet, approve/modify/reject it, and record a review.

- [ ] **Step 1: Write failing render and action tests**

```ts
test('portfolio UI exposes project creation and the decision lifecycle', async () => {
  const page = await import('../app/portfolio/page.tsx')
  assert.match(renderToStaticMarkup(createElement(page.default)), /Portfolio/)
})
```

- [ ] **Step 2: Run focused web tests and verify they fail**

Run: `pnpm test --test-name-pattern='portfolio UI'`
Expected: failure because the route does not exist.

- [ ] **Step 3: Implement the narrow UI**

```tsx
export default function PortfolioPage() {
  return <PortfolioConsole initial={loadPortfolioFromEnvironment()} />
}
```

- [ ] **Step 4: Run focused web tests and verify they pass**

Run: `pnpm test --test-name-pattern='portfolio UI|portfolio action'`
Expected: PASS.

### Task 5: Portfolio eval fixtures and browser verification

**Files:**
- Create: `evals/portfolio/weekly-priority.yaml`
- Modify: `test/portfolio.test.ts`
- Modify: `test/web.test.ts`

**Interfaces:**
- Produces deterministic measures for evidence integrity, contamination, contradictions, concrete data, trade-off, false premise, action clarity, and outcome completion.

- [ ] **Step 1: Write failing fixture-evaluation tests**

```ts
test('portfolio eval separates the recommendation from a raw context dump', () => {
  const report = evaluatePortfolioFixture('evals/portfolio/weekly-priority.yaml')
  assert.equal(report.packet.integrity, true)
  assert.equal(report.packet.projectContamination, false)
})
```

- [ ] **Step 2: Run the focused eval test and verify it fails**

Run: `pnpm test --test-name-pattern='portfolio eval'`
Expected: failure because the fixture evaluator does not exist.

- [ ] **Step 3: Implement fixture checks and inspect the running app**

```ts
export function evaluatePortfolioFixture(path: string): PortfolioEvalReport
```

Start `pnpm dev`, exercise `/portfolio` through the browser, and verify empty state, project and evidence entry, packet generation, all approval decisions, review validation, loading state, and navigation.

- [ ] **Step 4: Run full verification**

Run: `pnpm test && pnpm typecheck && pnpm build && pnpm knowledge:verify && git diff --check`
Expected: all commands exit 0; report any failure verbatim.

## Self-review

- Scope/evidence requirements map to Tasks 1 and 3.
- Approval, action, outcome and learning map to Task 2.
- Required UI and primary browser paths map to Task 4 and 5.
- No placeholders or omitted validation categories remain.
