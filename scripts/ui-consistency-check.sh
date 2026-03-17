#!/usr/bin/env bash
# Detect raw Tailwind palette usage that should use semantic tokens.
# Referenced by: npm run ui:check, docs/STYLE-GUIDE.md, CLAUDE.md
set -euo pipefail

cd "$(dirname "$0")/../web"

ERRORS=0
while IFS= read -r match; do
  echo "WARNING: $match"
  ERRORS=$((ERRORS + 1))
done < <(grep -rn --include='*.tsx' --include='*.ts' \
  -E '\b(text|bg|border|ring|fill|stroke)-(zinc|gray|slate|neutral|stone|red|orange|amber|yellow|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)-[0-9]+' \
  app/ components/ lib/ 2>/dev/null || true)

if [ "$ERRORS" -gt 0 ]; then
  echo ""
  echo "Found $ERRORS raw palette token(s). Use semantic tokens instead."
  echo "See app/globals.css for available semantic tokens."
  exit 1
fi

echo "All clear — no raw palette tokens found."
