import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { PortfolioSchema, emptyPortfolio, type Portfolio, type PortfolioRecord, type Validation } from './contracts.ts'

function slug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export function portfolioPath(): string {
  return process.env.FOUNDEROS_PORTFOLIO ?? `${process.env.FOUNDEROS_CONTEXT ?? './context/example'}/portfolio.yaml`
}

export function loadPortfolio(path = portfolioPath()): Portfolio {
  if (!existsSync(path)) return emptyPortfolio('founder')
  return PortfolioSchema.parse(parseYaml(readFileSync(path, 'utf8')))
}

export function savePortfolio(path: string, portfolio: Portfolio): void {
  const checked = PortfolioSchema.parse(portfolio)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, stringifyYaml(checked))
}

export function createProject(portfolio: Portfolio, name: string, now: string): Validation<Portfolio> {
  const id = slug(name)
  if (!id) return { ok: false, issues: ['Project name is required.'] }
  if (portfolio.projects.some((project) => project.id === id)) return { ok: false, issues: ['A project with this name already exists.'] }
  return {
    ok: true,
    value: {
      ...portfolio,
      projects: [...portfolio.projects, { id, name: name.trim(), recordedAt: now, observedAt: now, origin: 'founder', confidence: 1 }],
    },
  }
}

export type FounderRecordInput = Pick<PortfolioRecord, 'id' | 'kind' | 'projectId' | 'observedAt' | 'text' | 'numericValue' | 'origin' | 'confidence'>

export function addFounderRecord(portfolio: Portfolio, input: FounderRecordInput, now: string): Validation<Portfolio> {
  if (input.origin === 'model') return { ok: false, issues: ['Model-extracted claims must be reviewed before becoming canonical records.'] }
  if (portfolio.records.some((record) => record.id === input.id)) return { ok: false, issues: ['A record with this id already exists.'] }
  if (input.projectId && !portfolio.projects.some((project) => project.id === input.projectId)) return { ok: false, issues: ['Record project is not available.'] }
  const record: PortfolioRecord = {
    ...input,
    scope: input.projectId ? 'project' : 'founder',
    recordedAt: now,
    evidenceIds: [],
    sourceStatus: 'approved',
    causal: false,
  }
  const checked = PortfolioSchema.safeParse({ ...portfolio, records: [...portfolio.records, record] })
  return checked.success ? { ok: true, value: checked.data } : { ok: false, issues: checked.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) }
}
