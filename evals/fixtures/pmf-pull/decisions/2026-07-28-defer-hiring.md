---
id: d-2026-07-28-defer-hiring
date: 2026-07-28
question: Should we hire a support engineer now or after the enterprise feature ships?
options:
  - Hire now
  - Hire after the enterprise feature ships
  - Do not hire, automate support instead
decision: Hire after the enterprise feature ships
confidence: 0.5
review_date: 2026-09-30
assumptions:
  - text: Support load will stay manageable for another two months
    confidence: 0.35
    how_to_test: Track median response time weekly; if it passes 24h the assumption is dead
evidence:
  - claim: Median support response was 14 hours in June
    source: intercom-export-2026-06
expert_citations: []
next_action: Revisit at the end of September
status: open
outcome: null
learning: null
---

Decided during a week when support felt quiet. Response time has since doubled.
