import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const TRACE_DIR = 'traces'

export type TraceStep = {
  name: string
  model: string
  system: string
  prompt: string
  raw: string
  tokensIn: number
  tokensOut: number
  ms: number
}

export type Trace = {
  run_id: string
  query: string
  flags: Record<string, boolean>
  versions: {
    skills: Record<string, number>
    experts: Record<string, number>
    context_hash: string
  }
  steps: TraceStep[]
  /** Corpus passage ids handed to the reasoning step, so an answer is reproducible. */
  passages?: string[]
  corpus_unavailable?: string
  final: unknown
  error: string | null
}

export function newRunId(now: Date): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-').replace('Z', '')
  return `${stamp}-${Math.random().toString(36).slice(2, 6)}`
}

export function writeTrace(trace: Trace): string {
  mkdirSync(TRACE_DIR, { recursive: true })
  const path = join(TRACE_DIR, `${trace.run_id}.json`)
  writeFileSync(path, JSON.stringify(trace, null, 2))
  return path
}
