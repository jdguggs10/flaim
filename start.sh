#!/bin/bash

# FLAIM Development Startup Script
# Starts all services for local development
# Compatible with bash 3.2 (macOS default)

# Version
VERSION="1.1.0"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
DRY_RUN=false
CONFIRM_PROD=false

# Worker modes (using separate variables for bash 3.2 compatibility)
AUTH_MODE=""
BASEBALL_MODE=""
FOOTBALL_MODE=""

show_help() {
  echo "FLAIM Development Environment v${VERSION}"
  echo "Usage: $0 [options]"
  echo ""
  echo "Options:"
  echo "  -h, --help       Show this help message and exit"
  echo "  -v, --version    Show version information"
  echo "  -d, --dry-run    Show what would be done without making changes"
  echo "  -y, --yes        Skip confirmation prompts"
  echo "  --confirm-prod   Require confirmation for production deployments"
  echo ""
  echo "Modes:"
  echo "  1) Local dev    - Run locally with wrangler dev"
  echo "  2) Remote dev   - Deploy to dev environment"
  echo "  3) Deploy prod  - Deploy to production"
  echo "  0) Custom       - Configure each worker individually"
  exit 0
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -h|--help)
      show_help
      ;;
    -v|--version)
      echo "FLAIM Development Environment v${VERSION}"
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
      echo "${RED}Error: Unknown option $1${NC}"
      show_help
      exit 1
      ;;
  esac
done

# Check if wrangler is available
if ! command -v wrangler >/dev/null 2>&1; then
  echo -e "${RED}❌ Error: wrangler command not found. Please install Wrangler CLI:${NC}"
  echo "   npm install -g wrangler"
  exit 1
fi

# Check if user is logged in to Cloudflare
if ! wrangler whoami >/dev/null 2>&1; then
  echo -e "${YELLOW}⚠️  You are not logged in to Cloudflare. Please run:${NC}"
  echo "   wrangler login"
  exit 1
fi

echo -e "${BLUE}🚀 Starting FLAIM Development Environment v${VERSION}${NC}"
echo -e "${BLUE}==========================================${NC}"

if [ "$DRY_RUN" = true ]; then
  echo -e "${YELLOW}⚠️  DRY RUN MODE: No changes will be made${NC}\n"
fi

#--------------------------------------------------------------------
# 1. Interactive mode selector for all workers
#--------------------------------------------------------------------

# Default mode for all workers
GLOBAL_MODE=""

# Function to set worker mode
set_worker_mode() {
  local name=$1
  local mode=$2
  
  case $name in
    auth) AUTH_MODE=$mode ;;
    baseball) BASEBALL_MODE=$mode ;;
    football) FOOTBALL_MODE=$mode ;;
  esac
}

# Function to get worker mode
get_worker_mode() {
  local name=$1
  
  case $name in
    auth) echo "$AUTH_MODE" ;;
    baseball) echo "$BASEBALL_MODE" ;;
    football) echo "$FOOTBALL_MODE" ;;
  esac
}

# Function to select mode for all workers
select_global_mode() {
  if [ "$DRY_RUN" = true ]; then
    GLOBAL_MODE="local"
    return
  fi
  
  # Check if mode is set via environment variable
  if [ -n "$WORKER_MODE" ]; then
    case "$WORKER_MODE" in
      local|deploy-dev|deploy-prod|skip)
        GLOBAL_MODE="$WORKER_MODE"
        echo -e "${GREEN}✓${NC} All workers set to ${YELLOW}${GLOBAL_MODE}${NC} via WORKER_MODE"
        return
        ;;
      *)
        echo -e "${YELLOW}⚠️  Invalid value for WORKER_MODE: ${WORKER_MODE}. Using interactive mode.${NC}"
        ;;
    esac
  fi
  
  echo -e "${BLUE}▶  How should the workers run?${NC}"
  echo "    1) Local dev          (wrangler dev --port)"
  echo "    2) Remote dev         (wrangler deploy --env dev)"
  echo "    3) Deploy prod        (wrangler deploy --env prod)"
  echo "    0) Custom             (configure each worker individually)"
  
  while true; do
    read -rp "    Select [1-3/0, default 1]: " CHOICE
    CHOICE=${CHOICE:-1}
    
    case "$CHOICE" in
      1) 
        GLOBAL_MODE="local"
        break
        ;;
      2) 
        GLOBAL_MODE="deploy-dev"
        break
        ;;
      3) 
        if [ "$CONFIRM_PROD" = true ]; then
          read -rp "⚠️  Are you sure you want to deploy ALL workers to PRODUCTION? [y/N] " confirm
          if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
            echo "Skipping production deployment."
            continue
          fi
        fi
        GLOBAL_MODE="deploy-prod"
        break
        ;;
      0) 
        GLOBAL_MODE="custom"
        break
        ;;
      *) 
        echo -e "${RED}Invalid choice. Please try again.${NC}"
        ;;
    esac
  done
}

