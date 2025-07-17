#!/bin/bash

# ╔═══════════════════════════════════════════════════════════════════════════╗
# ║                    FLAIM Development Orchestrator                         ║
# ║                                                                           ║
# ║  Complete stack orchestration: workers, frontend, and infrastructure.    ║
# ║  Single entry point for local development and remote deployments.        ║
# ║                                                                           ║
# ║  Compatible with bash 3.2+ (macOS default)                              ║
# ╚═══════════════════════════════════════════════════════════════════════════╝

# ┌─────────────────────────────────────────────────────────────────────────┐
# │                             Configuration                                │
# └─────────────────────────────────────────────────────────────────────────┘

VERSION="1.1.0"

# ┌─────────────────────────────────────────────────────────────────────────┐
# │                        Deployment Configuration                         │
# └─────────────────────────────────────────────────────────────────────────┘

# Cloudflare configuration - customize these for your setup
CF_ACCOUNT_DOMAIN="${CF_ACCOUNT_DOMAIN:-gerrygugger.workers.dev}"
CF_PAGES_PROJECT_NAME="${CF_PAGES_PROJECT_NAME:-flaim-frontend}"
CF_PAGES_PROD_DOMAIN="${CF_PAGES_PROD_DOMAIN:-flaim-frontend.pages.dev}"
CF_PAGES_DEV_DOMAIN="${CF_PAGES_DEV_DOMAIN:-preview.flaim-frontend.pages.dev}"

# Enhanced color palette
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

# Script configuration
DRY_RUN=${DRY_RUN:-false}
CONFIRM_PROD=${CONFIRM_PROD:-false}
CI=${CI:-false}

# Worker deployment modes
declare AUTH_MODE=""
declare BASEBALL_MODE=""
declare FOOTBALL_MODE=""

# ┌─────────────────────────────────────────────────────────────────────────┐
# │                           Utility Functions                             │
# └─────────────────────────────────────────────────────────────────────────┘

# Visual helpers for consistent section banners
# Usage: banner "$COLOR" "Title text"
# -------------------------------------------------------------------------

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


show_help() {
  cat << EOF
${BOLD}${BLUE}FLAIM Development Environment v${VERSION}${NC}
${DIM}Fantasy League AI Manager - Development Orchestrator${NC}

${BOLD}USAGE:${NC}
  $0 [options]

${BOLD}OPTIONS:${NC}
  ${GREEN}-h, --help${NC}       Show this help message and exit
  ${GREEN}-v, --version${NC}    Show version information
  ${GREEN}-d, --dry-run${NC}    Show what would be done without making changes
  ${GREEN}-y, --yes${NC}        Skip confirmation prompts
  ${GREEN}--confirm-prod${NC}   Require confirmation for production deployments

${BOLD}DEPLOYMENT MODES:${NC}
  ${CYAN}1) Local dev${NC}     Run all services locally (workers + frontend)
  ${YELLOW}2) Preview${NC}       Deploy complete stack to preview environment 
  ${RED}3) Production${NC}     Deploy complete stack to production
  ${PURPLE}0) Custom${NC}        Configure each worker individually

${BOLD}EXAMPLES:${NC}
  $0                    # Interactive mode selection
  $0 --dry-run         # Preview without changes
  WORKER_MODE=dev $0 # Set all workers to local dev mode

${BOLD}CONFIGURATION:${NC}
  Set these environment variables to customize deployment:
  ${GREEN}CF_ACCOUNT_DOMAIN${NC}     Your Cloudflare Workers domain
  ${GREEN}CF_PAGES_PROJECT_NAME${NC} Your Cloudflare Pages project name
  ${GREEN}CF_PAGES_PROD_DOMAIN${NC}  Production frontend domain
  ${GREEN}CF_PAGES_DEV_DOMAIN${NC}   Development frontend domain

EOF
  exit 0
}

# ┌─────────────────────────────────────────────────────────────────────────┐
# │                         Command Line Parsing                            │
# └─────────────────────────────────────────────────────────────────────────┘

while [[ $# -gt 0 ]]; do
  case $1 in
    -h|--help)
      show_help
      ;;
    -v|--version)
      echo -e "${BOLD}${BLUE}FLAIM Development Environment v${VERSION}${NC}"
      exit 0
      ;;
    -d|--dry-run)
      DRY_RUN=true
      shift
      ;;
    -y|--yes)
      CONFIRM_PROD=false
      shift
      ;;
    --confirm-prod)
      CONFIRM_PROD=true
      shift
      ;;
    *)
      echo -e "${RED}${BOLD}Error:${NC} Unknown option ${YELLOW}$1${NC}"
      echo -e "Use ${GREEN}$0 --help${NC} for usage information."
      exit 1
      ;;
  esac
done

