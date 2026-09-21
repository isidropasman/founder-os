'use server'

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { basename, dirname, relative, resolve } from 'node:path'
import { revalidatePath } from 'next/cache'
import { loadCorpusManifest, type Corpus, type Source } from '../../src/knowledge/corpus.ts'
import { check, connect } from '../../src/knowledge/db.ts'
import { ingest, type IngestReport } from '../../src/knowledge/ingest.ts'

type PreviewSource = {
  id: string
  title: string
  checksum: string | null
  indexedChecksum: string | null
  checksumState: 'new' | 'unchanged' | 'changed' | 'unknown'
  policy: Source['policy']
  availability: 'available' | 'unavailable'
  passages: { ordinal: number; text: string }[]
}

export type IngestPreview =
  | { ok: true; manifestPath: string; manifestChecksum: string; corpusChecksum: string; sources: PreviewSource[]; skipped: { sourceId: string; reason: string }[] }
  | { ok: false; message: string }

export type IngestActionResult =
  | { ok: true; report: IngestReport }
  | { ok: false; message: string }

type ManifestCorpus =
  | { ok: true; corpus: Corpus; path: string; checksum: string }
  | { ok: false; message: string }

export async function corpusReviewChecksum(corpus: Corpus): Promise<string> {
  const sources = [...corpus.sources.values()]
    .map((source) => ({ id: source.id, checksum: source.checksum }))
    .sort((a, b) => a.id.localeCompare(b.id))
  return `sha256:${createHash('sha256').update(JSON.stringify(sources)).digest('hex')}`
}

function manifestCorpus(manifestPath: string): ManifestCorpus {
  const requestedPath = resolve(manifestPath)
  if (basename(requestedPath) !== 'manifest.yaml') {
    return { ok: false, message: 'Choose a manifest.yaml inside this workspace.' }
  }
  if (!existsSync(requestedPath)) return { ok: false, message: 'Manifest file does not exist.' }

  const absolutePath = realpathSync(requestedPath)
  const workspacePath = realpathSync(process.cwd())
  const pathFromWorkspace = relative(workspacePath, absolutePath)
  if (pathFromWorkspace === '..' || pathFromWorkspace.startsWith('../')) {
    return { ok: false, message: 'Choose a manifest.yaml inside this workspace.' }
  }

  try {
    const raw = readFileSync(absolutePath)
    return {
      ok: true,
      corpus: loadCorpusManifest(absolutePath),
      path: absolutePath,
      checksum: `sha256:${createHash('sha256').update(raw).digest('hex')}`,
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

async function indexedChecksums(sourceIds: string[]): Promise<Map<string, string> | null> {
  if (sourceIds.length === 0) return new Map()
  const db = connect()
  try {
    const health = await check(db)
    if (!health.ok) return null
    const result = await db.query<{ id: string; checksum: string }>(
      'SELECT id, checksum FROM sources WHERE id = ANY($1)',
      [sourceIds],
    )
    return new Map(result.rows.map((row) => [row.id, row.checksum]))
  } catch {
    return null
  } finally {
    await db.end()
  }
}

export async function inspectIngestManifest(manifestPath: string): Promise<IngestPreview> {
  const loaded = manifestCorpus(manifestPath)
  if (!loaded.ok) return loaded

  const corpusSources = [...loaded.corpus.sources.values()]
  const checksums = await indexedChecksums(corpusSources.map((source) => source.id))
  const sources = corpusSources.map((source) => {
    const indexedChecksum = checksums?.get(source.id) ?? null
    const checksumState = checksums === null
      ? 'unknown' as const
      : indexedChecksum === null
        ? 'new' as const
        : indexedChecksum === source.checksum
          ? 'unchanged' as const
          : 'changed' as const
    return {
      id: source.id,
      title: source.title,
      checksum: source.checksum,
      indexedChecksum,
      checksumState,
      policy: source.policy,
      availability: 'available' as const,
      passages: source.chunks.slice(0, 2).map((passage) => ({
        ordinal: passage.ordinal,
        text: passage.text,
      })),
    }
  })

  return {
    ok: true,
      manifestPath: loaded.path,
      manifestChecksum: loaded.checksum,
      corpusChecksum: await corpusReviewChecksum(loaded.corpus),
      sources,
    skipped: loaded.corpus.skipped ?? [],
  }
}

function isPolicySkip(skipped: { sourceId: string; reason: string }[]): boolean {
  return skipped.some((source) => source.reason.startsWith('retrieval policy is '))
}

export async function runIngestManifest(
  manifestPath: string,
  manifestChecksum = '',
  reviewedCorpusChecksum = '',
): Promise<IngestActionResult> {
  const loaded = manifestCorpus(manifestPath)
  if (!loaded.ok) return { ok: false, message: loaded.message }
  if (!manifestChecksum || manifestChecksum !== loaded.checksum) {
    return { ok: false, message: 'Manifest changed or was not reviewed. Review it again before indexing.' }
  }
  if (!reviewedCorpusChecksum || reviewedCorpusChecksum !== await corpusReviewChecksum(loaded.corpus)) {
    return { ok: false, message: 'Source content changed or was not reviewed. Review it again before indexing.' }
  }
  const skipped = loaded.corpus.skipped ?? []
  if (isPolicySkip(skipped)) return { ok: false, message: 'Source is not approved for ingestion.' }
  if (skipped.length > 0) return { ok: false, message: 'Source files are unavailable for ingestion.' }
  if (loaded.corpus.sources.size === 0) return { ok: false, message: 'Manifest has no approved local sources.' }

  const db = connect()
  try {
    const health = await check(db)
    if (!health.ok) return { ok: false, message: health.reason }
    const result = await ingest(db, loaded.corpus)
    if (!result.ok) return { ok: false, message: result.reason }
    revalidatePath('/knowledge')
    revalidatePath('/ingest')
    revalidatePath('/evals')
    return { ok: true, report: result.report }
  } finally {
    await db.end()
  }
}
