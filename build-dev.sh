#!/bin/bash

# FLAIM Development Build Script
# Builds all components in parallel for development

echo "🔨 FLAIM Development Build"
echo "========================="

# Function to cleanup background processes on exit
cleanup() {
    echo ""
    echo "🛑 Stopping build processes..."
    jobs -p | xargs kill 2>/dev/null || true
    exit 0
}

# Set up cleanup on script exit
trap cleanup SIGINT SIGTERM EXIT

echo "🚀 Starting builds in parallel..."

# Start all builds in background simultaneously
echo "📦 Building Auth Module..."
(cd auth && npm install --silent && npm run build > /tmp/auth-build.log 2>&1) &
AUTH_PID=$!

echo "⚾ Type-checking Baseball ESPN MCP Worker..."
(cd workers/baseball-espn-mcp && npm install --silent && npm run type-check > /tmp/baseball-build.log 2>&1) &
BASEBALL_PID=$!

echo "🏈 Type-checking Football ESPN MCP Worker..."
(cd workers/football-espn-mcp && npm install --silent && npm run type-check > /tmp/football-build.log 2>&1) &
FOOTBALL_PID=$!

echo "🧪 Building Test Suite..."
(cd tests && npm install --silent && npm run type-check > /tmp/tests-build.log 2>&1) &
TESTS_PID=$!

echo "🖥️  Preparing Frontend..."
(cd openai && npm install --silent > /tmp/frontend-build.log 2>&1) &
FRONTEND_PID=$!

# Store PIDs for tracking
echo $AUTH_PID > /tmp/auth-build.pid
echo $BASEBALL_PID > /tmp/baseball-build.pid
echo $FOOTBALL_PID > /tmp/football-build.pid
echo $TESTS_PID > /tmp/tests-build.pid
echo $FRONTEND_PID > /tmp/frontend-build.pid

echo ""
echo "⏳ Waiting for builds to complete..."

# Function to check build status
check_build() {
    local pid=$1
    local name=$2
    local logfile=$3
    
    if wait $pid; then
        echo "✅ $name built successfully!"
        return 0
    else
        echo "❌ $name build failed!"
        echo "📝 Last 5 lines from build log:"
        tail -5 "$logfile" | sed 's/^/   /'
        return 1
    fi
}

# Track build results
BUILD_RESULTS=()
AUTH_SUCCESS=false
BASEBALL_SUCCESS=false
FOOTBALL_SUCCESS=false
TESTS_SUCCESS=false
FRONTEND_SUCCESS=false

# Wait for each build and collect results
echo -n "🔄 Auth Module "
if check_build $AUTH_PID "Auth Module" "/tmp/auth-build.log"; then
    AUTH_SUCCESS=true
fi

echo -n "🔄 Baseball Worker "
if check_build $BASEBALL_PID "Baseball Worker" "/tmp/baseball-build.log"; then
    BASEBALL_SUCCESS=true
fi

echo -n "🔄 Football Worker "
if check_build $FOOTBALL_PID "Football Worker" "/tmp/football-build.log"; then
    FOOTBALL_SUCCESS=true
fi

echo -n "🔄 Test Suite "
if check_build $TESTS_PID "Test Suite" "/tmp/tests-build.log"; then
    TESTS_SUCCESS=true
fi

echo -n "🔄 Frontend Dependencies "
if check_build $FRONTEND_PID "Frontend Dependencies" "/tmp/frontend-build.log"; then
    FRONTEND_SUCCESS=true
fi

echo ""
echo "📊 Build Summary:"
echo "=================="

# Display results
if [ "$AUTH_SUCCESS" = true ]; then
    echo "✅ Auth Module: Ready"
else
    echo "❌ Auth Module: Failed"
fi

if [ "$BASEBALL_SUCCESS" = true ]; then
    echo "✅ Baseball Worker: Ready"
else
    echo "❌ Baseball Worker: Failed"
fi

if [ "$FOOTBALL_SUCCESS" = true ]; then
    echo "✅ Football Worker: Ready"
else
    echo "❌ Football Worker: Failed"
fi

if [ "$TESTS_SUCCESS" = true ]; then
    echo "✅ Test Suite: Ready"
else
    echo "❌ Test Suite: Failed"
fi

if [ "$FRONTEND_SUCCESS" = true ]; then
    echo "✅ Frontend Dependencies: Ready"
else
    echo "❌ Frontend Dependencies: Failed"
fi

echo ""

# Check overall success
if [ "$AUTH_SUCCESS" = true ] && [ "$BASEBALL_SUCCESS" = true ] && [ "$FOOTBALL_SUCCESS" = true ] && [ "$TESTS_SUCCESS" = true ] && [ "$FRONTEND_SUCCESS" = true ]; then
    echo "🎉 All builds completed successfully!"
    echo ""
    echo "🚀 To start development environment:"
    echo "   ./start-dev.sh"
    echo ""
    echo "📝 Build logs available at:"
    echo "   /tmp/auth-build.log"
    echo "   /tmp/baseball-build.log"
    echo "   /tmp/football-build.log"
    echo "   /tmp/tests-build.log"
    echo "   /tmp/frontend-build.log"
    
    # Cleanup build artifacts
    rm -f /tmp/*-build.pid
    
    exit 0
else
    echo "❌ Some builds failed. Check the logs above for details."
    echo ""
    echo "📝 Full build logs:"
    echo "   tail /tmp/auth-build.log"
    echo "   tail /tmp/baseball-build.log"
    echo "   tail /tmp/football-build.log"
    echo "   tail /tmp/tests-build.log"
    echo "   tail /tmp/frontend-build.log"
    
    # Cleanup build artifacts
    rm -f /tmp/*-build.pid
    
    exit 1
fi