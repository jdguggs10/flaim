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
if [[ "$1" == "--prod" ]]; then MODE="prod"; fi

# ----------------------------------------------------------------------------
# 2. Interactive prompt (optional)
# ----------------------------------------------------------------------------
if [[ "$MODE" == "interactive" ]]; then
  echo -e "${YELLOW}FLAIM Build Launcher${NC}"
  echo "========================\n"
  echo "What kind of build would you like to run?"
  echo "  1) Production build (sequential, fails on first error)"
  echo "  0) Cancel"
  read -rp "Select [1/0, default 1]: " CHOICE
  CHOICE=${CHOICE:-1}
  case "$CHOICE" in
    1) MODE="prod" ;;
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
  (cd openai && npm run build) || error "Frontend build failed"
  success "Frontend built"
}

typecheck_worker() {
  local dir="$1" label="$2"
  info "Type-checking $label worker…"
  (cd "$dir" && npm run type-check) || error "$label type-check failed"
  success "$label worker type-checked"
}

if [[ "$MODE" == "prod" ]]; then
  build_auth
  build_frontend
  typecheck_worker workers/baseball-espn-mcp "Baseball"
  typecheck_worker workers/football-espn-mcp "Football"
  # Note: auth-worker doesn't have a separate type-check script, 
  # but TypeScript errors are caught during auth module build above
fi

# ----------------------------------------------------------------------------
# 4. Outro
# ----------------------------------------------------------------------------

echo -e "\n${GREEN}🎉 Build completed successfully.${NC}"

echo "Artefacts ready for deployment. Run \`${YELLOW}./start.sh${NC}\` and choose deploy options, or use your CI pipeline." 