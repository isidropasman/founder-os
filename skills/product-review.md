---
id: product-review
version: 1
purpose: Judge whether a product or feature is ready, and what to fix before it ships.
use_when:
  - The founder asks whether something is ready to ship
  - A feature, flow, or release needs a critical read
  - The founder wants to know what is wrong with the product
dont_use_when:
  - The question is what to build next (use `focus` or `customer-discovery`)
  - The concern is how it is described rather than what it does (use `positioning`)
requires_context: [company, founder, metrics, feedback, goals]
experts: [paul-graham]
corpus_terms: [product, design, users, build, ship, launch, quality, simple]
output: review_brief
related: [focus, customer-discovery]
---

## Procedure

1. Establish what this product is supposed to do for whom, from `company.icp` and the goals.
   Review against that, not against general craft.
2. Find the evidence already in the context: activation and retention numbers, and verbatim
   `feedback`. Real user words outrank opinion, including yours.
3. Identify problems and grade each one: blocker (users cannot succeed), major (users succeed
   but churn or complain), minor (cosmetic). Every problem needs its evidence attached.
4. Say what works and should not be touched. A review that only lists problems invites a
   rewrite of things that were fine.
5. Name what is explicitly not worth fixing now, and why. This is required output.
6. Give a verdict: ship, fix-first, or rethink. "Rethink" means the thing solves a problem
   users do not have — say that plainly rather than listing UI fixes.
7. Name the biggest uncertainty: the thing you could not judge from the context, and what
   would resolve it.

## Failure modes

- Reviewing craft when the evidence says the problem is demand.
- Listing every imperfection at equal weight, so nothing is prioritized.
- Recommending a redesign when the numbers point at onboarding or activation.
- Opinion presented as finding, with no `feedback` or metric behind it.
- Missing that a loud complaint from a large customer may be less important than a silent
  pattern across many small ones.
