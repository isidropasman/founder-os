import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { PortfolioSchema } from '../src/portfolio/contracts.ts'

const EvalFixtureSchema = z.object({ id: z.string().min(1), question: z.string().min(1), portfolio: PortfolioSchema })

const FIXTURES = [
  'tradeoff-shared-constraint.yaml',
  'tradeoff-prioritization.yaml',
  'tradeoff-opportunity-cost.yaml',
  'tradeoff-conflicting-signals.yaml',
  'tradeoff-noisy-history.yaml',
]

test('portfolio evaluation fixtures cover distinct trade-off cases and validate', () => {
  const ids = new Set<string>()
  for (const file of FIXTURES) {
    const path = join('evals/portfolio', file)
    assert.equal(existsSync(path), true, `${file} is missing`)
    const parsed = EvalFixtureSchema.safeParse(parseYaml(readFileSync(path, 'utf8')))
    assert.equal(parsed.success, true, `${file} is invalid`)
    if (!parsed.success) continue
    assert.ok(!ids.has(parsed.data.id), `${file} duplicates ${parsed.data.id}`)
    ids.add(parsed.data.id)
  }
  assert.equal(ids.size, 5)
})