# Set all workers to the same mode
set_all_worker_modes() {
  local mode=$1
  set_worker_mode "auth" "$mode"
  set_worker_mode "baseball" "$mode"
  set_worker_mode "football" "$mode"
}

prompt_mode() {
  local NAME="$1"
  local DEFAULT_MODE="1"
  local CHOICE=""
  
  # Skip if in non-interactive mode
  if [ "$DRY_RUN" = true ]; then
    set_worker_mode "$NAME" "local"
    return
  fi
  
  # Skip if already set via environment variable (e.g., WORKER_AUTH_MODE=local)
  local env_var="WORKER_$(echo $NAME | tr '[:lower:]' '[:upper:]')_MODE"
  local env_value=$(eval "echo \$$env_var")
  
  if [ -n "$env_value" ]; then
    case "$env_value" in
      local|deploy-dev|deploy-prod|skip)
        set_worker_mode "$NAME" "$env_value"
        echo -e "${GREEN}✓${NC} $(tr '[:lower:]' '[:upper:]' <<< ${NAME:0:1})${NAME:1} worker mode set to ${YELLOW}${env_value}${NC} via $env_var"
        return
        ;;
      *)
        echo -e "${YELLOW}⚠️  Invalid value for $env_var: ${env_value}. Using default.${NC}"
        ;;
    esac
  fi
  
  echo ""
  echo -e "${BLUE}▶  How should the ${NAME} worker run?${NC}"
  echo "    1) Local dev          (wrangler dev --port)"
  echo "    2) Remote dev         (wrangler deploy --env dev)"
  echo "    3) Deploy prod        (wrangler deploy --env prod)"
  echo "    0) Skip"
  
  while true; do
    read -rp "    Select [1-3/0, default $DEFAULT_MODE]: " CHOICE
    CHOICE=${CHOICE:-$DEFAULT_MODE}
    
    case "$CHOICE" in
      1) 
        set_worker_mode "$NAME" "local"
        break
        ;;
      2) 
        set_worker_mode "$NAME" "deploy-dev"
        break
        ;;
      3) 
        if [ "$CONFIRM_PROD" = true ]; then
          read -rp "⚠️  Are you sure you want to deploy to PRODUCTION? [y/N] " confirm
          if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
            echo "Skipping production deployment."
            continue
          fi
        fi
        set_worker_mode "$NAME" "deploy-prod"
        break
        ;;
      0) 
        set_worker_mode "$NAME" "skip"
        break
        ;;
      *) 
        echo -e "${RED}Invalid choice. Please try again.${NC}"
        ;;
    esac
  done
}

# Set mode for all workers
select_global_mode

if [ "$GLOBAL_MODE" = "custom" ]; then
  # Custom mode: prompt for each worker individually
  echo -e "\n${BLUE}🔧 Custom configuration: Configure each worker individually${NC}"
  prompt_mode "auth"
  prompt_mode "baseball"
  prompt_mode "football"
else
  # Global mode: set all workers to the same mode
  set_all_worker_modes "$GLOBAL_MODE"
fi

# Show configuration
echo -e "\n${BLUE}📋 Configuration Summary:${NC}"
echo "   🔐 Auth Worker:     $(get_worker_mode auth)"
echo "   ⚾ Baseball Worker: $(get_worker_mode baseball)"
echo "   🏈 Football Worker: $(get_worker_mode football)"
echo ""

