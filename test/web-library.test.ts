import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PassageLink } from '../app/knowledge/passage.tsx'

test('library result links to its source version and exact passage', () => {
  const html = renderToStaticMarkup(
    createElement(PassageLink, {
      passageId: 'paul-graham/ds#0002',
      sourceVersionId: 'paul-graham/ds',
    }),
  )

  assert.match(html, /source-version=paul-graham%2Fds/)
  assert.match(html, /passage=paul-graham%2Fds%230002/)
})
