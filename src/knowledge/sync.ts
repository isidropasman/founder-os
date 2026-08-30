import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { htmlToText } from './text.ts'
import { SOURCES_DIR } from './corpus.ts'

const MONTHS =
  'January|February|March|April|May|June|July|August|September|October|November|December'

type Entry = {
  id: string
  file: string
  title: string
  kind: string
  url?: string
  year?: number
  retrieved_at: string
  checksum: string
}

/**
 * Titles and dates come from the documents themselves, never from memory. A
 * hand-written manifest does not scale past a handful of sources, and a
 * remembered publication year is exactly the kind of small fabrication this
 * subsystem exists to prevent.
 */
function describe(raw: string, text: string): { title: string | null; year: number | null } {
  const title = raw.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? null
  const year = text.match(new RegExp(`\\b(?:${MONTHS})\\s+(\\d{4})\\b`))?.[1]
  return { title: title || null, year: year ? Number(year) : null }
}

export type SyncReport = {
  author: string
  added: string[]
  updated: string[]
  unchanged: number
  skipped: { file: string; reason: string }[]
}

const MIN_TEXT_CHARS = 1500

export function syncManifest(
  authorId: string,
  options: { urlPattern?: string; kind?: string; retrievedAt: string; dir?: string },
): SyncReport {
  const dir = join(options.dir ?? SOURCES_DIR, authorId)
  const manifestPath = join(dir, 'manifest.yaml')
  if (!existsSync(manifestPath)) {
    throw new Error(`${manifestPath} does not exist. Create it from templates/manifest.yaml first.`)
  }

  const manifest = parseYaml(readFileSync(manifestPath, 'utf8')) as {
    author: Record<string, unknown>
    sources?: Entry[]
  }
  const existing = new Map((manifest.sources ?? []).map((s) => [s.id, s]))
  const report: SyncReport = { author: authorId, added: [], updated: [], unchanged: 0, skipped: [] }
  const entries: Entry[] = []

  for (const file of readdirSync(dir).filter((f) => /\.(html?|txt)$/.test(f)).sort()) {
    const raw = readFileSync(join(dir, file), 'utf8')
    const text = file.endsWith('.txt') ? raw.trim() : htmlToText(raw)

    // Short pages are navigation stubs or image-only essays: they produce no
    // usable claims and would pollute retrieval with boilerplate.
    if (text.length < MIN_TEXT_CHARS) {
      report.skipped.push({ file, reason: `only ${text.length} chars of text` })
      continue
    }

    const id = file.replace(/\.(html?|txt)$/, '')
    const { title, year } = describe(raw, text)
    if (!title) {
      report.skipped.push({ file, reason: 'no <title> to name it' })
      continue
    }

    const checksum = `sha256:${createHash('sha256').update(text).digest('hex')}`
    const prior = existing.get(id)

    const entry: Entry = {
      id,
      file,
      // A title edited by hand in the manifest wins: some of these are ALL CAPS
      // or carry site furniture, and a human fix should survive a re-sync.
      title: prior && prior.title !== title && prior.checksum === checksum ? prior.title : title,
      kind: prior?.kind ?? options.kind ?? 'essay',
      ...(options.urlPattern ? { url: options.urlPattern.replace('{id}', id) } : {}),
      ...(year !== null ? { year } : {}),
      retrieved_at: prior?.checksum === checksum ? prior.retrieved_at : options.retrievedAt,
      checksum,
    }

    if (!prior) report.added.push(id)
    else if (prior.checksum !== checksum) report.updated.push(id)
    else report.unchanged++

    entries.push(entry)
  }

  writeFileSync(
    manifestPath,
    stringifyYaml({ author: manifest.author, sources: entries }, { lineWidth: 100 }),
  )
  return report
}
