import { renderContext, selectContext, type ContextKey, type Workspace } from '../context.ts'
import { renderPassages, type Passage } from '../knowledge/consult.ts'
import type { BrainEvidence } from './contract.ts'

export type AssembleBrainInput = {
  question: string
  workspace: Workspace
  contextKeys: readonly ContextKey[]
  passages: Passage[]
  ruleIds?: readonly string[]
}

export type AssembledBrainInput = {
  prompt: string
  selected: Record<string, unknown>
  passages: Passage[]
  evidence: BrainEvidence
}

function addPaths(value: unknown, prefix: string, paths: Set<string>): void {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) addPaths(item, `${prefix}.${index}`, paths)
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) addPaths(item, `${prefix}.${key}`, paths)
    return
  }
  paths.add(prefix)
}

export function assembleBrainInput(input: AssembleBrainInput): AssembledBrainInput {
  const selected = selectContext(input.workspace, input.contextKeys)
  const startupPaths = new Set<string>()
  for (const [key, value] of Object.entries(selected)) addPaths(value, key, startupPaths)
  const passages = new Map(input.passages.map((passage) => [passage.id, passage.text]))

  return {
    selected,
    passages: input.passages,
    evidence: {
      startupPaths,
      passages,
      ruleIds: new Set(input.ruleIds ?? []),
    },
    prompt: [
      `Question: ${input.question}`,
      '',
      'Private startup context:',
      renderContext(selected),
      '',
      'Retrieved source passages:',
      renderPassages(input.passages),
    ].join('\n'),
  }
}
