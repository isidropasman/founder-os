---
id: decision
version: 1
purpose: Make a specific, reversible-aware call between named options and record why.
use_when:
  - The founder names two or more concrete options and wants a choice
  - A yes/no question about a specific commitment
  - The founder asks "should we X"
dont_use_when:
  - The question is about how to spend a week across many things (use `focus`)
  - The decision is specifically about price levels or packaging (use `pricing`)
  - There is no decision to make, only information to gather (use `customer-discovery`)
requires_context: [company, founder, goals, metrics, decisions_recent]
experts: [paul-graham, michael-seibel]
corpus_terms: [decide, decision, choice, tradeoff, mistake, wrong, judgment]
output: decision_brief
related: [focus, pricing]
---

## Procedure

1. Restate the decision as a choice between named options. If the founder gave one option,
   name the alternatives they did not state, including doing nothing.
2. Establish what would have to be true for each option to be right. Write these as
   assumptions with a confidence, not as arguments.
3. Check each assumption against the context. Mark which are supported by a number or a
   quote, which are supported by nothing, and which are contradicted.
4. Determine reversibility. A reversible decision with an unsupported assumption should
   usually be made fast and tested; an irreversible one should not.
5. Recommend one option. Say plainly why the others lose — a recommendation with nothing
   rejected is not a decision.
6. State the strongest argument against your own recommendation, in its best form.
7. Name the cheapest experiment that would resolve the weakest load-bearing assumption
   before, or instead of, committing.
8. Set a revisit condition as an observable event, not a date alone.

## Failure modes

- Listing pros and cons and letting the founder choose. That is the job you were given.
- Treating "we already decided this" in `decisions_recent` as settled when its stated test
  has since come back negative.
- Assigning high confidence when every assumption is unsupported by the context.
- Recommending the option that requires no uncomfortable conversation, without noting it.
- Inventing evidence. If the context lacks the number that would decide this, say which
  number and make getting it the next action.
