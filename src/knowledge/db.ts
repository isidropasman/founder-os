import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const MIGRATIONS_DIR = 'migrations'

export const DEFAULT_DATABASE_URL = 'postgres://localhost:5432/founderos'

export function databaseUrl(): string {
  return process.env.FOUNDEROS_DATABASE_URL ?? DEFAULT_DATABASE_URL
}

export type Db = pg.Pool

export function connect(url = databaseUrl()): Db {
  return new pg.Pool({ connectionString: url, max: 4 })
}

export type DbCheck =
  | { ok: true; version: string; vector: string }
  | { ok: false; reason: string }

/** Every knowledge command starts here so a missing database is a sentence, not a stack trace. */
export async function check(db: Db): Promise<DbCheck> {
  try {
    const version = await db.query<{ v: string }>('SELECT version() AS v')
    const vector = await db.query<{ extversion: string }>(
      "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
    )
    const installed = vector.rows[0]?.extversion
    if (!installed) {
      return { ok: false, reason: 'pgvector is not installed. Run: CREATE EXTENSION vector;' }
    }
    return { ok: true, version: version.rows[0]?.v ?? 'unknown', vector: installed }
  } catch (error) {
    return {
      ok: false,
      reason: `Cannot reach Postgres at ${databaseUrl()}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

async function ensureMigrationsTable(db: Db): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `)
}

export async function migrate(db: Db): Promise<string[]> {
  await ensureMigrationsTable(db)
  const applied = new Set(
    (await db.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
  )
  const pending = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .filter((f) => !applied.has(f))

  for (const name of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, name), 'utf8')
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK')
      throw new Error(`Migration ${name} failed: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      client.release()
    }
  }

  return pending
}

export async function reset(db: Db): Promise<void> {
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
}
