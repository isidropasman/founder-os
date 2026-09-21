#!/usr/bin/env bash
set -euo pipefail

fetch() {
  local author="$1"
  local file="$2"
  local url="$3"
  mkdir -p "knowledge/sources/$author"
  curl --fail --location --silent --show-error --max-time 30 "$url" -o "knowledge/sources/$author/$file"
}

fetch sam-altman startup-advice.html https://blog.samaltman.com/startup-advice
fetch steve-blank hypotheses-experiments-insights.html https://steveblank.com/2015/05/06/
fetch andrew-chen how-to-build-a-growth-team.html https://andrewchen.com/how-to-build-a-growth-team/
fetch tomasz-tunguz how-to-price-your-startup.html https://tomtunguz.com/how-to-price-your-startups-product/

echo 'Fetched the initial cohort. Run pnpm knowledge ingest to verify every manifest checksum before indexing.'
