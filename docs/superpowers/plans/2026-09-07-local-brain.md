# FounderOS Local Brain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a local-first, evidence-native founder brain that ingests approved sources, retrieves them quickly with provenance, and answers questions with inspectable citations.

**Architecture:** Keep Next.js and local PostgreSQL + pgvector. Store private startup data in the existing workspace files; store reviewed external metadata in manifests and local source versions/passages in PostgreSQL. A typed brain contract validates every rendered assertion against a startup reference, source passage, rule, or explicit inference.

**Tech Stack:** TypeScript strict, Next.js App Router, React 19, PostgreSQL, pgvector, `ai` SDK, Zod, Node test runner, pnpm.

**Spec:** [2026-09-07-local-brain-design.md](../specs/2026-09-07-local-brain-design.md)

## Global Constraints

- Preserve the separation between startup workspace and expert corpus.
- Raw third-party text remains local and ignored by Git; manifests and checksums are versioned.
- Do not use `any`; external inputs parse as `unknown` and validate at the boundary.
- Return typed result unions for expected operational failures.
- Do not fabricate sources, quotes, source identifiers, or basis labels.
- No consumer-web automation for ChatGPT or Claude; keys stay in `.env`.
- Do not commit or push unless the user explicitly asks.
- Every production behavior introduced below has a deterministic test.

---

## File map

| File | Responsibility |
| --- | --- |
| `migrations/002_local_brain.sql` | Versioned source, ingestion run, topic, and timing schema |
| `src/knowledge/policy.ts` | Manifest/source policy types and validation |
| `src/knowledge/corpus.ts` | Read reviewed manifests and local raw source files |
| `src/knowledge/ingest.ts` | Create immutable source versions and deterministic passages |
| `src/knowledge/retrieve.ts` | Filtered parallel hybrid retrieval and timing output |
| `src/knowledge/cli.ts` | Source review, ingestion, status, and evaluation commands |
| `src/brain/contract.ts` | Validated answer/basis contract independent of providers |
| `src/brain/assemble.ts` | Startup-context and evidence selection for a question |
| `src/brain/answer.ts` | Generation, fallback, and post-generation provenance validation |
| `src/provider.ts` | Official API and optional local CLI adapter selection |
| `src/knowledge/evals.ts` | Retrieval, provenance, and latency evaluation runner |
| `app/brain/*` | Evidence-native chat screen and server action |
| `app/knowledge/*` | Searchable Library with provenance filters and passage links |
| `app/ingest/*` | Local source review and ingestion UI |
| `app/evals/*` | Local evaluation and latency dashboard |
| `test/*.test.ts` | Deterministic behavior and regression coverage |

## Task 1: Source policy and manifest contract

**Files:**
- Create: `src/knowledge/policy.ts`
- Modify: `src/knowledge/corpus.ts`
- Modify: `test/knowledge.test.ts`
- Modify: `knowledge/sources/paul-graham/manifest.yaml`

**Interfaces:**
- Produces `SourcePolicy`, `SourceManifestEntry`, and `parseSourceManifest(input: unknown): SourceManifestResult`.
- `SourceManifestResult` is `{ ok: true; value: SourceManifestEntry } | { ok: false; issues: string[] }`.
- A manifest entry has `canonical_url`, `retrieval.method`, `retrieval.status`, and `redistribution` in addition to existing provenance fields.

- [x] **Step 1: Write failing manifest-policy tests**

```ts
test('rejects an entry without an approved acquisition state', () => {
  const result = parseSourceManifest({ id: 'x', title: 'X' })
  assert.deepEqual(result, {
    ok: false,
    issues: ['retrieval.status: Required'],
  })
})

test('does not load a review-required source into the retrievable corpus', () => {
  const corpus = loadCorpus(fixtureDir('review-required'))
  assert.equal(corpus.sources.size, 0)
})
```

- [x] **Step 2: Run the focused test and observe failure**

Run: `pnpm exec node --import tsx --test --test-name-pattern='manifest|review-required' test/*.test.ts`

Expected: failure because the parser and policy gate do not exist.

- [x] **Step 3: Implement explicit source policy parsing**

```ts
export const retrievalStatuses = ['approved', 'review_required', 'blocked'] as const
export type RetrievalStatus = (typeof retrievalStatuses)[number]

export type SourcePolicy = {
  method: 'direct_html' | 'local_text' | 'provided_transcript'
  status: RetrievalStatus
  retrievedAt: string
  redistribution: 'prohibited' | 'citation_only' | 'permitted'
}
```

