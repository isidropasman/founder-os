import { progress, STEPS } from '../../src/setup.ts'
import { Walkthrough } from './walkthrough.tsx'

export const dynamic = 'force-dynamic'

export default function Setup() {
  const root = process.env.FOUNDEROS_CONTEXT ?? './context/example'
  return <Walkthrough steps={STEPS} done={progress(root).filter((s) => s.done).map((s) => s.id)} />
}
