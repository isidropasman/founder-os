import Link from 'next/link'

export function PassageLink({ passageId, sourceVersionId }: { passageId: string; sourceVersionId: string }) {
  const query = new URLSearchParams({ passage: passageId, 'source-version': sourceVersionId })
  return (
    <Link className="link passage-link" href={`/knowledge?${query.toString()}`}>
      {passageId}
    </Link>
  )
}
