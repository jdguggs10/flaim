#!/bin/bash

# Test Local Deployment Script
# Starts all services locally and runs deployment tests

set -e

echo "🚀 FLAIM Local Deployment Test Suite"
echo "===================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if required environment variables are set
check_env_vars() {
    echo "📋 Checking environment variables..."
    
    required_vars=(
        "TEST_ENCRYPTION_KEY"
        "TEST_CLERK_SECRET_KEY"
        "TEST_CLERK_PUBLISHABLE_KEY"
    )
    
    missing_vars=()
    
    for var in "${required_vars[@]}"; do
        if [ -z "${!var}" ]; then
            missing_vars+=("$var")
        fi
    done
    
    if [ ${#missing_vars[@]} -ne 0 ]; then
        echo -e "${RED}❌ Missing required environment variables:${NC}"
        printf '%s\n' "${missing_vars[@]}"
        echo "Please set these variables in tests/config/.env.test"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Environment variables check passed${NC}"
}

# Start baseball worker locally
start_baseball_worker() {
    echo "⚾ Starting Baseball ESPN MCP Worker..."
    
    cd "$(dirname "$0")/../../workers/baseball-espn-mcp"
    
    # Kill any existing process on port 8787
    lsof -ti:8787 | xargs kill -9 2>/dev/null || true
    
    # Start worker in background
    ENCRYPTION_KEY="$TEST_ENCRYPTION_KEY" \
    CLERK_SECRET_KEY="$TEST_CLERK_SECRET_KEY" \
    NODE_ENV="development" \
    wrangler dev --local --port 8787 > /tmp/baseball-worker.log 2>&1 &
    
    BASEBALL_PID=$!
    echo "Baseball worker started with PID: $BASEBALL_PID"
    
    # Wait for worker to be ready
    echo "Waiting for baseball worker to start..."
    for i in {1..30}; do
        if curl -s http://localhost:8787/health > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Baseball worker is ready${NC}"
            break
        fi
        sleep 2
        if [ $i -eq 30 ]; then
            echo -e "${RED}❌ Baseball worker failed to start${NC}"
            cat /tmp/baseball-worker.log
            exit 1
        fi
    done
}

# Start football worker locally
start_football_worker() {
    echo "🏈 Starting Football ESPN MCP Worker..."
    
    cd "$(dirname "$0")/../../workers/football-espn-mcp"
    
    # Kill any existing process on port 8788
    lsof -ti:8788 | xargs kill -9 2>/dev/null || true
    
    # Start worker in background
    ENCRYPTION_KEY="$TEST_ENCRYPTION_KEY" \
    CLERK_SECRET_KEY="$TEST_CLERK_SECRET_KEY" \
    NODE_ENV="development" \
    wrangler dev --local --port 8788 > /tmp/football-worker.log 2>&1 &
    
    FOOTBALL_PID=$!
    echo "Football worker started with PID: $FOOTBALL_PID"
    
    # Wait for worker to be ready
    echo "Waiting for football worker to start..."
    for i in {1..30}; do
        if curl -s http://localhost:8788/health > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Football worker is ready${NC}"
            break
        fi
        sleep 2
        if [ $i -eq 30 ]; then
            echo -e "${RED}❌ Football worker failed to start${NC}"
            cat /tmp/football-worker.log
            exit 1
        fi
    done
}

# Start frontend locally
start_frontend() {
    echo "🌐 Starting Next.js Frontend..."
    
    cd "$(dirname "$0")/../../openai"
    
    # Kill any existing process on port 3000
    lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    
    # Install dependencies if needed
    if [ ! -d "node_modules" ]; then
        echo "Installing frontend dependencies..."
        npm install
    fi
    
    # Start frontend in background
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY="$TEST_CLERK_PUBLISHABLE_KEY" \
    CLERK_SECRET_KEY="$TEST_CLERK_SECRET_KEY" \
    npm run dev > /tmp/frontend.log 2>&1 &
    
    FRONTEND_PID=$!
    echo "Frontend started with PID: $FRONTEND_PID"
    
    # Wait for frontend to be ready
    echo "Waiting for frontend to start..."
    for i in {1..60}; do
        if curl -s http://localhost:3000 > /dev/null 2>&1; then
            echo -e "${GREEN}✅ Frontend is ready${NC}"
            break
        fi
        sleep 3
        if [ $i -eq 60 ]; then
            echo -e "${RED}❌ Frontend failed to start${NC}"
            cat /tmp/frontend.log
            exit 1
        fi
    done
}

# Run deployment tests
run_tests() {
    echo "🧪 Running local deployment tests..."
    
    cd "$(dirname "$0")/.."
    
    # Install test dependencies if needed
    if [ ! -d "node_modules" ]; then
        echo "Installing test dependencies..."
        npm install
    fi
    
    # Run deployment tests
    npm run test:deployment 2>&1 | tee /tmp/test-results.log
    
    TEST_EXIT_CODE=${PIPESTATUS[0]}
    
    if [ $TEST_EXIT_CODE -eq 0 ]; then
        echo -e "${GREEN}✅ All deployment tests passed!${NC}"
    else
        echo -e "${RED}❌ Some deployment tests failed${NC}"
        return $TEST_EXIT_CODE
    fi
}

# Cleanup function
cleanup() {
    echo "🧹 Cleaning up services..."
    
    if [ ! -z "$BASEBALL_PID" ]; then
        kill $BASEBALL_PID 2>/dev/null || true
        echo "Stopped baseball worker"
    fi
    
    if [ ! -z "$FOOTBALL_PID" ]; then
        kill $FOOTBALL_PID 2>/dev/null || true
        echo "Stopped football worker"
    fi
    
    if [ ! -z "$FRONTEND_PID" ]; then
        kill $FRONTEND_PID 2>/dev/null || true
        echo "Stopped frontend"
    fi
    
    # Kill any remaining processes on our ports
    lsof -ti:8787 | xargs kill -9 2>/dev/null || true
    lsof -ti:8788 | xargs kill -9 2>/dev/null || true
    lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    
    echo "Cleanup complete"
}

# Set trap to cleanup on exit
trap cleanup EXIT

# Main execution
main() {
    check_env_vars
    start_baseball_worker
    start_football_worker
    start_frontend
    
    echo ""
    echo "🎉 All services are running locally!"
    echo "   Baseball Worker: http://localhost:8787"
    echo "   Football Worker: http://localhost:8788"
    echo "   Frontend:        http://localhost:3000"
    echo ""
    
    run_tests
    
    echo ""
    echo "📊 Test Summary:"
    echo "   Logs available in /tmp/:"
    echo "   - baseball-worker.log"
    echo "   - football-worker.log"
    echo "   - frontend.log"
    echo "   - test-results.log"
}

# Run main function
main "$@"