'use server'

import { revalidatePath } from 'next/cache'
import { readProviderSelection, writeProviderSelection } from '../../src/providers/connection.ts'
import { localCliSessionStatus } from '../../src/providers/local-cli.ts'

type CodexStatus = Awaited<ReturnType<typeof localCliSessionStatus>>

export type ProviderConnectionsView = {
  selected: 'codex-cli' | null
  codex: CodexStatus
}

export type ProviderConnectionsAction =
  | { ok: true; view: ProviderConnectionsView }
  | { ok: false; message: string; view: ProviderConnectionsView }

function workspaceRoot(): string {
  return process.env.FOUNDEROS_CONTEXT ?? './context/example'
}

export async function loadProviderConnections(): Promise<ProviderConnectionsView> {
  const root = workspaceRoot()
  return { selected: readProviderSelection(root)?.provider ?? null, codex: await localCliSessionStatus('codex-cli') }
}

export async function selectCodexConnection(): Promise<ProviderConnectionsAction> {
  const view = await loadProviderConnections()
  if (!view.codex.ok) return { ok: false, message: view.codex.reason, view }

  writeProviderSelection(workspaceRoot(), { provider: 'codex-cli' })
  revalidatePath('/providers')
  return { ok: true, view: { ...view, selected: 'codex-cli' } }
}

export async function disconnectProvider(): Promise<ProviderConnectionsAction> {
  writeProviderSelection(workspaceRoot(), null)
  revalidatePath('/providers')
  return { ok: true, view: { ...(await loadProviderConnections()), selected: null } }
}
