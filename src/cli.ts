import { parseArgs } from 'node:util'
import { openWorkspace } from './context.ts'
import { contextAdd, contextImport, contextIngest } from './ingest/cli.ts'
import { renderContextOverview } from './ingest/show.ts'
import { ensureInbox } from './ingest/inbox.ts'
import { initWorkspace } from './init.ts'
import { diagnose, renderDiagnosis, worstStatus } from './doctor.ts'
import { detectSignals, renderSignals } from './signals.ts'
import { run } from './pipeline.ts'
import { explainProviderError, modelForRole } from './provider.ts'
import type { Challenge } from './outputs.ts'
import { renderBrief, renderChallenge } from './render.ts'
import { recordFromTrace } from './replay.ts'
import { buildOfflineBrief, hasReasoningCredentials, renderOfflineBrief } from './offline.ts'
import { runKnowledgeCommand } from './knowledge/cli.ts'

const USAGE = `founderos <command>

  doctor               What is configured, what is missing, and the exact fix
  ask "<question>"     Answer a founder question through the full pipeline
  init [dir]           Scaffold an empty context workspace (never overwrites)

  status               What needs your attention. Rule-based, no model, no cost.
  knowledge <cmd>      Search and manage the corpus (search, status, sync, ingest, verify)
  context show         What FounderOS currently knows            [--full]
  context add "<text>" Structure pasted notes into context
  context import <path> Structure a file or a folder of files
  context ingest       Process everything dropped in <workspace>/inbox/

Ingestion is preview-only until you pass --apply:
  --apply           Write the changes shown in the preview
  --overwrite       Also apply conflicts, which replace values you wrote
  --force           Reprocess inbox files already recorded as ingested
  --archive         Move processed inbox files to inbox/processed/
  --record          Save the raw extraction as a test fixture
  --extractor <id>  "llm" (default) or "fixture" (offline, replays recordings)

Options for ask:
  --skill <id>      Pin a skill and skip the router
  --no-challenge    Skip the challenger pass (for measuring what it contributes)
  --no-experts      Skip expert packs (for measuring what they contribute)
  --no-corpus       Skip the knowledge base (for measuring what it contributes)
  --context <dir>   Workspace directory (default: $FOUNDEROS_CONTEXT or ./context/example)
  --offline         Answer with no model: procedure, your state, and real quotes
  --verbose         Show every challenger finding, not just the strongest
  --save-run <name> Save this run as an offline replay fixture
  --json            Print the raw brief instead of the rendered one
`

