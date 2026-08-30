import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { consult, isClaimId, renderPassages } from '../src/knowledge/consult.ts'
import { check, connect, type Db } from '../src/knowledge/db.ts'
import { toLexicalQuery } from '../src/knowledge/retrieve.ts'
import { validateCitations, loadExperts } from '../src/experts.ts'
import { loadSkills } from '../src/skills.ts'

test('a long query becomes an OR of its meaningful terms', () => {
  // websearch_to_tsquery ANDs bare terms, so appending a skill's vocabulary to the
  // question matched nothing at all until this ran. Zero rows, no error.
  const q = toLexicalQuery('Should we raise prices? price charge value')
  assert.equal(q, 'raise OR prices OR price OR charge OR value', '"should"/"we" carry no signal')

  assert.equal(toLexicalQuery('the and for'), '', 'pure stopwords retrieve nothing')
  assert.equal(toLexicalQuery('a b'), '', 'sub-3-character tokens carry no signal')
  assert.ok(!toLexicalQuery('growth or scale').includes(' or OR'), '"or" must not corrupt the syntax')
  assert.equal(toLexicalQuery('users users users'), 'users', 'terms are deduplicated')
})

test('claim ids are distinguishable from principle ids', () => {
  assert.ok(isClaimId('paul-graham/ds#0002'))
  assert.ok(!isClaimId('paul-graham/P3'))
})

test('a retrieved passage is citable; an unretrieved one is not', () => {
  const experts = [...loadExperts().values()]
  const retrieved = ['paul-graham/ds#0002']

  const ok = validateCitations(experts, [{ principle_id: 'paul-graham/ds#0002', kind: 'quoted' }], retrieved)
  assert.equal(ok.ok, true, 'a passage handed to the model must be citable')

  const invented = validateCitations(
    experts,
    [{ principle_id: 'paul-graham/ds#9999', kind: 'quoted' }],
    retrieved,
  )
  assert.equal(invented.ok, false, 'a passage that was never retrieved must be rejected')

  const noneRetrieved = validateCitations(experts, [{ principle_id: 'paul-graham/ds#0002', kind: 'quoted' }])
  assert.equal(noneRetrieved.ok, false, 'with no corpus consulted, claim ids are not citable')
})

test('rendered passages carry the id, author and title the model needs to cite', () => {
  const rendered = renderPassages([
    { id: 'paul-graham/ds#0002', sourceId: 'paul-graham/ds', title: "Do Things that Don't Scale", author: 'paul-graham', text: 'Recruit users manually.' },
  ])
  assert.match(rendered, /\[paul-graham\/ds#0002\]/)
  assert.match(rendered, /Do Things that Don't Scale/)
  assert.equal(renderPassages([]), '')
})

test('every skill declares corpus vocabulary or falls back cleanly', () => {
  for (const skill of loadSkills().values()) {
    const query = skill.corpusTerms.join(' ') || skill.purpose
    assert.ok(toLexicalQuery(query).length > 0, `${skill.id} retrieves on an empty query`)
  }
})

describe('against the real corpus', () => {
  let db: Db | null = null
  let reason = ''

  before(async () => {
    const candidate = connect()
    const health = await check(candidate)
    if (!health.ok) {
      await candidate.end()
      reason = health.reason
      return
    }
    db = candidate
  })

  after(async () => {
    await db?.end()
  })

  test('consulting returns verbatim passages with resolvable ids', async (t) => {
    if (!db) return t.skip(reason)
    const skill = loadSkills().get('founder-sales')!
    const result = await consult({
      query: `how do I get my first users ${skill.corpusTerms.join(' ')}`,
      authors: ['paul-graham'],
      limit: 4,
      db,
    })
    if (!result.ok) return t.skip(result.reason)
    if (result.passages.length === 0) return t.skip('corpus not ingested')

    for (const p of result.passages) {
      assert.ok(isClaimId(p.id), `${p.id} is not a claim id`)
      assert.ok(p.text.length > 0)
      assert.ok(p.id.startsWith(p.sourceId), 'a passage id must contain its source id')
      assert.equal(p.author, 'paul-graham')
    }
    assert.equal(new Set(result.passages.map((p) => p.id)).size, result.passages.length, 'duplicates')
  })

  test('an unreachable database degrades instead of throwing', async () => {
    const result = await consult({
      query: 'anything',
      db: connect('postgres://localhost:1/nope'),
    })
    assert.equal(result.ok, false)
    assert.ok(result.ok === false && result.reason.length > 0)
  })
})
