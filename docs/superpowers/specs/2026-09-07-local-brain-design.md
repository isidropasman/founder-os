# FounderOS Local Brain — Design

## Status

Proposed. This document is the design gate before implementation.

## Product decision

FounderOS Local Brain is a local-first evidence system for a single founder. It
answers questions such as “I am stuck on PMF” using two distinct inputs:

- **startup memory**: the founder's own files, which are private and editable;
- **expert corpus**: external material with a reproducible source trail.

It is not a general-purpose chatbot, an autonomous company operator, a clone of
Conductor, or an archive of the internet. Its useful claim is narrower: it gives
a second opinion whose factual basis is inspectable.

## Non-negotiable invariants

1. Private startup memory never becomes part of the shared corpus or Git history.
2. Every external source has canonical URL, author, retrieval time, content
   checksum, acquisition status, and redistribution status.
3. Raw third-party text remains local and ignored by Git. Git contains manifests,
   source metadata, code, tests, and evaluations only.
4. A citation is a contiguous range in one stored source version. A model cannot
   create evidence, quotes, author attribution, or source identifiers.
5. The answer renderer marks each claim as `startup_data`, `source`, `rule`, or
   `inference`. An unsupported statement is always `inference`.
6. A source whose retrieval or use status is not approved is invisible to answer
   generation and cannot be cited.
7. Models are replaceable generation adapters. Retrieval and provenance work
   without one.

## Architecture

```text
                         FounderOS UI (Next, local)
     ┌───────────────┬───────────────┬────────────────┬───────────────┐
     │ Brain chat    │ Library       │ Ingest review  │ Eval console  │
     └──────┬────────┴───────┬───────┴───────┬────────┴──────┬────────┘
            │                │               │               │
            │                │               │               │
     Startup workspace       │               │          deterministic
   YAML + Markdown files     │               │          test fixtures
            │                │               │
            └──── context assembler          │
                                             │
                     source manifests ─ source acquisition adapters
                     (versioned)       │
                                         ▼
       local ignored raw text ─ normalize ─ validate ─ PostgreSQL + pgvector
                                                   │        │
                                                   │        ├ lexical FTS
                                                   │        ├ vector HNSW
                                                   │        └ provenance graph
                                                   ▼
                              hybrid retrieval → answer contract → model adapter
```

The existing Next application and local PostgreSQL + pgvector instance remain
the foundation. Replacing them with SQLite or introducing a separate daemon
would add migration and operational work before proving a founder gets better
answers. A later local daemon is possible only behind the existing application
contracts.

## Data model

The current `authors`, `sources`, `claims`, `principles`, `frameworks`, and
`principle_evidence` model stays. The Local Brain extends it with the following
concepts.

### Source manifest

Each source version has a small, reviewed manifest in Git:

```yaml
id: sam-altman/startup-advice
author: sam-altman
canonical_url: https://blog.samaltman.com/startup-advice
kind: essay
retrieval:
  method: direct_html
  status: approved
  retrieved_at: 2026-09-07
redistribution: prohibited
checksum: sha256:...
```

`retrieval.status` is `approved`, `review_required`, or `blocked`. The ingestion
command only accepts `approved`. `redistribution` governs whether source text
can be exported; it does not weaken citation requirements.

### Source versions and passages

A source version is immutable once ingested. A new checksum creates a new
version and supersedes the previous one. Passages store `source_version_id`,
ordinal, character offsets, normalized text, lexical index, embedding, and
topic labels. The normalizer is deterministic: it preserves a passage's exact
range in the stored original.

### Ingestion run

An ingestion run records source version, adapter, timestamps, normalizer
version, passage count, validation result, and failures. This gives the UI an
auditable answer to “where did this come from?” and makes failed acquisitions
retryable without mutating a previous corpus version.

### Answer contract

The server returns structured assertions rather than a blob of Markdown:

```ts
type AnswerAssertion = {
  text: string
  basis: 'startup_data' | 'source' | 'rule' | 'inference'
  evidence: Array<
    | { type: 'startup_ref'; path: string }
    | { type: 'passage_ref'; passageId: string; quote: string }
    | { type: 'rule_ref'; ruleId: string }
  >
}
```

`source` requires at least one verified `passage_ref`; `startup_data` requires a
resolvable workspace path; `rule` requires a deterministic rule identifier;
and `inference` has no implied evidence. Validation rejects the other three
kinds when their evidence is missing or invalid.

## Corpus policy and first cohort

The first cohort is a source policy exercise, not an author popularity contest:

| Collection | Initial focus | Acquisition route |
| --- | --- | --- |
| Paul Graham | ideas, PMF, fundraising, founder practice | author-published essays |
| Sam Altman | startup execution, focus, ideas | author-published essays |
| Steve Blank | customer discovery and validation | author-published essays and course material with reviewed status |
| Andrew Chen | growth, retention, network effects | author-published essays |

First Round's public PMF material is a second-phase editorial collection. It is
not attributed to a single founder unless the source itself names and supports
that attribution.

