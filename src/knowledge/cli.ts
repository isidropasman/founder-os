import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { loadCorpus } from './corpus.ts'
import { check, connect, databaseUrl, migrate, reset } from './db.ts'
import { embedderFor, hashEmbedder } from './embed.ts'
import { embedAll, ingest } from './ingest.ts'
import { search, stats, type Kind } from './retrieve.ts'
import { syncManifest } from './sync.ts'
import { verifyQuotes } from './verify.ts'

const USAGE = `founderos knowledge <command>

  verify              Check every quoted principle against the fetched corpus (no DB, no network)
  status              Show database, extension and row counts
  migrate             Apply pending migrations
  reset               Drop and recreate the public schema (destructive)
  sync <author>       Rebuild an author's manifest from the files on disk
  ingest              Load corpus + expert packs into Postgres (deterministic, no model)
  embed [--allow-hash]  Embed everything not yet embedded (needs OPENAI_API_KEY)
  embed --clear       Null out every embedding (do this before switching embedders)
  search <query> [--kind claim|principle|framework] [--author id] [--limit n] [--semantic]

Environment: FOUNDEROS_DATABASE_URL (default ${databaseUrl()}), FOUNDEROS_EMBEDDINGS=openai|hash
`

function fail(message: string): never {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

export async function runKnowledgeCommand(argv?: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    ...(argv ? { args: argv } : {}),
    allowPositionals: true,
    options: {
      kind: { type: 'string', multiple: true },
      author: { type: 'string' },
      limit: { type: 'string' },
      semantic: { type: 'boolean', default: false },
      'allow-hash': { type: 'boolean', default: false },
      clear: { type: 'boolean', default: false },
      url: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  })

  const [command, ...rest] = positionals
  if (values.help || !command) {
    process.stdout.write(USAGE)
    process.exitCode = command ? 0 : 1
    return
  }

  // Quote verification is a filesystem operation on purpose: it must run in CI
  // and on a laptop with no Postgres and no API keys.
  if (command === 'verify') {
    const result = verifyQuotes()
    const errors = result.findings.filter((f) => f.level === 'error')
    const warnings = result.findings.filter((f) => f.level === 'warning')
    process.stdout.write(
      `${result.checked} principles checked, ${result.quoted} carrying verbatim quotes.\n`,
    )
    for (const f of errors) process.stdout.write(`  ERROR   ${f.principleId}: ${f.message}\n`)
    for (const f of warnings) process.stdout.write(`  warning ${f.principleId}: ${f.message}\n`)
    if (errors.length) fail(`\n${errors.length} unverifiable quote(s). Fix the pack or the corpus.`)
    process.stdout.write(
      result.quoted === 0
        ? '\nNothing was verified — no quotes were checked against any document.\n'
        : `\nAll ${result.quoted} quoted principles located in the corpus.\n`,
    )
    return
  }

  const db = connect()
  try {
    const health = await check(db)

    if (command === 'status') {
      if (!health.ok) fail(health.reason)
      const counts = await stats(db).catch(() => null)
      process.stdout.write(`${databaseUrl()}\n  ${health.version.split(',')[0]}\n  pgvector ${health.vector}\n`)
      if (!counts) {
        process.stdout.write('  schema not migrated — run: pnpm knowledge migrate\n')
        return
      }
      for (const [label, n] of Object.entries(counts)) {
        process.stdout.write(`  ${label.padEnd(20)} ${n}\n`)
      }
      const corpus = loadCorpus()
      process.stdout.write(`  corpus on disk       ${corpus.sources.size} sources\n`)
      return
    }

    if (!health.ok) fail(health.reason)

    if (command === 'migrate') {
      const applied = await migrate(db)
      process.stdout.write(applied.length ? `applied: ${applied.join(', ')}\n` : 'up to date\n')
      return
    }

    if (command === 'reset') {
      await reset(db)
      await migrate(db)
      process.stdout.write('schema reset and migrated\n')
      return
    }

    if (command === 'sync') {
      const author = rest[0]
      if (!author) fail('sync needs an author id, e.g. `knowledge sync paul-graham`')
      const report = syncManifest(author, {
        retrievedAt: new Date().toISOString().slice(0, 10),
        ...(values.url ? { urlPattern: values.url } : {}),
      })
      process.stdout.write(
        `${report.author}: ${report.added.length} added, ${report.updated.length} updated, ` +
          `${report.unchanged} unchanged, ${report.skipped.length} skipped\n`,
      )
      for (const s of report.skipped.slice(0, 10)) {
        process.stdout.write(`  skipped ${s.file} — ${s.reason}\n`)
      }
      if (report.skipped.length > 10) {
        process.stdout.write(`  ...and ${report.skipped.length - 10} more\n`)
      }
      return
    }

    if (command === 'ingest') {
      const report = await ingest(db)
      for (const [label, value] of Object.entries(report)) {
        if (label === 'unlocatedQuotes') continue
        process.stdout.write(`  ${label.padEnd(12)} ${value}\n`)
      }
      if (report.unlocatedQuotes.length) {
        fail(`\nQuotes not locatable in any claim: ${report.unlocatedQuotes.join(', ')}`)
      }
      return
    }

    if (command === 'embed') {
      if (values.clear) {
        for (const table of ['claims', 'principles', 'frameworks']) {
          await db.query(`UPDATE ${table} SET embedding = NULL`)
        }
        process.stdout.write('cleared all embeddings\n')
        return
      }
      const embedder = embedderFor()
      if (!embedder.semantic && !values['allow-hash']) {
        fail(
          'Refusing to write non-semantic hash vectors. Pass --allow-hash if this is a test corpus.',
        )
      }
      const report = await embedAll(db, embedder)
      for (const row of report) process.stdout.write(`  ${row.table.padEnd(12)} ${row.embedded}\n`)
      if (!embedder.semantic) {
        process.stdout.write('  NOTE: hash embeddings are lexical, not semantic. Test use only.\n')
      }
      return
    }

    if (command === 'search') {
      const query = rest.join(' ')
      if (!query) fail('search needs a query')
      const hits = await search(db, query, {
        limit: values.limit ? Number(values.limit) : 10,
        ...(values.kind?.length ? { kinds: values.kind as Kind[] } : {}),
        ...(values.author ? { authorId: values.author } : {}),
        ...(values.semantic ? { embedder: embedderFor() } : {}),
      })
      if (hits.length === 0) {
        process.stdout.write('no results\n')
        return
      }
      for (const hit of hits) {
        const modes = [
          hit.lexicalRank ? `lex#${hit.lexicalRank}` : null,
          hit.vectorRank ? `vec#${hit.vectorRank}` : null,
        ]
          .filter(Boolean)
          .join(' ')
        process.stdout.write(
          `\n${hit.kind.toUpperCase()}  ${hit.id}  [${modes}]  ${hit.score.toFixed(4)}\n` +
            `  ${hit.title}\n` +
            `  ${hit.text.replace(/\s+/g, ' ').slice(0, 240)}${hit.text.length > 240 ? '…' : ''}\n`,
        )
      }
      return
    }

    fail(`Unknown command "${command}".\n\n${USAGE}`)
  } finally {
    await db.end()
  }
}

// Only self-executes as `pnpm knowledge`; the main CLI imports and delegates.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runKnowledgeCommand().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
}

export { hashEmbedder }
