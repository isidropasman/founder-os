import { existsSync, readdirSync } from 'node:fs'
import { openWorkspace } from './context.ts'
import { loadCorpus } from './knowledge/corpus.ts'
import { check, connect } from './knowledge/db.ts'
import { loadExperts } from './experts.ts'
import { loadSkills } from './skills.ts'
import { verifyQuotes } from './knowledge/verify.ts'

export type CheckStatus = 'ok' | 'degraded' | 'missing'

export type CheckResult = {
  name: string
  status: CheckStatus
  detail: string
  /** The exact command that fixes it. Nothing here says "configure X" without saying how. */
  fix?: string
  /** What still works without it — so a founder knows whether to stop or continue. */
  without?: string
}

const MARKS: Record<CheckStatus, string> = { ok: '✓', degraded: '~', missing: '✗' }

function checkRuntime(): CheckResult {
  const major = Number(process.versions.node.split('.')[0])
  return major >= 22
    ? { name: 'Node 22+', status: 'ok', detail: `v${process.versions.node}` }
    : {
        name: 'Node 22+',
        status: 'missing',
        detail: `v${process.versions.node} — too old for --env-file-if-exists`,
        fix: 'nvm use 22',
      }
}

function checkWorkspace(dir: string): CheckResult {
  try {
    const ws = openWorkspace(dir)
    return { name: 'Your company', status: 'ok', detail: `${ws.root} (${ws.hash.slice(0, 20)}…)` }
  } catch (error) {
    return {
      name: 'Your company',
      status: 'missing',
      detail: error instanceof Error ? error.message.split('\n')[0]! : String(error),
      fix: `founderos init ${dir}`,
    }
  }
}

function checkSkills(): CheckResult {
  try {
    const skills = loadSkills()
    const experts = loadExperts()
    return {
      name: 'Skills and experts',
      status: 'ok',
      detail: `${skills.size} skills, ${experts.size} expert packs`,
    }
  } catch (error) {
    return {
      name: 'Skills and experts',
      status: 'missing',
      detail: error instanceof Error ? error.message.split('\n')[0]! : String(error),
    }
  }
}

function checkCorpus(): CheckResult {
  const corpus = loadCorpus()
  if (corpus.sources.size === 0) {
    return {
      name: 'Corpus on disk',
      status: 'missing',
      detail: 'no source documents fetched',
      fix: './scripts/fetch-paul-graham.sh && founderos knowledge sync paul-graham --url "https://paulgraham.com/{id}.html"',
      without: 'answers still work, but cite nothing from the authors themselves',
    }
  }
  const verification = verifyQuotes(corpus)
  const errors = verification.findings.filter((f) => f.level === 'error')
  return errors.length === 0
    ? {
        name: 'Corpus on disk',
        status: 'ok',
        detail: `${corpus.sources.size} sources, ${verification.quoted} verified quotes`,
      }
    : {
        name: 'Corpus on disk',
        status: 'degraded',
        detail: `${errors.length} quote(s) no longer locatable`,
        fix: 'founderos knowledge verify',
      }
}

async function checkDatabase(): Promise<CheckResult[]> {
  const db = connect()
  try {
    const health = await check(db)
    if (!health.ok) {
      return [
        {
          name: 'Knowledge base',
          status: 'missing',
          detail: health.reason.split('\n')[0]!,
          fix: './scripts/db-setup.sh && founderos knowledge migrate && founderos knowledge ingest',
          without: 'answers lose the corpus passages; everything else works',
        },
      ]
    }

    const counts = await db
      .query<{ claims: string; embedded: string }>(
        `SELECT (SELECT count(*) FROM claims)::text AS claims,
                (SELECT count(*) FROM claims WHERE embedding IS NOT NULL)::text AS embedded`,
      )
      .catch(() => null)

    if (!counts) {
      return [
        {
          name: 'Knowledge base',
          status: 'missing',
          detail: 'reachable, but the schema is not migrated',
          fix: 'founderos knowledge migrate && founderos knowledge ingest',
        },
      ]
    }

    const claims = Number(counts.rows[0]?.claims ?? 0)
    const embedded = Number(counts.rows[0]?.embedded ?? 0)

    return [
      claims === 0
        ? {
            name: 'Knowledge base',
            status: 'missing',
            detail: 'migrated but empty',
            fix: 'founderos knowledge ingest',
          }
        : {
            name: 'Knowledge base',
            status: 'ok',
            detail: `${claims} passages, pgvector ${health.vector}`,
          },
      embedded > 0
        ? { name: 'Semantic search', status: 'ok', detail: `${embedded} passages embedded` }
        : {
            name: 'Semantic search',
            status: 'degraded',
            detail: 'no embeddings — retrieval is lexical only',
            fix: 'set OPENAI_API_KEY, then: FOUNDEROS_EMBEDDINGS=openai founderos knowledge embed',
            without:
              'search works but is weak on ambiguous wording ("raise prices" drifts to "raise money")',
          },
    ]
  } finally {
    await db.end()
  }
}

