# FounderOS — Vision

## The hypothesis

> A founder using FounderOS makes better decisions than the same founder asking the same question in a blank GPT/Claude chat.

Everything in this repo exists to prove or disprove that sentence. If a component
can't be shown to move that needle, it gets deleted.

## Why it could be true

A blank chat has no memory of the company, no idea which question matters this
week, no opinion, and no incentive to disagree with the founder. It is optimized
to be helpful in the moment. Founders don't need help in the moment; they need
help not spending three months on the wrong thing.

FounderOS adds four things a blank chat structurally cannot have:

1. **Persistent structured context** — the company, the goals, the numbers, the
   people, and every past decision with its assumptions.
2. **Procedure** — a skill is a checklist a good advisor would follow, not vibes.
3. **Sourced expert knowledge** — principles with citations, not "act like Paul Graham".
4. **An adversarial pass** — something whose job is to attack the answer before
   the founder sees it.

## Why it could be false

The frontier models are very good. It's entirely possible that pasting a
one-page company summary into Claude gets 90% of the value. **This is the null
hypothesis and we take it seriously.** The eval harness (`docs/evals.md`)
includes a "vanilla + context dump" arm specifically to try to kill the project.
If FounderOS only beats a blank chat but not a context-dump chat, the answer is
to cut FounderOS down to a context-dump generator, not to add more layers.

## What FounderOS is not

- Not a chatbot. Sessions are cheap; the artifacts (decisions, learnings) are the product.
- Not a replacement for frontier models. It is a harness around one.
- Not a multi-agent framework. One strong model, called at most three times per query.
- Not a CRM/notes app. It reads structured context; it does not aspire to be where you write everything down.

## Principles (operative, not aspirational)

1. **No complexity without measurable improvement.** Every layer ships behind a
   flag so an eval can measure it with and without. Layers that don't win get removed.
2. **Grounded or labelled.** Any claim attributed to an expert cites a principle
   ID that exists in the repo. Anything else is explicitly marked as inference.
3. **Answers end in an action.** A recommendation without a next action is a failure.
4. **Question the question.** The system may respond that the asked question is
   not the highest-leverage one — but it must still answer what was asked.
5. **Everything is a file.** Skills, experts, context, traces, evals. Diffable,
   reviewable, greppable, PR-able. This is what makes it open-source-friendly.
6. **YAGNI, aggressively.** See `docs/architecture.md` for the list of things in
   the original brief that we deliberately did not build.

## Definition of done for V0

A founder puts their company into `context/`, runs `founderos ask "where should I
focus this week?"`, and gets top-3 priorities, what to ignore, the biggest
unresolved uncertainty, and a next action — with a trace on disk and an eval
score against vanilla GPT and Claude.
