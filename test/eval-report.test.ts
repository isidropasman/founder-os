import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ARMS, DIMENSIONS, lost, meanDelta, report, won, type Comparison } from '../src/eval.ts'

/**
 * The report has never run against real data — it only executes at the very end of
 * an expensive suite. These tests make sure the money is not spent on a run that
 * then crashes, or worse, prints arithmetic nobody checked.
 */

type ScoreOverrides = Partial<Record<(typeof DIMENSIONS)[number], number>>

function scores(base: number, overrides: ScoreOverrides = {}) {
  return Object.fromEntries(DIMENSIONS.map((d) => [d, overrides[d] ?? base])) as Record<
    (typeof DIMENSIONS)[number],
    number
  >
}

function comparison(input: {
  caseId: string
  challenger: string
  baselineScore: number
  otherScore: number
  preferred: 'A' | 'B' | 'tie'
  baselineWasA?: boolean
  condition?: string
  mechanism?: string
  diagnosis?: string
}): Comparison {
  const baselineWasA = input.baselineWasA ?? true
  return {
    caseId: input.caseId,
    condition: input.condition ?? 'generic',
    challenger: input.challenger,
    baselineWasA,
    verdict: {
      scores_a: scores(baselineWasA ? input.baselineScore : input.otherScore),
      scores_b: scores(baselineWasA ? input.otherScore : input.baselineScore),
      preferred: input.preferred,
      judge_confidence: 'high',
      advantage_source: (input.mechanism ?? 'skill_framework') as never,
      advantage_evidence: 'because of the thing',
    },
    diagnosis: input.diagnosis
      ? { reason: input.diagnosis as never, explanation: 'the reason' }
      : null,
  }
}

const CASES = [
  { id: 'c1', condition: 'generic', query: 'q', skill: 'focus', notes: '', context: './x' },
]

test('win, loss and tie are read off the position-swapped verdict correctly', () => {
  const baselineIsA = comparison({
    caseId: 'c1',
    challenger: 'context-dump',
    baselineScore: 4,
    otherScore: 2,
    preferred: 'A',
  })
  assert.ok(won(baselineIsA))
  assert.ok(!lost(baselineIsA))

  // Same outcome, baseline in position B. Getting this backwards would invert
  // every result in the suite while looking perfectly plausible.
  const baselineIsB = comparison({
    caseId: 'c1',
    challenger: 'context-dump',
    baselineScore: 4,
    otherScore: 2,
    preferred: 'B',
    baselineWasA: false,
  })
  assert.ok(won(baselineIsB))

  const tie = comparison({
    caseId: 'c1',
    challenger: 'context-dump',
    baselineScore: 3,
    otherScore: 3,
    preferred: 'tie',
  })
  assert.ok(!won(tie) && !lost(tie))
})

test('meanDelta is baseline minus arm, whichever position they held', () => {
  const a = comparison({ caseId: 'c1', challenger: 'x', baselineScore: 5, otherScore: 2, preferred: 'A' })
  const b = comparison({
    caseId: 'c2',
    challenger: 'x',
    baselineScore: 5,
    otherScore: 2,
    preferred: 'B',
    baselineWasA: false,
  })
  assert.equal(meanDelta([a, b], 'startup_judgment'), 3)
  assert.equal(meanDelta([], 'startup_judgment'), 0)
})

