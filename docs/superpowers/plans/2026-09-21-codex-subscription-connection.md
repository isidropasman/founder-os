# Codex Subscription Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a founder use an already authenticated local Codex / ChatGPT subscription for FounderOS questions and portfolio packets, without supplying or storing an API key.

**Architecture:** FounderOS stores only an opt-in provider selection in the founder's local workspace. Codex CLI remains the credential owner: FounderOS detects its authenticated session and invokes the existing read-only `codex exec` adapter. The UI exposes Codex as a working connection and lists Copilot and Grok accurately as unsupported until adapters and their authentication contracts exist.

**Tech Stack:** Next.js App Router server actions, TypeScript, Node child processes, Zod, existing local CLI provider adapter, Node test runner.

**Spec:** Screenshot supplied 2026-09-21: “Connect a subscription” onboarding, where an active paid subscription powers model requests rather than an API key.

## Global Constraints

- Never read, copy, persist, or expose a ChatGPT, Copilot, or Grok credential or browser session.
- The local CLI owns authentication; FounderOS stores only the selected provider identifier.
- Preserve the existing API-key providers and offline behavior.
- Codex calls keep `--sandbox read-only --ephemeral`; only minimum selected context and approved passages go to the CLI.
- Do not imply token, usage, or monetary-cost telemetry exists when a subscription-backed CLI does not return it.
- Copilot and Grok must not show a functional “Connect” control until a real adapter with a documented authentication status check exists.
- No `any`; errors at process boundaries return tagged result unions.

---

### Task 1: Model the local connection and selection

**Files:**
- Create: `src/providers/connection.ts`
- Modify: `src/providers/local-cli.ts`
- Modify: `src/provider.ts`
- Test: `test/provider.test.ts`

**Interfaces:**
- Produces `ConnectionStatus = { kind: 'ready'; provider: 'codex-cli'; label: string } | { kind: 'unavailable'; provider: 'codex-cli'; reason: string }`.
- Produces `ProviderSelection = { provider: 'codex-cli' } | null`.
- Produces `readProviderSelection(root)`, `writeProviderSelection(root, selection)`, `connectionStatus('codex-cli')`, and `modelForWorkspaceRole(root, role)`.
- `modelForWorkspaceRole` returns `codex-cli` for every role only when the workspace selection is Codex; otherwise it delegates to existing `modelForRole` environment defaults.

- [ ] **Step 1: Write failing tests for a missing selection, a selected Codex connection, and an unauthenticated Codex CLI**

```ts
assert.equal(readProviderSelection(root), null)
writeProviderSelection(root, { provider: 'codex-cli' })
assert.deepEqual(readProviderSelection(root), { provider: 'codex-cli' })
assert.equal(modelForWorkspaceRole(root, 'reason'), 'codex-cli')
assert.deepEqual(await connectionStatus('codex-cli', fakeUnauthenticatedRunner), {
  kind: 'unavailable', provider: 'codex-cli', reason: 'Codex CLI is not signed in',
})
```

- [ ] **Step 2: Run the provider tests and confirm the new imports fail**

Run: `pnpm test -- test/provider.test.ts`

Expected: failure because the connection contract does not exist.

- [ ] **Step 3: Implement minimal local-only selection and authenticated-session detection**

```ts
export async function codexSessionStatus(): Promise<ConnectionStatus> {
  const available = localCliAvailability('codex-cli')
  if (!available.ok) return { kind: 'unavailable', provider: 'codex-cli', reason: available.reason }
  const result = await runLocalCommand('codex', ['login', 'status'])
  return result.ok && /logged in/i.test(result.output)
    ? { kind: 'ready', provider: 'codex-cli', label: 'ChatGPT subscription' }
    : { kind: 'unavailable', provider: 'codex-cli', reason: 'Codex CLI is not signed in' }
}
```

Store selection at `<workspace>/.founderos/provider.json`; validate it with Zod when reading; make the parent folder if needed. A malformed local preference resolves to `null`, not a server error. The command runner must cap output and return `{ ok: false, reason }` instead of throwing.

- [ ] **Step 4: Run provider tests and typecheck**

Run: `pnpm test -- test/provider.test.ts && pnpm typecheck`

Expected: PASS.

### Task 2: Route interactive FounderOS work through the selected subscription

**Files:**
- Modify: `app/ask/actions.ts`
- Modify: `app/portfolio/actions.ts`
- Modify: `src/brain/answer.ts` only if its input needs the selected model metadata
- Test: `test/brain.test.ts`
- Test: `test/portfolio-reason.test.ts`

**Interfaces:**
- Consumes `modelForWorkspaceRole(workspaceRoot, role)` from Task 1.
- Produces the same `Counsel` and `PortfolioAction` result unions as today.
- A selected but unavailable Codex connection yields the existing grounded/offline behavior or an actionable provider error; it never silently falls back to a paid API provider.

- [ ] **Step 1: Write failing tests proving a selected `codex-cli` spec is used for an Ask and a portfolio generation**

```ts
const model = modelForWorkspaceRole(tempWorkspace, 'reason')
assert.equal(model, 'codex-cli')
assert.equal(await providerIsReady(model, authenticatedCodexEnvironment), true)
```

Add the companion unavailable test: no Codex session means no model object is constructed and the answer remains retrieval-only/offline.

- [ ] **Step 2: Run the focused tests and confirm they fail before wiring**

Run: `pnpm test -- test/brain.test.ts test/portfolio-reason.test.ts`

Expected: failure because server actions still obtain only `modelForRole`.

- [ ] **Step 3: Resolve model choice from the active workspace in both server actions**

