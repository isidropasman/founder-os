import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { z } from 'zod'

export const CONTEXT_KEYS = [
  'company',
  'founder',
  'goals',
  'metrics',
  'people',
  'feedback',
  'experiments',
  'meetings',
  'decisions_recent',
  'decisions_all',
] as const

export type ContextKey = (typeof CONTEXT_KEYS)[number]

export const ContextKeySchema = z.enum(CONTEXT_KEYS)

/** YAML parses bare `2026-08-01` into a Date; normalize back to an ISO day at the border. */
const DateString = z
  .union([z.string(), z.date()])
  .transform((value) => (typeof value === 'string' ? value : value.toISOString().slice(0, 10)))

const Company = z.object({
  name: z.string(),
  one_liner: z.string(),
  stage: z.enum(['idea', 'pre-seed', 'seed', 'series-a+']),
  business_model: z.string(),
  icp: z.string(),
  pricing: z.string(),
  runway_months: z.number(),
  team_size: z.number(),
  constraints: z.array(z.string()).default([]),
})

// Setup is incremental by design: a workspace with only step 1 must still work.
// Requiring these made a half-finished setup crash instead of degrade.
const Founder = z.object({
  name: z.string().default(''),
  role: z.string().default(''),
  strengths: z.array(z.string()).default([]),
  weak_spots: z.array(z.string()).default([]),
  known_biases: z.array(z.string()).default([]),
  working_style: z.string().default(''),
})

const Goal = z.object({
  id: z.string(),
  statement: z.string(),
  horizon: DateString,
  metric: z.string(),
  target: z.number(),
  status: z.enum(['active', 'achieved', 'abandoned']),
})

const Metric = z.object({
  name: z.string(),
  value: z.number(),
  as_of: DateString,
  trend: z.enum(['up', 'flat', 'down']),
  source: z.string(),
})

const Person = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  org: z.string(),
  relationship: z.enum(['investor', 'customer', 'advisor', 'candidate', 'team']),
  last_touch: DateString,
  notes: z.string(),
})

const Feedback = z.object({
  id: z.string(),
  date: DateString,
  person_id: z.string().nullable().default(null),
  channel: z.enum(['call', 'email', 'support', 'survey', 'churn-interview', 'sales-call']),
  verbatim: z.string(),
  theme: z.string(),
  sentiment: z.enum(['positive', 'neutral', 'negative']),
})

const Experiment = z.object({
  id: z.string(),
  hypothesis: z.string(),
  method: z.string(),
  metric: z.string(),
  started: DateString,
  ends: DateString,
  status: z.enum(['running', 'concluded', 'abandoned']),
  result: z.string().nullable(),
  learning: z.string().nullable(),
})

const Meeting = z.object({
  id: z.string(),
  date: DateString,
  person_id: z.string().nullable().default(null),
  purpose: z.string(),
  outcome: z.string().nullable(),
  open_threads: z.array(z.string()).default([]),
})

export const DecisionSchema = z.object({
  id: z.string(),
  date: DateString,
  question: z.string(),
  options: z.array(z.string()),
  decision: z.string(),
  confidence: z.number().min(0).max(1),
  review_date: DateString,
  assumptions: z.array(
    z.object({ text: z.string(), confidence: z.number(), how_to_test: z.string() }),
  ),
  evidence: z.array(z.object({ claim: z.string(), source: z.string() })).default([]),
  expert_citations: z
    .array(z.object({ principle_id: z.string(), kind: z.enum(['quoted', 'inferred']) }))
    .default([]),
  next_action: z.string(),
  status: z.enum(['open', 'reviewed']),
  outcome: z.string().nullable(),
  learning: z.string().nullable(),
})

export type Decision = z.infer<typeof DecisionSchema>

const RECENT_DECISION_COUNT = 5

export type Workspace = {
  root: string
  hash: string
}

function readYaml<T>(root: string, file: string, schema: z.ZodType<T>): T {
  const path = join(root, file)
  const parsed = schema.safeParse(parseYaml(readFileSync(path, 'utf8')))
  if (!parsed.success) {
    throw new Error(`${path} failed validation:\n${parsed.error.issues.map(formatIssue).join('\n')}`)
  }
  return parsed.data
}