# Check if all workers are skipped
if [ "$(get_worker_mode auth)" = "skip" ] && [ "$(get_worker_mode baseball)" = "skip" ] && [ "$(get_worker_mode football)" = "skip" ]; then
  echo -e "${YELLOW}⚠️  All workers skipped. Exiting.${NC}"
  exit 0
fi

# Function to kill process on specific port
kill_port() {
    local port=$1
    local pids=$(lsof -ti :$port 2>/dev/null)
    if [ ! -z "$pids" ]; then
        echo "🔄 Killing existing processes on port $port..."
        echo "$pids" | xargs kill -9 2>/dev/null || true
        sleep 1
    fi
}

# Function to cleanup background processes on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down services..."
    jobs -p | xargs kill 2>/dev/null || true
    kill_port 8786
    kill_port 8787
    kill_port 8788  
    kill_port 3000
    exit 0
}

# Set up cleanup on script exit
trap cleanup SIGINT SIGTERM EXIT

# Remove old inspector port tracking file
rm -f /tmp/inspector_ports.list

# Kill any existing processes on our ports
echo "🧹 Cleaning up existing processes..."
# Only kill ports we'll actually reuse
[ "$(get_worker_mode auth)" = "local" ] && kill_port 8786
[ "$(get_worker_mode baseball)" = "local" ] && kill_port 8787
[ "$(get_worker_mode football)" = "local" ] && kill_port 8788
kill_port 3000

# Kill any existing wrangler/next processes
pkill -f "wrangler dev" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
sleep 2

echo ""

#--------------------------------------------------------------------
# 2. Launch or deploy each worker based on chosen mode
#--------------------------------------------------------------------
launch_or_deploy() {
  local NAME="$1" DIR="$2" PORT="$3"
  local CMD=""
  local LOG_FILE="/tmp/${NAME}.log"
  
  # Skip if dry run
  local MODE=$(get_worker_mode "$NAME")
  if [ "$DRY_RUN" = true ]; then
    echo -e "${YELLOW}⚠️  DRY RUN: Would run ${NAME} in ${MODE} mode${NC}"
    return 0
  fi
  
  case "$MODE" in
    local)
      if ! lsof -i ":$PORT" >/dev/null 2>&1; then
        echo -e "${BLUE}🛠  Starting $NAME worker locally (port $PORT)…${NC}"
        # Use a unique inspector port to prevent conflicts (wrangler defaults to 9229 for every instance)
      local INSPECT_PORT=$((PORT+4000))
      (cd "$DIR" && wrangler dev --env dev --port "$PORT" --inspector-port "$INSPECT_PORT" > "$LOG_FILE" 2>&1) &
      # Track inspector port so we can clean it up later
      echo "$INSPECT_PORT" >> /tmp/inspector_ports.list
        echo $! > "/tmp/${NAME}.pid"
      else
        echo -e "${YELLOW}⚠️  Port $PORT is already in use. Skipping $NAME worker.${NC}"
        return 1
      fi
      ;;
      
    deploy-dev)
      echo -e "${BLUE}🚀  Deploying $NAME worker to dev environment...${NC}"
      CMD="cd \"$DIR\" && wrangler deploy --env dev --minify"
      echo -e "${YELLOW}Running: $CMD${NC}"
      
      if (cd "$DIR" && wrangler deploy --env dev --minify); then
        echo -e "${GREEN}✅  $NAME worker deployed to dev successfully${NC}"
      else
        echo -e "${RED}❌  Failed to deploy $NAME worker to dev${NC}"
        echo -e "${YELLOW}Check the logs: $LOG_FILE${NC}"
        return 1
      fi
      ;;
      
    deploy-prod)
      if [ "$CONFIRM_PROD" = true ]; then
        read -rp "⚠️  Are you ABSOLUTELY SURE you want to deploy $NAME to PRODUCTION? [y/N] " confirm
        if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
          echo -e "${YELLOW}Skipping production deployment of $NAME.${NC}"
          return 0
        fi
      fi
      
      echo -e "${BLUE}🚀  Deploying $NAME worker to PRODUCTION environment...${NC}"
      CMD="cd \"$DIR\" && wrangler deploy --env prod --minify"
      echo -e "${YELLOW}Running: $CMD${NC}"
      
      if (cd "$DIR" && wrangler deploy --env prod --minify); then
        echo -e "${GREEN}✅  $NAME worker deployed to PRODUCTION successfully${NC}"
      else
        echo -e "${RED}❌  Failed to deploy $NAME worker to PRODUCTION${NC}"
        echo -e "${YELLOW}Check the logs: $LOG_FILE${NC}"
        return 1
      fi
      ;;
      
    skip)
      echo -e "${YELLOW}⏭️  Skipping $NAME worker${NC}"
      ;;
  esac
  
  return 0
}

