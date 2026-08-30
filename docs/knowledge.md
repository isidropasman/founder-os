# FounderOS — Knowledge Layer

Two memories, deliberately not one system.

| | Startup Memory | Knowledge Base |
|---|---|---|
| Contains | This founder's company | What experts have written |
| Size | Kilobytes | Megabytes and growing |
| Shared | No, private | Yes, shared by every user |
| Storage | YAML/Markdown files | PostgreSQL + pgvector |
| Retrieved by | Explicit context keys | Hybrid search |
| Truth | The founder asserts it | A source document proves it |

They are separate because they fail differently. Startup Memory must be
diffable, reproducible and inspectable by one person; a database there buys
nothing and costs reproducible evals. The Knowledge Base must scale to many
authors and support ranked retrieval; files there stop working around the first
thousand claims.

## Schema

```
authors ──┬── sources ── claims ──┐
          │                       ├── principle_evidence ── principles
          ├── principles ─────────┘
          └── frameworks
```

- **source** — one document (essay, talk, transcript), with its URL, year, retrieval
  date and a checksum of the extracted text.
- **claim** — a verbatim, contiguous slice of a source. Paragraph-aligned, never
  split mid-paragraph, with `char_start`/`char_end` indexing back into the source.
  Never model-generated.
- **principle** — an assertion attributed to an author, written by a *contributor*.
  This is the only human-authored layer, and it is the only one that can be wrong.
- **principle_evidence** — the join that makes a principle admissible: which claim
  contains the quote, and what the quote is.
- **framework** — an ordered procedure attributed to an author. Different shape from
  an assertion, so a different table.

Full DDL in `migrations/001_knowledge.sql`.

## The anti-fabrication gate

This is the point of the whole subsystem. A model asked to "channel Paul Graham"
will produce confident, plausible, invented quotes. So quotes are not trusted,
they are **located**:

1. A principle marked `quoted:` must name a corpus source id and carry the text.
2. `pnpm knowledge:verify` normalizes both sides (hard wrapping, curly quotes, em
   dashes) and searches the actual fetched document for the string.
3. Not found → the command exits non-zero. It is part of `pnpm verify`.
4. At ingestion, the quote is located down to the specific claim and stored in
   `principle_evidence`. A quote that resolves to no claim fails the ingest.

This is not theoretical. Writing the first Paul Graham pack from memory produced
**9 fabricated or misremembered quotes out of 20 candidates** — all caught by this
gate before they reached the repo. The shipped pack has 12 quotes, all located.

A principle that cannot be sourced is not banned — it is marked `paraphrase` and
reported as a warning, which is honest about what it is.

## Retrieval

Hybrid, fused with Reciprocal Rank Fusion (k=60):

- **Lexical** — Postgres `tsvector` + `websearch_to_tsquery`, GIN indexed. Works
  with no credentials, no embeddings, no network.
- **Semantic** — pgvector cosine over HNSW. Needs an embedding model.

RRF rather than score normalization because `ts_rank_cd` and cosine distance are
not on comparable scales and never will be. RRF only consumes the orderings, so
adding or removing a retrieval mode cannot silently reweight the others.

Search runs over a union of claims, principles and frameworks, filterable by kind
and author.

### Embeddings and the hash embedder

`src/knowledge/embed.ts` ships two embedders:

- `openai:text-embedding-3-small` (1536 dims) — the real one. **BLOCKED_ON_CREDENTIALS.**
- `hash-v1` — a hashed bag-of-words projection. Deterministic, offline, and *not
  semantic*: "cheap" and "inexpensive" land nowhere near each other.

The hash embedder exists so the vector path, the SQL, the fusion arithmetic and
the CLI are all testable and reproducible with no API key. `knowledge embed`
refuses to write hash vectors without `--allow-hash`, and prints a warning when it
does. Before switching to real embeddings, clear them:

```bash
pnpm knowledge embed --clear
FOUNDEROS_EMBEDDINGS=openai pnpm knowledge embed
```

Changing embedding model changes the required dimension, which is a migration —
that is the honest cost of putting vectors in Postgres.

## Source documents are not redistributed

`knowledge/sources/**/*.html` is gitignored. The essays are third-party work; this
repo commits the *manifest* — id, title, url, year, retrieval date and the sha256
of the extracted text — not the documents. Contributors fetch their own copy:

```bash
./scripts/fetch-paul-graham.sh
```

`loadCorpus` compares each fetched document against the committed checksum and
refuses to proceed on drift, because a changed document means every quote drawn
from it needs re-verification. If the corpus was never fetched, verification
reports a skip rather than a failure.

## What is in the corpus today

14 Paul Graham essays, fetched 2026-08-16, → 239 claims. 12 verified principles
and 1 framework (*Startups in 13 Sentences*, extracted verbatim).

**No YC corpus.** The YC Startup Library is a client-rendered application: a fetch
returns 54 characters of visible text. The `michael-seibel` pack is therefore
paraphrase-only, `confidence: low`, and every principle in it is flagged
unverifiable by `knowledge:verify`. Building a real YC pack is
**BLOCKED_ON_SOURCE_MATERIAL** — it needs transcripts, which need either a
different acquisition path or manual transcription. Inventing quotes to fill the
gap would defeat the entire subsystem.