# ┌─────────────────────────────────────────────────────────────────────────┐
# │                        Prerequisites Check                              │
# └─────────────────────────────────────────────────────────────────────────┘

if ! command -v wrangler >/dev/null 2>&1; then
  echo -e "${RED}${BOLD}✘ Error:${NC} Wrangler CLI not found"
  echo -e "${GRAY}  Install with:${NC} ${GREEN}npm install -g wrangler${NC}"
  exit 1
fi

if ! wrangler whoami >/dev/null 2>&1; then
  echo -e "${YELLOW}${BOLD}⚠ Warning:${NC} Not logged in to Cloudflare"
  echo -e "${GRAY}  Login with:${NC} ${GREEN}wrangler login${NC}"
  exit 1
fi

# Check Node version
required_node_major=20
current_major=$(node -v | sed -E 's/^v([0-9]+).*/\1/')
if [ "$current_major" -ne "$required_node_major" ]; then
  echo -e "${YELLOW}${BOLD}⚠ Node $current_major detected – Node $required_node_major required.${NC}"
  echo -e "  Use ${GREEN}nvm use 20${NC} (or volta) and re-run."
  read -p "Continue anyway? [y/N]: " ans
  [[ ! $ans =~ ^[Yy]$ ]] && exit 1
fi

# Check Wrangler version
check_wrangler_version() {
  local latest
  latest=$(timeout 3 npm view wrangler@latest version 2>/dev/null)
  local current
  current=$(wrangler --version | awk '{print $2}')
  if [ "$latest" != "$current" ] && [ -n "$latest" ]; then
    echo -e "${YELLOW}⚠ Wrangler $current installed; $latest available.${NC}"
    echo -e "  Update with: ${GREEN}npm i -g wrangler@latest${NC}"
  fi
}

check_wrangler_version

# ┌─────────────────────────────────────────────────────────────────────────┐
# │                           Script Banner                                 │
# └─────────────────────────────────────────────────────────────────────────┘

banner "${BLUE}" "🚀 FLAIM Development Environment v${VERSION}"
echo -e "${DIM}Fantasy League AI Manager - Development Orchestrator${NC}"

# Display warning guidance
show_warning_guidance() {
  if [ "$DRY_RUN" = false ]; then
    echo -e "${YELLOW}${BOLD}📋 Common Build Warnings${NC}"
    echo -e "${DIM}  • EBADENGINE: Use Node 20 to eliminate warnings${NC}"
    echo -e "${DIM}  • unsafe-perm: Upstream issue, no action needed${NC}"
    echo -e "${DIM}  • Edge runtime: Normal for API routes${NC}"
    echo -e "${DIM}  • Git dirty: Auto-handled or commit changes${NC}"
    echo
  fi
}

show_warning_guidance

if [ "$DRY_RUN" = true ]; then
  echo -e "${YELLOW}${BOLD}⚠️  DRY RUN MODE:${NC} ${DIM}No changes will be made${NC}"
  echo
fi

# ┌─────────────────────────────────────────────────────────────────────────┐
# │                      Worker Mode Management                             │
# └─────────────────────────────────────────────────────────────────────────┘

# Global deployment mode for all workers
declare GLOBAL_MODE=""

# Set deployment mode for a specific worker
set_worker_mode() {
  local worker_name="$1"
  local deployment_mode="$2"
  
  case "$worker_name" in
    auth)     AUTH_MODE="$deployment_mode" ;;
    baseball) BASEBALL_MODE="$deployment_mode" ;;
    football) FOOTBALL_MODE="$deployment_mode" ;;
    *)        echo -e "${RED}Unknown worker: $worker_name${NC}" >&2; return 1 ;;
  esac
}

# Get deployment mode for a specific worker
get_worker_mode() {
  local worker_name="$1"
  
  case "$worker_name" in
    auth)     echo "$AUTH_MODE" ;;
    baseball) echo "$BASEBALL_MODE" ;;
    football) echo "$FOOTBALL_MODE" ;;
    *)        echo "unknown" ;;
  esac
}

