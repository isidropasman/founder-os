---
id: some-author                 # must equal the filename
name: Some Author
version: 1
domains: [pricing, positioning] # what the router matches against
confidence: medium              # high | medium | low — how well-sourced THIS pack is
limitations:
  # Where this author's advice does not transfer. Be specific; this is injected
  # into the reasoning prompt and it is what stops over-application.
  - B2B software only; weak signal for consumer
sources:
  - title: The Document
    url: https://example.com/doc
    year: 2019
---

### P1 — Short imperative title
Claim: The principle in your own words. One or two sentences.
Source: some-author/doc — quoted: "the verbatim text, which must exist in the corpus"
Applies when: The situations where this should be brought to bear
Conflicts with: another-author/P3

### P2 — A principle you cannot source verbatim
Claim: ...
Source: Some talk title — paraphrase
Applies when: ...
Conflicts with: —

### F1 — A named procedure
When to use: The situation this framework is for.
Source: some-author/doc
Steps:
1. First step.
2. Second step.

<!--
RULES, enforced by `pnpm knowledge:verify`:

- `quoted:` REQUIRES a corpus source id (`<author>/<slug>`) that exists in
  knowledge/sources/<author>/manifest.yaml, AND the quote must be findable in the
  fetched document. Whitespace, curly quotes and dashes are normalized for you;
  the words must match.
- `paraphrase` may cite free text. It is reported as an unverifiable warning,
  which is the honest label for it.
- A principle with no Source at all is rejected at load time.
- Principle ids are append-only. Never renumber: traces and decision records
  reference them.
-->