```ts
const ws = workspace()
const model = modelForWorkspaceRole(ws.root, 'reason')
const provider = await providerIsReady(model) ? createProvider(model) : undefined
```

Keep evaluation model configuration environment-controlled: a workspace subscription is a founder-interactive provider, not an implicit benchmark/judge provider.

- [ ] **Step 4: Run focused tests and typecheck**

Run: `pnpm test -- test/brain.test.ts test/portfolio-reason.test.ts && pnpm typecheck`

Expected: PASS.

### Task 3: Build an honest Provider Connections screen

**Files:**
- Create: `app/providers/actions.ts`
- Create: `app/providers/console.tsx`
- Create: `app/providers/page.tsx`
- Modify: `app/masthead.tsx`
- Modify: `app/globals.css` only for existing design primitives that cannot express connection state
- Test: `test/web-providers.test.ts`

**Interfaces:**
- `loadConnections(): Promise<ProviderConnectionsView>` includes current selection and Codex session status.
- `selectCodexConnection(): Promise<ProviderConnectionsAction>` writes `{ provider: 'codex-cli' }` only if session status is `ready`.
- `disconnectProvider(): Promise<ProviderConnectionsAction>` clears FounderOS selection; it never runs `codex logout`.

- [ ] **Step 1: Write a UI contract test**

```ts
assert.match(page, /Use your existing ChatGPT subscription/)
assert.match(page, /Codex/)
assert.match(page, /GitHub Copilot.*Not available yet/s)
assert.match(page, /SuperGrok.*Not available yet/s)
assert.match(actions, /selectCodexConnection/)
assert.match(actions, /disconnectProvider/)
```

- [ ] **Step 2: Run the focused test and confirm it fails**

Run: `pnpm test -- test/web-providers.test.ts`

Expected: failure because the route and actions do not exist.

- [ ] **Step 3: Implement the screen and actions**

The page must show:

```text
Use a subscription you already have
Codex / ChatGPT subscription / [Use for FounderOS | Connected]
Privacy: FounderOS never sees or stores your subscription credential.
Only the selected company context and approved Knowledge Base passages are sent.
GitHub Copilot — Not available yet
SuperGrok — Not available yet
```

If Codex is installed but unauthenticated, show exactly `Run codex login in Terminal, then verify again` with a Verify control. Do not launch an interactive terminal login from the web server. Add `/providers` to `Masthead` as `Models`.

- [ ] **Step 4: Run focused tests, typecheck, and a production build**

Run: `pnpm test -- test/web-providers.test.ts && pnpm typecheck && pnpm build`

Expected: PASS.

### Task 4: Make diagnosis and user-facing errors connection-aware

**Files:**
- Modify: `src/doctor.ts`
- Modify: `src/provider.ts`
- Modify: `test/doctor.test.ts`
- Modify: `test/provider.test.ts`

**Interfaces:**
- Codex diagnosis distinguishes absent binary from an installed but unauthenticated CLI.
- `explainProviderError('codex-cli', error)` points to `codex login` and `/providers`, not an API-key instruction.

- [ ] **Step 1: Write failing tests for signed-out Codex diagnostics and errors**

```ts
assert.match(renderDiagnosis(await diagnose(root, signedOutEnvironment)), /codex login/)
assert.match(explainProviderError('codex-cli', new Error('not logged in')), /codex login/)
```

- [ ] **Step 2: Run focused tests and confirm the new status is not yet represented**

Run: `pnpm test -- test/doctor.test.ts test/provider.test.ts`

Expected: failure before the status is added.

- [ ] **Step 3: Implement specific actionable error mapping**

Do not alter API-key error strings. For Codex only, distinguish installation, sign-in, and request failures so the UI/CLI does not claim that `.env` fixes a ChatGPT-subscription problem.

- [ ] **Step 4: Run focused tests and full verification**

Run: `pnpm test -- test/doctor.test.ts test/provider.test.ts && pnpm verify`

Expected: PASS; record Node-version warning if the active shell is below Node 22.

### Task 5: Verify the actual local authenticated path and document product limits in UI copy

**Files:**
- Modify: `test/web-providers.test.ts`
- Modify: `docs/portfolio-evals.md` only if connection-backed eval execution instructions need clarification

**Interfaces:**
- No persistence of model response/token/cost values beyond existing trace/eval fields.
- The UI labels usage as unavailable for subscription-backed execution unless the CLI returns usage metadata.

- [ ] **Step 1: Run session detection against the local Codex login**

Run: `codex login status`

Expected: a signed-in status, without printing a credential.

- [ ] **Step 2: Run one bounded object generation through `codex-cli` using the current existing provider test harness**

Run: `pnpm test -- test/provider.test.ts`

Expected: PASS; the test verifies `--output-last-message` and output-schema handling without consuming a real subscription request.

- [ ] **Step 3: Run the local app and inspect `/providers`, `/ask`, and `/portfolio`**

Run: `pnpm dev`

Expected: Models screen accurately shows session state; Ask and Portfolio use the selected Codex provider; disabled/error/loading states render without exposing credentials.

- [ ] **Step 4: Run full verification and report precise limitations**

Run: `pnpm verify && pnpm build`

Expected: PASS.

## Self-review

- Scope coverage: Codex subscription detection, local selection, interactive routing, UI, diagnostics, privacy, and verification are covered. Copilot and Grok are intentionally deferred because no adapter/authentication contract is present.
- No placeholders: each task specifies paths, interfaces, commands, and behavior.
- Type consistency: the selected provider stays a `LocalCliSpec` (`'codex-cli'`) through persistence, resolution, readiness, and `createProvider`.
