import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PortfolioConsole } from '../app/portfolio/console.tsx'
import { emptyPortfolio } from '../src/portfolio/contracts.ts'

test('portfolio UI exposes project creation, evidence capture and the decision lifecycle', () => {
  const initial = {
    ...emptyPortfolio('founder'),
    projects: [{ id: 'zent', name: 'Zent', recordedAt: '2026-09-08T00:00:00.000Z', observedAt: '2026-09-08T00:00:00.000Z', origin: 'founder' as const, confidence: 1 }],
    records: [{ id: 'mrr', kind: 'metric' as const, scope: 'project' as const, projectId: 'zent', recordedAt: '2026-09-08T00:00:00.000Z', observedAt: '2026-09-08T00:00:00.000Z', origin: 'founder' as const, confidence: 1, evidenceIds: [], text: 'MRR is 2000', numericValue: 2000, sourceStatus: 'approved' as const, causal: false }],
  }
  const html = renderToStaticMarkup(createElement(PortfolioConsole, { initial }))

  assert.match(html, /Portfolio/)
  assert.match(html, /Add project/)
  assert.match(html, /Record evidence/)
  assert.match(html, /Generate weekly decision/)
  assert.match(html, /MRR is 2000/)
})