New collections require an author manifest, an approved acquisition route, at
least one retrieval evaluation, and an explicit topic gap they address. Podcast
and video adapters accept a provided or permitted transcript; they do not
invent one from audio or captions of unclear provenance.

## Query and answer flow

1. The founder submits a question in Brain.
2. The context assembler reads only the required local startup files.
3. Retrieval runs lexical and vector searches in parallel, applies source/topic/
   author filters, and fuses candidates with RRF.
4. A deterministic evidence selector bounds the prompt to the highest-ranked,
   diverse passages and relevant startup facts.
5. The selected model adapter returns the structured answer contract.
6. The server validates every assertion's basis references before rendering.
7. The UI renders assertions and citations inline; the reader can open the
   source, source version, and contiguous passage.

If the database, embedding model, or generation model is unavailable, the
result is a typed degraded response. It may render startup facts, deterministic
rules, lexical results, or retrieval-only passages, but never pretends that a
model answer succeeded.

## Retrieval and latency design

The current RRF lexical + vector strategy remains because its score fusion is
stable across retrieval modes. The Local Brain adds:

- query-independent metadata filters before ranking;
- a bounded candidate pool for each modality;
- diversity by author and source before prompt assembly;
- optional reranking behind an interface and evaluation gate;
- per-stage timings: context, lexical, vector, fusion, rerank, generation, and
  total request time.

Reranking is not a launch dependency. It is adopted only when its offline
retrieval evaluation improves relevance at an acceptable measured latency. The
acceptance target is not an invented absolute number: the project records a
hardware-specific baseline, then prevents regressions against that baseline.

## UI

### Brain

The primary screen has a conversation timeline, a compact source tray, and
inline provenance badges. Clicking a badge opens the exact startup field,
deterministic rule, or source passage—not an opaque internal identifier. The
screen surfaces degraded mode and the selected model before a question is sent.

### Library

Library is an explorer, not a document dump. It supports hybrid search, author,
topic, format, retrieval-status and source-version filters. Each result shows
the passage, source details, checksum/version, and citation-ready range.

### Ingest

Ingest starts from a reviewed manifest. The UI previews normalized passages,
checksum changes, source-policy state, and validation output before indexing.
It never represents a failed fetch as imported material.

### Evals

Evals show the fixed question set, expected passages, retrieved passages,
citation validation, answer-basis coverage, latency distribution, and
comparison to the checked-in baseline.

## Model adapters and privacy

The model adapter contract takes a structured prompt and returns a structured
answer. Initial adapters are official OpenAI and Anthropic APIs, plus optional
locally authenticated `codex` and `claude` CLI harnesses. The latter run as local
processes and use their installed authentication; FounderOS does not automate
the consumer web UIs or treat a subscription session as an API.

The selected adapter and the fact that context will leave the Mac are displayed
before generation. Retrieval-only mode remains available with no API key. API
keys live only in `.env`; no key, raw corpus, or startup workspace enters Git.

## Evaluation

The eval suite has four layers:

1. **Corpus invariants**: checksum, source policy, contiguous passage offsets,
   quote location, and no unapproved source in retrieval.
2. **Retrieval**: fixtures for PMF, customer discovery, pricing, GTM, hiring and
   fundraising, with expected passage identifiers and recall/rank metrics.
3. **Answer provenance**: every non-inference assertion resolves; displayed
   quotes occur in the claimed passage; unsupported source labels fail.
4. **Usefulness and performance**: curated founder scenarios judged separately
   from factual grounding, plus per-stage and end-to-end latency regression
   measurements.

Model-based judging, if enabled, is advisory. It cannot make an answer pass
source validation or replace deterministic grounding tests.

## Delivery phases

### Phase 1 — Corpus contract

Add source policy, immutable source versions, manifests, raw-local layout,
ingestion-run records, and deterministic validation. Import the initial four
collections only through reviewed manifests.

### Phase 2 — Fast retrieval

Add metadata filters, parallel retrieval instrumentation, diversity selection,
and corpus/retrieval eval fixtures. Keep the current RRF behavior as the
baseline.

### Phase 3 — Evidence-native chat

Replace blob answers with validated assertions, implement the model adapter
boundary, and render citations inline in Brain.

### Phase 4 — Local operating UI

Implement Library, Ingest review, source coverage, eval dashboard, and
degraded-mode states. Connect the first local CLI adapters only after the API
adapter contract is proven.

### Phase 5 — Scale with evidence

Add reviewed author collections one at a time, only when their topic gap,
acquisition route, eval fixture and retrieval effect are documented.

## Definition of done for the first release

- A local founder can import approved sources without committing raw text.
- The initial cohort is indexed with versioned provenance and passes all corpus
  checks.
- Brain answers a PMF question using startup memory and retrieved passages, with
  every rendered assertion labeled by basis and every source citation resolvable.
- Library and Ingest expose the evidence and status that produced those answers.
- Retrieval, citation and latency suites run locally and fail on regression.
- Official API adapters work when their keys are present; retrieval-only mode
  works without them; no consumer web automation is required.
