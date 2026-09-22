ALTER TABLE sources
  ADD COLUMN retrieval_method text NOT NULL DEFAULT 'unknown'
    CHECK (retrieval_method IN ('direct_html', 'local_text', 'provided_transcript', 'unknown')),
  ADD COLUMN redistribution text NOT NULL DEFAULT 'unknown'
    CHECK (redistribution IN ('prohibited', 'citation_only', 'permitted', 'unknown'));

CREATE TABLE ingestion_run_sources (
  run_id            bigint NOT NULL REFERENCES ingestion_runs(id) ON DELETE CASCADE,
  source_version_id text NOT NULL REFERENCES source_versions(id) ON DELETE RESTRICT,
  PRIMARY KEY (run_id, source_version_id)
);

CREATE INDEX ingestion_run_sources_source_version_idx
  ON ingestion_run_sources(source_version_id, run_id DESC);