# Select global deployment mode for all workers
select_global_mode() {
  
  # Check if mode is set via environment variable
  if [ -n "$WORKER_MODE" ]; then
    case "$WORKER_MODE" in
      dev|preview|prod|skip)
        GLOBAL_MODE="$WORKER_MODE"
        echo -e "${GREEN}${BOLD}✓${NC} All workers set to ${YELLOW}${BOLD}${GLOBAL_MODE}${NC} ${DIM}(via WORKER_MODE)${NC}"
        return
        ;;
      *)
        echo -e "${YELLOW}${BOLD}⚠${NC} Invalid WORKER_MODE: ${RED}${WORKER_MODE}${NC}. ${DIM}Using interactive mode.${NC}"
        ;;
    esac
  fi
  
  echo -e "${BOLD}${BLUE}▶ Deployment Mode Selection${NC}"
  echo -e "  ${CYAN}1)${NC} Local dev          ${DIM}(all services run locally)${NC}"
  echo -e "  ${YELLOW}2)${NC} Preview            ${DIM}(deploy workers + frontend to preview environment)${NC}"
  echo -e "  ${RED}3)${NC} Production         ${DIM}(deploy workers + frontend to production)${NC}"
  echo -e "  ${PURPLE}0)${NC} Custom             ${DIM}(configure each worker individually)${NC}"
  echo
  
  while true; do
    echo -ne "  ${BOLD}Select [1-3/0, default 1]:${NC} "
    read -r CHOICE
    CHOICE=${CHOICE:-1}
    
    case "$CHOICE" in
      1) 
        GLOBAL_MODE="dev"
        break
        ;;
      2) 
        GLOBAL_MODE="preview"
        break
        ;;
      3) 
        if [ "$CONFIRM_PROD" = true ]; then
          echo
          echo -ne "  ${RED}${BOLD}⚠ Deploy ALL workers to PRODUCTION? [y/N]:${NC} "
          read -r confirm
          if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
            echo -e "  ${DIM}Skipping production deployment.${NC}"
            continue
          fi
        fi
        GLOBAL_MODE="prod"
        break
        ;;
      0) 
        GLOBAL_MODE="custom"
        break
        ;;
      *) 
        echo -e "  ${RED}Invalid choice. Please try again.${NC}"
        ;;
    esac
  done
}

# Apply the same deployment mode to all workers
set_all_worker_modes() {
  local deployment_mode="$1"
  
  set_worker_mode "auth" "$deployment_mode"
  set_worker_mode "baseball" "$deployment_mode"
  set_worker_mode "football" "$deployment_mode"
}

# Prompt for individual worker deployment mode
prompt_worker_mode() {
  local worker_name="$1"
  local default_choice="1"
  
  # Note: Allow dry-run to continue with interactive mode selection
  
  # Check for environment variable override (e.g., WORKER_AUTH_MODE=dev)
  local env_var="WORKER_$(echo "$worker_name" | tr '[:lower:]' '[:upper:]')_MODE"
  local env_value=$(eval "echo \$$env_var")
  
  if [ -n "$env_value" ]; then
    case "$env_value" in
      dev|preview|prod|skip)
        set_worker_mode "$worker_name" "$env_value"
        local worker_display=$(echo "$worker_name" | awk '{print toupper(substr($0,1,1)) substr($0,2)}')
        echo -e "${GREEN}${BOLD}✓${NC} ${worker_display} worker set to ${YELLOW}${BOLD}${env_value}${NC} ${DIM}(via $env_var)${NC}"
        return
        ;;
      *)
        echo -e "${YELLOW}${BOLD}⚠${NC} Invalid $env_var: ${RED}${env_value}${NC}. ${DIM}Using interactive mode.${NC}"
        ;;
    esac
  fi
  
  local worker_display=$(echo "$worker_name" | awk '{print toupper(substr($0,1,1)) substr($0,2)}')
  echo
  echo -e "${BOLD}${BLUE}▶ ${worker_display} Worker Deployment${NC}"
  echo -e "  ${CYAN}1)${NC} Local dev          ${DIM}(run locally with wrangler dev)${NC}"
  echo -e "  ${YELLOW}2)${NC} Preview            ${DIM}(deploy to preview environment)${NC}"
  echo -e "  ${RED}3)${NC} Production         ${DIM}(deploy to production)${NC}"
  echo -e "  ${GRAY}0)${NC} Skip               ${DIM}(disable this worker)${NC}"
  echo
  
  while true; do
    echo -ne "  ${BOLD}Select [1-3/0, default $default_choice]:${NC} "
    read -r choice
    choice=${choice:-$default_choice}
    
    case "$choice" in
      1) 
        set_worker_mode "$worker_name" "dev"
        break
        ;;
      2) 
        set_worker_mode "$worker_name" "preview"
        break
        ;;
      3) 
        if [ "$CONFIRM_PROD" = true ]; then
          echo
          echo -ne "  ${RED}${BOLD}⚠ Deploy ${worker_display} to PRODUCTION? [y/N]:${NC} "
          read -r confirm
          if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
            echo -e "  ${DIM}Skipping production deployment.${NC}"
            continue
          fi
        fi
        set_worker_mode "$worker_name" "prod"
        break
        ;;
      0) 
        set_worker_mode "$worker_name" "skip"
        break
        ;;
      *) 
        echo -e "  ${RED}Invalid choice. Please try again.${NC}"
        ;;
    esac
  done
}

# ┌─────────────────────────────────────────────────────────────────────────┐
# │                       Deployment Configuration                          │
# └─────────────────────────────────────────────────────────────────────────┘

# Select deployment modes
select_global_mode

