#!/bin/bash

# FLAIM Development Startup Script
# Starts all services for local development

echo "🚀 Starting FLAIM Development Environment"
echo "======================================="

# Check if wrangler is available
if ! command -v wrangler >/dev/null 2>&1; then
  echo "❌ Error: wrangler command not found. Please install Wrangler CLI:"
  echo "   npm install -g wrangler"
  exit 1
fi

#--------------------------------------------------------------------
# 1. Interactive mode selector per worker
#--------------------------------------------------------------------
declare -A WORKER_MODES   # auth=local|remote|deploy-prev|deploy-prod|skip

prompt_mode () {
  local NAME="$1"
  local CHOICE=""
  echo ""
  echo "▶  How should the ${NAME} worker run?"
  echo "    1) Local dev          (wrangler dev --port)"
  echo "    2) Remote preview     (wrangler dev --remote)"
  echo "    3) Deploy  preview    (wrangler deploy --env preview)"
  echo "    4) Deploy  prod       (wrangler deploy --env prod)"
  echo "    0) Skip"
  read -rp "    Select [1-4/0, default 1]: " CHOICE
  CHOICE=${CHOICE:-1}
  case "$CHOICE" in
    1) WORKER_MODES[$NAME]="local"        ;;
    2) WORKER_MODES[$NAME]="remote-dev"   ;;
    3) WORKER_MODES[$NAME]="deploy-prev"  ;;
    4) WORKER_MODES[$NAME]="deploy-prod"  ;;
    0) WORKER_MODES[$NAME]="skip"         ;;
    *) echo "Invalid choice, defaulting to local"; WORKER_MODES[$NAME]="local" ;;
  esac
}

prompt_mode "auth"
prompt_mode "baseball"
prompt_mode "football"

echo ""
echo "📋 Configuration Summary:"
echo "   🔐 Auth Worker:     ${WORKER_MODES[auth]}"
echo "   ⚾ Baseball Worker: ${WORKER_MODES[baseball]}"
echo "   🏈 Football Worker: ${WORKER_MODES[football]}"
echo ""
read -rp "Continue with this configuration? [Y/n]: " CONFIRM
CONFIRM=${CONFIRM:-Y}
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
  echo "❌ Aborted by user"
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

# Kill any existing processes on our ports
echo "🧹 Cleaning up existing processes..."
# Only kill ports we'll actually reuse
[ "${WORKER_MODES[auth]}"     = "local" ] && kill_port 8786
[ "${WORKER_MODES[baseball]}" = "local" ] && kill_port 8787
[ "${WORKER_MODES[football]}" = "local" ] && kill_port 8788
kill_port 3000

# Kill any existing wrangler/next processes
pkill -f "wrangler dev" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
sleep 2

echo ""

#--------------------------------------------------------------------
# 2. Launch or deploy each worker based on chosen mode
#--------------------------------------------------------------------
launch_or_deploy () {
  local NAME="$1"  DIR="$2" PORT="$3"
  case "${WORKER_MODES[$NAME]}" in
    local)
      echo "🛠  Starting $NAME worker locally (port $PORT)…"
      (cd "$DIR" && wrangler dev --env dev --port "$PORT" > "/tmp/${NAME}.log" 2>&1) &
      ;;
    remote-dev)
      echo "🌐  Starting $NAME worker in remote preview (wrangler dev --remote)…"
      (cd "$DIR" && wrangler dev --remote --env dev > "/tmp/${NAME}.log" 2>&1) &
      ;;
    deploy-prev)
      if [ -z "$CF_ACCOUNT_ID" ]; then
        echo "❌  Error: CF_ACCOUNT_ID environment variable is required for deployment"
        echo "    Please set it with: export CF_ACCOUNT_ID=your-account-id"
        echo "    Or run: wrangler whoami to see your account ID"
        exit 1
      fi
      echo "🚀  Deploying $NAME worker to preview environment..."
      if (cd "$DIR" && wrangler deploy --env preview --minify); then
        echo "✅  $NAME worker deployed to preview successfully"
      else
        echo "❌  Failed to deploy $NAME worker to preview"
        exit 1
      fi
      ;;
    deploy-prod)
      if [ -z "$CF_ACCOUNT_ID" ]; then
        echo "❌  Error: CF_ACCOUNT_ID environment variable is required for deployment"
        echo "    Please set it with: export CF_ACCOUNT_ID=your-account-id"
        echo "    Or run: wrangler whoami to see your account ID"
        exit 1
      fi
      echo "🚀  Deploying $NAME worker to production environment..."
      if (cd "$DIR" && wrangler deploy --env prod --minify); then
        echo "✅  $NAME worker deployed to production successfully"
      else
        echo "❌  Failed to deploy $NAME worker to production"
        exit 1
      fi
      ;;
    skip)
      echo "⏭️  Skipping $NAME worker"
      ;;
  esac
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
  
  case "${WORKER_MODES[$NAME]}" in
    local)
      # Clean up any existing environment variables for local mode
      unset "$ENV_VAR" 2>/dev/null || true
      echo "🧹 Cleaned up $ENV_VAR (using local worker)"
      return
      ;;
    remote-dev)
      # Extended retry for remote URL capture (up to 60 seconds)
      echo "⏳ Waiting for remote URL for $NAME worker..."
      local attempts=0
      while [ $attempts -lt 30 ]; do
        URL="$(grep -oE 'https://[^ ]+\.workers\.dev' /tmp/${NAME}.log 2>/dev/null | head -n1)"
        if [ -n "$URL" ]; then
          echo ""
          break
        fi
        sleep 2
        attempts=$((attempts + 1))
        [ $((attempts % 5)) -eq 0 ] && echo -n " ${attempts}s" || echo -n "."
      done
      
      # Fallback: manual URL entry if auto-capture fails
      if [ -z "$URL" ]; then
        echo ""
        echo "⚠️  Could not auto-capture remote URL for $NAME worker after 60s"
        echo "📋 Please check the log file and enter the URL manually:"
        echo "   tail -f /tmp/${NAME}.log"
        echo ""
        read -rp "Enter the remote URL (or press Enter to skip): " URL
        [ -z "$URL" ] && echo "⏭️  Skipping URL export for $NAME worker" && return
      fi
      ;;
    deploy-prev)
      URL="https://${LABEL}-preview.${CF_ACCOUNT_ID}.workers.dev"
      ;;
    deploy-prod)
      URL="https://${LABEL}.${CF_ACCOUNT_ID}.workers.dev"
      ;;
    *)
      return
      ;;
  esac
  
  eval "export $ENV_VAR=\"$URL\""
  echo "🔗 $NAME worker URL: $URL"
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

