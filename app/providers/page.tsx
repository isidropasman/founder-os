import { ProvidersConsole } from './console.tsx'
import { loadProviderConnections } from './actions.ts'

export const dynamic = 'force-dynamic'

export default async function ProvidersPage() {
  return <ProvidersConsole initial={await loadProviderConnections()} />
}