test('the ablation ladder reports each mechanism as the gap between adjacent rungs', () => {
  // Gaps to the baseline: dump 3, selected 2, skill 1.5, +experts 1.0, +corpus 0.5.
  // Marginals are therefore 1.0 / 0.5 / 0.5 / 0.5 / 0.5 down the ladder.
  const comparisons = [
    comparison({ caseId: 'c1', challenger: 'context-dump', baselineScore: 5, otherScore: 2, preferred: 'A' }),
    comparison({ caseId: 'c1', challenger: 'context-selected', baselineScore: 5, otherScore: 3, preferred: 'A' }),
    comparison({ caseId: 'c1', challenger: 'skill', baselineScore: 5, otherScore: 3.5, preferred: 'A' }),
    comparison({ caseId: 'c1', challenger: 'skill+experts', baselineScore: 5, otherScore: 4, preferred: 'A' }),
    comparison({ caseId: 'c1', challenger: 'skill+corpus', baselineScore: 5, otherScore: 4.5, preferred: 'A' }),
  ]
  const md = report({ comparisons, usage: new Map(), cases: CASES, router: null, arms: ARMS })

  // The win/loss table and the ladder table both have rows starting `| <arm> |`,
  // so scope the lookup to the ladder section or the first table answers instead.
  const ladder = md.slice(md.indexOf('## Ablation ladder'), md.indexOf('## Where'))
  const marginal = (arm: string): string => {
    const line = ladder.split('\n').find((l) => l.startsWith(`| ${arm} |`))
    assert.ok(line, `no ladder row for "${arm}"`)
    return line.split('|').at(-2)!.trim()
  }
  assert.equal(marginal('context-dump'), '—', 'the bottom rung has nothing below it')
  assert.equal(marginal('context-selected'), '1.00', 'context selection')
  assert.equal(marginal('skill'), '0.50', 'skill framework')
  assert.equal(marginal('skill+experts'), '0.50', 'expert knowledge')
  assert.equal(marginal('skill+corpus'), '0.50', 'the knowledge base')
  assert.equal(marginal('founderos'), '0.50', 'challenger')
})

test('a rung that was not run breaks the chain honestly instead of guessing', () => {
  // Marginals are differences between adjacent rungs. Skipping one with --arms
  // must show "—" rather than silently attributing two mechanisms to one rung.
  const md = report({
    comparisons: [
      comparison({ caseId: 'c1', challenger: 'context-dump', baselineScore: 5, otherScore: 2, preferred: 'A' }),
    ],
    usage: new Map(),
    cases: CASES,
    router: null,
    arms: ARMS,
  })
  const ladder = md.slice(md.indexOf('## Ablation ladder'), md.indexOf('## Where'))
  assert.match(ladder, /\| context-selected \| context selection \| not run \| — \|/)
})

test('mechanism attribution counts only wins against the null hypothesis', () => {
  const comparisons = [
    comparison({
      caseId: 'c1',
      challenger: 'context-dump',
      baselineScore: 5,
      otherScore: 2,
      preferred: 'A',
      mechanism: 'challenger',
    }),
    // A win against a vanilla arm must not inflate the attribution table.
    comparison({
      caseId: 'c1',
      challenger: 'claude-vanilla',
      baselineScore: 5,
      otherScore: 1,
      preferred: 'A',
      mechanism: 'better_context_selection',
    }),
  ]
  const md = report({ comparisons, usage: new Map(), cases: CASES, router: null, arms: ARMS })

  assert.match(md, /Attributed over the 1 case\(s\)/)
  assert.match(md, /\| challenger \| 1 \|/)
  assert.ok(!md.includes('| better_context_selection |'), 'a vanilla win was counted')
})

test('losses surface with their diagnosis, and an all-loss run says so plainly', () => {
  const comparisons = [
    comparison({
      caseId: 'c1',
      challenger: 'context-dump',
      baselineScore: 2,
      otherScore: 4,
      preferred: 'B',
      diagnosis: 'overlong_prompt',
    }),
  ]
  const md = report({ comparisons, usage: new Map(), cases: CASES, router: null, arms: ARMS })

  assert.match(md, /overlong_prompt/)
  assert.match(md, /\*\*c1\*\*/)
  assert.match(md, /not earning its complexity/, 'zero wins must be stated, not left blank')
})

test('the report renders with no comparisons at all', () => {
  const md = report({
    comparisons: [],
    usage: new Map(),
    cases: [],
    router: { passed: 10, total: 12, failures: ['"q"\n    skills: want [focus], got []'] },
    arms: ARMS,
  })
  assert.match(md, /10\/12 passed/)
  assert.match(md, /skills: want \[focus\]/)
  assert.match(md, /No wins to attribute/)
})

test('cost and latency are reported per arm', () => {
  const usage = new Map([['founderos', { tokensIn: 1000, tokensOut: 500, ms: 6000, calls: 3 }]])
  const md = report({ comparisons: [], usage, cases: CASES, router: null, arms: ARMS })
  assert.match(md, /\| founderos \| 3 \| 1000 \| 500 \| 6000 \|/)
})
