import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, beforeEach, test } from 'node:test'
import { parse as parseYaml } from 'yaml'
import { openWorkspace, selectContext } from '../src/context.ts'
import { applyPlan, UNRESOLVED_FILE } from '../src/ingest/apply.ts'
import { fixtureExtractor, hashText, type Extraction } from '../src/ingest/extract.ts'
import { readLedger, recordIngested, scanInbox } from '../src/ingest/inbox.ts'
import { buildPlan, countBy, type MergePlan } from '../src/ingest/plan.ts'
import { renderPlan } from '../src/ingest/preview.ts'

const NOTE_PATH = 'test/fixtures/inbox/customer-call.md'
const NOTE = readFileSync(NOTE_PATH, 'utf8')

const roots: string[] = []

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'founderos-ingest-'))
  cpSync('context/example', root, { recursive: true })
  roots.push(root)
  return root
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

let extraction: Extraction

beforeEach(async () => {
  extraction = await fixtureExtractor().extract({ sourceId: NOTE_PATH, text: NOTE })
})

function plan(root: string, text = NOTE): MergePlan {
  return buildPlan({ root, sourceText: text, extraction, sourceId: NOTE_PATH })
}

test('the fixture extractor is keyed by content hash', async () => {
  const byHash = join('test/fixtures/extractions', `${hashText(NOTE)}.json`)
  assert.ok(readFileSync(byHash, 'utf8').length > 0)

  await assert.rejects(
    () => fixtureExtractor().extract({ sourceId: 'x', text: 'text with no recording' }),
    /No recorded extraction/,
  )
})

test('a quote that is not in the source is rejected, never merged', () => {
  const root = workspace()
  const rejected = plan(root).items.filter((i) => i.disposition === 'rejected')

  assert.equal(rejected.length, 1)
  assert.equal(rejected[0]!.proposal.fields.id, 'fb-invented')
  assert.match(rejected[0]!.reason, /not found in the source/)

  applyPlan(root, plan(root), { overwrite: true })
  const feedback = parseYaml(readFileSync(join(root, 'feedback.yaml'), 'utf8')) as { id: string }[]
  assert.ok(
    !feedback.some((f) => f.id === 'fb-invented'),
    'a rejected proposal must never reach the workspace',
  )
})

test('low confidence is held as unresolved rather than merged or discarded', () => {
  const root = workspace()
  const held = plan(root).items.filter((i) => i.disposition === 'unresolved')
  assert.equal(held.length, 1)
  assert.equal(held[0]!.proposal.target, 'decision')

  applyPlan(root, plan(root))
  const unresolved = parseYaml(readFileSync(join(root, UNRESOLVED_FILE), 'utf8')) as {
    target: string
    provenance: { source: string; quote: string }
  }[]
  assert.equal(unresolved.length, 1)
  assert.equal(unresolved[0]!.target, 'decision')
  assert.equal(unresolved[0]!.provenance.source, NOTE_PATH)

  // and it must not have been written as a real decision
  const decisions = selectContext(openWorkspace(root), ['decisions_all']).decisions_all as unknown[]
  assert.equal(decisions.length, 1, 'only the pre-existing decision should be present')
})

test('existing values are never overwritten without --overwrite', () => {
  const root = workspace()
  const before = readFileSync(join(root, 'metrics.yaml'), 'utf8')

  const conflicts = plan(root).items.filter((i) => i.disposition === 'conflict')
  assert.ok(conflicts.some((c) => c.proposal.fields.name === 'mrr'))

  const report = applyPlan(root, plan(root))
  assert.ok(report.skippedConflicts >= 1)
  assert.equal(readFileSync(join(root, 'metrics.yaml'), 'utf8'), before, 'metrics must be untouched')

  applyPlan(root, plan(root), { overwrite: true })
  const metrics = parseYaml(readFileSync(join(root, 'metrics.yaml'), 'utf8')) as {
    name: string
    value: number
  }[]
  assert.equal(metrics.find((m) => m.name === 'mrr')?.value, 3620)
})

