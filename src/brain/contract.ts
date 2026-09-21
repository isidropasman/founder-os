import { z } from 'zod'
import { containsQuote } from '../knowledge/text.ts'

const BasisSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('startup_data'), path: z.string().min(1) }),
  z.object({ kind: z.literal('source'), passageId: z.string().min(1), quote: z.string().min(1) }),
  z.object({ kind: z.literal('rule'), ruleId: z.string().min(1) }),
  z.object({ kind: z.literal('inference') }),
])

export const BrainAnswerSchema = z.object({
  assertions: z
    .array(
      z.object({
        text: z.string().min(1),
        basis: z.array(BasisSchema).min(1),
      }),
    )
    .min(1),
})

export type BrainEvidence = {
  startupPaths: ReadonlySet<string>
  passages: ReadonlyMap<string, string>
  ruleIds: ReadonlySet<string>
}

export type BrainAnswer = z.infer<typeof BrainAnswerSchema>

export type BrainAnswerValidation =
  | { ok: true; value: BrainAnswer }
  | { ok: false; issues: string[] }

function formatPath(path: PropertyKey[]): string {
  return path.reduce<string>((result, part) => {
    if (typeof part === 'number') return `${result}[${part}]`
    const key = String(part)
    return result.length === 0 ? key : `${result}.${key}`
  }, '')
}

export function validateBrainAnswer(input: unknown, evidence: BrainEvidence): BrainAnswerValidation {
  const parsed = BrainAnswerSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => `${formatPath(issue.path)}: ${issue.message}`),
    }
  }

  const issues: string[] = []
  for (const [assertionIndex, assertion] of parsed.data.assertions.entries()) {
    for (const [basisIndex, basis] of assertion.basis.entries()) {
      const path = `assertions[${assertionIndex}].basis[${basisIndex}]`
      if (basis.kind === 'startup_data' && !evidence.startupPaths.has(basis.path)) {
        issues.push(`${path}: startup path not available`)
      }
      if (basis.kind === 'source') {
        const passage = evidence.passages.get(basis.passageId)
        if (passage === undefined) issues.push(`${path}: passage not available`)
        else if (!containsQuote(passage, basis.quote)) issues.push(`${path}: quote not found in passage`)
      }
      if (basis.kind === 'rule' && !evidence.ruleIds.has(basis.ruleId)) {
        issues.push(`${path}: rule not available`)
      }
    }
  }

  return issues.length === 0 ? { ok: true, value: parsed.data } : { ok: false, issues }
}
