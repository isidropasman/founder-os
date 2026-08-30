import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

/**
 * The guided first turn of the loop.
 *
 * Onboarding fails when it asks for everything before giving anything, so each
 * step is short and states what it unlocks. Nothing is mandatory: a workspace
 * with only step 1 is usable, and the app reports what is still missing rather
 * than refusing to work.
 */

export type FieldKind = 'text' | 'long' | 'number' | 'choice' | 'list'

export type Field = {
  name: string
  label: string
  kind: FieldKind
  placeholder?: string
  choices?: string[]
  /** Why this field earns its keystrokes. Shown, not hidden in a tooltip. */
  because?: string
}

export type Step = {
  id: string
  title: string
  /** The single sentence that says what answering this buys. */
  unlocks: string
  fields: Field[]
  /** Repeating steps collect rows rather than one record. */
  repeats?: { min: number; max: number; noun: string }
}

export const STEPS: Step[] = [
  {
    id: 'company',
    title: 'Your company',
    unlocks: 'Advice stops being generic. Every answer gets anchored to who actually buys.',
    fields: [
      { name: 'name', label: 'Name', kind: 'text', placeholder: 'Acme' },
      {
        name: 'one_liner',
        label: 'What you do, in one line',
        kind: 'text',
        placeholder: 'Invoicing for freelance designers',
        because: 'In the words a customer would use, not a positioning statement.',
      },
      {
        name: 'stage',
        label: 'Stage',
        kind: 'choice',
        choices: ['idea', 'pre-seed', 'seed', 'series-a+'],
      },
      {
        name: 'icp',
        label: 'Who buys',
        kind: 'text',
        placeholder: 'Solo designers billing over $5k/mo',
        because: '“Marketing teams” is too vague to reason about. Name the person.',
      },
      { name: 'pricing', label: 'What you charge', kind: 'text', placeholder: '$19/mo, one tier' },
      { name: 'runway_months', label: 'Months of runway', kind: 'number', placeholder: '11' },
      { name: 'team_size', label: 'People', kind: 'number', placeholder: '4' },
    ],
  },
  {
    id: 'metrics',
    title: 'Your numbers',
    unlocks:
      'Rules start watching them. A number drifting away from a goal becomes your headline.',
    repeats: { min: 1, max: 5, noun: 'number' },
    fields: [
      {
        name: 'name',
        label: 'Name',
        kind: 'text',
        placeholder: 'mrr',
        because: 'The three you would check first if something felt wrong.',
      },
      { name: 'value', label: 'Now', kind: 'number', placeholder: '3420' },
      { name: 'trend', label: 'Heading', kind: 'choice', choices: ['up', 'flat', 'down'] },
      { name: 'source', label: 'From', kind: 'text', placeholder: 'stripe' },
    ],
  },
  {
    id: 'goals',
    title: 'What you are trying to do',
    unlocks: 'A goal with no number attached gets flagged, instead of quietly going stale.',
    repeats: { min: 1, max: 4, noun: 'goal' },
    fields: [
      { name: 'statement', label: 'Goal', kind: 'text', placeholder: 'Reach $10k MRR' },
      {
        name: 'metric',
        label: 'Measured by',
        kind: 'text',
        placeholder: 'mrr',
        because: 'Use one of the names you just entered.',
      },
      { name: 'target', label: 'Target', kind: 'number', placeholder: '10000' },
      { name: 'horizon', label: 'By when', kind: 'text', placeholder: '2026-12-31' },
    ],
  },
  {
    id: 'founder',
    title: 'You',
    unlocks:
      'The challenger uses this to catch advice that conveniently sits inside your comfort zone.',
    fields: [
      { name: 'name', label: 'Name', kind: 'text', placeholder: 'Sam' },
      { name: 'role', label: 'Role', kind: 'text', placeholder: 'ceo' },
      {
        name: 'working_style',
        label: 'How your week actually looks',
        kind: 'text',
        placeholder: 'Deep work 8–12, calendar otherwise reactive',
      },
      {
        name: 'weak_spots',
        label: 'What you avoid or over-index on',
        kind: 'list',
        placeholder: 'Reschedules sales calls · Rewrites working code when anxious',
        because:
          'No other tool asks this. It is what turns “talk to customers” into “you have moved this call twice — here is the smallest version of it”.',
      },
    ],
  },
]

export type StepValues = Record<string, unknown>

const FILE_FOR: Record<string, string> = {
  company: 'company.yaml',
  founder: 'founder.yaml',
  metrics: 'metrics.yaml',
  goals: 'goals.yaml',
}

function today(now: Date): string {
  return now.toISOString().slice(0, 10)
}

function slug(value: unknown, prefix: string, index: number): string {
  const base = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return `${prefix}-${base || index + 1}`
}

/** Fills the fields a schema requires but a founder should not be asked for. */
function complete(stepId: string, row: StepValues, index: number, now: Date): StepValues {
  if (stepId === 'metrics') {
    return { as_of: today(now), trend: 'flat', source: 'founder', ...row }
  }
  if (stepId === 'goals') {
    return { id: slug(row.statement, 'g', index), status: 'active', ...row }
  }
  if (stepId === 'company') {
    return { business_model: '', constraints: [], runway_months: 0, team_size: 0, ...row }
  }
  if (stepId === 'founder') {
    return { strengths: [], known_biases: [], weak_spots: [], working_style: '', ...row }
  }
  return row
}

export type SaveResult = { file: string; wrote: number }

/**
 * Writes one step. Merges into whatever is already there rather than replacing,
 * so a founder can go back and add a metric without losing the others.
 */
export function saveStep(
  root: string,
  stepId: string,
  values: StepValues | StepValues[],
  now = new Date(),
): SaveResult {
  const file = FILE_FOR[stepId]
  if (!file) throw new Error(`Unknown setup step "${stepId}"`)
  mkdirSync(join(root, 'decisions'), { recursive: true })
  const path = join(root, file)

  if (Array.isArray(values)) {
    const rows = values
      .filter((row) => Object.values(row).some((v) => v !== '' && v !== undefined))
      .map((row, index) => complete(stepId, row, index, now))
    writeFileSync(path, stringifyYaml(rows))
    return { file, wrote: rows.length }
  }

  const existing = existsSync(path)
    ? ((parseYaml(readFileSync(path, 'utf8')) as StepValues | null) ?? {})
    : {}
  const merged = complete(stepId, { ...existing, ...values }, 0, now)
  writeFileSync(path, stringifyYaml(merged))
  return { file, wrote: 1 }
}

export type Progress = { id: string; title: string; done: boolean; unlocks: string }[]

/** What is filled in and what is not, so the app can say so instead of failing. */
export function progress(root: string): Progress {
  return STEPS.map((step) => {
    const path = join(root, FILE_FOR[step.id]!)
    let done = false
    if (existsSync(path)) {
      const parsed = parseYaml(readFileSync(path, 'utf8')) as unknown
      done = Array.isArray(parsed)
        ? parsed.length > 0
        : Boolean(parsed && Object.values(parsed as StepValues).some((v) => v !== '' && v !== null))
    }
    return { id: step.id, title: step.title, done, unlocks: step.unlocks }
  })
}

export function isConfigured(root: string): boolean {
  return progress(root).some((step) => step.id === 'company' && step.done)
}
