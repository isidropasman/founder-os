import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
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
        retrieved_at: z.union([z.string(), z.date()]).transform((v) =>
          typeof v === 'string' ? v : v.toISOString().slice(0, 10),
        ),
        /** Committed even though the document is not, so a re-fetch is verifiable. */
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
  retrievedAt: string
  checksum: string
  text: string
  chunks: Chunk[]
}

export type Corpus = {
  authors: Map<string, Author>
  sources: Map<string, Source>
}

function extract(file: string, raw: string): string {
  return file.endsWith('.html') || file.endsWith('.htm') ? htmlToText(raw) : raw.trim()
}

export function loadCorpus(dir = SOURCES_DIR): Corpus {
  const authors = new Map<string, Author>()
  const sources = new Map<string, Source>()

  if (!existsSync(dir)) return { authors, sources }

  for (const authorDir of readdirSync(dir, { withFileTypes: true })) {
    if (!authorDir.isDirectory()) continue
    const manifestPath = join(dir, authorDir.name, 'manifest.yaml')
    if (!existsSync(manifestPath)) {
      throw new Error(`${join(dir, authorDir.name)} has no manifest.yaml`)
    }

    const parsed = ManifestSchema.safeParse(parseYaml(readFileSync(manifestPath, 'utf8')))
    if (!parsed.success) {
      throw new Error(
        `${manifestPath} failed validation:\n${parsed.error.issues
          .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('\n')}`,
      )
    }

    const { author, sources: entries } = parsed.data
    if (author.id !== authorDir.name) {
      throw new Error(`${manifestPath}: author id "${author.id}" does not match directory name.`)
    }
    authors.set(author.id, author)

    for (const entry of entries) {
      const path = join(dir, author.id, entry.file)
      // Source documents are not redistributed with the repo. A missing file means
      // "not fetched yet", which callers report as a skip — not a validation failure.
      if (!existsSync(path)) continue
      const text = extract(entry.file, readFileSync(path, 'utf8'))
      const checksum = `sha256:${createHash('sha256').update(text).digest('hex')}`
      if (entry.checksum && entry.checksum !== checksum) {
        throw new Error(
          `${path} has drifted from the manifest checksum.\n` +
            `  manifest: ${entry.checksum}\n  on disk:  ${checksum}\n` +
            `  Every quote taken from this source must be re-verified. Update the manifest deliberately.`,
        )
      }
      const id = `${author.id}/${entry.id}`
      sources.set(id, {
        id,
        authorId: author.id,
        title: entry.title,
        kind: entry.kind,
        url: entry.url ?? null,
        year: entry.year ?? null,
        retrievedAt: entry.retrieved_at,
        checksum,
        text,
        chunks: chunk(text),
      })
    }
  }

  return { authors, sources }
}
