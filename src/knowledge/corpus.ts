import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { parseSourceManifestEntry, parseSourcePolicy, type SourcePolicy } from './policy.ts'
import { chunk, htmlToText, type Chunk } from './text.ts'

export const SOURCES_DIR = 'knowledge/sources'

const ManifestSchema = z.object({
  author: z.object({
    id: z.string(),
    name: z.string(),
    kind: z.enum(['person', 'organization']),
    confidence: z.enum(['high', 'medium', 'low']),
    domains: z.array(z.string()).default([]),
    limitations: z.array(z.string()).default([]),
    source_policy: z.unknown().optional(),
  }),
  sources: z
    .array(
      z.object({
        id: z.string(),
        file: z.string(),
        title: z.string(),
        kind: z.enum(['essay', 'talk', 'book', 'post', 'transcript', 'note']),
        url: z.string().optional(),
        year: z.number().int().optional(),
        topics: z.array(z.string()).optional(),
        retrieved_at: z.union([z.string(), z.date()]).transform((v) =>
          typeof v === 'string' ? v : v.toISOString().slice(0, 10),
        ),
        retrieval: z.unknown().optional(),
        redistribution: z.unknown().optional(),
        checksum: z.string().optional(),
      }),
    )
    .default([]),
})

export type Author = z.infer<typeof ManifestSchema>['author']

export type Source = {
  id: string
  authorId: string
  title: string
  kind: string
  url: string | null
  year: number | null
  topics: string[]
  retrievedAt: string
  checksum: string
  text: string
  chunks: Chunk[]
  policy: SourcePolicy
}

export type Corpus = {
  authors: Map<string, Author>
  sources: Map<string, Source>
  skipped?: { sourceId: string; reason: string }[]
}

function extract(file: string, raw: string): string {
  return file.endsWith('.html') || file.endsWith('.htm') ? htmlToText(raw) : raw.trim()
}

function sourceFilePath(sourcesDir: string, authorId: string, file: string): string {
  const authorDir = resolve(sourcesDir, authorId)
  const candidate = resolve(authorDir, file)
  const pathFromAuthor = relative(authorDir, candidate)
  if (pathFromAuthor === '..' || pathFromAuthor.startsWith(`..${sep}`)) {
    throw new Error(`${file}: source file must stay inside its author directory.`)
  }
  if (!existsSync(candidate)) return candidate

  const resolvedAuthorDir = realpathSync(authorDir)
  const resolvedCandidate = realpathSync(candidate)
  const resolvedPathFromAuthor = relative(resolvedAuthorDir, resolvedCandidate)
  if (resolvedPathFromAuthor === '..' || resolvedPathFromAuthor.startsWith(`..${sep}`)) {
    throw new Error(`${file}: resolved source file must stay inside its author directory.`)
  }
  return resolvedCandidate
}

function loadManifest(
  dir: string,
  authorDirName: string,
  manifestPath: string,
  authors: Map<string, Author>,
  sources: Map<string, Source>,
  skipped: { sourceId: string; reason: string }[],
): void {
  const parsed = ManifestSchema.safeParse(parseYaml(readFileSync(manifestPath, 'utf8')))
  if (!parsed.success) {
    throw new Error(
      `${manifestPath} failed validation:\n${parsed.error.issues
        .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('\n')}`,
    )
  }

  const { author, sources: entries } = parsed.data
  if (author.id !== authorDirName) {
    throw new Error(`${manifestPath}: author id "${author.id}" does not match directory name.`)
  }
  authors.set(author.id, author)

  const inheritedPolicy = author.source_policy ? parseSourcePolicy(author.source_policy) : null
  if (inheritedPolicy && !inheritedPolicy.ok) {
    throw new Error(`${manifestPath}: ${inheritedPolicy.issues.join('; ')}`)
  }

  for (const entry of entries) {
    const entryWithInheritedPolicy: unknown =
      entry.retrieval && entry.redistribution
        ? entry
        : inheritedPolicy?.ok
          ? {
              ...entry,
              retrieval: {
                method: inheritedPolicy.value.method,
                status: inheritedPolicy.value.status,
                retrieved_at: inheritedPolicy.value.retrievedAt,
              },
              redistribution: inheritedPolicy.value.redistribution,
            }
          : entry
    const sourceEntry = parseSourceManifestEntry(entryWithInheritedPolicy)
    if (!sourceEntry.ok) {
      throw new Error(`${manifestPath}: ${sourceEntry.issues.join('; ')}`)
    }
    const sourceId = `${author.id}/${entry.id}`
    if (sourceEntry.value.policy.status !== 'approved') {
      skipped.push({
        sourceId,
        reason: `retrieval policy is ${sourceEntry.value.policy.status}`,
      })
      continue
    }
    const path = sourceFilePath(dir, author.id, entry.file)
    // Source documents are not redistributed with the repo. A missing file means
    // "not fetched yet", which callers report as a skip — not a validation failure.
    if (!existsSync(path)) {
      skipped.push({ sourceId, reason: 'local source file is unavailable' })
      continue
    }
    const text = extract(entry.file, readFileSync(path, 'utf8'))
    const checksum = `sha256:${createHash('sha256').update(text).digest('hex')}`
    if (entry.checksum && entry.checksum !== checksum) {
      throw new Error(
        `${path} has drifted from the manifest checksum.\n` +
          `  manifest: ${entry.checksum}\n  on disk:  ${checksum}\n` +
          `  Every quote taken from this source must be re-verified. Update the manifest deliberately.`,
      )
    }
    sources.set(sourceId, {
      id: sourceId,
      authorId: author.id,
      title: entry.title,
      kind: entry.kind,
      url: entry.url ?? null,
      year: entry.year ?? null,
      topics: entry.topics ?? author.domains,
      retrievedAt: entry.retrieved_at,
      checksum,
      text,
      chunks: chunk(text),
      policy: sourceEntry.value.policy,
    })
  }
}

export function loadCorpus(dir = SOURCES_DIR): Corpus {
  const authors = new Map<string, Author>()
  const sources = new Map<string, Source>()
  const skipped: { sourceId: string; reason: string }[] = []

  if (!existsSync(dir)) return { authors, sources, skipped }

  for (const authorDir of readdirSync(dir, { withFileTypes: true })) {
    if (!authorDir.isDirectory()) continue
    const manifestPath = join(dir, authorDir.name, 'manifest.yaml')
    if (!existsSync(manifestPath)) {
      throw new Error(`${join(dir, authorDir.name)} has no manifest.yaml`)
    }

    loadManifest(dir, authorDir.name, manifestPath, authors, sources, skipped)
  }

  return { authors, sources, skipped }
}

export function loadCorpusManifest(manifestPath: string): Corpus {
  const authors = new Map<string, Author>()
  const sources = new Map<string, Source>()
  const skipped: { sourceId: string; reason: string }[] = []
  const authorDir = resolve(manifestPath, '..')
  loadManifest(resolve(authorDir, '..'), authorDir.split(sep).at(-1)!, manifestPath, authors, sources, skipped)
  return { authors, sources, skipped }
}
