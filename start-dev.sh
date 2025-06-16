#!/bin/bash

# FLAIM Development Startup Script
# Starts all services for local development

echo "🚀 Starting FLAIM Development Environment"
echo "======================================="

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
    kill_port 8787
    kill_port 8788  
    kill_port 3000
    exit 0
}

# Set up cleanup on script exit
trap cleanup SIGINT SIGTERM EXIT

# Kill any existing processes on our ports
echo "🧹 Cleaning up existing processes..."
kill_port 8787
kill_port 8788
kill_port 3000

# Kill any existing wrangler/next processes
pkill -f "wrangler dev" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
sleep 2

echo ""
echo "🚀 Starting all services in parallel..."

# Start all services in background simultaneously
echo "📊 Starting Baseball ESPN MCP Worker (port 8787)..."
(cd workers/baseball-espn-mcp && NODE_OPTIONS="--inspect=9230" wrangler dev --env dev --port 8787 > /tmp/baseball.log 2>&1) &
BASEBALL_PID=$!

echo "🏈 Starting Football ESPN MCP Worker (port 8788)..."
(cd workers/football-espn-mcp && NODE_OPTIONS="--inspect=9231" wrangler dev --env dev --port 8788 > /tmp/football.log 2>&1) &
FOOTBALL_PID=$!

echo "🖥️  Starting Next.js Frontend (port 3000)..."
(cd openai && npm run dev > /tmp/frontend.log 2>&1) &
FRONTEND_PID=$!

# Store PIDs for cleanup
echo $BASEBALL_PID > /tmp/baseball.pid
echo $FOOTBALL_PID > /tmp/football.pid  
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
echo -n "🔄 Baseball Worker "
check_service "http://localhost:8787/health" "Baseball Worker"

echo -n "🔄 Football Worker "  
check_service "http://localhost:8788/health" "Football Worker"

echo -n "🔄 Frontend "
check_service "http://localhost:3000" "Frontend"

echo ""
echo "🎉 All services are running!"
echo ""
echo "🌐 Frontend:        http://localhost:3000"
echo "⚾ Baseball Worker: http://localhost:8787"  
echo "🏈 Football Worker: http://localhost:8788"
echo ""
echo "📊 Health Checks:"
echo "   curl http://localhost:8787/health"
echo "   curl http://localhost:8788/health"
echo ""
echo "📝 Logs:"
echo "   tail -f /tmp/baseball.log"
echo "   tail -f /tmp/football.log"
echo "   tail -f /tmp/frontend.log"
echo ""

# Check if we should run in detached mode
if [[ "${START_DETACHED:-}" == "true" ]] || [[ ! -t 0 && ! -t 1 ]]; then
    # Detached mode - start services and exit (services continue in background)
    echo "✅ Services started successfully and running in background!"
    echo "🔧 To stop services later: pkill -f 'wrangler dev'; pkill -f 'next dev'"
    echo "📊 Check status: curl http://localhost:3000"
    
    # Detach from cleanup trap since we want services to continue
    trap - SIGINT SIGTERM EXIT
    exit 0
fi

# Interactive mode - give user choice
echo "Choose an option:"
echo "  [1] Keep services running (press Ctrl+C to stop)"
echo "  [2] Start services and exit script (services continue in background)"
echo ""
read -p "Enter choice [1-2]: " choice

case $choice in
    2)
        echo ""
        echo "✅ Services started successfully and running in background!"
        echo "🔧 To stop services later: pkill -f 'wrangler dev'; pkill -f 'next dev'"
        echo "📊 Check status: curl http://localhost:3000"
        
        # Detach from cleanup trap since we want services to continue
        trap - SIGINT SIGTERM EXIT
        exit 0
        ;;
    *)
        echo ""
        echo "📡 Keeping services running... Press Ctrl+C to stop all services"
        ;;
esac

# Wait for any process to exit
wait