Parse YAML through Zod in `policy.ts`, then make `loadCorpus` skip anything
other than `approved`. Keep missing local source files as an explicit skipped
state rather than a malformed manifest.

- [x] **Step 4: Upgrade the Paul Graham manifest and fixtures**

Add policy fields to every real entry and source fixture. Preserve each existing
checksum and source id. Do not copy source text into Git.

- [x] **Step 5: Re-run focused and full knowledge tests**

Run: `pnpm exec node --import tsx --test --test-name-pattern='manifest|review-required|knowledge' test/*.test.ts`

Expected: parser rejects incomplete policy, approved source loads, unapproved
source is not retrievable.

## Task 2: Immutable source versions and ingestion audit

**Files:**
- Create: `migrations/002_local_brain.sql`
- Modify: `src/knowledge/ingest.ts`
- Modify: `src/knowledge/retrieve.ts`
- Modify: `src/knowledge/db.ts`
- Modify: `test/knowledge.test.ts`

**Interfaces:**
- Produces `SourceVersion` and `IngestionRun` rows.
- `ingest` returns `IngestReport & { skipped: Array<{ sourceId: string; reason: string }> }`.
- Claims reference a source version, and all display/retrieval code exposes both
  canonical `sourceId` and immutable `sourceVersionId`.

- [ ] **Step 1: Write failing idempotency/version tests**

```ts
test('preserves the first source version when a newer checksum is ingested', async () => {
  const first = await ingest(db, corpusWithText('original'))
  const second = await ingest(db, corpusWithText('changed'))
  assert.equal(first.sourceVersions, 1)
  assert.equal(second.sourceVersions, 1)
  assert.equal(await countRows(db, 'source_versions'), 2)
})

test('records a failed ingestion run without indexing claims', async () => {
  const report = await ingest(db, invalidCorpus())
  assert.equal(report.claims, 0)
  assert.equal(await latestRunState(db), 'failed')
})
```

- [ ] **Step 2: Run the focused tests and observe failure**

Run: `pnpm exec node --import tsx --test --test-name-pattern='source version|ingestion run' test/*.test.ts`

Expected: failure because source rows are currently overwritten in place.

- [ ] **Step 3: Add the non-destructive migration**

Create `source_versions` and `ingestion_runs`; backfill one version per existing
`sources` row. Add `claims.source_version_id`, backfill it, and keep canonical
`sources.id` as the stable source identity. Index `(source_id, retrieved_at)` and
`(source_version_id, ordinal)`.

```sql
CREATE TABLE source_versions (
  id text PRIMARY KEY,
  source_id text NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  checksum text NOT NULL,
  raw_text text NOT NULL,
  retrieved_at date NOT NULL,
  supersedes_id text REFERENCES source_versions(id),
  UNIQUE (source_id, checksum)
);
```

- [ ] **Step 4: Change ingestion to append versions**

Create a version id from canonical source id plus checksum prefix. Reuse an
existing identical version, append a changed one, and only delete/rebuild claims
for the version being ingested. Write a success or failure `ingestion_runs` row
inside the transaction.

- [ ] **Step 5: Verify migration and tests**

Run: `pnpm exec node --import tsx --test --test-name-pattern='source version|ingestion run|ingest' test/*.test.ts`

Run: `pnpm typecheck`

Expected: changed text produces a second version; old passages remain addressable.

## Task 3: Filtered, measured hybrid retrieval

**Files:**
- Modify: `src/knowledge/retrieve.ts`
- Modify: `src/knowledge/consult.ts`
- Modify: `test/knowledge.test.ts`
- Modify: `test/consult.test.ts`

**Interfaces:**
- Extend `SearchOptions` with `topics?: string[]`, `sourceIds?: string[]`, and
  `sourceVersionIds?: string[]`.
- Return `SearchResult = { hits: Hit[]; timing: RetrievalTiming }` from a new
  `searchMeasured` function; retain `search` as compatibility wrapper.
- `RetrievalTiming` has `lexicalMs`, `vectorMs`, `fusionMs`, and `totalMs`.

- [ ] **Step 1: Write failing filter/timing tests**

```ts
test('returns only the requested author and source version', async () => {
  const result = await searchMeasured(db, 'product market fit', {
    authorId: 'andrew-chen',
    sourceVersionIds: ['andrew-chen/pmf@abc123'],
  })
  assert.ok(result.hits.every((hit) => hit.authorId === 'andrew-chen'))
  assert.ok(result.hits.every((hit) => hit.sourceVersionId === 'andrew-chen/pmf@abc123'))
})

test('reports every retrieval timing stage', async () => {
  const result = await searchMeasured(db, 'pricing')
  assert.ok(result.timing.totalMs >= result.timing.fusionMs)
})
```

