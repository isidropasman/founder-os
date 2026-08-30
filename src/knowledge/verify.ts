import { loadExperts } from '../experts.ts'
import { loadCorpus, type Corpus } from './corpus.ts'
import { containsQuote, normalizeForMatch } from './text.ts'

export type Finding = {
  principleId: string
  level: 'error' | 'warning'
  message: string
}

export type VerifyResult = {
  checked: number
  quoted: number
  findings: Finding[]
}

/**
 * The anti-fabrication gate. Every principle claiming to quote an author is
 * checked against the actual downloaded text of that author's work. A quote that
 * cannot be located in the corpus fails the build.
 *
 * Pure filesystem — no database, no network, no model. It runs in `pnpm verify`.
 */
export function verifyQuotes(corpus: Corpus = loadCorpus()): VerifyResult {
  const findings: Finding[] = []
  let checked = 0
  let quoted = 0

  // No corpus on disk is a "not fetched yet" state, not a failure: the source
  // documents are third-party and deliberately not committed.
  if (corpus.sources.size === 0) {
    return {
      checked: 0,
      quoted: 0,
      findings: [
        {
          principleId: '(corpus)',
          level: 'warning',
          message: 'no source documents fetched — run scripts/fetch-paul-graham.sh to enable verification.',
        },
      ],
    }
  }

  for (const expert of loadExperts().values()) {
    for (const principle of expert.principles) {
      checked++

      if (principle.sourceId && !corpus.sources.has(principle.sourceId)) {
        findings.push({
          principleId: principle.id,
          level: principle.quoted ? 'error' : 'warning',
          message: `references source "${principle.sourceId}", which is not in the corpus.`,
        })
        continue
      }

      if (!principle.quoted) {
        if (!principle.sourceId) {
          findings.push({
            principleId: principle.id,
            level: 'warning',
            message: 'paraphrase with no corpus source — cannot be verified mechanically.',
          })
        }
        continue
      }

      quoted++
      const source = corpus.sources.get(principle.sourceId!)!
      if (!principle.quote) {
        findings.push({ principleId: principle.id, level: 'error', message: 'quoted but no quote text.' })
        continue
      }

      if (!containsQuote(source.text, principle.quote)) {
        findings.push({
          principleId: principle.id,
          level: 'error',
          message:
            `quote not found in ${source.id} ("${source.title}"):\n      ` +
            `${normalizeForMatch(principle.quote).slice(0, 120)}`,
        })
      }
    }
  }

  return { checked, quoted, findings }
}

/** Locates the chunk a quote lives in, so provenance can be stored at claim granularity. */
export function locateQuote(
  corpus: Corpus,
  sourceId: string,
  quote: string,
): { claimId: string; ordinal: number } | null {
  const source = corpus.sources.get(sourceId)
  if (!source) return null
  for (const c of source.chunks) {
    if (containsQuote(c.text, quote)) {
      return { claimId: `${sourceId}#${String(c.ordinal).padStart(4, '0')}`, ordinal: c.ordinal }
    }
  }
  return null
}
