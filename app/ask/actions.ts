'use server'

import { collectBasis, resolveAll, type ResolvedBasis } from '../../src/basis.ts'
import { openWorkspace, selectContext } from '../../src/context.ts'
import { loadExperts, selectExperts } from '../../src/experts.ts'
import { loadSkills, requireSkill } from '../../src/skills.ts'
import { buildOfflineBrief, hasReasoningCredentials } from '../../src/offline.ts'
import { run } from '../../src/pipeline.ts'
import { explainProviderError, modelForRole } from '../../src/provider.ts'
import type { Passage } from '../../src/knowledge/consult.ts'
import type { Signal } from '../../src/signals.ts'

export type Counsel =
  | {
      mode: 'reasoned'
      query: string
      skill: string
      brief: Record<string, unknown>
      challenge: Record<string, unknown> | null
      betterQuestion: string | null
      /** Resolved once on the server so the browser never renders a bare id. */
      attribution: ResolvedBasis[]
      tokens: number
    }
  | {
      mode: 'offline'
      query: string
      skill: string
      signals: Signal[]
      procedure: string[]
      failureModes: string[]
      principles: { id: string; title: string; claim: string; quote: string | null }[]
      passages: Passage[]
      semantic: boolean
      reason: string
    }
  | { mode: 'error'; message: string }

function workspace() {
  return openWorkspace(process.env.FOUNDEROS_CONTEXT ?? './context/example')
}

/**
 * Offline is a first-class answer, not an error path: the procedure, the founder's
 * own blocking signals, and the authors' verbatim words are worth more than a
 * failure message, and the quotes are theirs rather than a model's imitation.
 */
export async function counselOffline(query: string, skillId: string): Promise<Counsel> {
  try {
    const ws = workspace()
    const brief = await buildOfflineBrief({ query, workspace: ws, skillId, now: new Date() })
    return {
      mode: 'offline',
      query,
      skill: brief.skill.id,
      signals: brief.signals,
      procedure: brief.skill.procedure
        .split(/\n(?=\d+\.\s)/)
        .map((s) => s.replace(/^\d+\.\s*/, '').replace(/\s+/g, ' ').trim())
        .filter(Boolean),
      failureModes: brief.skill.failureModes
        .split('\n- ')
        .slice(1)
        .map((s) => s.replace(/\s+/g, ' ').trim()),
      principles: brief.experts.flatMap((e) =>
        e.principles.slice(0, 4).map((p) => ({
          id: p.id,
          title: p.title,
          claim: p.claim.replace(/\s+/g, ' '),
          quote: p.quoted ? p.quote : null,
        })),
      ),
      passages: brief.passages,
      semantic: brief.semantic,
      reason: brief.corpusUnavailable ?? '',
    }
  } catch (error) {
    return { mode: 'error', message: error instanceof Error ? error.message : String(error) }
  }
}

export async function counsel(query: string, skillId: string, offline: boolean): Promise<Counsel> {
  if (!query.trim()) return { mode: 'error', message: 'Ask something.' }
  if (offline || !hasReasoningCredentials()) return counselOffline(query, skillId)

  try {
    const ws = workspace()
    const result = await run({ query, workspace: ws, pinnedSkill: skillId })

    // Resolve every ref to something a person can read and follow. This is the
    // answer to "who is suggesting this", and it belongs next to the claim.
    const skill = requireSkill(loadSkills(), skillId)
    const attribution = resolveAll(collectBasis(result.brief), {
      selected: selectContext(ws, skill.requiresContext),
      experts: selectExperts(loadExperts(), skill.experts),
      passages: [],
    })

    return {
      mode: 'reasoned',
      query,
      skill: skillId,
      brief: result.brief as Record<string, unknown>,
      challenge: (result.challenge as Record<string, unknown> | null) ?? null,
      betterQuestion: result.routing.better_question,
      attribution,
      tokens: result.usage.tokensIn + result.usage.tokensOut,
    }
  } catch (error) {
    // A billing or credential failure should still leave the founder with the
    // material, not a dead end.
    const explained = explainProviderError(modelForRole('reason'), error)
    const fallback = await counselOffline(query, skillId)
    return fallback.mode === 'offline' ? { ...fallback, reason: explained } : fallback
  }
}