if [ "$GLOBAL_MODE" = "custom" ]; then
  echo -e "\n${BOLD}${PURPLE}🔧 Custom Configuration${NC}"
  echo -e "${DIM}Configure each worker individually${NC}"
  
  prompt_worker_mode "auth"
  prompt_worker_mode "baseball"
  prompt_worker_mode "football"
else
  set_all_worker_modes "$GLOBAL_MODE"
fi

# Display final configuration
banner "${BLUE}" "📋 Configuration Summary"

get_mode_display() {
  local mode="$1"
  case "$mode" in
    dev)        echo -e "${CYAN}${BOLD}Local Dev${NC}" ;;
    preview)    echo -e "${YELLOW}${BOLD}Preview${NC}" ;;
    prod)       echo -e "${RED}${BOLD}Production${NC}" ;;
    skip)       echo -e "${GRAY}${BOLD}Skipped${NC}" ;;
    *)          echo -e "${GRAY}Unknown${NC}" ;;
  esac
}

echo -e "  🔐 ${BOLD}Auth Worker:${NC}     $(get_mode_display "$(get_worker_mode auth)")"
echo -e "  ⚾ ${BOLD}Baseball Worker:${NC} $(get_mode_display "$(get_worker_mode baseball)")"
echo -e "  🏈 ${BOLD}Football Worker:${NC} $(get_mode_display "$(get_worker_mode football)")"
echo

# Validate configuration
if [ "$(get_worker_mode auth)" = "skip" ] && [ "$(get_worker_mode baseball)" = "skip" ] && [ "$(get_worker_mode football)" = "skip" ]; then
  echo -e "${YELLOW}${BOLD}⚠ Warning:${NC} All workers are skipped. Nothing to do."
  exit 0
fi

# ┌─────────────────────────────────────────────────────────────────────────┐
# │                      Process Management                                 │
# └─────────────────────────────────────────────────────────────────────────┘

# Terminate processes running on a specific port
kill_port() {
  local port="$1"
  local pids
  
  pids=$(lsof -ti ":$port" 2>/dev/null)
  if [ -n "$pids" ]; then
    echo -e "${DIM}  Terminating processes on port $port...${NC}"
    echo "$pids" | xargs kill -9 2>/dev/null || true
    sleep 1
  fi
}

# Comprehensive cleanup on script exit
cleanup() {
  # Check if we have local services that need cleanup
  local has_local_cleanup=false
  
  # Check for running background jobs (local services)
  if [ -n "$(jobs -p 2>/dev/null)" ]; then
    has_local_cleanup=true
  fi
  
  # Check for processes on our ports
  for port in 8786 8787 8788 3000; do
    if lsof -ti ":$port" >/dev/null 2>&1; then
      has_local_cleanup=true
      break
    fi
  done
  
  # Only show shutdown messages if we have local services to clean up
  if [ "$has_local_cleanup" = true ]; then
    echo
    echo -e "${BOLD}${BLUE}🛑 Shutting down services...${NC}"
  fi
  
  # Kill background jobs
  jobs -p | xargs kill 2>/dev/null || true
  
  # Kill processes on known ports
  kill_port 8786  # Auth worker
  kill_port 8787  # Baseball worker  
  kill_port 8788  # Football worker
  kill_port 3000  # Frontend
  
  # Clean up auto-generated files
  if [ -f "openai/.env.local" ]; then
    rm -f "openai/.env.local"
    if [ "$has_local_cleanup" = true ]; then
      echo -e "${DIM}  Cleaned up auto-generated .env.local${NC}"
    fi
  fi
  
  # Only show completion message if we actually cleaned up services
  if [ "$has_local_cleanup" = true ]; then
    echo -e "${GREEN}${BOLD}✓${NC} ${DIM}All services stopped${NC}"
  fi
  
  exit 0
}

# Set up cleanup handlers
trap cleanup SIGINT SIGTERM EXIT

# Initialize cleanup
rm -f /tmp/inspector_ports.list

banner "${BLUE}" "🧹 Environment Preparation"

# Terminate existing processes only for ports we'll use
[ "$(get_worker_mode auth)" = "dev" ] && kill_port 8786
[ "$(get_worker_mode baseball)" = "dev" ] && kill_port 8787  
[ "$(get_worker_mode football)" = "dev" ] && kill_port 8788
kill_port 3000

# Clean up any lingering wrangler/next processes
pkill -f "wrangler dev" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
sleep 2

echo -e "${GREEN}${BOLD}✓${NC} ${DIM}Environment ready${NC}"
echo

