import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { parse as parseYaml } from 'yaml'
import { CONTEXT_KEYS, openWorkspace, selectContext } from '../src/context.ts'
import { loadExperts, validateCitations } from '../src/experts.ts'
import { loadSkills } from '../src/skills.ts'
import { OUTPUT_SCHEMAS } from '../src/outputs.ts'

test('every skill file parses and declares a real output schema', () => {
  const skills = loadSkills()
  assert.ok(skills.size > 0, 'no skills loaded')
  for (const skill of skills.values()) {
    assert.ok(skill.output in OUTPUT_SCHEMAS, `${skill.id} declares unknown output "${skill.output}"`)
    assert.ok(skill.procedure.length > 0)
    assert.ok(skill.failureModes.length > 0)
    for (const key of skill.requiresContext) {
      assert.ok(CONTEXT_KEYS.includes(key), `${skill.id} requires unknown context key "${key}"`)
    }
  }
})

test('every skill references only experts that exist', () => {
  const experts = loadExperts()
  for (const skill of loadSkills().values()) {
    for (const id of skill.experts) {
      assert.ok(experts.has(id), `${skill.id} references missing expert "${id}"`)
    }
  }
})

test('every expert principle carries a source, and quoted means quoted', () => {
  const experts = loadExperts()
  assert.ok(experts.size > 0, 'no experts loaded')
  for (const expert of experts.values()) {
    for (const principle of expert.principles) {
      assert.match(principle.source, /—\s*(quoted:|paraphrase)/, `${principle.id} has an unsourced claim`)
      assert.equal(principle.quoted, /—\s*quoted:/.test(principle.source))
    }
  }
})

test('citation validation rejects invented ids and false quote claims', () => {
  const experts = [...loadExperts().values()]
  const paraphrased = experts.flatMap((e) => e.principles).find((p) => !p.quoted)
  assert.ok(paraphrased, 'fixture needs at least one paraphrased principle')

  assert.deepEqual(validateCitations(experts, []), { ok: true })

  const invented = validateCitations(experts, [{ principle_id: 'nobody/P99', kind: 'inferred' }])
  assert.equal(invented.ok, false)

  const overclaimed = validateCitations(experts, [{ principle_id: paraphrased.id, kind: 'quoted' }])
  assert.equal(overclaimed.ok, false)

  const honest = validateCitations(experts, [{ principle_id: paraphrased.id, kind: 'inferred' }])
  assert.equal(honest.ok, true)
})

test('the example workspace loads every context key and hashes stably', () => {
  const ws = openWorkspace('./context/example')
  const selected = selectContext(ws, CONTEXT_KEYS)
  for (const key of CONTEXT_KEYS) {
    assert.ok(key in selected, `selectContext dropped "${key}"`)
  }
  assert.equal(ws.hash, openWorkspace('./context/example').hash)
})

test('selectContext loads only what was asked for', () => {
  const selected = selectContext(openWorkspace('./context/example'), ['metrics'])
  assert.deepEqual(Object.keys(selected), ['metrics'])
})

test('every eval fixture loads, validates, and hashes stably', () => {
  const fixtures = readdirSync('evals/fixtures')
  assert.ok(fixtures.length >= 5, `expected at least 5 fixtures, found ${fixtures.length}`)
  for (const name of fixtures) {
    const dir = join('evals/fixtures', name)
    const ws = openWorkspace(dir)
    const selected = selectContext(ws, CONTEXT_KEYS)
    for (const key of CONTEXT_KEYS) assert.ok(key in selected, `${name} is missing "${key}"`)
    assert.equal(ws.hash, openWorkspace(dir).hash, `${name} does not hash stably`)
  }
})

test('every eval case points at a real fixture, a real skill, and has a unique id', () => {
  const files = readdirSync('evals/cases').filter((f) => f.endsWith('.yaml'))
  const skills = loadSkills()
  const seen = new Set<string>()
  const conditions = new Set<string>()
  let total = 0

  for (const file of files) {
    const parsed = parseYaml(readFileSync(join('evals/cases', file), 'utf8')) as {
      context: string
      cases: { id: string; condition: string; query: string; skill?: string }[]
    }
    // Throws if the fixture is missing or malformed — the case file cannot
    // silently point at nothing.
    openWorkspace(parsed.context)
    for (const c of parsed.cases) {
      assert.ok(!seen.has(c.id), `duplicate case id "${c.id}"`)
      assert.ok(c.query.length > 0, `${c.id} has an empty query`)
      assert.ok(skills.has(c.skill ?? 'focus'), `${c.id} names unknown skill "${c.skill}"`)
      seen.add(c.id)
      conditions.add(c.condition)
      total++
    }
  }

  assert.ok(total >= 15, `expected at least 15 behavioural cases, found ${total}`)
  assert.ok(conditions.size >= 10, `expected at least 10 distinct conditions, found ${conditions.size}`)
})

test('every skill has behavioural eval coverage', () => {
  const covered = new Set<string>()
  for (const file of readdirSync('evals/cases').filter((f) => f.endsWith('.yaml'))) {
    const parsed = parseYaml(readFileSync(join('evals/cases', file), 'utf8')) as {
      cases: { skill?: string }[]
    }
    for (const c of parsed.cases) covered.add(c.skill ?? 'focus')
  }
  const uncovered = [...loadSkills().keys()].filter((id) => !covered.has(id))
  assert.deepEqual(uncovered, [], 'these skills have no eval case')
})

test('every router case parses with the schema the runner uses', async () => {
  // Checking only `expect.skills` here once let a YAML `null` reach production and
  // kill the whole router run on file three. Parse with the real schema instead.
  const { RouterCaseSchema } = await import('../src/eval.ts')
  const skills = loadSkills()

  for (const file of readdirSync('evals/router').filter((f) => f.endsWith('.yaml'))) {
    const raw = parseYaml(readFileSync(join('evals/router', file), 'utf8'))
    const parsed = RouterCaseSchema.safeParse(raw)
    assert.ok(parsed.success, `evals/router/${file} is invalid: ${parsed.error?.message}`)
    for (const id of parsed.data.expect.skills) {
      assert.ok(skills.has(id), `evals/router/${file} expects unknown skill "${id}"`)
    }
  }
})
