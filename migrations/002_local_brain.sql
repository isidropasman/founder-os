CREATE TABLE source_versions (
  id            text PRIMARY KEY,
  source_id     text NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  checksum      text NOT NULL,
  raw_text      text NOT NULL,
  retrieved_at  date NOT NULL,
  supersedes_id text REFERENCES source_versions(id),
  UNIQUE (source_id, checksum)
);

ALTER TABLE sources ADD COLUMN topics text[] NOT NULL DEFAULT '{}';

INSERT INTO source_versions (id, source_id, checksum, raw_text, retrieved_at)
SELECT id, id, checksum, raw_text, retrieved_at FROM sources
ON CONFLICT (source_id, checksum) DO NOTHING;

ALTER TABLE claims ADD COLUMN source_version_id text REFERENCES source_versions(id);

UPDATE claims c
SET source_version_id = s.id
FROM sources s
WHERE c.source_id = s.id AND c.source_version_id IS NULL;

ALTER TABLE claims ALTER COLUMN source_version_id SET NOT NULL;
ALTER TABLE claims DROP CONSTRAINT claims_source_id_ordinal_key;
ALTER TABLE claims ADD CONSTRAINT claims_source_version_ordinal_key UNIQUE (source_version_id, ordinal);

CREATE INDEX claims_source_version_idx ON claims(source_version_id);
CREATE INDEX source_versions_source_retrieved_idx ON source_versions(source_id, retrieved_at DESC);

CREATE TABLE ingestion_runs (
  id                bigserial PRIMARY KEY,
  source_version_id text REFERENCES source_versions(id) ON DELETE SET NULL,
  started_at        timestamptz NOT NULL DEFAULT now(),
  finished_at       timestamptz,
  status            text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  normalizer        text NOT NULL,
  claim_count       integer NOT NULL DEFAULT 0,
  failure           text
);

CREATE INDEX ingestion_runs_source_version_idx ON ingestion_runs(source_version_id, started_at DESC);
