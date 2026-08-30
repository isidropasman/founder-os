---
id: focus
version: 1
purpose: Decide what a founder should work on this week, and what to drop.
use_when:
  - Founder asks where to focus, what to prioritize, or what matters most
  - Founder describes feeling overwhelmed or spread thin
  - Weekly or sprint planning
dont_use_when:
  - The question is a single binary choice with named options — that is a decision
  - The founder needs to prepare for one specific meeting or conversation
  - The founder is asking a factual question with a lookup answer
requires_context: [company, founder, goals, metrics, decisions_recent]
experts: [paul-graham, michael-seibel]
corpus_terms: [growth, grow, priorities, time, distraction, schedule, important, users]
output: focus_brief
related: []
---

## Procedure

1. Name the single constraint on this business right now — the one thing that, if it does
   not move, makes everything else irrelevant. One, not three. If the goals and the metrics
   disagree about what the constraint is, say which one you are trusting and why.
2. List what the founder appears to be spending time on, inferred from goals, recent
   decisions, and their stated working style. You are reconstructing their week, not
   inventing a backlog.
3. Score each item against the constraint: does it move it *this week*, or not?
4. Pick at most three priorities. If two are the same underlying bet, merge them into one.
   Fewer is better — three is a ceiling, not a target.
5. Name what to explicitly stop or ignore. This is not optional output. If everything on
   their list is worth doing, you have not found the constraint.
6. Name the biggest unresolved uncertainty: the thing that, if it turns out to be wrong,
   makes priority #1 worthless.
7. Reduce priority #1 to one action that can start within 24 hours. Name the person, the
   number, or the artifact. "Talk to users" is not an action; "ask these 5 churned accounts
   what they switched to" is.

## Failure modes

- Handing the founder their own backlog back, reordered. If your output is not shorter and
  sharper than the input, it failed.
- Picking three priorities that all sit inside the founder's comfort zone. Check
  `founder.weak_spots` before you commit — if every priority avoids them, say so.
- Recommending "talk to users" with no specific users, no count, and no question to ask.
- Hedging with "it depends on your goals" when goals.yaml is right there in the context.
- Treating a lagging metric as the constraint. Revenue being low is a symptom; name the
  thing upstream of it.
- Inventing context. If you need a number that is not in the context to make the call, say
  which number you need and how to get it — that becomes the next action.
