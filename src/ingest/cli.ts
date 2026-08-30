import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openWorkspace } from '../context.ts'
import { applyPlan } from './apply.ts'
import { extractorFor, hashText, type Extraction, type Extractor } from './extract.ts'
import { archive, ensureInbox, recordIngested, scanInbox } from './inbox.ts'
import { buildPlan, countBy, type MergePlan } from './plan.ts'
import { renderPlan } from './preview.ts'

const RECORD_DIR = 'test/fixtures/extractions'
const SUPPORTED = ['.md', '.txt', '.markdown', '.text']

export type ContextCommandOptions = {
  apply: boolean
  overwrite: boolean
  record: boolean
  force: boolean
  archive: boolean
  extractor?: string
}

type Source = { sourceId: string; text: string }

function readSources(path: string): Source[] {
  const stats = statSync(path)
  if (stats.isFile()) return [{ sourceId: path, text: readFileSync(path, 'utf8') }]
  return readdirSync(path)
    .filter((name) => SUPPORTED.some((ext) => name.endsWith(ext)))
    .sort()
    .map((name) => ({ sourceId: join(path, name), text: readFileSync(join(path, name), 'utf8') }))
}

function recordExtraction(text: string, extraction: Extraction): string {
  mkdirSync(RECORD_DIR, { recursive: true })
  const path = join(RECORD_DIR, `${hashText(text)}.json`)
  writeFileSync(path, `${JSON.stringify(extraction, null, 2)}\n`)
  return path
}

async function planFor(
  extractor: Extractor,
  root: string,
  source: Source,
  record: boolean,
): Promise<MergePlan> {
  const extraction = await extractor.extract({ sourceId: source.sourceId, text: source.text })
  if (record) {
    process.stderr.write(`  recorded ${recordExtraction(source.text, extraction)}\n`)
  }
  return buildPlan({
    root,
    sourceText: source.text,
    extraction,
    sourceId: source.sourceId,
  })
}

function report(plan: MergePlan, options: ContextCommandOptions, root: string): void {
  process.stdout.write(`${renderPlan(plan, { applied: options.apply })}\n\n`)
  if (!options.apply) return

  const result = applyPlan(root, plan, { overwrite: options.overwrite })
  process.stdout.write(
    `  wrote ${result.added} new, ${result.updated} updated` +
      (result.unresolved ? `, ${result.unresolved} held unresolved` : '') +
      (result.skippedConflicts ? `, ${result.skippedConflicts} conflict(s) skipped` : '') +
      '\n',
  )
  for (const file of result.files) process.stdout.write(`    ${file}\n`)
  process.stdout.write('\n')
}

export async function contextAdd(
  root: string,
  text: string,
  options: ContextCommandOptions,
): Promise<void> {
  const extractor = extractorFor(options.extractor)
  const source: Source = { sourceId: `paste:${hashText(text).slice(0, 12)}`, text }
  report(await planFor(extractor, root, source, options.record), options, root)
}

export async function contextImport(
  root: string,
  path: string,
  options: ContextCommandOptions,
): Promise<void> {
  const extractor = extractorFor(options.extractor)
  for (const source of readSources(path)) {
    report(await planFor(extractor, root, source, options.record), options, root)
  }
}

export async function contextIngest(root: string, options: ContextCommandOptions): Promise<void> {
  const dir = ensureInbox(root)
  const items = scanInbox(root)
  const pending = options.force ? items : items.filter((i) => !i.alreadyIngested)

  if (items.length === 0) {
    process.stdout.write(`${dir} is empty. Drop .md or .txt notes there and run this again.\n`)
    return
  }
  process.stdout.write(
    `${items.length} file(s) in ${dir}, ${pending.length} unprocessed` +
      (options.force ? ' (--force: reprocessing all)' : '') +
      '.\n\n',
  )
  if (pending.length === 0) return

  const extractor = extractorFor(options.extractor)
  for (const item of pending) {
    const plan = await planFor(
      extractor,
      root,
      { sourceId: item.relativePath, text: item.text },
      options.record,
    )
    process.stdout.write(`${renderPlan(plan, { applied: options.apply })}\n\n`)

    if (!options.apply) continue

    const result = applyPlan(root, plan, { overwrite: options.overwrite })
    const counts = countBy(plan)
    process.stdout.write(
      `  wrote ${result.added} new, ${result.updated} updated` +
        (result.unresolved ? `, ${result.unresolved} held unresolved` : '') +
        (counts.conflict && !options.overwrite ? `, ${counts.conflict} conflict(s) skipped` : '') +
        '\n',
    )

    // Recorded by content hash, so the same note under a different name is still
    // recognized as processed.
    recordIngested(root, item.hash, {
      file: item.relativePath,
      ingested_at: new Date().toISOString().slice(0, 10),
      added: result.added,
      updated: result.updated,
    })
    if (options.archive) {
      process.stdout.write(`  archived → ${archive(root, item)}\n`)
    }
    process.stdout.write('\n')
  }
}

export function workspaceFor(dir: string): string {
  return openWorkspace(dir).root
}