launch_or_deploy "auth"     "workers/auth-worker"          8786
launch_or_deploy "baseball" "workers/baseball-espn-mcp"   8787
launch_or_deploy "football" "workers/football-espn-mcp"   8788

#--------------------------------------------------------------------
# 3. Clean up environment and export env-vars for remote/deploy cases
#--------------------------------------------------------------------
echo ""
echo "🔧 Setting up environment variables..."
export_env_if_remote () {
  local NAME="$1" LABEL="$2" ENV_VAR="$3"
  local URL=""
  local mode=$(get_worker_mode "$NAME")
  if [ -n "$mode" ]; then
    case "$mode" in
      local)
        # Clean up any existing environment variables for local mode
        unset "$ENV_VAR" 2>/dev/null || true
        echo "🧹 Cleaned up $ENV_VAR (using local worker)"
        return
        ;;
      deploy-dev)
        URL="https://${LABEL}-dev.gerrygugger.workers.dev"
        ;;
      deploy-prod)
        URL="https://${LABEL}.gerrygugger.workers.dev"
        ;;
      *)
        return
        ;;
    esac
    
    eval "export $ENV_VAR=\"$URL\""
    echo "🔗 $NAME worker URL: $URL"
  fi
}

export_env_if_remote "auth"     "auth-worker"          NEXT_PUBLIC_AUTH_WORKER_URL
export_env_if_remote "baseball" "baseball-espn-mcp"    NEXT_PUBLIC_BASEBALL_ESPN_MCP_URL
export_env_if_remote "football" "football-espn-mcp"    NEXT_PUBLIC_FOOTBALL_ESPN_MCP_URL

echo "✅ Environment configuration complete"

echo "🖥️  Starting Next.js Frontend (port 3000)..."
(cd openai && npm run dev > /tmp/frontend.log 2>&1) &
FRONTEND_PID=$!

# Store PID for cleanup
echo $FRONTEND_PID > /tmp/frontend.pid

echo ""
echo "⏳ Waiting for services to start..."

# Function to check if a service is ready
check_service() {
    local url=$1
    local name=$2
    local max_attempts=30
    local attempt=0
    
    while [ $attempt -lt $max_attempts ]; do
        if curl -s -f "$url" > /dev/null 2>&1; then
            echo "✅ $name is ready!"
            return 0
        fi
        sleep 1
        attempt=$((attempt + 1))
        echo -n "."
    done
    echo "❌ $name failed to start after 30 seconds"
    return 1
}

# Track service status
SERVICES_STARTED=true

# Wait for all services to be ready
if [ "$DRY_RUN" = false ]; then
  echo -e "\n${BLUE}⏳ Waiting for services to start...${NC}"
  
  if [ "$(get_worker_mode auth)" = "local" ]; then
    echo -n "🔄 Auth Worker "
    if ! check_service "http://localhost:8786/health" "Auth Worker"; then
      SERVICES_STARTED=false
      echo -e "${RED}❌ Auth Worker failed to start${NC}" >&2
    fi
  fi

  if [ "$(get_worker_mode baseball)" = "local" ]; then
    echo -n "🔄 Baseball Worker "
    if ! check_service "http://localhost:8787/health" "Baseball Worker"; then
      SERVICES_STARTED=false
      echo -e "${RED}❌ Baseball Worker failed to start${NC}" >&2
    fi
  fi

  if [ "$(get_worker_mode football)" = "local" ]; then
    echo -n "🔄 Football Worker "  
    if ! check_service "http://localhost:8788/health" "Football Worker"; then
      SERVICES_STARTED=false
      echo -e "${RED}❌ Football Worker failed to start${NC}" >&2
    fi
  fi

  echo -n "🔄 Frontend "
  if ! check_service "http://localhost:3000" "Frontend"; then
    SERVICES_STARTED=false
    echo -e "${RED}❌ Frontend failed to start${NC}" >&2
  fi
  
  if [ "$SERVICES_STARTED" = true ]; then
    echo -e "\n${GREEN}✅ All services started successfully!${NC}"
  else
    echo -e "\n${YELLOW}⚠️  Some services failed to start. Check the logs above for details.${NC}" >&2
    exit 1
  fi
