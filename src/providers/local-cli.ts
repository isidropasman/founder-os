import { accessSync, constants } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { spawn } from 'node:child_process'

export type LocalCliSpec = 'codex-cli' | 'claude-cli'

export type ProviderAvailability =
  | { ok: true; provider: string }
  | { ok: false; reason: string }

export type LocalCliEnvironment = {
  PATH?: string | undefined
}

export type LocalCliRequest = {
  system: string
  prompt: string
  maxOutputTokens?: number
  outputSchema?: unknown
}

export type LocalCliRun =
  | { ok: true; output: string; ms: number }
  | { ok: false; reason: string }

const COMMANDS: Record<LocalCliSpec, { executable: string; label: string }> = {
  'codex-cli': { executable: 'codex', label: 'codex' },
  'claude-cli': { executable: 'claude', label: 'claude' },
}

const MAX_OUTPUT_BYTES = 1_000_000

export function isLocalCliSpec(spec: string): spec is LocalCliSpec {
  return spec === 'codex-cli' || spec === 'claude-cli'
}

function commandOnPath(command: string, pathValue: string | undefined): boolean {
  if (!pathValue) return false

  return pathValue.split(delimiter).some((entry) => {
    if (!entry) return false
    try {
      accessSync(join(entry, command), constants.X_OK)
      return true
    } catch {
      return false
    }
  })
}

export function localCliAvailability(
  spec: LocalCliSpec,
  environment: LocalCliEnvironment = { PATH: process.env.PATH },
): ProviderAvailability {
  const command = COMMANDS[spec]
  return commandOnPath(command.executable, environment.PATH)
    ? { ok: true, provider: spec }
    : { ok: false, reason: `${command.label} CLI not found on PATH` }
}

function commandFor(spec: LocalCliSpec, request: LocalCliRequest, outputPath: string | null, schemaPath: string | null): { executable: string; args: string[] } {
  if (spec === 'codex-cli') {
    return {
      executable: COMMANDS[spec].executable,
      args: ['exec', '--sandbox', 'read-only', '--ephemeral', '--output-last-message', outputPath ?? '', ...(schemaPath ? ['--output-schema', schemaPath] : []), '-'],
    }
  }

  return {
    executable: COMMANDS[spec].executable,
    args: [
      '--print',
      '--restricted',
      '--no-session-persistence',
      '--output-format',
      'text',
      '--system-prompt',
      `${request.system}\n\nThe user request arrives as JSON on standard input. Follow its prompt field and return only the answer.`,
    ],
  }
}

export function inputForLocalCli(spec: LocalCliSpec, request: LocalCliRequest): string {
  if (spec === 'codex-cli') {
    return `${request.system}\n\n${request.prompt}\n\nReturn only the requested answer.`
  }
  return JSON.stringify({ system: request.system, prompt: request.prompt })
}

export async function runLocalCli(spec: LocalCliSpec, request: LocalCliRequest): Promise<LocalCliRun> {
  const availability = localCliAvailability(spec)
  if (!availability.ok) return availability

  const outputDirectory = spec === 'codex-cli' ? await mkdtemp(join(tmpdir(), 'founderos-codex-cli-')) : null
  const outputPath = outputDirectory ? join(outputDirectory, 'last-message.json') : null
  const schemaPath = outputDirectory && request.outputSchema !== undefined ? join(outputDirectory, 'output-schema.json') : null
  if (schemaPath) await writeFile(schemaPath, JSON.stringify(request.outputSchema))
  const command = commandFor(spec, request, outputPath, schemaPath)
  const started = Date.now()

  try {
    return await new Promise((resolve) => {
      // The authenticated harness is intentionally resolved from the local PATH at runtime.
      const child = spawn(/* turbopackIgnore: true */ command.executable, command.args, { stdio: ['pipe', 'pipe', 'pipe'] })
      const output: Buffer[] = []
      const errors: Buffer[] = []
      let outputBytes = 0
      let exceededOutputLimit = false
      let settled = false

      const settle = (result: LocalCliRun) => {
        if (settled) return
        settled = true
        resolve(result)
      }

      child.stdout.on('data', (chunk: Buffer) => {
        outputBytes += chunk.byteLength
        if (outputBytes > MAX_OUTPUT_BYTES) {
          exceededOutputLimit = true
          child.kill()
          return
        }
        output.push(chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => errors.push(chunk))
      child.on('error', (error) => settle({ ok: false, reason: error.message }))
      child.on('close', async (code) => {
        if (exceededOutputLimit) {
          settle({ ok: false, reason: `${spec} exceeded the ${MAX_OUTPUT_BYTES}-byte output limit` })
          return
        }
        if (code !== 0) {
          const detail = Buffer.concat(errors).toString('utf8').trim()
          settle({ ok: false, reason: detail || `${spec} exited with code ${code ?? 'unknown'}` })
          return
        }
        if (outputPath) {
          try {
            settle({ ok: true, output: await readFile(outputPath, 'utf8'), ms: Date.now() - started })
          } catch (error) {
            settle({ ok: false, reason: error instanceof Error ? error.message : String(error) })
          }
          return
        }
        settle({ ok: true, output: Buffer.concat(output).toString('utf8'), ms: Date.now() - started })
      })
      child.stdin.end(inputForLocalCli(spec, request))
    })
  } finally {
    if (outputDirectory) await rm(outputDirectory, { recursive: true, force: true })
  }
}
