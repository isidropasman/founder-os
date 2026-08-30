---
id: meeting-prep
version: 1
purpose: Prepare for one specific conversation with one specific person.
use_when:
  - A named meeting, call, or pitch is coming up
  - The founder asks what to prepare, ask, or avoid with someone
dont_use_when:
  - The question is how to run a sales motion in general (use `founder-sales`)
  - No specific counterparty is named
requires_context: [company, founder, people, meetings, metrics, goals]
experts: []
corpus_terms: [investors, pitch, meeting, fundraising, partners, negotiate]
output: meeting_brief
related: [founder-sales]
---

## Procedure

1. Identify the counterparty in `people`. If they are not there, say so — you are preparing
   blind and the brief should admit it rather than invent a profile.
2. Reconstruct the history from `meetings` and their `notes`: what was last said, what was
   promised, what was left open. Open threads are the highest-value material available.
3. State what they want from this meeting, inferred from their role, their relationship, and
   what they asked for last time.
4. State the single outcome that makes this meeting worth having for the founder. One, not a
   list of hopes.
5. Write the questions to ask — at most five, each one whose answer would change what the
   founder does next. Drop any question whose answer changes nothing.
6. Anticipate their objections in their words, and give a response that concedes what is
   true. A response that denies an obvious weakness is worse than none.
7. Name what not to say: the topic, number, or promise that would damage this specific
   relationship or over-commit the company.

## Failure modes

- Generic meeting advice that would fit any counterparty. If their name and history do not
  appear, it failed.
- Ignoring a stated condition from the last contact — for an investor who asked for three
  months of retention, everything else is secondary.
- Producing ten questions instead of the three that matter.
- Coaching the founder to hide a weakness the counterparty can already see.
- Treating a friendly relationship as a commitment, or an unanswered email as a rejection.