/**
 * A workspace that has no meetings yet is legitimate; a request for a context key
 * that does not exist is not. Missing list files therefore read as empty, while an
 * unknown key still fails loudly in `selectContext`.
 */
function readList<T>(root: string, file: string, schema: z.ZodType<T>): T[] {
  if (!existsSync(join(root, file))) return []
  return readYaml(root, file, z.array(schema))
}

function formatIssue(issue: z.ZodIssue): string {
  return `  ${issue.path.join('.') || '(root)'}: ${issue.message}`
}

function decisionFiles(root: string): string[] {
  const dir = join(root, 'decisions')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => join(dir, f))
}

function readDecisions(root: string): Decision[] {
  return decisionFiles(root).map((path) => {
    const parsed = DecisionSchema.safeParse(matter(readFileSync(path, 'utf8')).data)
    if (!parsed.success) {
      throw new Error(
        `${path} failed validation:\n${parsed.error.issues.map(formatIssue).join('\n')}`,
      )
    }
    return parsed.data
  })
}

export function openWorkspace(root = process.env.FOUNDEROS_CONTEXT ?? './context/example'): Workspace {
  if (!existsSync(join(root, 'company.yaml'))) {
    throw new Error(`No company.yaml in "${root}". Set FOUNDEROS_CONTEXT to a workspace directory.`)
  }
  const hash = createHash('sha256')
  for (const file of [
    'company.yaml',
    'founder.yaml',
    'goals.yaml',
    'metrics.yaml',
    'people.yaml',
    'feedback.yaml',
    'experiments.yaml',
    'meetings.yaml',
  ]) {
    const path = join(root, file)
    if (existsSync(path)) hash.update(readFileSync(path))
  }
  for (const path of decisionFiles(root)) hash.update(readFileSync(path))
  return { root, hash: `sha256:${hash.digest('hex')}` }
}

/** Loads exactly the keys requested. An unknown key is a hard error, never empty context. */
export function selectContext(ws: Workspace, keys: readonly ContextKey[]): Record<string, unknown> {
  const selected: Record<string, unknown> = {}
  for (const key of new Set(keys)) {
    switch (key) {
      case 'company':
        selected.company = readYaml(ws.root, 'company.yaml', Company)
        break
      case 'founder':
        selected.founder = existsSync(join(ws.root, 'founder.yaml'))
          ? readYaml(ws.root, 'founder.yaml', Founder)
          : Founder.parse({})
        break
      case 'goals':
        selected.goals = readList(ws.root, 'goals.yaml', Goal)
        break
      case 'metrics':
        selected.metrics = readList(ws.root, 'metrics.yaml', Metric)
        break
      case 'people':
        selected.people = readList(ws.root, 'people.yaml', Person)
        break
      case 'feedback':
        selected.feedback = readList(ws.root, 'feedback.yaml', Feedback)
        break
      case 'experiments':
        selected.experiments = readList(ws.root, 'experiments.yaml', Experiment)
        break
      case 'meetings':
        selected.meetings = readList(ws.root, 'meetings.yaml', Meeting)
        break
      case 'decisions_recent':
        selected.decisions_recent = readDecisions(ws.root).slice(-RECENT_DECISION_COUNT)
        break
      case 'decisions_all':
        selected.decisions_all = readDecisions(ws.root)
        break
    }
  }
  return selected
}

export function renderContext(selected: Record<string, unknown>): string {
  return Object.entries(selected)
    .map(([key, value]) => `## ${key}\n${stringifyYaml(value).trimEnd()}`)
    .join('\n\n')
}

export function companySummary(ws: Workspace): string {
  const company = readYaml(ws.root, 'company.yaml', Company)
  return `${company.name} — ${company.one_liner} (${company.stage}, ${company.business_model}, ${company.runway_months}mo runway)`
}

export function appendDecision(ws: Workspace, decision: Decision, notes: string): string {
  const dir = join(ws.root, 'decisions')
  mkdirSync(dir, { recursive: true })
  const slug = decision.question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  const path = join(dir, `${decision.date}-${slug}.md`)
  writeFileSync(path, matter.stringify(notes, decision))
  return path
}
