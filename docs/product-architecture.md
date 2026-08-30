# Product architecture

Written after the first interface failed. Not the code architecture — that is in
`architecture.md`. This is about what a founder experiences, and it is where the
project was actually broken.

## What was wrong

The code was fine. The product was incoherent, in three specific ways.

**1. You land in someone else's company.** The app opens onto `context/example` —
Acme, a fictional invoicing startup. There is no way in from your own company and
no indication that setup is even a thing. A founder's first thirty seconds are
spent working out that none of this is about them.

**2. You cannot tell who is talking.** This is the worst of the three. The entire
engineering effort went into provenance — quotes located in real documents, claim
ids that resolve, citations validated against what was actually retrieved — and
the interface reduced all of it to a grey line of ids at the bottom of the page.
So the honest question *"where is this coming from, who is suggesting this"* has
no answer on screen. A recommendation with invisible provenance is
indistinguishable from a chatbot's opinion, which means the product's whole claim
is invisible.

**3. There is no loop.** Four screens that each do a thing, with nothing telling
you what to do next or what you would get if you did. Nothing says: put your
numbers in and this headline becomes about *you*.

## What the product actually is

> A second opinion that shows its work.

Not a chatbot with context. Not a dashboard. The distinguishing feature is that
every sentence can be traced to one of exactly four things, and the founder can
see which:

| Basis | Means | Checkable by |
|---|---|---|
| **Your data** | A number or fact you recorded | Pointing at the field |
| **A source** | A passage from a real document | Reading the passage |
| **A rule** | Deterministic logic over your record | Reading the rule |
| **Inference** | The model's own judgment | Nothing — and it must say so |

The fourth is the important one. Most tools blur inference into the other three.
Marking it explicitly is what makes the other three trustworthy.

## Three questions, three screens

Everything the founder can do reduces to three questions. If a screen does not
answer one of them, it should not exist.

**1. What does it know about me?** → Company
Every fact, and where it came from: typed by you, or imported from a note (with
the sentence that produced it).

**2. What should I do?** → Today, and Ask
Today is the standing answer, derived by rule, free. Ask is the considered answer.

**3. Why should I believe it?** → attribution inline, everywhere
Not a footnote. Each claim carries its basis where you read it, and every id is
clickable through to the passage or the field.

The Library is not a fourth question — it is the evidence layer for the third,
browsable on its own.

## The loop

```
   set up ──► Today tells you the one thing ──► Ask thinks it through
      ▲                                                │
      └──────── record what happened ◄─────────────────┘
                 (decision, outcome, learning)
```

Setup is not a one-time wall; it is the first turn of this loop. The founder
should reach a useful Today screen having answered about fifteen questions, and
everything after that gets added by talking.

## Setup, as five questions that each buy something

The failure mode of onboarding is asking for everything before giving anything.
Each step here is short, and states what it unlocks — because a founder should
never be filling in a field without knowing why.

| Step | Asks | Unlocks |
|---|---|---|
| 1. Company | Name, one line, stage, who buys, what you charge | Advice stops being generic; every answer is anchored to your buyer |
| 2. Numbers | The three you would check first if things felt wrong | Rules can watch them. A number drifting from a goal becomes your headline |
| 3. Goals | What you are trying to do, each tied to a number | A goal with no number attached gets flagged, not silently ignored |
| 4. You | What you avoid, what you over-index on | The challenger uses it to catch advice that sits inside your comfort zone |
| 5. This week | Paste notes, calls, anything | Everything else fills itself in |

Step 4 is the one no other tool asks. It is also the one that makes the
challenger work: without `weak_spots`, "talk to more customers" is advice; with
it, "you have rescheduled this call twice, here is the smallest version of it" is
a second opinion.

Nothing is mandatory. A workspace with only step 1 is usable; the app says what
is missing and what it would be able to do if you filled it in.

## Attribution, concretely

Today the output schemas carry `expert_citations` — a bag of ids at the document
level. That is why the interface could only render a footnote. The fix is
structural: **basis moves onto the claim**.

```
priorities: [{
  what:  "Call five churned accounts before Friday"
  why:   "Your own decision doc rates 'churn is the editor' at 0.4"
  basis: ["decisions.d-2026-07-14.assumptions[0]", "paul-graham/ds#0002"]
}]
```

Which renders, inline, under the claim:

```
  Your data · decision from 14 Jul, assumption at 0.4 confidence
  Paul Graham · Do Things that Don't Scale
```

Validation already exists for source ids and extends naturally to data refs: a
path that does not resolve in the selected context fails the run, exactly as an
invented principle id does today. An unsupported claim must carry `inference` and
render as *the model's own judgment* — visibly weaker than the rest.

## What this changes

- **Output schemas**: `basis` per claim; `expert_citations` becomes derived.
- **Validation**: data refs resolve against the selected context, or the run fails.
- **Interface**: attribution renders under each claim, not at the foot of the page.
- **A setup route** that writes real files and can be resumed.
- **First-run detection**: an empty workspace sends you to setup instead of
  showing you a stranger's company.

## What this does not change

Startup Memory stays filesystem-backed. The knowledge base stays Postgres. The
pipeline stays route → reason → challenge. None of the three complaints were
about those, and rebuilding them would be motion rather than progress.
