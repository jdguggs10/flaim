#!/usr/bin/env bash
set -euo pipefail

echo "Checking for hard-coded palette classes..."

# Allow-list: bg-black/50 and bg-black/80 are used for overlays (dialog.tsx)
VIOLATIONS=$(
  grep -rn --include='*.tsx' --include='*.ts' \
    -E 'bg-(white|gray|red|green|blue|amber|yellow|slate|stone|zinc)|text-(black|white|gray|red|green|blue|amber|yellow|slate|stone|zinc)|bg-\[#' \
    web/components web/app \
    | grep -v 'node_modules' \
    | grep -v 'bg-black/[0-9]' \
  || true
)

if [ -n "$VIOLATIONS" ]; then
  echo "FAIL: Hard-coded color classes found:"
  echo "$VIOLATIONS"
  exit 1
fi

echo "PASS: No hard-coded color violations found."
