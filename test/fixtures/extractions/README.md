# Recorded extractions

Each file is keyed by `sha256(input text)` and replayed by the `fixture` extractor
(`FOUNDEROS_EXTRACTOR=fixture`), which makes every stage after extraction —
classification, dedup, conflict detection, preview, merge — testable and
reproducible with no API key.

**These are hand-authored, not captured from a real model.** No model has ever run
against this repo. They are written to exercise every disposition the planner can
produce, including two that must fail:

- `fb-invented` in `c8771fad….json` carries a quote that does not appear in the
  source note. The quote gate must reject it.
- `d-2026-08-14-stop-redesign` sits at confidence 0.35, below the threshold, and
  must be held as unresolved rather than merged.

Record a real one once credentials exist:

```bash
pnpm founderos context import notes/some-call.md --record
```

That writes the model's actual output here, keyed by the same hash, and it will
replace the hand-authored file for that input.
