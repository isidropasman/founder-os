ALTER TABLE sources
  ADD COLUMN retrieval_status text NOT NULL DEFAULT 'approved'
    CHECK (retrieval_status IN ('approved', 'review_required', 'blocked'));
