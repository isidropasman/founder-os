#!/usr/bin/env bash
# One command from a fresh clone to a working install. Safe to re-run.
set -uo pipefail

say() { printf '\n\033[1m%s\033[0m\n' "$1"; }

say "1/5  Node and dependencies"
node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' || {
  echo "  Node 22+ required. Run: nvm use 22"; exit 1; }
pnpm install --silent

say "2/5  Postgres and pgvector"
./scripts/db-setup.sh >/dev/null 2>&1 && echo "  ready" || {
  echo "  Postgres unavailable — the knowledge base will be skipped."
  echo "  brew install postgresql@18 pgvector && brew services start postgresql@18"; }

say "3/5  Schema"
pnpm -s knowledge migrate 2>/dev/null || echo "  skipped (no database)"

say "4/5  Corpus"
if [ -z "$(ls knowledge/sources/paul-graham/*.html 2>/dev/null)" ]; then
  ./scripts/fetch-paul-graham.sh
  pnpm -s knowledge sync paul-graham --url "https://paulgraham.com/{id}.html"
else
  echo "  already fetched"
fi
pnpm -s knowledge ingest 2>/dev/null || echo "  skipped (no database)"

say "5/5  Your workspace"
[ -f .env ] || { cp .env.example .env; echo "  created .env — add your ANTHROPIC_API_KEY"; }

say "Where you stand"
pnpm -s founderos doctor || true

cat <<'NEXT'

Next:
  founderos status                              what needs attention (no model, free)
  founderos knowledge search "do things that don't scale"
  founderos ask "Where should I focus this week?"

Read docs/guide.md — the whole product in one page.
NEXT
