# FounderOS — the founder's guide

You do not need to read the architecture docs to use this. This page is the whole
product in one place.

## What it is

A frontier model, wrapped in four things a blank chat cannot have:

1. **Your company, structured** — goals, metrics, people, feedback, experiments,
   and every decision you have made with its assumptions and review date.
2. **Procedures** — nine skills, each a checklist a good advisor would follow.
3. **A corpus** — 224 Paul Graham essays, 2800 verbatim passages, retrieved per
   question and cited by id. Nothing is quoted that is not in a real document.
4. **A challenger** — a second pass whose only job is to attack the answer before
   you see it.

## Day one: fifteen questions

```bash
pnpm dev        # then open /setup
```

Four steps, each stating what it buys you:

| Step | Asks | Unlocks |
|---|---|---|
| Your company | Name, one line, stage, who buys, what you charge | Advice stops being generic |
| Your numbers | The three you would check first if things felt wrong | Rules start watching them |
| Your goals | What you are trying to do, each tied to a number | A goal with no number gets flagged |
| You | What you avoid, what you over-index on | The challenger catches advice inside your comfort zone |

Nothing is mandatory and you can stop after step one — the app says what is still
missing and what it would be able to do if you filled it in.

The last step is the one no other tool asks. Without `weak_spots`, "talk to more
customers" is advice. With it, "you have moved this call twice; here is the
smallest version of it" is a second opinion.

Prefer files? `founderos init ~/my-company` scaffolds the same thing as commented
YAML.

Everything else goes in by talking:

```bash
founderos context add "Call with Priya. She said onboarding is confusing and gave
up before sending an invoice. MRR is 3620 now."
```

You get a preview. Nothing is written until you pass `--apply`.

## Without an API key

`founderos ask --offline` answers with no model at all:

- the blocking findings from your own context
- the skill's procedure, as a checklist you walk yourself
- where that skill usually goes wrong
- the relevant principles, with the author's verbatim words
- passages retrieved from the corpus

It runs automatically when no key is set. This is not a consolation prize: a
model's imitation of Paul Graham is worse evidence than Paul Graham's actual
sentences. What you lose is synthesis and the challenger — real losses, but not
the whole product.

## Every day: two commands

```bash
founderos status
```

Rule-based, no model, costs nothing. It tells you what is overdue, unmeasured, or
unreviewed: a decision past its review date, a goal with no metric behind it, a
metric moving away from its target, an assumption you never tested, an investor
with an open thread and three weeks of silence.

```bash
founderos ask "Where should I focus this week?"
```

The full pipeline. Roughly two minutes and a few cents.

## Capturing the week without typing YAML

Drop notes — call transcripts, meeting scribbles, a voice memo transcription —
into `~/my-company/inbox/` as `.md` or `.txt`, then:

```bash
founderos context ingest            # preview everything unprocessed
founderos context ingest --apply --archive
```

FounderOS classifies each note, extracts people, feedback, metrics, meetings and
decisions, deduplicates against what it already knows, and shows you a diff. Three
guarantees:

- **It never overwrites what you wrote** without `--overwrite`.
- **It rejects anything it cannot quote from your note.** If the extractor writes
  "she said the price is too high" and your note never says that, it is thrown out.
- **Low confidence is held, not guessed.** "I think we should stop the redesign but
  I want to sleep on it" is not a decision; it goes to `unresolved.yaml`.

## The nine skills

The router picks one. You can force it with `--skill`.

| Skill | Ask it when |
|---|---|
| `focus` | What should I work on this week? |
| `decision` | Should we do A or B? |
| `pricing` | What should we charge? |
| `positioning` | Who is this for, and against what alternative? |
| `customer-discovery` | Who should I talk to, and what do I ask? |
| `founder-sales` | How do I get customers when I am the only seller? |
| `product-review` | Is this ready to ship? |
| `meeting-prep` | What do I prepare for this specific conversation? |
| `learning` | That experiment ended — what do I take from it? |

## Reading an answer

```
CONSTRAINT            The one thing limiting the business. One, not three.
PRIORITIES            At most three, each marked whether it moves the constraint.
IGNORE                What to drop. Never empty — if everything matters, the
                      constraint was not found.
BIGGEST UNCERTAINTY   What, if wrong, makes priority #1 worthless.
NEXT ACTION           One thing, startable in 24 hours, with a name or a number.
confidence 0.72  ·  grounded in paul-graham/P5, paul-graham/ds#0002
? A question back     Asked instead of hedging across two branches.
CHALLENGER            The verdict and the single strongest objection.
```

## Who is suggesting this

Every claim carries its basis, shown under the claim rather than as a footnote:

```
Call five churned accounts before Friday
  YOUR DATA  decision from 14 Jul — confidence 0.5
  SOURCE     Paul Graham · Do Things that Don't Scale
```

Four kinds, and the fourth is the important one:

| | Means |
|---|---|
| **Your data** | A number or fact you recorded |
| **Source** | A passage from a real document |
| **Rule** | Deterministic logic over your record |
| **Its own judgment** | Nothing behind it — and it says so |

Most tools blur inference into the other three. Marking it explicitly is what
makes the other three worth trusting. A basis that resolves to nothing fails the
run, exactly like an invented quote.

Every id resolves. `paul-graham/P5` is a curated principle; `paul-graham/ds#0002`
is a verbatim passage. Look either up:

```bash
founderos knowledge search "recruit users manually"
```

## Searching the corpus directly

```bash
founderos knowledge search "the best startup ideas seem like bad ideas"
founderos knowledge search "make a few users love you" --kind framework
founderos knowledge search "growth rate" --author paul-graham --limit 5
```

Free — lexical search needs no model. `--semantic` adds vector search once
embeddings exist.

## What it will not do

- **It will not invent a quote.** Every quoted principle is checked against the
  fetched document, and the build fails if it cannot be located. The first draft of
  the Paul Graham pack had 9 wrong quotes out of 20 candidates; all 9 were caught
  by that gate before reaching the repo.
- **It will not pretend to know your numbers.** If the context lacks the number
  that would decide something, it says which number and makes getting it the action.
- **It will not agree with you to be pleasant.** The challenger flags priorities
  that sit conveniently inside your comfort zone, using your own `weak_spots`.

## Honest limits, today

- **Retrieval is lexical only, and this genuinely bites.** Ask about raising
  prices and you get essays about raising money, because to a keyword index those
  are the same question. Two fixes were tried and rejected as dishonest heuristics
  (prefix stemming matched "value" to "valuation"; requiring both queries to agree
  did not help, because *How to Raise Money* legitimately ranks on price and
  value). Semantic embeddings are the real fix and need an OpenAI key. Until then
  every passage list carries that warning inline — read the titles.
- **Only one author has a real corpus.** Paul Graham. The Michael Seibel pack is
  paraphrase-only and marked `confidence: low`, because the YC library is a
  client-rendered app that yields no fetchable text. Nothing was invented to fill
  the gap.
- **Nothing here is proven better than a good prompt yet.** The eval suite that
  measures that — FounderOS against pasting your whole context into Claude — is
  built and has not been run. See `docs/v0-validation.md`.

## Adding your own experts

Anyone can. See `docs/contributing.md`: fetch sources, run `knowledge sync`, write
principles with real quotes, and `pnpm knowledge:verify` refuses anything it cannot
find in the document.
