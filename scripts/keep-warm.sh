#!/usr/bin/env bash
# keep-warm.sh — Ping Flaim services to prevent cold starts
#
# Runs on Raspberry Pi via cron every 5 minutes.
# Keeps Vercel functions, Cloudflare Workers, and Supabase connections warm.
# Log auto-trims to ~7 days of history.
#
# Install:
#   crontab -e
#   */5 * * * * ~/PiCode/keep-warm.sh

set -euo pipefail

LOG="$HOME/PiCode/keep-warm.log"
MAX_LINES=6048  # 3 lines per run × 12 runs/hr × 24 hrs × 7 days

ENDPOINTS=(
  "https://flaim.app"                       # Vercel SSR / Next.js
  "https://api.flaim.app/auth/health"       # auth-worker + Supabase connection
  "https://api.flaim.app/fantasy/health"    # fantasy-mcp gateway
)

TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

for url in "${ENDPOINTS[@]}"; do
  STATUS=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$url" 2>/dev/null || echo "FAIL")
  echo "$TIMESTAMP  $STATUS  $url"
done >> "$LOG"

# Trim log to last 7 days
LINES=$(wc -l < "$LOG")
if [ "$LINES" -gt "$MAX_LINES" ]; then
  tail -n "$MAX_LINES" "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
