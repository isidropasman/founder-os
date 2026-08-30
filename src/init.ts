import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Scaffolding, not an importer. There is no Notion/CRM integration here on
 * purpose: the fastest path to a real workspace is a founder filling in eight
 * commented files, and every integration we could guess at would be speculative.
 */
const TEMPLATES: Record<string, string> = {
  'company.yaml': `name:
one_liner: # What you do, in the words a customer would use
stage: seed # idea | pre-seed | seed | series-a+
business_model: # b2b-saas | marketplace | consumer | services
icp: # Who specifically buys. "Marketing teams" is too vague to be useful.
pricing: # Actual current price and structure
runway_months: 0
team_size: 0
# The real limits. Not aspirations — what is actually true about your capacity.
constraints: []
`,
  'founder.yaml': `name:
role: ceo
strengths: []
# Be honest here. This is what stops FounderOS recommending only what you enjoy.
weak_spots: []
known_biases: []
working_style: # Real hours, real calendar shape
`,
  'goals.yaml': `# Every goal needs a metric that appears in metrics.yaml, or it cannot be checked.
- id: g-example
  statement:
  horizon: 2026-12-31
  metric:
  target: 0
  status: active # active | achieved | abandoned
`,
  'metrics.yaml': `# Only numbers you actually have. A missing metric is more useful than a guessed one.
- name:
  value: 0
  as_of: 2026-01-01
  trend: flat # up | flat | down
  source: # stripe | posthog | founder_notes — where this came from
`,
  'people.yaml': `- id: p-example
  name:
  role:
  org:
  relationship: customer # investor | customer | advisor | candidate | team
  last_touch: 2026-01-01
  notes: # What they asked for, what they objected to, what you promised
`,
  'feedback.yaml': `# Verbatim only. Paraphrasing here destroys the evidence value.
- id: fb-example
  date: 2026-01-01
  person_id: null # or a people.yaml id
  channel: call # call | email | support | survey | churn-interview | sales-call
  verbatim:
  theme:
  sentiment: neutral # positive | neutral | negative
`,
  'experiments.yaml': `# An experiment without a prediction produces a story, not a learning.
- id: exp-example
  hypothesis:
  method:
  metric:
  started: 2026-01-01
  ends: 2026-01-31
  status: running # running | concluded | abandoned
  result: null
  learning: null
`,
  'meetings.yaml': `- id: mtg-example
  date: 2026-01-01
  person_id: null
  purpose:
  outcome: null
  open_threads: []
`,
}

export type InitReport = { created: string[]; skipped: string[] }

export function initWorkspace(root: string): InitReport {
  mkdirSync(join(root, 'decisions'), { recursive: true })
  const created: string[] = []
  const skipped: string[] = []

  for (const [file, body] of Object.entries(TEMPLATES)) {
    const path = join(root, file)
    if (existsSync(path)) {
      skipped.push(file)
      continue
    }
    writeFileSync(path, body)
    created.push(file)
  }

  return { created, skipped }
}
