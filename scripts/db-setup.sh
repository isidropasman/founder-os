#!/usr/bin/env bash
# Local Postgres + pgvector for FounderOS. Idempotent.
set -euo pipefail

DB="${1:-founderos}"
TEST_DB="${DB}_test"

command -v psql >/dev/null || { echo "psql not found. brew install postgresql@18"; exit 1; }
pg_isready -q || { echo "Postgres is not running. brew services start postgresql@18"; exit 1; }

for name in "$DB" "$TEST_DB"; do
  if psql -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$name'" | grep -q 1; then
    echo "database $name already exists"
  else
    createdb "$name" && echo "created database $name"
  fi
  if ! psql -d "$name" -tAc "SELECT 1 FROM pg_extension WHERE extname='vector'" | grep -q 1; then
    psql -d "$name" -q -c "CREATE EXTENSION vector" 2>/dev/null \
      || { echo "pgvector missing. brew install pgvector"; exit 1; }
    echo "enabled pgvector in $name"
  fi
done

echo
echo "next: pnpm knowledge migrate && pnpm knowledge ingest"