# ┌─────────────────────────────────────────────────────────────────────────┐
# │                      Worker Deployment                                 │
# └─────────────────────────────────────────────────────────────────────────┘
# Deploy or launch a worker based on its configured mode
launch_or_deploy() {
  local worker_name="$1"
  local worker_dir="$2" 
  local worker_port="$3"
  
  local deployment_mode
  local log_file="/tmp/${worker_name}.log"
  local worker_display
  
  deployment_mode=$(get_worker_mode "$worker_name")
  worker_display=$(echo "$worker_name" | awk '{print toupper(substr($0,1,1)) substr($0,2)}')
  
  # Handle dry run mode
  if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}${BOLD}⚠ DRY RUN:${NC} Would deploy ${worker_display} in ${BOLD}${deployment_mode}${NC} mode"
    return 0
  fi
  
  case "$deployment_mode" in
    dev)
      if ! lsof -i ":$worker_port" >/dev/null 2>&1; then
        echo
        echo -e "${CYAN}${BOLD}🛠 Starting ${worker_display} Worker${NC} ${DIM}(port $worker_port)${NC}"
        echo
        
        # Use unique inspector port to prevent conflicts
        local inspector_port=$((worker_port + 4000))
        (cd "$worker_dir" && wrangler dev --env dev --port "$worker_port" --inspector-port "$inspector_port" > "$log_file" 2>&1) &
        
        # Track inspector port for cleanup
        echo "$inspector_port" >> /tmp/inspector_ports.list
        echo $! > "/tmp/${worker_name}.pid"
      else
        echo
        echo -e "${YELLOW}${BOLD}⚠${NC} Port $worker_port in use. Skipping ${worker_display} worker."
        echo
        return 1
      fi
      ;;
      
    preview)
      echo
      echo -e "${YELLOW}${BOLD}🚀 Deploying ${worker_display} Worker${NC} ${DIM}(preview environment)${NC}"
      echo -e "${DIM}  Running: cd \"$worker_dir\" && wrangler deploy --env preview --minify${NC}"
      
      if (cd "$worker_dir" && wrangler deploy --env preview --minify 2>&1); then
        echo
        echo -e "${GREEN}${BOLD}✅ ${worker_display} deployed successfully${NC}"
        echo
      else
        echo
        echo -e "${RED}${BOLD}✘ Failed to deploy ${worker_display}${NC}"
        echo -e "${DIM}  Check logs: $log_file${NC}"
        echo
        return 1
      fi
      ;;
      
    prod)
      if [ "$CONFIRM_PROD" = true ]; then
        echo
        echo -ne "  ${RED}${BOLD}⚠ Deploy ${worker_display} to PRODUCTION? [y/N]:${NC} "
        read -r confirm
        if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
          echo -e "${DIM}  Skipping production deployment of ${worker_display}.${NC}"
          return 0
        fi
      fi
      
      echo
      echo -e "${RED}${BOLD}🚀 Deploying ${worker_display} Worker${NC} ${DIM}(PRODUCTION)${NC}"
      echo -e "${DIM}  Running: cd \"$worker_dir\" && wrangler deploy --env prod --minify${NC}"
      
      if (cd "$worker_dir" && wrangler deploy --env prod --minify 2>&1); then
        echo
        echo -e "${GREEN}${BOLD}✅ ${worker_display} deployed to PRODUCTION${NC}"
        echo
      else
        echo
        echo -e "${RED}${BOLD}✘ Failed to deploy ${worker_display} to PRODUCTION${NC}"
        echo -e "${DIM}  Check logs: $log_file${NC}"
        echo
        return 1
      fi
      ;;
      
    skip)
      echo
      echo -e "${GRAY}${BOLD}⏭ Skipping ${worker_display} Worker${NC}"
      echo
      ;;
      
    *)
      echo
      echo -e "${RED}${BOLD}✘ Unknown deployment mode for ${worker_display}: $deployment_mode${NC}"
      echo
      return 1
      ;;
  esac
  
  return 0
}

# Execute deployments
launch_or_deploy "auth"     "workers/auth-worker"        8786
launch_or_deploy "baseball" "workers/baseball-espn-mcp" 8787
launch_or_deploy "football" "workers/football-espn-mcp" 8788

# ┌─────────────────────────────────────────────────────────────────────────┐
# │                      Frontend Deployment                               │
# └─────────────────────────────────────────────────────────────────────────┘

