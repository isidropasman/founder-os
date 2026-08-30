/**
 * Deterministic HTML → text and chunking. No model is involved anywhere in this
 * file: the corpus must be reproducible from the raw sources by anyone, and a
 * quote is only trustworthy if the path from source to claim is mechanical.
 */

const BLOCK_TAGS = /<\/(p|div|h[1-6]|li|blockquote|tr|table)>/gi

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  ldquo: '“',
  rdquo: '”',
}

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1]?.toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : match
    }
    return ENTITIES[body.toLowerCase()] ?? match
  })
}

export function htmlToText(html: string): string {
  let text = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(BLOCK_TAGS, '\n\n')
    .replace(/<[^>]+>/g, ' ')

  text = decodeEntities(text)

  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * The single normalization used for every quote comparison. Source text is hard
 * wrapped and uses typographic quotes; a citation written by a human will not
 * reproduce either. Collapsing both sides is what makes verbatim checking
 * survive contact with real documents.
 */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

export function containsQuote(haystack: string, quote: string): boolean {
  return normalizeForMatch(haystack).includes(normalizeForMatch(quote))
}

export type Chunk = { ordinal: number; text: string; charStart: number; charEnd: number }

const MIN_CHUNK_CHARS = 400
const MAX_CHUNK_CHARS = 1400

/**
 * Paragraph-aligned chunking. Paragraphs are never split, so every chunk is a
 * contiguous verbatim slice of the source and `charStart`/`charEnd` always index
 * back into it exactly — that is what lets a stored quote be re-verified against
 * the original document later.
 */
export function chunk(text: string): Chunk[] {
  const paragraphs: { text: string; start: number }[] = []
  let cursor = 0
  for (const part of text.split(/\n{2,}/)) {
    const start = text.indexOf(part, cursor)
    if (part.trim().length > 0) paragraphs.push({ text: part, start })
    cursor = start + part.length
  }

  const chunks: Chunk[] = []
  let buffer: { text: string; start: number }[] = []

  const flush = (): void => {
    if (buffer.length === 0) return
    const first = buffer[0]!
    const last = buffer.at(-1)!
    const charStart = first.start
    const charEnd = last.start + last.text.length
    chunks.push({
      ordinal: chunks.length,
      text: text.slice(charStart, charEnd),
      charStart,
      charEnd,
    })
    buffer = []
  }

  for (const paragraph of paragraphs) {
    const bufferedChars = buffer.reduce((n, p) => n + p.text.length, 0)
    if (bufferedChars >= MIN_CHUNK_CHARS && bufferedChars + paragraph.text.length > MAX_CHUNK_CHARS) {
      flush()
    }
    buffer.push(paragraph)
    if (buffer.reduce((n, p) => n + p.text.length, 0) >= MAX_CHUNK_CHARS) flush()
  }
  flush()

  return chunks
}
