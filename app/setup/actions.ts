'use server'

import { saveStep, type StepValues } from '../../src/setup.ts'

function workspaceRoot(): string {
  return process.env.FOUNDEROS_CONTEXT ?? './context/example'
}

export async function persist(
  stepId: string,
  values: StepValues | StepValues[],
): Promise<{ ok: true; wrote: number } | { ok: false; message: string }> {
  try {
    const result = saveStep(workspaceRoot(), stepId, values)
    return { ok: true, wrote: result.wrote }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}
