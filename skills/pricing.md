---
id: pricing
version: 1
purpose: Decide what to charge and how to package it, grounded in the alternative the buyer has.
use_when:
  - The founder asks whether to raise, lower, or restructure prices
  - Packaging, tiers, or discount policy questions
  - The founder suspects they are too cheap or too expensive
dont_use_when:
  - The real question is who the customer is (use `positioning`)
  - Nobody is buying at any price (use `customer-discovery`)
requires_context: [company, founder, goals, metrics, feedback, decisions_recent]
experts: []
corpus_terms: [price, pricing, charge, cheap, expensive, revenue, customers, value, willingness]
output: decision_brief
related: [positioning, decision]
---

## Procedure

1. Establish what the buyer does instead of buying — the competitive alternative, including
   doing nothing and doing it manually. Price is anchored there, not on cost.
2. Check whether price is actually the constraint. If activation, retention or demand is
   broken, a price change moves almost nothing. Say so and stop if that is the case.
3. Look for price signal already in the context: churn reasons in `feedback`, discount
   requests, deals lost, expansions taken. Quote them. Absence of complaints about price is
   evidence too, and usually means the price is too low.
4. Separate the decision into level (how much) and structure (per what, which tiers).
   Structure changes are usually higher leverage and lower risk than level changes.
5. Recommend a specific number or structure. "Consider raising prices" is not an output.
6. Prefer the cheapest reversible test: new customers only, one segment, one quarter.
   Grandfathering existing accounts turns an irreversible move into a reversible one.
7. State what you expect to happen and what result would prove you wrong.

## Failure modes

- Recommending a price with no reference to what the buyer would otherwise do.
- Cost-plus reasoning in a software business.
- Raising prices as a substitute for fixing activation or retention.
- Proposing a full repackaging when a single reversible experiment would answer the question.
- Ignoring that the founder's discomfort with the conversation, not the market, may be the
  real constraint — check `founder.weak_spots`.