else
  echo -e "\n${YELLOW}⚠️  DRY RUN: Skipping service health checks${NC}"
fi

# Function to get worker URL based on mode
get_worker_url() {
  local NAME="$1" PORT="$2" LABEL="$3"
  local mode=$(get_worker_mode "$NAME")
  case "$mode" in
    local)
      echo "http://localhost:$PORT"
      ;;
    deploy-dev)
      echo "https://${LABEL}-dev.gerrygugger.workers.dev"
      ;;
    deploy-prod)
      echo "https://${LABEL}.gerrygugger.workers.dev"
      ;;
    skip)
      echo "disabled"
      ;;
  esac
}

# Display service information
echo -e "\n${BLUE}🌐 Service Information${NC}"
echo -e "${BLUE}====================${NC}"

# Frontend info
echo -e "${GREEN}Frontend:${NC}"
echo -e "  URL:     http://localhost:3000"
echo -e "  Logs:    tail -f /tmp/frontend.log"
echo ""

# Worker info
print_worker_info() {
  local name=$1
  local port=$2
  local label=$3
  
  local mode=$(get_worker_mode "$name")
  if [ "$mode" != "skip" ]; then
    local url=$(get_worker_url "$name" "$port" "$label")
    
    # Color code the mode
    case "$mode" in
      "local") mode_color="${BLUE}local${NC}" ;;
      "deploy-dev") mode_color="${YELLOW}dev${NC}" ;;
      "deploy-prod") mode_color="${RED}PRODUCTION${NC}" ;;
      *) mode_color="$mode" ;;
    esac
    
    # Format name with first letter capitalized
    local display_name=$(echo "$name" | sed 's/^./\u&/')
    
    # Display worker info
    echo -e "${GREEN}${display_name} Worker:${NC} (${mode_color})"
    echo -e "  URL:     $url"
    echo -e "  Logs:    tail -f /tmp/${name}.log"
    
    # Show health check URL if running locally
    if [ "$mode" = "local" ]; then
      echo -e "  Health:  http://localhost:${port}/health"
    fi
    
    echo ""
  fi
}

print_worker_info "auth" "8786" "auth-worker"
print_worker_info "baseball" "8787" "baseball-espn-mcp"
print_worker_info "football" "8788" "football-espn-mcp"

# Display help information
echo -e "${BLUE}📋 Quick Commands${NC}"
echo -e "${BLUE}================${NC}"
echo -e "${YELLOW}Stop all services:${NC}  Press Ctrl+C"
echo -e "${YELLOW}View logs:${NC}          tail -f /tmp/{auth,baseball,football,frontend}.log"
echo -e "${YELLOW}Dry run:${NC}            $0 --dry-run"
echo -e "${YELLOW}Help:${NC}               $0 --help"
echo ""

echo -e "${GREEN}✅ Setup complete!${NC}"

if [ "$DRY_RUN" = false ]; then
  echo -e "\n${BLUE}🚀 Services are running in the foreground...${NC}"
  echo -e "${YELLOW}Press Ctrl+C to stop all services and exit${NC}"
  
  # Wait for any process to exit
  wait
  
  echo -e "\n${GREEN}✅ All services have been stopped.${NC}"
else
  echo -e "\n${YELLOW}⚠️  DRY RUN: No changes were made.${NC}"
fi

# Wait for any process to exit
wait
