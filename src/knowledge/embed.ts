import { createHash } from 'node:crypto'
import { openai } from '@ai-sdk/openai'
import { embedMany } from 'ai'

export const EMBEDDING_DIMENSIONS = 1536

export type Embedder = {
  readonly id: string
  readonly semantic: boolean
  embed(texts: string[]): Promise<number[][]>
}

/**
 * A hashed bag-of-words projection. NOT semantic: "cheap" and "inexpensive" land
 * nowhere near each other. It exists so the retrieval SQL, the fusion maths and
 * the CLI can be tested end-to-end with no credentials and no network, and so
 * those tests are byte-for-byte reproducible.
 *
 * Never use it for a real corpus — `knowledge:embed` refuses to write hash
 * vectors unless --allow-hash is passed, and records the embedder id in the
 * source row so a hash-embedded corpus is always identifiable.
 */
export const hashEmbedder: Embedder = {
  id: 'hash-v1',
  semantic: false,
  async embed(texts) {
    return texts.map((text) => {
      const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0)
      const tokens = text.toLowerCase().match(/[a-z0-9']+/g) ?? []
      for (const token of tokens) {
        const digest = createHash('sha256').update(token).digest()
        const index = digest.readUInt32BE(0) % EMBEDDING_DIMENSIONS
        const sign = (digest[4]! & 1) === 0 ? 1 : -1
        vector[index] = vector[index]! + sign
      }
      const norm = Math.hypot(...vector)
      return norm === 0 ? vector : vector.map((v) => v / norm)
    })
  },
}

export const openaiEmbedder: Embedder = {
  id: 'openai:text-embedding-3-small',
  semantic: true,
  async embed(texts) {
    const { embeddings } = await embedMany({
      model: openai.textEmbedding('text-embedding-3-small'),
      values: texts,
    })
    return embeddings
  },
}

export function embedderFor(spec = process.env.FOUNDEROS_EMBEDDINGS ?? 'openai'): Embedder {
  if (spec === 'hash') return hashEmbedder
  if (spec === 'openai') return openaiEmbedder
  throw new Error(`Unknown embedder "${spec}". Use "openai" or "hash".`)
}

export function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(',')}]`
}
