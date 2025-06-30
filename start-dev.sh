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
kill_port 8786
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
echo "🔐 Starting Auth Worker (port 8786)..."
(cd workers/auth-worker && NODE_OPTIONS="--inspect=9229" wrangler dev --env dev --port 8786 > /tmp/auth.log 2>&1) &
AUTH_PID=$!

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
echo $AUTH_PID > /tmp/auth.pid
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
echo -n "🔄 Auth Worker "
check_service "http://localhost:8786/health" "Auth Worker"

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
echo "🔐 Auth Worker:     http://localhost:8786"
echo "⚾ Baseball Worker: http://localhost:8787"  
echo "🏈 Football Worker: http://localhost:8788"
echo ""
echo "📊 Health Checks:"
echo "   curl http://localhost:8786/health"
echo "   curl http://localhost:8787/health"
echo "   curl http://localhost:8788/health"
echo ""
echo "📝 Logs:"
echo "   tail -f /tmp/auth.log"
echo "   tail -f /tmp/baseball.log"
echo "   tail -f /tmp/football.log"
echo "   tail -f /tmp/frontend.log"
echo ""

echo ""
echo "🎉 All services started successfully!"
echo ""
echo "✅ Summary:"
echo "   🔐 Auth Worker:     http://localhost:8786 (healthy)"
echo "   ⚾ Baseball Worker: http://localhost:8787 (healthy)"
echo "   🏈 Football Worker: http://localhost:8788 (healthy)"
echo "   🌐 Frontend:        http://localhost:3000 (ready)"
echo ""
echo "📡 Services are running in foreground mode"
echo "🛑 Press Ctrl+C to stop all services and exit"
echo ""

# Wait for any process to exit
wait