- [ ] **Step 2: Run focused tests and observe failure**

Run: `pnpm exec node --import tsx --test --test-name-pattern='source version|retrieval timing' test/*.test.ts`

- [ ] **Step 3: Implement parallel modality collection and deterministic fusion**

Start lexical and vector queries together when an embedder is present. Preserve
the current RRF constant and deterministic id tie-break. Apply SQL filters before
candidate limiting. Measure only local retrieval stages; do not include model
generation time in `RetrievalTiming`.

- [ ] **Step 4: Add source diversity in consultation**

Select at most one passage per source until each requested author has a result,
then fill remaining slots by fused rank. Expose discarded duplicate count in
`Consultation`.

- [ ] **Step 5: Re-run retrieval suite**

Run: `pnpm exec node --import tsx --test --test-name-pattern='retrieval|consult|semantic' test/*.test.ts`

Expected: filters are honored, ranking is deterministic, and lexical-only
retrieval still works without credentials.

## Task 4: Evidence-native answer contract

**Files:**
- Create: `src/brain/contract.ts`
- Create: `src/brain/assemble.ts`
- Create: `src/brain/answer.ts`
- Modify: `src/provider.ts`
- Modify: `app/ask/actions.ts`
- Modify: `test/provider.test.ts`
- Create: `test/brain.test.ts`

**Interfaces:**

```ts
export type Basis =
  | { kind: 'startup_data'; path: string }
  | { kind: 'source'; passageId: string; quote: string }
  | { kind: 'rule'; ruleId: string }
  | { kind: 'inference' }

export type AnswerAssertion = { text: string; basis: Basis[] }
export type BrainAnswer =
  | { mode: 'answer'; assertions: AnswerAssertion[]; timing: BrainTiming }
  | { mode: 'retrieval_only'; passages: Passage[]; reason: string }
  | { mode: 'error'; message: string }
```

- [ ] **Step 1: Write failing contract-validation tests**

```ts
test('rejects a source assertion when its quote is absent from the passage', () => {
  const result = validateAnswer(answerWithQuote('invented'), evidenceFixture())
  assert.deepEqual(result, { ok: false, issues: ['assertions[0].basis[0]: quote not found'] })
})

test('labels an unsupported generated statement as inference', () => {
  const result = validateAnswer(answerWithInference(), evidenceFixture())
  assert.equal(result.ok, true)
})
```

- [ ] **Step 2: Run focused tests and observe failure**

Run: `pnpm exec node --import tsx --test --test-name-pattern='source assertion|unsupported generated' test/*.test.ts`

- [ ] **Step 3: Implement Zod output schema and deterministic validator**

Validate workspace paths through the existing context resolver, source quotes by
normalizing and locating them in the selected passage, and rules against a
closed registered rule list. Return issues as data; only programmer invariants
throw.

- [ ] **Step 4: Build prompt assembly and degraded result path**

`assembleBrainInput` receives question, workspace, and retrieved passages. It
serializes only selected facts and exact passages. `answerBrainQuestion` invokes
the selected provider, validates its structured answer, and returns
`retrieval_only` if database/model availability prevents a valid answer.

- [ ] **Step 5: Adapt the existing Ask server action without breaking offline mode**

Map the old `Counsel` union to `BrainAnswer` incrementally. Continue showing
offline procedures, but source material must render from passages rather than
model-created quotes.

- [ ] **Step 6: Run brain and existing provider tests**

Run: `pnpm exec node --import tsx --test --test-name-pattern='brain|provider|offline|basis' test/*.test.ts`

Expected: source basis cannot pass with an invented quote; missing credentials
returns useful retrieval-only material.

## Task 5: Model adapter boundary and local harness discovery

**Files:**
- Modify: `src/provider.ts`
- Create: `src/providers/local-cli.ts`
- Modify: `src/doctor.ts`
- Modify: `test/provider.test.ts`
- Modify: `test/doctor.test.ts`

**Interfaces:**

```ts
export type ProviderAvailability =
  | { ok: true; provider: string }
  | { ok: false; reason: string }

export function providerAvailability(spec: string): Promise<ProviderAvailability>
```

- [ ] **Step 1: Write failing availability tests**