# Build and deploy frontend for remote environments
build_and_deploy_frontend() {
  local deployment_mode="$1"
  local branch="preview"
  local project="$CF_PAGES_PROJECT_NAME"
  
  case "$deployment_mode" in
    preview)
      branch="preview"
      ;;
    prod)
      branch="main"
      ;;
    *)
      echo -e "${RED}${BOLD}✘ Invalid frontend deployment mode: $deployment_mode${NC}"
      return 1
      ;;
  esac
  
  echo
  echo -e "${PURPLE}${BOLD}🏗️  Building Frontend Artifacts${NC}"
  echo -e "${DIM}  Running: ./build.sh --quiet${NC}"
  
  if ! ./build.sh --quiet; then
    echo
    echo -e "${RED}${BOLD}✘ Frontend build failed${NC}"
    echo
    return 1
  fi
  
  echo
  echo -e "${PURPLE}${BOLD}🚀 Deploying Frontend${NC} ${DIM}(branch: $branch)${NC}"
  
  # Build wrangler command with conditional --commit-dirty flag
  local deploy_cmd="wrangler pages deploy .vercel/output/static --project-name \"$project\" --branch \"$branch\""
  
  # Check if repo is dirty
  local repo_dirty=false
  if ! git diff-index --quiet HEAD --; then
    repo_dirty=true
  fi
  
  # Apply --commit-dirty flag for CI or dirty repo
  if [ "$CI" = true ] || [ "$repo_dirty" = true ]; then
    deploy_cmd="$deploy_cmd --commit-dirty=true"
  fi
  
  echo -e "${DIM}  Running: $deploy_cmd${NC}"
  
  if (cd openai && eval "$deploy_cmd" 2>&1); then
    echo
    echo -e "${GREEN}${BOLD}✅ Frontend deployed successfully${NC}"
    echo
    return 0
  else
    echo
    echo -e "${RED}${BOLD}✘ Failed to deploy frontend${NC}"
    echo
    return 1
  fi
}

# Deploy frontend for remote deployments
needs_frontend_deployment=false
for worker in auth baseball football; do
  mode=$(get_worker_mode "$worker")
  if [ "$mode" = "preview" ] || [ "$mode" = "prod" ]; then
    needs_frontend_deployment=true
    break
  fi
done

if [ "$needs_frontend_deployment" = true ]; then
  if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}${BOLD}⚠ DRY RUN:${NC} Would build and deploy frontend"
  else
    # Determine deployment mode from worker modes
    if [ "$(get_worker_mode auth)" = "prod" ] || [ "$(get_worker_mode baseball)" = "prod" ] || [ "$(get_worker_mode football)" = "prod" ]; then
      if ! build_and_deploy_frontend "prod"; then
        echo -e "${RED}${BOLD}✘ Frontend deployment failed${NC}"
        exit 1
      fi
    else
      if ! build_and_deploy_frontend "preview"; then
        echo -e "${RED}${BOLD}✘ Frontend deployment failed${NC}"
        exit 1
      fi
    fi
  fi
fi

# ┌─────────────────────────────────────────────────────────────────────────┐
# │                    Environment Configuration                            │
# └─────────────────────────────────────────────────────────────────────────┘

banner "${PURPLE}" "🔧 Environment Configuration"

# Generate .env.local file for local development or clean it up for remote deployment
generate_local_env_file() {
  local env_file="openai/.env.local"
  local has_local_workers=false
  
  # Check if any workers are running in local mode
  for worker in auth baseball football; do
    if [ "$(get_worker_mode "$worker")" = "dev" ]; then
      has_local_workers=true
      break
    fi
  done
  
  if [ "$has_local_workers" = true ]; then
    echo -e "${CYAN}${BOLD}📝 Generating .env.local${NC} ${DIM}for local development${NC}"
    
    # Create .env.local with localhost URLs for local workers
    cat > "$env_file" << 'EOF'
# ┌─────────────────────────────────────────────────────────────────────────┐
# │                Auto-generated by start.sh                              │
# │                This file is temporary and recreated on each run         │
# └─────────────────────────────────────────────────────────────────────────┘

# OpenAI API Key (add your actual key)
OPENAI_API_KEY=your-openai-api-key-here

# Clerk Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_YWNlLWdydWJ3b3JtLTc2LmNsZXJrLmFjY291bnRzLmRldiQ
CLERK_SECRET_KEY=your-clerk-secret-key-here

# Local Worker URLs (for wrangler dev)
NEXT_PUBLIC_AUTH_WORKER_URL=http://localhost:8786
NEXT_PUBLIC_BASEBALL_ESPN_MCP_URL=http://localhost:8787
NEXT_PUBLIC_FOOTBALL_ESPN_MCP_URL=http://localhost:8788

# Encryption key (add your actual key)
CF_ENCRYPTION_KEY=your-encryption-key-here
EOF
    
    echo -e "${GREEN}${BOLD}✓${NC} Created ${BOLD}$env_file${NC}"
    echo -e "${YELLOW}${BOLD}⚠${NC} ${DIM}Add your actual API keys to $env_file${NC}"
  else
    # Remove .env.local if it exists, so Wrangler vars take precedence
    if [ -f "$env_file" ]; then
      rm "$env_file"
      echo -e "${CYAN}${BOLD}🧹 Removed .env.local${NC} ${DIM}(using Wrangler configuration)${NC}"
    fi
    echo -e "${GREEN}${BOLD}✓${NC} ${DIM}Using Wrangler environment variables${NC}"
  fi
}

