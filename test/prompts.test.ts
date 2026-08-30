import assert from 'node:assert/strict'
import { test } from 'node:test'
import { openWorkspace, renderContext, selectContext } from '../src/context.ts'
import { loadExperts, selectExperts } from '../src/experts.ts'
import { challengePrompt, reasonPrompt, routerPrompt } from '../src/prompts.ts'
import { loadSkills, requireSkill } from '../src/skills.ts'
import type { FocusBrief } from '../src/outputs.ts'

const ws = openWorkspace('./context/example')
const skill = requireSkill(loadSkills(), 'focus')
const experts = selectExperts(loadExperts(), skill.experts)
const context = renderContext(selectContext(ws, skill.requiresContext))

test('the router sees when NOT to use a skill', () => {
  const { system } = routerPrompt({
    query: 'anything',
    company: 'Acme',
    skills: [skill],
    experts,
  })
  for (const line of skill.dontUseWhen) assert.ok(system.includes(line), `router prompt dropped: ${line}`)
})

test('the reasoning prompt carries the procedure, the failure modes, and citable ids', () => {
  const { system, prompt } = reasonPrompt({
    query: 'Where should I focus this week?',
    skill,
    experts,
    context,
  })
  assert.ok(system.includes(skill.procedure))
  assert.ok(system.includes(skill.failureModes))
  for (const expert of experts) {
    for (const principle of expert.principles) {
      assert.ok(system.includes(`[${principle.id}]`), `missing citable id ${principle.id}`)
    }
  }
  assert.ok(prompt.includes('monthly_logo_churn_pct'), 'selected context did not reach the prompt')
})

test('the reasoning prompt surfaces citation errors on retry', () => {
  const { system } = reasonPrompt({
    query: 'q',
    skill,
    experts,
    context,
    citationErrors: ['Cited principle "nobody/P99" does not exist.'],
  })
  assert.ok(system.includes('nobody/P99'))
})

test('the challenger never sees the reasoning that produced the draft', () => {
  const draft: FocusBrief = {
    constraint: 'Activation',
    constraint_basis: ['metrics.activated_pct_first_invoice_sent'],
    priorities: [
      { what: 'Fix onboarding', why: 'because', moves_constraint: true, basis: ['inference'] },
    ],
    ignore: ['The redesign'],
    biggest_uncertainty: 'Whether onboarding is the cause',
    next_action: 'Call Dana',
    question_for_you: null,
    confidence: 0.6,
    expert_citations: [],
  }
  const { system, prompt } = challengePrompt({ query: 'q', context, draft })
  assert.ok(!system.includes(skill.procedure), 'challenger leaked the skill procedure')
  assert.ok(!prompt.includes(skill.procedure), 'challenger leaked the skill procedure')
  assert.ok(prompt.includes('Fix onboarding'))
})

test('precomputed signals reach the reasoning prompt and are marked as settled', async () => {
  const { detectSignals, signalsForPrompt } = await import('../src/signals.ts')
  const signals = signalsForPrompt(detectSignals(ws, new Date('2026-08-18T00:00:00Z')))
  assert.ok(signals.length > 0, 'the example workspace should produce findings')

  const { prompt } = reasonPrompt({ query: 'q', skill, experts, context, signals })
  assert.ok(prompt.includes(signals), 'the findings were dropped')
  assert.match(prompt, /do not re-derive these/, 'the model must know these are settled')

  // Absent signals must not leave an empty heading behind.
  const without = reasonPrompt({ query: 'q', skill, experts, context })
  assert.ok(!without.prompt.includes('deterministic rules'))
})