```ts
test('reports an unavailable local codex harness without invoking it', async () => {
  const result = await providerAvailability('codex-cli')
  assert.deepEqual(result, { ok: false, reason: 'codex CLI not found on PATH' })
})
```

- [ ] **Step 2: Run focused tests and observe failure**

Run: `pnpm exec node --import tsx --test --test-name-pattern='local codex harness|provider availability' test/*.test.ts`

- [ ] **Step 3: Implement provider selection**

Keep existing `anthropic:` and `openai:` API paths. Add `codex-cli` and
`claude-cli` specs behind a process adapter that performs an availability check,
passes structured stdin, caps output, and returns a typed operational failure.
Do not launch browser login, save credentials, or execute a harness until the
user selects it.

- [ ] **Step 4: Surface status in doctor and UI model selector**

Mark unavailable harnesses degraded, not fatal. Show the active provider before
Brain submits a question and explain that external API providers receive the
assembled context.

- [ ] **Step 5: Run provider and doctor tests**

Run: `pnpm exec node --import tsx --test --test-name-pattern='provider|doctor|harness' test/*.test.ts`

## Task 6: Library and Ingest UI

**Files:**
- Modify: `app/knowledge/page.tsx`
- Create: `app/knowledge/passage.tsx`
- Create: `app/ingest/page.tsx`
- Create: `app/ingest/actions.ts`
- Modify: `app/masthead.tsx`
- Modify: `app/globals.css`
- Create: `test/web-ingest.test.ts`

**Interfaces:**
- Library query accepts `q`, `author`, `kind`, `topic`, and `version` search
  parameters.
- Ingest action returns `{ ok: true; report: IngestReport } | { ok: false; message: string }`.

- [ ] **Step 1: Write rendering/action tests**

```ts
test('library result links to a source version and exact passage', async () => {
  const html = await renderLibrary({ q: 'PMF' })
  assert.match(html, /source-version/)
  assert.match(html, /passage/)
})

test('ingest rejects a manifest in review_required state', async () => {
  const result = await runIngest('fixtures/review-required/manifest.yaml')
  assert.deepEqual(result, { ok: false, message: 'Source is not approved for ingestion.' })
})
```

- [ ] **Step 2: Run focused tests and observe failure**

Run: `pnpm exec node --import tsx --test --test-name-pattern='library result|ingest rejects' test/*.test.ts`

- [ ] **Step 3: Render provenance in Library**

Use `searchMeasured` and show author, canonical source, source version/checksum,
acquisition state, passage id, matched modes, and timings. Keep the raw source
text behind its existing local-only database boundary.

- [ ] **Step 4: Add manifest-first Ingest screen**

The screen accepts a local manifest path, previews status and checksum, calls the
server action only for `approved` sources, and renders success/failure report.
No browser upload is required in this release.

- [ ] **Step 5: Run focused UI tests and typecheck**

Run: `pnpm exec node --import tsx --test --test-name-pattern='library|ingest' test/*.test.ts`

Run: `pnpm typecheck`

## Task 7: Brain UI and inline evidence

**Files:**
- Create: `app/brain/page.tsx`
- Create: `app/brain/actions.ts`
- Create: `app/brain/console.tsx`
- Create: `app/brain/assertions.tsx`
- Modify: `app/masthead.tsx`
- Modify: `app/globals.css`
- Create: `test/web-brain.test.ts`

**Interfaces:**
- `askBrain(question: string, providerSpec: string): Promise<BrainAnswer>` is the
  sole server action consumed by the client console.
- Assertion rendering accepts only `AnswerAssertion[]`; it does not parse model
  Markdown for citations.

- [ ] **Step 1: Write failing UI tests**

```ts
test('renders source evidence beside an assertion', () => {
  const html = renderAssertions([sourceAssertionFixture()])
  assert.match(html, /Source/)
  assert.match(html, /paul-graham\/ds#0002/)
})

test('renders inference as inference and not a source', () => {
  const html = renderAssertions([inferenceAssertionFixture()])
  assert.match(html, /Inference/)
  assert.doesNotMatch(html, /Source/)
})
```

- [ ] **Step 2: Run focused tests and observe failure**

Run: `pnpm exec node --import tsx --test --test-name-pattern='renders source evidence|renders inference' test/*.test.ts`

- [ ] **Step 3: Implement the Brain route and assertion renderer**

Provide question input, selected available provider, pending/degraded state, and
a source tray. Render one basis badge per assertion and link passage evidence to
Library. Show timings only as diagnostic metadata, never as a fabricated speed
claim.

