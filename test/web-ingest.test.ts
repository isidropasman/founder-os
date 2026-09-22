import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  corpusReviewChecksum,
  inspectIngestManifest,
  runIngestManifest,
} from '../app/ingest/actions.ts'
import { loadCorpus } from '../src/knowledge/corpus.ts'

test('ingest preview retains the acquisition policy and local source version', async () => {
  const preview = await inspectIngestManifest('test/fixtures/knowledge/tester/manifest.yaml')

  assert.equal(preview.ok, true)
  if (!preview.ok) return
  assert.equal(preview.sources.length, 2)
  assert.ok(preview.sources.every((source) => source.id.startsWith('tester/')))
  assert.deepEqual(preview.skipped, [])
  assert.equal(preview.sources[0]?.policy.status, 'approved')
  assert.match(preview.sources[0]?.checksum ?? '', /^sha256:/)
  assert.ok(['new', 'unknown'].includes(preview.sources[0]?.checksumState ?? 'unknown'))
  assert.ok((preview.sources[0]?.passages.length ?? 0) > 0)
  assert.ok((preview.sources[0]?.passages[0]?.text.length ?? 0) > 0)
  assert.match(preview.corpusChecksum, /^sha256:/)
})

test('changes the reviewed corpus token when a source checksum changes', async () => {
  const corpus = loadCorpus('test/fixtures/knowledge')
  const source = corpus.sources.get('tester/pricing')
  assert.ok(source)
  const changed = { ...corpus, sources: new Map(corpus.sources) }
  changed.sources.set(source.id, { ...source, checksum: 'sha256:changed-after-review' })

  assert.notEqual(await corpusReviewChecksum(corpus), await corpusReviewChecksum(changed))
})

test('ingest rejects a manifest in review_required state', async () => {
  const preview = await inspectIngestManifest('test/fixtures/knowledge/review-required/manifest.yaml')
  assert.equal(preview.ok, true)
  if (!preview.ok) return
  const result = await runIngestManifest(
    'test/fixtures/knowledge/review-required/manifest.yaml',
    preview.manifestChecksum,
    preview.corpusChecksum,
  )

  assert.deepEqual(result, { ok: false, message: 'Source is not approved for ingestion.' })
})

test('ingest refuses a manifest that was not the reviewed revision', async () => {
  const result = await runIngestManifest('test/fixtures/knowledge/tester/manifest.yaml', 'sha256:stale')

  assert.deepEqual(result, {
    ok: false,
    message: 'Manifest changed or was not reviewed. Review it again before indexing.',
  })
})

test('ingest refuses source content when no reviewed corpus checksum is supplied', async () => {
  const preview = await inspectIngestManifest('test/fixtures/knowledge/tester/manifest.yaml')
  assert.equal(preview.ok, true)
  if (!preview.ok) return

  const result = await runIngestManifest(
    'test/fixtures/knowledge/tester/manifest.yaml',
    preview.manifestChecksum,
  )

  assert.deepEqual(result, {
    ok: false,
    message: 'Source content changed or was not reviewed. Review it again before indexing.',
  })
})