# Wait for all services to be ready
if [ "${WORKER_MODES[auth]}" = "local" ]; then
  echo -n "🔄 Auth Worker "
  check_service "http://localhost:8786/health" "Auth Worker"
fi

if [ "${WORKER_MODES[baseball]}" = "local" ]; then
  echo -n "🔄 Baseball Worker "
  check_service "http://localhost:8787/health" "Baseball Worker"
fi

if [ "${WORKER_MODES[football]}" = "local" ]; then
  echo -n "🔄 Football Worker "  
  check_service "http://localhost:8788/health" "Football Worker"
fi

echo -n "🔄 Frontend "
check_service "http://localhost:3000" "Frontend"

# Function to get worker URL based on mode
get_worker_url() {
  local NAME="$1" PORT="$2" LABEL="$3"
  case "${WORKER_MODES[$NAME]}" in
    local)
      echo "http://localhost:$PORT"
      ;;
    remote-dev)
      local URL="$(grep -oE 'https://[^ ]+\.workers\.dev' /tmp/${NAME}.log 2>/dev/null | head -n1)"
      echo "${URL:-remote-preview}"
      ;;
    deploy-prev)
      if [ -n "$CF_ACCOUNT_ID" ]; then
        echo "https://${LABEL}-preview.${CF_ACCOUNT_ID}.workers.dev"
      else
        echo "https://${LABEL}-preview.YOUR-ACCOUNT.workers.dev"
      fi
      ;;
    deploy-prod)
      if [ -n "$CF_ACCOUNT_ID" ]; then
        echo "https://${LABEL}.${CF_ACCOUNT_ID}.workers.dev"
      else
        echo "https://${LABEL}.YOUR-ACCOUNT.workers.dev"
      fi
      ;;
    skip)
      echo "disabled"
      ;;
  esac
}

echo ""
echo "🎉 Services configured successfully!"
echo ""
echo "🌐 Frontend:        http://localhost:3000"

# Show worker URLs based on their modes
AUTH_URL="$(get_worker_url "auth" "8786" "auth-worker")"
BASEBALL_URL="$(get_worker_url "baseball" "8787" "baseball-espn-mcp")"  
FOOTBALL_URL="$(get_worker_url "football" "8788" "football-espn-mcp")"

[ "${WORKER_MODES[auth]}" != "skip" ] && echo "🔐 Auth Worker:     $AUTH_URL (${WORKER_MODES[auth]})"
[ "${WORKER_MODES[baseball]}" != "skip" ] && echo "⚾ Baseball Worker: $BASEBALL_URL (${WORKER_MODES[baseball]})"
[ "${WORKER_MODES[football]}" != "skip" ] && echo "🏈 Football Worker: $FOOTBALL_URL (${WORKER_MODES[football]})"

echo ""
echo "📊 Health Checks:"
[ "${WORKER_MODES[auth]}" = "local" ] && echo "   curl http://localhost:8786/health"
[ "${WORKER_MODES[baseball]}" = "local" ] && echo "   curl http://localhost:8787/health"
[ "${WORKER_MODES[football]}" = "local" ] && echo "   curl http://localhost:8788/health"

echo ""
echo "📝 Logs:"
[ "${WORKER_MODES[auth]}" != "skip" ] && echo "   tail -f /tmp/auth.log"
[ "${WORKER_MODES[baseball]}" != "skip" ] && echo "   tail -f /tmp/baseball.log"
[ "${WORKER_MODES[football]}" != "skip" ] && echo "   tail -f /tmp/football.log"
echo "   tail -f /tmp/frontend.log"
echo ""

echo ""
echo "🎉 All services started successfully!"
echo ""
echo "✅ Summary:"
[ "${WORKER_MODES[auth]}" != "skip" ] && echo "   🔐 Auth Worker:     $AUTH_URL (${WORKER_MODES[auth]})"
[ "${WORKER_MODES[baseball]}" != "skip" ] && echo "   ⚾ Baseball Worker: $BASEBALL_URL (${WORKER_MODES[baseball]})"
[ "${WORKER_MODES[football]}" != "skip" ] && echo "   🏈 Football Worker: $FOOTBALL_URL (${WORKER_MODES[football]})"
echo "   🌐 Frontend:        http://localhost:3000 (ready)"
echo ""
echo "📡 Services are running in foreground mode"
echo "🛑 Press Ctrl+C to stop all services and exit"
echo ""

# Wait for any process to exit
wait
