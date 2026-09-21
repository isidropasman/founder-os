import { z } from 'zod'

const RetrievalSchema = z.object({
  method: z.enum(['direct_html', 'local_text', 'provided_transcript']),
  status: z.enum(['approved', 'review_required', 'blocked']),
  retrieved_at: z.union([z.string(), z.date()]).transform((value) =>
    typeof value === 'string' ? value : value.toISOString().slice(0, 10),
  ),
})

const SourcePolicySchema = z.object({
  retrieval: RetrievalSchema,
  redistribution: z.enum(['prohibited', 'citation_only', 'permitted']),
})

export type RetrievalStatus = z.infer<typeof RetrievalSchema>['status']

export type SourcePolicy = {
  method: z.infer<typeof RetrievalSchema>['method']
  status: RetrievalStatus
  retrievedAt: string
  redistribution: z.infer<typeof SourcePolicySchema>['redistribution']
}

export type SourceManifestEntry = {
  id: string
  file: string
  title: string
  kind: 'essay' | 'talk' | 'book' | 'post' | 'transcript' | 'note'
  url?: string
  year?: number
  retrievedAt: string
  policy: SourcePolicy
}

export type SourceManifestResult =
  | { ok: true; value: SourceManifestEntry }
  | { ok: false; issues: string[] }

const SourceManifestEntrySchema = z.object({
  id: z.string(),
  file: z.string(),
  title: z.string(),
  kind: z.enum(['essay', 'talk', 'book', 'post', 'transcript', 'note']),
  url: z
    .string()
    .url()
    .refine((value) => {
      const protocol = new URL(value).protocol
      return protocol === 'http:' || protocol === 'https:'
    }, 'must use http or https')
    .optional(),
  year: z.number().int().optional(),
  retrieved_at: z.union([z.string(), z.date()]).transform((value) =>
    typeof value === 'string' ? value : value.toISOString().slice(0, 10),
  ),
  ...SourcePolicySchema.shape,
})

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join('.')
    return `${path === 'retrieval' ? 'retrieval.status' : path || '(root)'}: ${issue.message}`
  })
}

function toPolicy(value: z.infer<typeof SourcePolicySchema>): SourcePolicy {
  return {
    method: value.retrieval.method,
    status: value.retrieval.status,
    retrievedAt: value.retrieval.retrieved_at,
    redistribution: value.redistribution,
  }
}

export function parseSourceManifestEntry(input: unknown): SourceManifestResult {
  const parsed = SourceManifestEntrySchema.safeParse(input)
  if (!parsed.success) return { ok: false, issues: formatIssues(parsed.error) }
  const value = parsed.data
  return {
    ok: true,
    value: {
      id: value.id,
      file: value.file,
      title: value.title,
      kind: value.kind,
      ...(value.url ? { url: value.url } : {}),
      ...(value.year ? { year: value.year } : {}),
      retrievedAt: value.retrieved_at,
      policy: toPolicy(value),
    },
  }
}

export function parseSourcePolicy(input: unknown):
  | { ok: true; value: SourcePolicy }
  | { ok: false; issues: string[] } {
  const parsed = SourcePolicySchema.safeParse(input)
  if (!parsed.success) return { ok: false, issues: formatIssues(parsed.error) }
  return { ok: true, value: toPolicy(parsed.data) }
}
