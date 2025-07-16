#!/bin/bash

# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║                   FLAIM Production Build Script                           ║
# ║                                                                           ║
# ║  Deterministic artifact builder for CI/CD pipelines and deployment prep.  ║
# ║  No deployment logic – just pure production artifacts.                    ║
# ╚═══════════════════════════════════════════════════════════════════════════╝
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

# ┌─────────────────────────────────────────────────────────────────────────┐
# │                           Color & Styling                              │
# └─────────────────────────────────────────────────────────────────────────┘
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[1;33m'
readonly BLUE='\033[0;34m'
readonly PURPLE='\033[0;35m'
readonly CYAN='\033[0;36m'
readonly WHITE='\033[1;37m'
readonly GRAY='\033[0;90m'
readonly BOLD='\033[1m'
readonly DIM='\033[2m'
readonly NC='\033[0m'

# Visual helpers for consistent section banners
# --------------------------------------------

draw_rule() {
  echo -e "${DIM}────────────────────────────────────────────────────────────${NC}"
}

banner() {
  local color="$1"; shift
  echo
  draw_rule
  echo -e "${color}${BOLD}$*${NC}"
  draw_rule
  echo
}

info()    { echo -e "${BLUE}▶${NC} $1"; }
success() { echo -e "${GREEN}✓${NC} $1"; }
error()   { echo -e "${RED}✘${NC} $1"; exit 1; }

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
  banner "${BLUE}" "🔨 Building FLAIM Production Artifacts"
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
  
  if [ "$QUIET_MODE" = true ]; then
    # Filter noise in quiet mode while preserving errors
    local build_log="/tmp/frontend_build.log"
    if (cd openai && npm run build && npx next-on-pages) 2>&1 | \
       tee "$build_log" | \
       grep --line-buffered -v "EBADENGINE" | \
       grep --line-buffered -v "unsafe-perm" > /dev/null; then
      
      # Show summary of filtered warnings
      local ebad_count=$(grep "EBADENGINE" "$build_log" 2>/dev/null | wc -l | tr -d ' ')
      local unsafe_count=$(grep "unsafe-perm" "$build_log" 2>/dev/null | wc -l | tr -d ' ')
      ebad_count=${ebad_count:-0}
      unsafe_count=${unsafe_count:-0}
      
      if [ "$ebad_count" -gt 0 ] || [ "$unsafe_count" -gt 0 ]; then
        echo -e "${DIM}  Filtered warnings: ${ebad_count} EBADENGINE, ${unsafe_count} unsafe-perm${NC}"
      fi
    else
      error "Frontend build failed"
    fi
  else
    (cd openai && npm run build && npx next-on-pages) || error "Frontend build failed"
  fi
  
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
  banner "${GREEN}" "🎉 Build artifacts ready"
  echo -e "${DIM}Frontend:${NC} openai/.vercel/output/static/"
  echo -e "${DIM}Auth module:${NC} auth/dist/"
  echo -e "${DIM}Workers:${NC} type-checked and ready"
fi