function render(
  brief: unknown,
  challenge: Challenge | null,
  betterQuestion: string | null,
  verbose: boolean,
): string {
  const lines: string[] = []
  if (betterQuestion) {
    lines.push('\u26a0 I can answer what you asked, but the higher-leverage question is:')
    lines.push(`  ${betterQuestion}`, '')
  }
  lines.push(renderBrief(brief))
  if (challenge) lines.push('', renderChallenge(challenge, verbose))
  return lines.join('\n')
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return ''
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

async function main(): Promise<void> {
  // Delegated before parsing: the knowledge commands own flags this parser does
  // not declare, and parseArgs rejects unknown options rather than passing them on.
  if (process.argv[2] === 'knowledge') {
    await runKnowledgeCommand(process.argv.slice(3))
    return
  }

  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      skill: { type: 'string' },
      context: { type: 'string' },
      'no-challenge': { type: 'boolean', default: false },
      'no-experts': { type: 'boolean', default: false },
      'no-corpus': { type: 'boolean', default: false },
      apply: { type: 'boolean', default: false },
      overwrite: { type: 'boolean', default: false },
      record: { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      archive: { type: 'boolean', default: false },
      full: { type: 'boolean', default: false },
      verbose: { type: 'boolean', default: false },
      offline: { type: 'boolean', default: false },
      'save-run': { type: 'string' },
      extractor: { type: 'string' },
      json: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  })

  const [command, argument] = positionals
  const workspaceDir = values.context ?? process.env.FOUNDEROS_CONTEXT ?? './context/example'

  if (values.help || !command) {
    process.stdout.write(USAGE)
    process.exitCode = values.help ? 0 : 1
    return
  }

  if (command === 'init') {
    const target = argument ?? workspaceDir
    const report = initWorkspace(target)
    for (const file of report.created) process.stdout.write(`  created  ${file}\n`)
    for (const file of report.skipped) process.stdout.write(`  kept     ${file}\n`)
    process.stdout.write(`\nFill these in, then: FOUNDEROS_CONTEXT=${target} pnpm founderos context\n`)
    return
  }

  if (command === 'doctor') {
    const results = await diagnose(workspaceDir)
    process.stdout.write(`FounderOS\n${renderDiagnosis(results)}\n`)
    // Non-zero only when something is outright missing, so `doctor` is usable in
    // a setup script without failing on a degraded-but-working install.
    if (worstStatus(results) === 'missing') process.exitCode = 1
    return
  }

  if (command === 'status') {
    const ws = openWorkspace(workspaceDir)
    process.stdout.write(`${renderSignals(detectSignals(ws, new Date()))}\n`)
    return
  }

  if (command === 'context') {
    const sub = argument ?? 'show'
    const options = {
      apply: values.apply ?? false,
      overwrite: values.overwrite ?? false,
      record: values.record ?? false,
      force: values.force ?? false,
      archive: values.archive ?? false,
      ...(values.extractor ? { extractor: values.extractor } : {}),
    }

    if (sub === 'show') {
      // Loads and validates every key, so a broken file surfaces here rather
      // than halfway through a run.
      process.stdout.write(`${renderContextOverview(openWorkspace(workspaceDir), { full: values.full ?? false })}\n`)
      return
    }
    if (sub === 'add') {
      const text = positionals[2] ?? (await readStdin())
      if (!text.trim()) {
        process.stderr.write('Nothing to add. Pass text as an argument or pipe it on stdin.\n')
        process.exitCode = 1
        return
      }
      await contextAdd(openWorkspace(workspaceDir).root, text, options)
      return
    }
    if (sub === 'import') {
      const path = positionals[2]
      if (!path) {
        process.stderr.write('context import needs a file or directory path.\n')
        process.exitCode = 1
        return
      }
      await contextImport(openWorkspace(workspaceDir).root, path, options)
      return
    }
    if (sub === 'ingest') {
      await contextIngest(openWorkspace(workspaceDir).root, options)
      return
    }
    if (sub === 'inbox') {
      process.stdout.write(`${ensureInbox(openWorkspace(workspaceDir).root)}\n`)
      return
    }

    process.stderr.write(`Unknown context command "${sub}". Try: show, add, import, ingest.\n`)
    process.exitCode = 1
    return
  }

  const query = argument
  if (command !== 'ask' || !query) {
    process.stdout.write(USAGE)
    process.exitCode = 1
    return
  }

  const workspace = openWorkspace(workspaceDir)

  // Without credentials the choice is an error message or the material a model
  // would have reasoned over. The second is worth more than the first, and the
  // quotes in it are the author's rather than an imitation of them.
  if (values.offline || !hasReasoningCredentials()) {
    if (!values.offline) {
      process.stderr.write('No model credentials — answering offline. `founderos doctor` for the fix.\n\n')
    }
    const brief = await buildOfflineBrief({
      query,
      workspace,
      skillId: values.skill ?? 'focus',
      now: new Date(),
    })
    process.stdout.write(`${renderOfflineBrief(brief, workspace, new Date())}\n`)
    return
  }

  const result = await run({
    query,
    workspace,
    ...(values.skill ? { pinnedSkill: values.skill } : {}),
    challenge: !values['no-challenge'],
    useExperts: !values['no-experts'],
    useCorpus: !values['no-corpus'],
  })

  process.stdout.write(
    values.json
      ? `${JSON.stringify({ brief: result.brief, challenge: result.challenge, routing: result.routing }, null, 2)}\n`
      : `${render(result.brief, result.challenge, result.routing.better_question, values.verbose ?? false)}\n`,
  )
  process.stderr.write(`\ntrace: ${result.tracePath}\n`)
  const saveRun = values['save-run']
  if (saveRun) {
    // A paid run becomes a regression fixture at no extra cost.
    process.stderr.write(`recorded: ${recordFromTrace(result.trace, saveRun)}\n`)
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${explainProviderError(modelForRole('reason'), error)}\n`)
  process.exitCode = 1
})