generate_local_env_file

# -------------------------------------------------------------------------
# Worker information helper (needs to be defined before first use)

# Get the appropriate URL for a worker based on its deployment mode
get_worker_url() {
  local worker_name="$1"
  local worker_port="$2" 
  local worker_label="$3"
  
  local deployment_mode
  deployment_mode=$(get_worker_mode "$worker_name")
  
  case "$deployment_mode" in
    dev)        echo "http://localhost:$worker_port" ;;
    preview)    echo "https://${worker_label}-preview.${CF_ACCOUNT_DOMAIN}" ;;
    prod)       echo "https://${worker_label}.${CF_ACCOUNT_DOMAIN}" ;;
    skip)       echo "disabled" ;;
    *)          echo "unknown" ;;
  esac
}

# Worker information helper
print_worker_info() {
  local worker_name="$1"
  local worker_port="$2"
  local worker_label="$3"
  
  local deployment_mode
  local worker_url
  local mode_display
  local worker_display
  
  deployment_mode=$(get_worker_mode "$worker_name")
  
  # Skip if worker is disabled
  if [ "$deployment_mode" = "skip" ]; then
    return
  fi
  
  worker_url=$(get_worker_url "$worker_name" "$worker_port" "$worker_label")
  worker_display=$(echo "$worker_name" | awk '{print toupper(substr($0,1,1)) substr($0,2)}')
  
  # Format deployment mode with colors
  case "$deployment_mode" in
    dev)        mode_display="${CYAN}${BOLD}Local Dev${NC}" ;;
    preview)    mode_display="${YELLOW}${BOLD}Preview${NC}" ;;
    prod)       mode_display="${RED}${BOLD}Production${NC}" ;;
    *)          mode_display="${GRAY}${deployment_mode}${NC}" ;;
  esac
  
  echo -e "${GREEN}${BOLD}${worker_display} Worker${NC} ${DIM}(${mode_display}${DIM})${NC}"
  echo -e "${DIM}  URL:${NC}     ${CYAN}${worker_url}${NC}"
  
  # Show additional info for local workers
  if [ "$deployment_mode" = "dev" ]; then
    echo -e "${DIM}  Health:${NC}  ${GRAY}http://localhost:${worker_port}/health${NC}"
    echo -e "${DIM}  Logs:${NC}    ${GRAY}tail -f /tmp/${worker_name}.log${NC}"
  fi
  
  echo
}

# ┌─────────────────────────────────────────────────────────────────────────┐
# │                    Deployment Mode Detection                            │
# └─────────────────────────────────────────────────────────────────────────┘

# Check if any workers are running locally
has_local_services=false
for worker in auth baseball football; do
  if [ "$(get_worker_mode "$worker")" = "dev" ]; then
    has_local_services=true
    break
  fi
done

# For remote-only deployments, exit after deployment
if [ "$has_local_services" = false ] && [ "$DRY_RUN" = false ]; then
  echo
  echo -e "${GREEN}${BOLD}✅ Remote Deployment Complete${NC}"
  echo -e "${DIM}All services deployed to Cloudflare infrastructure${NC}"
  echo
  echo -e "${BOLD}${BLUE}🌐 Deployed Services${NC}"
  echo -e "${BLUE}══════════════════════${NC}"
  
  # Show frontend deployment URL
  if [ "$needs_frontend_deployment" = true ]; then
    if [ "$(get_worker_mode auth)" = "prod" ] || [ "$(get_worker_mode baseball)" = "prod" ] || [ "$(get_worker_mode football)" = "prod" ]; then
      echo -e "${GREEN}${BOLD}Frontend${NC} ${DIM}(Production)${NC}"
      echo -e "${DIM}  URL:${NC}     ${CYAN}https://${CF_PAGES_PROD_DOMAIN}${NC}"
    else
      echo -e "${GREEN}${BOLD}Frontend${NC} ${DIM}(Preview)${NC}"  
      echo -e "${DIM}  URL:${NC}     ${CYAN}https://${CF_PAGES_DEV_DOMAIN}${NC}"
    fi
    echo
  fi
  
  # Show deployed worker URLs
  print_worker_info "auth"     "8786" "auth-worker"
  print_worker_info "baseball" "8787" "baseball-espn-mcp" 
  print_worker_info "football" "8788" "football-espn-mcp"
  
  echo -e "${GREEN}${BOLD}🎉 FLAIM Platform Ready${NC}"
  echo -e "${DIM}Your complete stack is now running on Cloudflare${NC}"
  exit 0
fi

# ┌─────────────────────────────────────────────────────────────────────────┐
# │                       Frontend Startup                                 │
# └─────────────────────────────────────────────────────────────────────────┘

banner "${PURPLE}" "🖥️  Starting Next.js Frontend (port 3000)"

