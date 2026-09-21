import { parseArgs } from 'node:util'
import { answerBrainQuestion } from '../src/brain/answer.ts'
import { assembleBrainInput } from '../src/brain/assemble.ts'
import { openWorkspace } from '../src/context.ts'
import { configuredSemanticEmbedder } from '../src/knowledge/embed.ts'
import { evaluateCitationFidelity } from '../src/knowledge/evals.ts'
import { consult } from '../src/knowledge/consult.ts'
import { check, connect } from '../src/knowledge/db.ts'
import { createProvider } from '../src/provider.ts'

const { values } = parseArgs({
  options: { provider: { type: 'string' } },
})
const provider = values.provider
if (provider !== 'codex-cli' && provider !== 'claude-cli') {
  throw new Error('Pass --provider codex-cli or --provider claude-cli.')
}

const db = connect()
try {
  const health = await check(db)
  if (!health.ok) throw new Error(health.reason)

  const semanticEmbedder = configuredSemanticEmbedder()
  const consultation = await consult({
    query: 'How should an early startup learn whether customers love its product?',
    domain: 'product market fit customer discovery',
    authors: ['sam-altman', 'steve-blank'],
    db,
    ...(semanticEmbedder ? { embedder: semanticEmbedder } : {}),
  })
  if (!consultation.ok) throw new Error(consultation.reason)

  const workspace = openWorkspace(process.env.FOUNDEROS_CONTEXT ?? './context/example')
  const response = await answerBrainQuestion({
    question: 'How should an early startup learn whether customers love its product?',
    workspace,
    contextKeys: ['metrics', 'feedback'],
    passages: consultation.passages,
    provider: createProvider(provider),
    retrievalMs: consultation.timing.totalMs,
  })
  if (response.mode !== 'answer') throw new Error(`Expected structured answer, got ${response.mode}: ${response.reason}`)

  const assembled = assembleBrainInput({
    question: 'How should an early startup learn whether customers love its product?',
    workspace,
    contextKeys: ['metrics', 'feedback'],
    passages: consultation.passages,
  })
  const fidelity = evaluateCitationFidelity({ assertions: response.assertions }, assembled.evidence)
  if (!fidelity.passed) throw new Error(`Citation fidelity failed: ${fidelity.issues.join('; ')}`)

  process.stdout.write(
    `${JSON.stringify({ provider, mode: response.mode, citationFidelity: fidelity.fidelity, timing: response.timing }, null, 2)}\n`,
  )
} finally {
  await db.end()
}
