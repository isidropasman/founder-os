#!/usr/bin/env bash
# Fetches Paul Graham's essays into knowledge/sources/paul-graham/.
# The documents are NOT committed (see docs/knowledge.md) — the manifest commits
# each one's sha256, so a re-fetch is verifiable against the packs.
set -uo pipefail

DIR="knowledge/sources/paul-graham"
mkdir -p "$DIR"

# Discover from the index rather than a hardcoded list, so new essays are picked up.
curl -s --max-time 30 https://paulgraham.com/articles.html -o /tmp/pg-articles.html || {
  echo "could not reach paulgraham.com"; exit 1; }

slugs=$(grep -oE 'href="[a-z0-9]+\.html"' /tmp/pg-articles.html \
  | sed -E 's/href="([a-z0-9]+)\.html"/\1/' \
  | grep -vE '^(index|articles|rss)$' | sort -u)

ok=0; skipped=0
for slug in $slugs; do
  code=$(curl -s -o "$DIR/$slug.html" -w "%{http_code}" --max-time 20 "https://paulgraham.com/$slug.html")
  size=$(wc -c < "$DIR/$slug.html" | tr -d ' ')
  # Some pages are image-only or stubs; too small to yield usable claims.
  if [ "$code" = "200" ] && [ "$size" -gt 3000 ]; then
    ok=$((ok+1))
  else
    rm -f "$DIR/$slug.html"; skipped=$((skipped+1))
  fi
done

echo "fetched $ok essays, skipped $skipped"
echo "next: pnpm knowledge sync   (rebuilds the manifest, then ingest)"
