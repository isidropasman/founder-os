import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import matter from 'gray-matter'
import { z } from 'zod'
import { ContextKeySchema, type ContextKey } from './context.ts'
import { OUTPUT_IDS, type OutputId } from './outputs.ts'

const SKILLS_DIR = 'skills'

const FrontmatterSchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  purpose: z.string(),
  use_when: z.array(z.string()).min(1),
  dont_use_when: z.array(z.string()).min(1),
  requires_context: z.array(ContextKeySchema).min(1),
  experts: z.array(z.string()).default([]),
  /**
   * Domain vocabulary for corpus retrieval. Lexical search cannot tell "raise
   * prices" from "raise money"; the skill author can. Falls back to `purpose`.
   */
  corpus_terms: z.array(z.string()).default([]),
  output: z.enum(OUTPUT_IDS),
  related: z.array(z.string()).default([]),
})

export type Skill = {
  id: string
  version: number
  purpose: string
  useWhen: string[]
  dontUseWhen: string[]
  requiresContext: ContextKey[]
  experts: string[]
  corpusTerms: string[]
  output: OutputId
  procedure: string
  failureModes: string
}

function section(body: string, heading: string, path: string): string {
  const start = body.match(new RegExp(`^##\\s+${heading}\\s*$`, 'm'))
  if (start?.index === undefined) throw new Error(`${path} is missing a "## ${heading}" section.`)
  const rest = body.slice(start.index + start[0].length)
  const next = rest.match(/^##\s/m)
  const text = rest.slice(0, next?.index ?? rest.length).trim()
  if (!text) throw new Error(`${path} has an empty "## ${heading}" section.`)
  return text
}

export function loadSkills(dir = SKILLS_DIR): Map<string, Skill> {
  const skills = new Map<string, Skill>()
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
    const path = join(dir, file)
    const { data, content } = matter(readFileSync(path, 'utf8'))
    const parsed = FrontmatterSchema.safeParse(data)
    if (!parsed.success) {
      throw new Error(
        `${path} frontmatter failed validation:\n${parsed.error.issues
          .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
          .join('\n')}`,
      )
    }
    const fm = parsed.data
    if (fm.id !== file.replace(/\.md$/, '')) {
      throw new Error(`${path}: frontmatter id "${fm.id}" does not match the filename.`)
    }
    skills.set(fm.id, {
      id: fm.id,
      version: fm.version,
      purpose: fm.purpose,
      useWhen: fm.use_when,
      dontUseWhen: fm.dont_use_when,
      requiresContext: fm.requires_context,
      experts: fm.experts,
      corpusTerms: fm.corpus_terms,
      output: fm.output,
      procedure: section(content, 'Procedure', path),
      failureModes: section(content, 'Failure modes', path),
    })
  }
  return skills
}

export function requireSkill(skills: Map<string, Skill>, id: string): Skill {
  const skill = skills.get(id)
  if (!skill) {
    throw new Error(`Unknown skill "${id}". Available: ${[...skills.keys()].join(', ') || '(none)'}`)
  }
  return skill
}