test('every written entity carries its provenance', () => {
  const root = workspace()
  applyPlan(root, plan(root))

  const people = parseYaml(readFileSync(join(root, 'people.yaml'), 'utf8')) as {
    id: string
    provenance?: { source: string; source_type: string; imported_at: string; quote: string }
  }[]
  const added = people.find((p) => p.id === 'p-priya')
  assert.ok(added?.provenance, 'imported entity has no provenance')
  assert.equal(added.provenance.source, NOTE_PATH)
  assert.equal(added.provenance.source_type, 'customer-interview')
  assert.match(added.provenance.imported_at, /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(NOTE.includes(added.provenance.quote), 'provenance quote must be a real span of the source')

  // Entities the founder wrote by hand must not acquire a fake provenance.
  assert.equal(people.find((p) => p.id === 'p-jane')?.provenance, undefined)
})

test('re-ingesting the same note changes nothing', () => {
  const root = workspace()
  const first = applyPlan(root, plan(root))
  assert.ok(first.added > 0)

  const snapshot = ['people.yaml', 'feedback.yaml', 'meetings.yaml', UNRESOLVED_FILE].map((f) =>
    readFileSync(join(root, f), 'utf8'),
  )

  const second = applyPlan(root, plan(root))
  assert.equal(second.added, 0, 'nothing new the second time')
  assert.equal(second.updated, 0)
  assert.equal(second.unresolved, 0, 'unresolved items must not pile up')

  for (const [index, file] of ['people.yaml', 'feedback.yaml', 'meetings.yaml', UNRESOLVED_FILE].entries()) {
    assert.equal(readFileSync(join(root, file), 'utf8'), snapshot[index], `${file} changed on re-ingest`)
  }
})

test('a paraphrase of existing feedback is recognized as the same item', () => {
  const root = workspace()
  const marcus = plan(root).items.find((i) => i.proposal.fields.id === 'fb-marcus-editor-dup')
  assert.ok(marcus)
  assert.notEqual(marcus.disposition, 'add', 'identical verbatim must not be added twice')
  assert.equal(marcus.existingId, 'fb-marcus-editor')
})

test('the workspace still validates after ingestion', () => {
  const root = workspace()
  applyPlan(root, plan(root), { overwrite: true })

  const ws = openWorkspace(root)
  const selected = selectContext(ws, ['people', 'feedback', 'meetings', 'metrics'])
  assert.equal((selected.people as unknown[]).length, 4)
  assert.ok((selected.feedback as unknown[]).length >= 5)
  assert.ok((selected.meetings as unknown[]).length >= 3)
})

test('comments in a scaffolded file survive a write', () => {
  const root = workspace()
  const path = join(root, 'people.yaml')
  writeFileSync(path, `# keep me\n${readFileSync(path, 'utf8')}`)

  applyPlan(root, plan(root))
  assert.ok(readFileSync(path, 'utf8').includes('# keep me'), 'YAML comments were destroyed')
})

test('the preview names every disposition and never claims to have written', () => {
  const root = workspace()
  const rendered = renderPlan(plan(root), { applied: false })
  const counts = countBy(plan(root))

  assert.ok(rendered.includes('NEW FACTS'))
  assert.ok(rendered.includes('WOULD CHANGE SOMETHING YOU WROTE'))
  assert.ok(rendered.includes('HELD AS UNRESOLVED'))
  assert.ok(rendered.includes('REJECTED'))
  assert.ok(rendered.includes('Preview only'))
  assert.ok(rendered.includes('--apply --overwrite'), 'conflicts must state how to approve them')
  assert.equal(counts.add, 3)
  assert.equal(counts.rejected, 1)
  assert.equal(counts.unresolved, 1)
})

test('the inbox ledger is keyed by content, so a renamed file is still processed', () => {
  const root = workspace()
  mkdirSync(join(root, 'inbox'), { recursive: true })
  writeFileSync(join(root, 'inbox/call.md'), NOTE)

  const [item] = scanInbox(root)
  assert.ok(item)
  assert.equal(item.alreadyIngested, false)

  recordIngested(root, item.hash, {
    file: item.relativePath,
    ingested_at: '2026-08-16',
    added: 3,
    updated: 0,
  })
  assert.equal(scanInbox(root)[0]?.alreadyIngested, true)

  writeFileSync(join(root, 'inbox/same-note-renamed.md'), NOTE)
  const scanned = scanInbox(root)
  assert.equal(scanned.length, 2)
  assert.ok(
    scanned.every((i) => i.alreadyIngested),
    'the same content under a new name must not be reprocessed',
  )
  assert.equal(Object.keys(readLedger(root)).length, 1)
})

test('a note with no context yields an empty plan, not an empty write', () => {
  const root = workspace()
  const empty = buildPlan({
    root,
    sourceText: 'nothing here',
    extraction: { summary: 'Nothing.', source_type: 'other', proposals: [] },
    sourceId: 'paste:test',
  })
  assert.equal(empty.items.length, 0)
  assert.ok(renderPlan(empty, { applied: false }).includes('Nothing found'))

  const before = readFileSync(join(root, 'people.yaml'), 'utf8')
  applyPlan(root, empty)
  assert.equal(readFileSync(join(root, 'people.yaml'), 'utf8'), before)
})
