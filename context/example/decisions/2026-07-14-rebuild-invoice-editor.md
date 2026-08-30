---
id: d-2026-07-14-rebuild-invoice-editor
date: 2026-07-14
question: Should we rebuild the invoice editor before fixing onboarding?
options:
  - Rebuild the invoice editor
  - Fix the onboarding flow first
  - Do neither and go do sales
decision: Rebuild the invoice editor
confidence: 0.5
review_date: 2026-09-14
assumptions:
  - text: Customers churn because the editor feels slow and dated
    confidence: 0.4
    how_to_test: Ask five churned accounts what they switched to and why
  - text: A rebuild takes three weeks
    confidence: 0.6
    how_to_test: Timebox one week and check the burn-down
evidence:
  - claim: Marcus complained the editor is slow
    source: email-2026-07-02
expert_citations: []
next_action: Start the editor rebuild
status: open
outcome: null
learning: null
---

Marcus's email landed the same week signups flattened, and it felt like the obvious thing to
fix. Nobody has actually asked the churned accounts why they left.
