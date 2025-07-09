#!/bin/bash

# ============================================================================
#  FLAIM Consolidated Build Script (build.sh)
# ---------------------------------------------------------------------------
#  Purpose   : One-stop build entrypoint primarily for CI / prod artefact builds.
#              Development servers already transpile on-the-fly, so an extra
#              "dev build" is unnecessary.  This script focuses on a deterministic
#              sequential production build (equivalent to the old build-prod.sh)
#              but leaves room for future options.
#
#  Why keep this script?
#    • CI pipelines run it to fail fast on any TypeScript or bundling errors.
#    • Produces release artefacts ready for `wrangler deploy` and `next start`.
#    • Keeps build logic in one maintained place instead of scattered.
#
#  Usage examples:
#      ./build.sh            # interactive menu (default)
#      ./build.sh --prod     # non-interactive production build (CI)
#
# ============================================================================

set -e  # Abort on first error

# Colour helpers -------------------------------------------------------------
GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Colour

info()    { echo -e "${BLUE}[BUILD]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
error()   { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ----------------------------------------------------------------------------
# 1. Parse mode
# ----------------------------------------------------------------------------
MODE="interactive"
case "$1" in
  --prod) MODE="prod" ;;
  --remote-dev) MODE="remote-dev" ;;
  --remote-prod|--prod-deploy) MODE="remote-prod" ;;
  --local-dev) MODE="local-dev" ;;
esac

# ----------------------------------------------------------------------------
# 2. Interactive prompt (optional)
# ----------------------------------------------------------------------------
if [[ "$MODE" == "interactive" ]]; then
  echo -e "${YELLOW}FLAIM Build Launcher${NC}"
  echo "========================\n"
  echo "What kind of build would you like to run?"
  echo "  1) Production build (sequential, fails on first error)"
  echo "  2) Local dev preview (wrangler pages dev)"
  echo "  3) Remote DEV deploy (Cloudflare Pages dev branch)"
  echo "  4) Remote PROD deploy (Cloudflare Pages main branch)"
  echo "  0) Cancel"
  read -rp "Select [1/0, default 1]: " CHOICE
  CHOICE=${CHOICE:-1}
  case "$CHOICE" in
    1) MODE="prod" ;;
    2) MODE="local-dev" ;;
    3) MODE="remote-dev" ;;
    4) MODE="remote-prod" ;;
    0) echo "Cancelled."; exit 0 ;;
    *) echo "Invalid selection"; exit 1 ;;
  esac
fi

echo -e "\n🔨 Starting $(echo $MODE | tr '[:lower:]' '[:upper:]') build"

# ----------------------------------------------------------------------------
# 3. Build steps (production)
# ----------------------------------------------------------------------------
# NOTE: Keep the order deterministic; some steps rely on others being built.

info "Installing workspace dependencies (npm ci)…"
(npm ci --silent) || error "Root npm ci failed"
success "Dependencies installed"

build_auth() {
  info "Building auth module…"
  (cd auth && npm run build) || error "Auth build failed"
  success "Auth module built"
}

build_frontend() {
  info "Building Next.js frontend…"
  (cd openai && npm run build && npx next-on-pages) || error "Frontend build failed"
  success "Frontend built & adapted with next-on-pages"
}

typecheck_worker() {
  local dir="$1" label="$2"
  info "Type-checking $label worker…"
  (cd "$dir" && npm run type-check) || error "$label type-check failed"
  success "$label worker type-checked"
}

deploy_frontend_remote() {
  local branch="$1" # dev or main
  local project="flaim-frontend-dev" # adjust if production project differs
  info "Deploying frontend to Cloudflare Pages (branch: $branch)…"
  (cd openai && wrangler pages deploy .vercel/output/static --project-name "$project" --branch "$branch") || error "Pages deploy failed"
  success "Frontend deployed to $branch"
}

run_local_preview() {
  info "Starting local Pages preview… (Ctrl+C to exit)"
  (cd openai && wrangler pages dev .vercel/output/static) || error "Pages dev exited with error"
}

if [[ "$MODE" == "prod" ]]; then
  build_auth
  build_frontend
  typecheck_worker workers/baseball-espn-mcp "Baseball"
  typecheck_worker workers/football-espn-mcp "Football"
elif [[ "$MODE" == "local-dev" ]]; then
  build_frontend
  run_local_preview
elif [[ "$MODE" == "remote-dev" ]]; then
  build_frontend
  deploy_frontend_remote dev
elif [[ "$MODE" == "remote-prod" ]]; then
  build_frontend
  deploy_frontend_remote main
fi

# ----------------------------------------------------------------------------
# 4. Outro
# ----------------------------------------------------------------------------

echo -e "\n${GREEN}🎉 Task completed for mode: $MODE.${NC}"

if [[ "$MODE" == "local-dev" ]]; then
  echo "Local preview running. Remember to stop with Ctrl+C when done."
elif [[ "$MODE" == remote-* ]]; then
  echo "Visit the deployment URL printed above to verify the site."
fi