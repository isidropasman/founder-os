import { z } from 'zod'
import { ContextKeySchema } from './context.ts'
import type { Expert } from './experts.ts'
import { routerPrompt } from './prompts.ts'
import type { Completion, Provider } from './provider.ts'
import type { Skill } from './skills.ts'

export const RouterOutputSchema = z.object({
  intent: z.string().describe('A short snake_case label for what the founder is really asking.'),
  skills: z.array(z.string()).max(2),
  experts: z.array(z.string()).max(3),
  context_keys: z.array(ContextKeySchema).min(1),
  depth: z.enum(['quick', 'deep']),
  better_question: z
    .string()
    .nullable()
    .describe('A higher-leverage question, or null if the one asked is the right one.'),
  reasoning: z.string().describe('One sentence. Goes in the trace, not shown to the founder.'),
})

export type RouterOutput = z.infer<typeof RouterOutputSchema>

export async function route(input: {
  provider: Provider
  query: string
  company: string
  skills: Skill[]
  experts: Expert[]
}): Promise<Completion<RouterOutput> & { system: string; prompt: string }> {
  const { system, prompt } = routerPrompt(input)
  const result = await input.provider.object({ system, prompt, schema: RouterOutputSchema, maxOutputTokens: 1000 })

  const knownSkills = new Set(input.skills.map((s) => s.id))
  const knownExperts = new Set(input.experts.map((e) => e.id))

  // Drop hallucinated ids rather than failing the run — the skill's own
  // requires_context still guarantees the answer has what it needs.
  return {
    ...result,
    system,
    prompt,
    value: {
      ...result.value,
      skills: result.value.skills.filter((id) => knownSkills.has(id)),
      experts: result.value.experts.filter((id) => knownExperts.has(id)),
    },
  }
}
