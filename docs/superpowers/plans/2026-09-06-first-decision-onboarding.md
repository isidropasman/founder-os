# First Decision Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a freshly initialized workspace usable for an offline first decision, and make every onboarding command executable from a clone without a global installation.

**Architecture:** `initWorkspace` remains a file scaffold, but its generated YAML must satisfy the same schemas that `openWorkspace` reads. User-facing guidance uses the repository script (`pnpm founderos`) everywhere, so setup, diagnostics, and documentation all address the same executable.

**Tech Stack:** TypeScript, Node test runner, YAML, pnpm.

**Spec:** README.md “Try it in three minutes”; docs/guide.md “Day one”; user request to verify `install → init → run → trace`, including no-credentials use.

## Global Constraints

- Node 22+ is the supported runtime.
- No API key is required for the offline first-decision path.
- Preserve the YAML scaffold as editable, commented user-owned files.
- Use `pnpm founderos`; the package is private and is not globally installed.
- Do not commit or push without explicit user authorization.

---

### Task 1: Generate a schema-valid workspace

**Files:**
- Modify: `src/init.ts`
- Modify: `test/setup.test.ts`

**Interfaces:**
- Consumes: `initWorkspace(root: string): InitReport` and `selectContext(workspace, CONTEXT_KEYS)`.
- Produces: a newly initialized workspace that loads every declared context key without validation errors.

- [ ] **Step 1: Write the failing test**

```ts
test('a newly initialized workspace can load every declared context key', () => {
  const root = workspace()
  initWorkspace(root)

  const selected = selectContext(openWorkspace(root), CONTEXT_KEYS)

  assert.deepEqual(Object.keys(selected).sort(), [...CONTEXT_KEYS].sort())
})
```

- [ ] **Step 2: Run the test to verify it fails because template fields parse as null**

Run: `node --import tsx --test --test-name-pattern='newly initialized workspace' test/setup.test.ts`

Expected: FAIL with `company.yaml failed validation` for blank scalar fields.

- [ ] **Step 3: Make the minimum scaffold change**

Replace blank scalar values in `company.yaml` and `founder.yaml` templates with quoted empty strings, and replace incomplete example records in list templates with empty arrays while retaining the instructional comments.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `node --import tsx --test --test-name-pattern='newly initialized workspace' test/setup.test.ts`

Expected: PASS.

### Task 2: Make clone-local commands consistent

**Files:**
- Modify: `README.md`
- Modify: `docs/guide.md`
- Modify: `scripts/setup.sh`
- Modify: `src/cli.ts`
- Modify: `src/doctor.ts`
- Modify: `src/offline.ts`
- Modify: `src/provider.ts`
- Modify: `src/signals.ts`
- Modify: `test/doctor.test.ts`
- Modify: `test/offline.test.ts`

**Interfaces:**
- Consumes: the `founderos` pnpm script defined in `package.json`.
- Produces: setup output, diagnostic repair commands, offline output, and the public quickstart all invoke `pnpm founderos`.

- [ ] **Step 1: Write failing expectations for clone-local repair and offline commands**

```ts
assert.match(workspace.fix ?? '', /^pnpm founderos init/)
assert.match(rendered, /pnpm founderos ask/)
assert.match(rendered, /pnpm founderos doctor/)
```

- [ ] **Step 2: Run the focused tests to verify the current output requires a missing global binary**

Run: `node --import tsx --test test/doctor.test.ts test/offline.test.ts`

Expected: FAIL because the output contains unprefixed `founderos` commands.

- [ ] **Step 3: Update every onboarding surface**

Use `pnpm founderos` in the setup script, CLI post-init message, diagnosis fixes and summaries, offline footer, provider remediation, signal hints, README quickstart, and founder guide. Add an explicit offline first-decision command for a new workspace and show the credentialed command that writes a trace.

- [ ] **Step 4: Run the focused tests to verify the output is executable from a clone**

Run: `node --import tsx --test test/doctor.test.ts test/offline.test.ts`

Expected: PASS.

### Task 3: Verify the complete path

**Files:**
- No new files.

**Interfaces:**
- Consumes: `pnpm founderos init`, `pnpm founderos ask --offline`, and `pnpm verify`.
- Produces: a checked first-decision path and full repository verification.

- [ ] **Step 1: Create a temporary workspace with the CLI**

Run: `pnpm founderos init /tmp/founderos-first-decision`

- [ ] **Step 2: Run the offline first decision against that workspace**

Run: `pnpm founderos ask "Where should I focus this week?" --context /tmp/founderos-first-decision --offline`

Expected: an offline brief, not a YAML validation error.

- [ ] **Step 3: Run repository verification**

Run: `pnpm verify`

Expected: typecheck, quote verification, and all tests pass.
