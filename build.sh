#!/bin/bash

# ============================================================================
#  FLAIM Production Build Script (build.sh)
# ---------------------------------------------------------------------------
#  Purpose   : Pure artifact builder for CI/CD pipelines and deployment prep.
#              Creates production-ready, deployable artifacts with zero side effects.
#              No interactive modes, no deployment logic - just deterministic building.
#
#  What it does:
#    • Installs dependencies (npm ci)
#    • Builds auth module
#    • Builds Next.js frontend with next-on-pages adapter
#    • Type-checks all workers
#    • Outputs clean artifacts ready for deployment
#
#  Usage:
#      ./build.sh           # Build everything
#      ./build.sh --quiet   # Silent mode for CI
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
# 1. Parse flags
# ----------------------------------------------------------------------------
QUIET_MODE=false
case "$1" in
  --quiet) QUIET_MODE=true ;;
  --help) 
    echo -e "${BLUE}FLAIM Build Script${NC}"
    echo "Usage: $0 [--quiet] [--help]"
    echo "  --quiet  Silent mode (minimal output)"
    echo "  --help   Show this help"
    exit 0
    ;;
esac

if [ "$QUIET_MODE" = false ]; then
  echo -e "\n🔨 ${BOLD}Building FLAIM Production Artifacts${NC}"
fi

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


# ----------------------------------------------------------------------------
# 3. Execute build sequence
# ----------------------------------------------------------------------------
# Deterministic build order - auth first, then frontend, then type-checks

build_auth
build_frontend
typecheck_worker workers/auth-worker "Auth"
typecheck_worker workers/baseball-espn-mcp "Baseball"
typecheck_worker workers/football-espn-mcp "Football"

# ----------------------------------------------------------------------------
# 4. Outro
# ----------------------------------------------------------------------------

# ----------------------------------------------------------------------------
# 4. Build complete
# ----------------------------------------------------------------------------

if [ "$QUIET_MODE" = false ]; then
  echo -e "\n${GREEN}🎉 Build artifacts ready for deployment${NC}"
  echo -e "${DIM}  Frontend: openai/.vercel/output/static/${NC}"
  echo -e "${DIM}  Auth module: auth/dist/${NC}"
  echo -e "${DIM}  Workers: type-checked and ready${NC}"
fi