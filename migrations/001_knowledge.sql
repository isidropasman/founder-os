-- Knowledge Base: large, shared, source-grounded, searchable.
-- Deliberately separate from Startup Memory, which stays private and
-- filesystem-backed (see docs/architecture.md).

CREATE EXTENSION IF NOT EXISTS vector;

-- Embedding dimension is fixed by the column type. 1536 matches OpenAI
-- text-embedding-3-small; changing embedding models is a migration, not a config
-- change, and that is the honest tradeoff of storing vectors in Postgres.
CREATE TABLE authors (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('person', 'organization')),
  confidence  text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  domains     text[] NOT NULL DEFAULT '{}',
  limitations text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE sources (
  id           text PRIMARY KEY,
  author_id    text NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  title        text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('essay', 'talk', 'book', 'post', 'transcript', 'note')),
  url          text,
  year         integer,
  retrieved_at date NOT NULL,
  -- sha256 of the extracted text. If a source is re-fetched and the checksum
  -- moves, every quote taken from it must be re-verified.
  checksum     text NOT NULL,
  raw_text     text NOT NULL
);

CREATE INDEX sources_author_idx ON sources(author_id);

-- A claim is a verbatim contiguous slice of a source. Never paraphrased, never
-- model-generated. char_start/char_end index back into sources.raw_text, so any
-- stored quote can be re-checked against the original document.
CREATE TABLE claims (
  id         text PRIMARY KEY,
  source_id  text NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  ordinal    integer NOT NULL,
  text       text NOT NULL,
  char_start integer NOT NULL,
  char_end   integer NOT NULL,
  embedding  vector(1536),
  tsv        tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, text)) STORED,
  UNIQUE (source_id, ordinal)
);

CREATE INDEX claims_tsv_idx ON claims USING gin(tsv);
CREATE INDEX claims_embedding_idx ON claims USING hnsw (embedding vector_cosine_ops);
CREATE INDEX claims_source_idx ON claims(source_id);

-- A principle is authored by a contributor, not extracted by a model. It is an
-- assertion attributed to an author, and it is only admissible with evidence.
CREATE TABLE principles (
  id           text PRIMARY KEY,
  author_id    text NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  title        text NOT NULL,
  statement    text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('quoted', 'paraphrase')),
  applies_when text NOT NULL DEFAULT '',
  conflicts_with text[] NOT NULL DEFAULT '{}',
  embedding    vector(1536),
  tsv          tsvector GENERATED ALWAYS AS (
                 to_tsvector('english'::regconfig, title || ' ' || statement)
               ) STORED
);

CREATE INDEX principles_tsv_idx ON principles USING gin(tsv);
CREATE INDEX principles_embedding_idx ON principles USING hnsw (embedding vector_cosine_ops);
CREATE INDEX principles_author_idx ON principles(author_id);

-- Provenance. `quote` must appear verbatim inside claims.text under the
-- normalization in src/knowledge/text.ts. Enforced by knowledge:verify, which is
-- part of `pnpm verify` — a principle whose quote cannot be located fails the build.
CREATE TABLE principle_evidence (
  principle_id text NOT NULL REFERENCES principles(id) ON DELETE CASCADE,
  claim_id     text NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  quote        text NOT NULL,
  PRIMARY KEY (principle_id, claim_id)
);

CREATE INDEX principle_evidence_claim_idx ON principle_evidence(claim_id);

-- A framework is an ordered procedure attributed to an author, as distinct from
-- an assertion. Different shape, different use at reasoning time.
CREATE TABLE frameworks (
  id          text PRIMARY KEY,
  author_id   text NOT NULL REFERENCES authors(id) ON DELETE CASCADE,
  name        text NOT NULL,
  steps       text[] NOT NULL,
  when_to_use text NOT NULL DEFAULT '',
  source_id   text REFERENCES sources(id) ON DELETE SET NULL,
  embedding   vector(1536),
  -- array_to_string is only STABLE, so it cannot appear in a generated column.
  -- Ingestion writes the flattened steps here and the tsv stays generated from it,
  -- which keeps the index correct without a trigger.
  steps_text  text NOT NULL DEFAULT '',
  tsv         tsvector GENERATED ALWAYS AS (
                to_tsvector('english'::regconfig, name || ' ' || when_to_use || ' ' || steps_text)
              ) STORED
);

CREATE INDEX frameworks_tsv_idx ON frameworks USING gin(tsv);
CREATE INDEX frameworks_author_idx ON frameworks(author_id);
