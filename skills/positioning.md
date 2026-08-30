---
id: positioning
version: 1
purpose: Decide which market a product competes in, for whom, and against what alternative.
use_when:
  - Customers do not understand what the product is or who it is for
  - Feedback conflicts across segments
  - The founder is choosing a segment, category, or message
dont_use_when:
  - The question is what to charge (use `pricing`)
  - The product does not work yet (use `product-review`)
requires_context: [company, founder, metrics, feedback, people, goals]
experts: []
corpus_terms: [market, segment, customers, competitors, niche, category, differentiate]
output: positioning_brief
related: [pricing, customer-discovery]
---

## Procedure

1. Identify the competitive alternative: what the buyer would genuinely do instead, including
   a spreadsheet, an intern, or nothing. Everything else is derived from this.
2. Segment the evidence. Where `metrics` or `feedback` differ by segment, treat retention and
   expansion — not headcount or revenue — as the signal for which segment fits.
3. List the attributes the product has that the alternative does not. Attributes only, not
   benefits yet.
4. Translate each attribute into the value it delivers to the chosen segment. An attribute
   with no value for that segment is noise and should be dropped from the story.
5. Name the market category the buyer already has in their head. Inventing a category is
   expensive and almost never correct at this stage.
6. Write one sentence a real customer would recognize as true. Not aspirational.
7. State who this is explicitly not for. A positioning that excludes nobody positions nothing.

## Failure modes

- Choosing the segment with the most customers rather than the best retention.
- Inventing a new category to avoid a difficult comparison.
- A statement full of adjectives that any competitor could also claim.
- Averaging across conflicting segments into a message that fits none of them.
- Confusing a large one-off deal with segment evidence.
