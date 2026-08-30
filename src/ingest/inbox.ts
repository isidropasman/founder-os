import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { hashText } from './extract.ts'

export const INBOX_DIR = 'inbox'
export const PROCESSED_DIR = 'inbox/processed'
export const LEDGER_FILE = '.ingested.json'

const SUPPORTED = ['.md', '.txt', '.markdown', '.text']

const LedgerSchema = z.record(
  z.string(),
  z.object({
    file: z.string(),
    ingested_at: z.string(),
    added: z.number(),
    updated: z.number(),
  }),
)

export type Ledger = z.infer<typeof LedgerSchema>

/**
 * Keyed by the sha256 of the file's text, not its path. Renaming a note, or
 * dropping the same note in twice under different names, is still the same source
 * and must not be ingested twice.
 */
export function readLedger(root: string): Ledger {
  const path = join(root, LEDGER_FILE)
  if (!existsSync(path)) return {}
  const parsed = LedgerSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')))
  if (!parsed.success) throw new Error(`${path} is corrupt: ${parsed.error.message}`)
  return parsed.data
}

export function recordIngested(
  root: string,
  hash: string,
  entry: Ledger[string],
): void {
  const ledger = readLedger(root)
  ledger[hash] = entry
  writeFileSync(join(root, LEDGER_FILE), `${JSON.stringify(ledger, null, 2)}\n`)
}

export type InboxItem = {
  path: string
  relativePath: string
  text: string
  hash: string
  alreadyIngested: boolean
}

export function scanInbox(root: string): InboxItem[] {
  const dir = join(root, INBOX_DIR)
  if (!existsSync(dir)) return []
  const ledger = readLedger(root)

  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && SUPPORTED.some((ext) => entry.name.endsWith(ext)))
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      const path = join(dir, name)
      const text = readFileSync(path, 'utf8')
      const hash = hashText(text)
      return {
        path,
        relativePath: join(INBOX_DIR, name),
        text,
        hash,
        alreadyIngested: hash in ledger,
      }
    })
}

export function ensureInbox(root: string): string {
  const dir = join(root, INBOX_DIR)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Archived rather than deleted: the ledger records that it was processed, the file proves what it said. */
export function archive(root: string, item: InboxItem): string {
  const dir = join(root, PROCESSED_DIR)
  mkdirSync(dir, { recursive: true })
  const target = join(dir, item.path.split('/').at(-1)!)
  renameSync(item.path, target)
  return target
}
