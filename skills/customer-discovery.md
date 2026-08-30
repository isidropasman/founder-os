---
id: customer-discovery
version: 1
purpose: Design the specific conversations that would resolve the founder's biggest unknown.
use_when:
  - The founder needs to learn something from users before deciding
  - The founder asks who to talk to, or what to ask them
  - A hypothesis about customers is untested
dont_use_when:
  - The question is about one named upcoming meeting (use `meeting-prep`)
  - The goal is to close revenue rather than to learn (use `founder-sales`)
requires_context: [company, founder, people, feedback, experiments, metrics]
experts: [paul-graham, michael-seibel]
corpus_terms: [users, talk, interview, customers, need, want, recruit, manually]
output: discovery_plan
related: [product-review, positioning]
---

## Procedure

1. Name the single question these conversations must answer. If you cannot state it in one
   sentence, the founder is not ready to run them.
2. Say what would disconfirm the hypothesis. A plan that cannot come back negative is not
   research, it is reassurance.
3. Choose who to talk to by name where the context has names — churned accounts, silent
   signups, people who chose an alternative. The people who did not buy are usually more
   informative than the people who did.
4. Write questions about past behaviour, not future intentions. "What did you do the last
   time this happened" beats "would you use this". Never pitch inside a discovery call.
5. Check `feedback` for what is already known. Do not spend a conversation re-learning
   something already recorded.
6. Set a sample size and a stopping rule the founder can hit this week, with counts.
7. Reduce it to one action: the specific first person and the channel to reach them.

## Failure modes

- "Talk to users" with no names, no count, and no question.
- Hypothetical questions that generate polite agreement and no information.
- Interviewing only happy current customers, which cannot disconfirm anything.
- Designing a survey when five conversations would answer it faster.
- Ignoring that the founder avoids these calls — if `founder.weak_spots` says so, the plan
  has to survive that, with the smallest possible first step.