(cd openai && npm run dev > /tmp/frontend.log 2>&1) &
FRONTEND_PID=$!

# Store PID for cleanup
echo $FRONTEND_PID > /tmp/frontend.pid

# ┌─────────────────────────────────────────────────────────────────────────┐
# │                      Service Health Checks                             │
# └─────────────────────────────────────────────────────────────────────────┘

banner "${BLUE}" "⏳ Service Health Checks"

# Check if a service is responding to health checks
check_service() {
  local service_url="$1"
  local service_name="$2"
  local max_attempts=30
  local attempt=0
  
  echo -ne "${DIM}  Checking ${service_name}...${NC}"
  
  while [ $attempt -lt $max_attempts ]; do
    if curl -s -f "$service_url" > /dev/null 2>&1; then
      echo -e "\r  ${GREEN}${BOLD}✓${NC} ${service_name} ${DIM}is ready${NC}"
      return 0
    fi
    sleep 1
    attempt=$((attempt + 1))
    echo -n "."
  done
  
  echo -e "\r  ${RED}${BOLD}✘${NC} ${service_name} ${DIM}failed to start (30s timeout)${NC}"
  return 1
}

# Execute health checks for local services
services_started=true

if [ "$DRY_RUN" = false ]; then
  # Check local workers
  if [ "$(get_worker_mode auth)" = "dev" ]; then
    if ! check_service "http://localhost:8786/health" "Auth Worker"; then
      services_started=false
    fi
  fi

  if [ "$(get_worker_mode baseball)" = "dev" ]; then
    if ! check_service "http://localhost:8787/health" "Baseball Worker"; then
      services_started=false
    fi
  fi

  if [ "$(get_worker_mode football)" = "dev" ]; then
    if ! check_service "http://localhost:8788/health" "Football Worker"; then
      services_started=false
    fi
  fi

  # Check frontend
  if ! check_service "http://localhost:3000" "Frontend"; then
    services_started=false
  fi
  
  echo
  if [ "$services_started" = true ]; then
    echo -e "${GREEN}${BOLD}✅ All services healthy${NC}"
  else
    echo -e "${RED}${BOLD}✘ Some services failed to start${NC}"
    echo -e "${DIM}Check logs above for details${NC}"
    exit 1
  fi
else
  echo -e "${YELLOW}${BOLD}⚠ DRY RUN:${NC} ${DIM}Skipping health checks${NC}"
fi

# ┌─────────────────────────────────────────────────────────────────────────┐
# │                       Service Information                               │
# └─────────────────────────────────────────────────────────────────────────┘

banner "${BLUE}" "🌐 Service Information"

# Frontend information  
echo -e "${GREEN}${BOLD}Frontend${NC}"
echo -e "${DIM}  URL:${NC}     ${CYAN}http://localhost:3000${NC}"
echo -e "${DIM}  Logs:${NC}    ${GRAY}tail -f /tmp/frontend.log${NC}"
echo


# Display worker information
print_worker_info "auth"     "8786" "auth-worker"
print_worker_info "baseball" "8787" "baseball-espn-mcp"
print_worker_info "football" "8788" "football-espn-mcp"

# ┌─────────────────────────────────────────────────────────────────────────┐
# │                        Quick Reference                                  │
# └─────────────────────────────────────────────────────────────────────────┘

echo -e "${BOLD}${BLUE}📋 Quick Commands${NC}"
echo -e "${BLUE}══════════════════${NC}"
echo -e "${DIM}  Stop services:${NC}  ${YELLOW}Press Ctrl+C${NC}"
echo -e "${DIM}  View logs:${NC}     ${GRAY}tail -f /tmp/{auth,baseball,football,frontend}.log${NC}"
echo -e "${DIM}  Dry run:${NC}       ${GRAY}$0 --dry-run${NC}"
echo -e "${DIM}  Help:${NC}          ${GRAY}$0 --help${NC}"

# ┌─────────────────────────────────────────────────────────────────────────┐
# │                          Completion                                     │
# └─────────────────────────────────────────────────────────────────────────┘

echo
echo -e "${GREEN}${BOLD}✅ FLAIM Development Environment Ready${NC}"

if [ "$DRY_RUN" = false ]; then
  echo
  echo -e "${BOLD}${BLUE}🚀 Local Services Running${NC}"
  echo -e "${DIM}Press ${YELLOW}${BOLD}Ctrl+C${NC}${DIM} to stop all local services and exit${NC}"
  echo
  
  # Wait for any process to exit
  wait
  
  echo
  echo -e "${GREEN}${BOLD}✅ All local services stopped gracefully${NC}"
else
  echo
  echo -e "${YELLOW}${BOLD}⚠ DRY RUN COMPLETE:${NC} ${DIM}No changes were made${NC}"
fi
