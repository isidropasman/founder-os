import { loadSkills } from '../../src/skills.ts'
import { hasReasoningCredentials } from '../../src/offline.ts'
import { Console } from './console.tsx'

export const dynamic = 'force-dynamic'

export default async function Ask({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; skill?: string }>
}) {
  const params = await searchParams
  const skills = [...loadSkills().values()].map((s) => ({ id: s.id, purpose: s.purpose }))

  return (
    <Console
      skills={skills}
      initialQuery={params.q ?? ''}
      initialSkill={params.skill ?? 'focus'}
      credentialed={hasReasoningCredentials()}
    />
  )
}
