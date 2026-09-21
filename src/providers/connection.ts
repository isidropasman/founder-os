import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

const ProviderSelectionSchema = z.object({ provider: z.literal('codex-cli') })

export type ProviderSelection = z.infer<typeof ProviderSelectionSchema>

export function providerSelectionPath(root: string): string {
  return join(root, '.founderos', 'provider.json')
}

export function readProviderSelection(root: string): ProviderSelection | null {
  const path = providerSelectionPath(root)
  if (!existsSync(path)) return null

  try {
    return ProviderSelectionSchema.safeParse(JSON.parse(readFileSync(path, 'utf8'))).data ?? null
  } catch {
    return null
  }
}

export function writeProviderSelection(root: string, selection: ProviderSelection | null): void {
  const path = providerSelectionPath(root)
  if (selection === null) {
    rmSync(path, { force: true })
    return
  }

  mkdirSync(join(root, '.founderos'), { recursive: true })
  writeFileSync(path, `${JSON.stringify(ProviderSelectionSchema.parse(selection), null, 2)}\n`)
}