- [ ] **Step 4: Keep `/ask` as a compatibility route**

Route existing Ask links to Brain or reuse its components after the new contract
is stable. Preserve its query/skill deep links.

- [ ] **Step 5: Run Brain UI tests**

Run: `pnpm exec node --import tsx --test --test-name-pattern='brain|source evidence|inference' test/*.test.ts`

## Task 8: Evaluation suite and local dashboard

**Files:**
- Create: `src/knowledge/evals.ts`
- Create: `evals/retrieval/pmf.yaml`
- Create: `evals/retrieval/customer-discovery.yaml`
- Create: `evals/retrieval/pricing.yaml`
- Create: `evals/retrieval/gtm.yaml`
- Create: `evals/retrieval/hiring.yaml`
- Create: `evals/retrieval/fundraising.yaml`
- Create: `app/evals/page.tsx`
- Modify: `src/knowledge/cli.ts`
- Modify: `package.json`
- Create: `test/knowledge-evals.test.ts`

**Interfaces:**

```ts
export type RetrievalEvalCase = {
  id: string
  query: string
  expectedPassageIds: string[]
  filters?: { authors?: string[]; topics?: string[] }
}

export type EvalReport = {
  cases: Array<{ id: string; reciprocalRank: number; recallAt10: number; latencyMs: number }>
  aggregate: { mrr: number; recallAt10: number; p50Ms: number; p95Ms: number }
}
```

- [ ] **Step 1: Write failing evaluation runner tests**

```ts
test('reports reciprocal rank and recall for a fixture corpus', async () => {
  const report = await runRetrievalEvals(db, [pmfCase])
  assert.equal(report.cases[0]?.reciprocalRank, 1)
  assert.equal(report.aggregate.recallAt10, 1)
})

test('fails the provenance suite for a non-contiguous displayed quote', () => {
  assert.equal(verifyBrainProvenance(nonContiguousQuoteFixture()).ok, false)
})
```

- [ ] **Step 2: Run focused tests and observe failure**

Run: `pnpm exec node --import tsx --test --test-name-pattern='reciprocal rank|non-contiguous' test/*.test.ts`

- [ ] **Step 3: Implement deterministic retrieval and provenance evaluations**

Read checked-in YAML cases, execute lexical and hybrid retrieval as configured,
calculate MRR/recall and percentile latency, and return a typed report. Store
optional local result snapshots in ignored `evals/results/`; source fixtures
contain ids, never third-party raw text.

- [ ] **Step 4: Expose CLI and dashboard**

Add `pnpm knowledge eval` and a local `/evals` page. The page shows case result,
expected versus retrieved ids, provenance failure, and measured p50/p95. A
baseline comparison only displays when a checked-in compatible baseline exists.

- [ ] **Step 5: Run eval tests and CLI help**

Run: `pnpm exec node --import tsx --test --test-name-pattern='eval|reciprocal rank|provenance' test/*.test.ts`

Run: `pnpm founderos knowledge --help`

## Task 9: End-to-end verification and honest documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/guide.md`
- Modify: `docs/knowledge.md`
- Modify: `.env.example` if it already exists; otherwise document variable names only in `docs/guide.md`
- Modify: `test/web.test.ts`

**Interfaces:**
- Documents exact local setup, approved source workflow, retrieval-only mode,
  model adapter choices, and evaluation commands.

- [ ] **Step 1: Write an end-to-end fixture test**

```ts
test('an approved PMF source produces a cited Brain assertion', async () => {
  await ingest(db, approvedFixtureCorpus())
  const result = await answerBrainQuestion({ question: 'How do I know whether I have PMF?' })
  assert.equal(result.mode, 'answer')
  assert.equal(result.assertions[0]?.basis[0]?.kind, 'source')
})
```

- [ ] **Step 2: Run it and observe the initial failure**

Run: `pnpm exec node --import tsx --test --test-name-pattern='approved PMF source' test/*.test.ts`

- [ ] **Step 3: Document only verified behavior**

Describe local setup and commands that have actually passed in this repository.
State the four initial collections as source policy targets until their reviewed
manifests and local imports exist. Do not claim corpus size, semantic quality, or
latency without an eval output.

- [ ] **Step 4: Execute release verification**

Run: `pnpm verify`

Run: `pnpm founderos knowledge eval`

Run: `pnpm build`

Run: `git diff --check`

Expected: typecheck, quote verification, all tests, eval suite, production build,
and whitespace verification pass. Report any unavailable local service or key as
an explicit setup prerequisite, never a passing result.
