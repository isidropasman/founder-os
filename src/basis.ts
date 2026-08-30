import type { Expert } from './experts.ts'
import type { Passage } from './knowledge/consult.ts'

/**
 * Where a claim comes from, attached to the claim rather than to the document.
 *
 * The first interface could only render provenance as a grey line of ids at the
 * foot of the page, because that is where the schema put it. A founder reading a
 * recommendation cannot then answer "who is suggesting this" without scrolling
 * past the thing they are reading. Moving basis onto the claim is what makes
 * attribution renderable inline, and it is the product's whole differentiator.
 */

export type BasisKind = 'your-data' | 'source' | 'rule' | 'inference'

export type ResolvedBasis = {
  ref: string
  kind: BasisKind
  /** What to show the reader, in their language rather than in ids. */
  label: string
  /** The supporting text, when there is one to quote. */
  detail: string | null
  /** True when the ref points at nothing — surfaced, never silently dropped. */
  broken: boolean
}

const PASSAGE = /^[a-z0-9-]+\/[a-z0-9-]+#\d+$/
const PRINCIPLE = /^[a-z0-9-]+\/P\d+$/

/** `metrics.mrr`, `decisions.d-2026-07-14`, `founder.weak_spots` */
const DATA = /^(company|founder|goals|metrics|people|feedback|experiments|meetings|decisions)\.([\w-]+)/

function findRow(rows: unknown, key: string): Record<string, unknown> | null {
  if (!Array.isArray(rows)) return null
  return (
    (rows as Record<string, unknown>[]).find((row) => row.id === key || row.name === key) ?? null
  )
}

function labelFor(collection: string, row: Record<string, unknown>): string {
  const text =
    row.statement ?? row.question ?? row.hypothesis ?? row.verbatim ?? row.purpose ?? row.name
  return typeof text === 'string' ? text : collection
}

function detailFor(collection: string, row: Record<string, unknown>): string | null {
  if (collection === 'metrics') return `${String(row.value)} as of ${String(row.as_of)}`
  if (collection === 'decisions') {
    return `decided “${String(row.decision)}”, confidence ${String(row.confidence)}`
  }
  if (collection === 'goals') return `target ${String(row.target)} by ${String(row.horizon)}`
  if (collection === 'feedback') return String(row.verbatim ?? '')
  if (collection === 'people') return String(row.notes ?? '')
  return null
}

export function resolveBasis(
  ref: string,
  context: {
    selected: Record<string, unknown>
    experts: readonly Expert[]
    passages: readonly Passage[]
  },
): ResolvedBasis {
  if (ref === 'inference') {
    return {
      ref,
      kind: 'inference',
      label: 'The model’s own judgment',
      detail: 'Nothing in your record or the library supports this directly.',
      broken: false,
    }
  }

  if (ref.startsWith('rule:')) {
    return { ref, kind: 'rule', label: ref.slice(5), detail: null, broken: false }
  }

  if (PASSAGE.test(ref)) {
    const passage = context.passages.find((p) => p.id === ref)
    return {
      ref,
      kind: 'source',
      label: passage ? `${passage.author} · ${passage.title}` : ref,
      detail: passage?.text ?? null,
      broken: !passage,
    }
  }

  if (PRINCIPLE.test(ref)) {
    const principle = context.experts.flatMap((e) => e.principles).find((p) => p.id === ref)
    const expert = context.experts.find((e) => ref.startsWith(`${e.id}/`))
    return {
      ref,
      kind: 'source',
      label: principle ? `${expert?.name ?? ''} · ${principle.title}`.trim() : ref,
      detail: principle?.quote ?? principle?.claim ?? null,
      broken: !principle,
    }
  }

  const match = DATA.exec(ref)
  if (match) {
    const [, collection, key] = match as unknown as [string, string, string]

    // Singletons are addressed by field: `founder.weak_spots`, `company.icp`.
    if (collection === 'company' || collection === 'founder') {
      const record = context.selected[collection] as Record<string, unknown> | undefined
      const value = record?.[key]
      return {
        ref,
        kind: 'your-data',
        label: `Your ${collection} · ${key.replace(/_/g, ' ')}`,
        detail: Array.isArray(value) ? value.join(' · ') : value ? String(value) : null,
        broken: value === undefined,
      }
    }

    // A collection can be selected under several keys — `decisions` arrives as
    // `decisions_recent` for some skills and `decisions_all` for others. Looking
    // in only one of them silently reported real refs as broken.
    const row =
      findRow(context.selected[collection], key) ??
      findRow(context.selected[`${collection}_all`], key) ??
      findRow(context.selected[`${collection}_recent`], key)
    return {
      ref,
      kind: 'your-data',
      label: row ? `Your record · ${labelFor(collection, row)}` : `Your record · ${key}`,
      detail: row ? detailFor(collection, row) : null,
      broken: !row,
    }
  }

  return { ref, kind: 'inference', label: ref, detail: null, broken: true }
}

export function resolveAll(
  refs: readonly string[],
  context: Parameters<typeof resolveBasis>[1],
): ResolvedBasis[] {
  return refs.map((ref) => resolveBasis(ref, context))
}

/** Pulls every `basis` array out of a brief, whatever shape the skill produced. */
export function collectBasis(brief: unknown): string[] {
  const found: string[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (node === null || typeof node !== 'object') return
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      // `basis` on a list item, `constraint_basis` / `recommendation_basis` on a
      // top-level claim. Matching only the bare key silently skipped the latter.
      if (key.endsWith('basis') && Array.isArray(value)) {
        found.push(...value.filter((v): v is string => typeof v === 'string'))
      } else {
        walk(value)
      }
    }
  }
  walk(brief)
  return [...new Set(found)]
}

export type BasisCheck = { ok: true } | { ok: false; errors: string[] }

/**
 * A ref that resolves to nothing is the same class of failure as an invented
 * quote: it looks like evidence and is not. Fails the run rather than rendering
 * a citation the founder cannot follow.
 */
export function validateBasis(
  refs: readonly string[],
  context: Parameters<typeof resolveBasis>[1],
): BasisCheck {
  const errors = resolveAll(refs, context)
    .filter((b) => b.broken)
    .map(
      (b) =>
        `Cited "${b.ref}" as support, but it resolves to nothing. ` +
        `Use an id that exists, or "inference" if this is your own judgment.`,
    )
  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}