function checkCredentials(): CheckResult[] {
  const anthropic = Boolean(process.env.ANTHROPIC_API_KEY)
  const openai = Boolean(process.env.OPENAI_API_KEY)
  const envFile = existsSync('.env')

  return [
    anthropic
      ? { name: 'ANTHROPIC_API_KEY', status: 'ok', detail: 'set' }
      : {
          name: 'ANTHROPIC_API_KEY',
          status: 'missing',
          detail: envFile ? 'not in .env' : 'no .env file',
          fix: 'cp .env.example .env, then add the key from console.anthropic.com',
          without: '`founderos ask` cannot run. status, context and knowledge search still work',
        },
    openai
      ? { name: 'OPENAI_API_KEY', status: 'ok', detail: 'set' }
      : {
          name: 'OPENAI_API_KEY',
          status: 'degraded',
          detail: 'not set',
          fix: 'add OPENAI_API_KEY to .env',
          without: 'no semantic search and no `gpt-vanilla` eval arm; everything else works',
        },
  ]
}

function checkRecordings(): CheckResult {
  const dir = 'test/fixtures/runs'
  const count = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')).length : 0
  return count > 0
    ? { name: 'Offline replay', status: 'ok', detail: `${count} recorded run(s)` }
    : {
        name: 'Offline replay',
        status: 'degraded',
        detail: 'no recordings',
        fix: 'founderos ask "..." --save-run <name>',
      }
}

export async function diagnose(workspaceDir: string): Promise<CheckResult[]> {
  return [
    checkRuntime(),
    checkWorkspace(workspaceDir),
    checkSkills(),
    checkCorpus(),
    ...(await checkDatabase()),
    ...checkCredentials(),
    checkRecordings(),
  ]
}

/**
 * The point of this output is that someone who has never seen the repo can read it
 * and know exactly what to run next. Every non-ok line carries a command, and says
 * what still works without it — a founder should never have to guess whether a
 * warning means "stop" or "carry on".
 */
export function renderDiagnosis(results: CheckResult[]): string {
  const lines: string[] = []
  const width = Math.max(...results.map((r) => r.name.length))

  for (const result of results) {
    lines.push(`  ${MARKS[result.status]} ${result.name.padEnd(width)}  ${result.detail}`)
    if (result.fix) lines.push(`      fix: ${result.fix}`)
    if (result.without) lines.push(`      without it: ${result.without}`)
  }

  const missing = results.filter((r) => r.status === 'missing')
  const degraded = results.filter((r) => r.status === 'degraded')

  lines.push('')
  if (missing.length === 0 && degraded.length === 0) {
    lines.push('Everything is configured. Try: founderos ask "Where should I focus this week?"')
  } else if (missing.length === 0) {
    lines.push(
      `Usable. ${degraded.length} thing(s) degraded — see above for what each one costs you.`,
    )
  } else {
    lines.push(`${missing.length} thing(s) missing. Fix them top to bottom; each line has the command.`)
  }

  return lines.join('\n')
}

export function worstStatus(results: CheckResult[]): CheckStatus {
  if (results.some((r) => r.status === 'missing')) return 'missing'
  return results.some((r) => r.status === 'degraded') ? 'degraded' : 'ok'
}
