# Context ingestion

> Tell FounderOS what happened; FounderOS structures and remembers it.

The YAML files are an implementation detail. A founder should never have to know
that a customer's complaint goes in `feedback.yaml` and the person who said it goes
in `people.yaml`.

Startup Memory stays filesystem-backed. This adds a way to write to it without
opening an editor.

## Three ways in

```bash
founderos context add "Priya said onboarding is confusing. MRR is 3620 now."
pbpaste | founderos context add                  # stdin also works
founderos context import notes/customer-call.md  # a file, or a whole folder
founderos context ingest                         # everything in <workspace>/inbox/
founderos context show                           # what FounderOS currently knows
```

## The flow

```
input → extract → plan → preview → [--apply] → merge → provenance
```

Only the **extract** step uses a model. Everything after it is deterministic, which
is why the whole pipeline is testable with no credentials.

### Preview is the default

Nothing is written until `--apply`. The preview is the approval step:

```
NEW FACTS  (3)
  + person      Priya Nandakumar
  + feedback    I spent forty minutes trying to figure out how to add my logo…
  + meeting     Intro call with referred studio

WOULD CHANGE SOMETHING YOU WROTE  (2)
  ! metric      mrr
      value: 3420 → 3620
      source: stripe → founder_notes
      4 existing value(s) would change

HELD AS UNRESOLVED  (1)
  ? decision    Should we stop the redesign and work on onboarding instead?
      confidence 0.35 is below 0.5

REJECTED  (1)
  x feedback    The pricing is far too expensive for what you get.
      quote not found in the source text — the extractor invented or paraphrased it

Preview only. --apply writes 3 change(s) and holds 1 unresolved item(s).
2 conflict(s) need --apply --overwrite; they replace values you wrote.
```

### Six dispositions

| | Meaning | Written by |
|---|---|---|
| `add` | Nothing like it exists | `--apply` |
| `update` | Fills a field that was empty | `--apply` |
| `conflict` | Would replace a value you wrote | `--apply --overwrite` |
| `duplicate` | Already recorded | never |
| `unresolved` | Confidence below 0.5 | held in `unresolved.yaml` |
| `rejected` | The quote is not in your text | never |

**Conflicts need their own flag.** `--apply` will not silently replace something the
founder typed; the second flag is the second approval. This is the one place the
CLI is deliberately more annoying than it could be.

### Rejection: the quote gate

Every proposal must carry a `quote` that is a **verbatim span of the input**. The
planner searches the source for it (normalizing whitespace and typographic quotes)
and rejects anything it cannot find.

This is the same mechanism the knowledge base uses for expert quotes, pointed at a
different problem: an extractor that has started summarizing instead of recording.
A model that writes "she said the pricing is too expensive" when the note never
says that produces a rejected item, not a fact in your context.

### Unresolved, not invented

An extraction below 0.5 confidence is appended to `<workspace>/unresolved.yaml`
with its reason, its confidence and its provenance — not merged, not thrown away.
`context show` reports the count. The founder resolves them by editing the file.

A half-formed thought — "I think we should probably stop the redesign, but I want
to sleep on it" — is exactly this case. It is not a decision yet, and recording it
as one would be worse than losing it.

## Deduplication

Deterministic, no model. An `id` always wins; otherwise each entity has one natural
identity field, because that is what a founder would recognize as "the same thing":

| entity | identity |
|---|---|
| goal | statement |
| metric | name |
| person | name |
| feedback | verbatim |
| experiment | hypothesis |
| meeting | date + purpose |
| decision | question |

Compared after normalizing whitespace, case and typographic quotes. Re-importing
the same note is a no-op — there is a test asserting the files are byte-identical
after a second apply.

## Provenance

Every imported entity carries where it came from:

```yaml
- id: p-priya
  name: Priya Nandakumar
  ...
  provenance:
    source: inbox/customer-call.md
    source_type: customer-interview
    imported_at: 2026-08-16
    quote: She runs a three-person studio, bills around $8k/mo.
```

The quote is a real span of the source, so any imported fact can be traced back to
the sentence that produced it. Entities the founder wrote by hand have no
`provenance` key, which is how you tell the two apart.

Provenance is stripped when context is loaded for reasoning — it is for audit, not
for the prompt.

## The inbox

```bash
founderos context inbox    # prints the path, creates it
# drop .md / .txt notes there all week
founderos context ingest   # preview everything unprocessed
founderos context ingest --apply --archive
```

The ledger (`<workspace>/.ingested.json`) is keyed by **sha256 of the file's text,
not its path**. Renaming a note, or dropping the same note in twice under two
names, is still one source and is not processed twice. `--force` reprocesses
anyway; because merging is idempotent, that is safe.

`--archive` moves processed files to `inbox/processed/` rather than deleting them.

## Extraction is the only model-dependent step

`FOUNDEROS_EXTRACTOR` selects the implementation:

- `llm` (default) — the provider abstraction, structured output.
  **BLOCKED_ON_CREDENTIALS.**
- `fixture` — replays a recorded extraction keyed by `sha256(input)`. Offline and
  byte-reproducible.

Record a real extraction once credentials exist:

```bash
pnpm founderos context import notes/call.md --record
```

That writes the model's actual output to `test/fixtures/extractions/<hash>.json`,
which then becomes a regression fixture for free.

The fixtures shipped today are **hand-authored, not captured from a model** — see
`test/fixtures/extractions/README.md`. They exist to exercise every disposition,
including the two that must fail.

## What is not here

No web UI, no database, no integrations — out of scope for this phase. No
interactive y/n prompt either: `--apply` is the approval, which keeps every path
scriptable and testable.
