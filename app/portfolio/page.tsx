import { PortfolioConsole } from './console.tsx'
import { loadPortfolio } from '../../src/portfolio/store.ts'

export const dynamic = 'force-dynamic'

export default function PortfolioPage() {
  return <PortfolioConsole initial={loadPortfolio()} />
}
