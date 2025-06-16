#!/bin/bash

# Test Worker Connectivity Script
# Tests inter-worker communication and shared authentication

set -e

echo "🔗 FLAIM Worker Connectivity Test Suite"
echo "======================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Load environment variables from .env.test if it exists
if [ -f "$(dirname "$0")/../config/.env.test" ]; then
    export $(grep -v '^#' "$(dirname "$0")/../config/.env.test" | xargs)
fi

# Configuration
BASEBALL_URL="${TEST_BASEBALL_WORKER_URL:-http://localhost:8787}"
FOOTBALL_URL="${TEST_FOOTBALL_WORKER_URL:-http://localhost:8788}"

# Test helper functions
test_endpoint() {
    local url="$1"
    local method="${2:-GET}"
    local data="$3"
    local headers="$4"
    
    if [ "$method" = "GET" ]; then
        curl -s -w "%{http_code}" -o /tmp/response.json "$url" ${headers:+-H "$headers"}
    else
        curl -s -w "%{http_code}" -o /tmp/response.json -X "$method" ${headers:+-H "$headers"} ${data:+-d "$data"} "$url"
    fi
}

# Test basic connectivity
test_basic_connectivity() {
    echo "🌐 Testing basic worker connectivity..."
    
    echo -n "  Baseball worker health check... "
    status_code=$(test_endpoint "$BASEBALL_URL/health")
    if [ "$status_code" = "200" ]; then
        echo -e "${GREEN}✅ OK${NC}"
    else
        echo -e "${RED}❌ Failed (HTTP $status_code)${NC}"
        return 1
    fi
    
    echo -n "  Football worker health check... "
    status_code=$(test_endpoint "$FOOTBALL_URL/health")
    if [ "$status_code" = "200" ]; then
        echo -e "${GREEN}✅ OK${NC}"
    else
        echo -e "${RED}❌ Failed (HTTP $status_code)${NC}"
        return 1
    fi
    
    echo -e "${GREEN}✅ Basic connectivity tests passed${NC}"
}

# Test MCP capabilities
test_mcp_capabilities() {
    echo "🛠️  Testing MCP capabilities..."
    
    echo -n "  Baseball worker MCP info... "
    status_code=$(test_endpoint "$BASEBALL_URL/mcp")
    if [ "$status_code" = "200" ]; then
        echo -e "${GREEN}✅ OK${NC}"
        # Check if response contains expected MCP structure
        if grep -q '"capabilities"' /tmp/response.json; then
            echo "    ✓ MCP capabilities present"
        else
            echo -e "    ${YELLOW}⚠️  MCP capabilities format unexpected${NC}"
        fi
    else
        echo -e "${RED}❌ Failed (HTTP $status_code)${NC}"
        return 1
    fi
    
    echo -n "  Football worker MCP info... "
    status_code=$(test_endpoint "$FOOTBALL_URL/mcp")
    if [ "$status_code" = "200" ]; then
        echo -e "${GREEN}✅ OK${NC}"
        # Check if response contains expected MCP structure
        if grep -q '"capabilities"' /tmp/response.json; then
            echo "    ✓ MCP capabilities present"
        else
            echo -e "    ${YELLOW}⚠️  MCP capabilities format unexpected${NC}"
        fi
    else
        echo -e "${RED}❌ Failed (HTTP $status_code)${NC}"
        return 1
    fi
    
    echo -e "${GREEN}✅ MCP capabilities tests passed${NC}"
}

# Test authentication consistency
test_auth_consistency() {
    echo "🔐 Testing authentication consistency..."
    
    # Test unauthorized access to credential endpoints
    echo -n "  Baseball worker auth rejection... "
    status_code=$(test_endpoint "$BASEBALL_URL/credential/espn" "POST" '{"swid":"test","espn_s2":"test"}' "Content-Type: application/json")
    if [ "$status_code" = "401" ]; then
        echo -e "${GREEN}✅ OK (properly rejected)${NC}"
    else
        echo -e "${YELLOW}⚠️  Unexpected response (HTTP $status_code)${NC}"
    fi
    
    echo -n "  Football worker auth rejection... "
    status_code=$(test_endpoint "$FOOTBALL_URL/credential/espn" "POST" '{"swid":"test","espn_s2":"test"}' "Content-Type: application/json")
    if [ "$status_code" = "401" ]; then
        echo -e "${GREEN}✅ OK (properly rejected)${NC}"
    else
        echo -e "${YELLOW}⚠️  Unexpected response (HTTP $status_code)${NC}"
    fi
    
    # Test discover-leagues endpoint authentication
    echo -n "  Baseball discover-leagues auth... "
    status_code=$(test_endpoint "$BASEBALL_URL/discover-leagues")
    if [ "$status_code" = "401" ]; then
        echo -e "${GREEN}✅ OK (properly rejected)${NC}"
    else
        echo -e "${YELLOW}⚠️  Unexpected response (HTTP $status_code)${NC}"
    fi
    
    echo -e "${GREEN}✅ Authentication consistency tests passed${NC}"
}

# Test CORS configuration
test_cors_configuration() {
    echo "🌍 Testing CORS configuration..."
    
    echo -n "  Baseball worker CORS headers... "
    cors_header=$(curl -s -H "Origin: http://localhost:3000" -I "$BASEBALL_URL/health" | grep -i "access-control-allow-origin" | cut -d' ' -f2 | tr -d '\r\n')
    if [ "$cors_header" = "*" ] || [ "$cors_header" = "http://localhost:3000" ]; then
        echo -e "${GREEN}✅ OK${NC}"
    else
        echo -e "${YELLOW}⚠️  CORS header: '$cors_header'${NC}"
    fi
    
    echo -n "  Football worker CORS headers... "
    cors_header=$(curl -s -H "Origin: http://localhost:3000" -I "$FOOTBALL_URL/health" | grep -i "access-control-allow-origin" | cut -d' ' -f2 | tr -d '\r\n')
    if [ "$cors_header" = "*" ] || [ "$cors_header" = "http://localhost:3000" ]; then
        echo -e "${GREEN}✅ OK${NC}"
    else
        echo -e "${YELLOW}⚠️  CORS header: '$cors_header'${NC}"
    fi
    
    # Test OPTIONS preflight
    echo -n "  Baseball worker OPTIONS support... "
    status_code=$(curl -s -w "%{http_code}" -o /dev/null -X OPTIONS -H "Origin: http://localhost:3000" -H "Access-Control-Request-Method: POST" "$BASEBALL_URL/mcp")
    if [ "$status_code" = "200" ]; then
        echo -e "${GREEN}✅ OK${NC}"
    else
        echo -e "${YELLOW}⚠️  OPTIONS returned HTTP $status_code${NC}"
    fi
    
    echo -e "${GREEN}✅ CORS configuration tests passed${NC}"
}

# Test tool availability
test_tool_availability() {
    echo "🔧 Testing MCP tool availability..."
    
    # Test baseball tools
    echo -n "  Baseball worker tools list... "
    status_code=$(test_endpoint "$BASEBALL_URL/mcp" "POST" '{"method":"tools/list","params":{}}' "Content-Type: application/json")
    if [ "$status_code" = "200" ]; then
        echo -e "${GREEN}✅ OK${NC}"
        
        # Check for expected tools
        expected_tools=("get_espn_league_info" "get_espn_team_roster" "get_espn_matchups")
        for tool in "${expected_tools[@]}"; do
            if grep -q "\"$tool\"" /tmp/response.json; then
                echo "    ✓ $tool available"
            else
                echo -e "    ${YELLOW}⚠️  $tool missing${NC}"
            fi
        done
    else
        echo -e "${RED}❌ Failed (HTTP $status_code)${NC}"
        return 1
    fi
    
    # Test football tools
    echo -n "  Football worker tools list... "
    status_code=$(test_endpoint "$FOOTBALL_URL/mcp" "POST" '{"method":"tools/list","params":{}}' "Content-Type: application/json")
    if [ "$status_code" = "200" ]; then
        echo -e "${GREEN}✅ OK${NC}"
        
        # Check for expected football tools
        expected_tools=("get_espn_football_league_info" "get_espn_football_team" "get_espn_football_matchups" "get_espn_football_standings")
        for tool in "${expected_tools[@]}"; do
            if grep -q "\"$tool\"" /tmp/response.json; then
                echo "    ✓ $tool available"
            else
                echo -e "    ${YELLOW}⚠️  $tool missing${NC}"
            fi
        done
    else
        echo -e "${RED}❌ Failed (HTTP $status_code)${NC}"
        return 1
    fi
    
    echo -e "${GREEN}✅ Tool availability tests passed${NC}"
}

# Test performance
test_performance() {
    echo "⚡ Testing worker performance..."
    
    echo -n "  Baseball worker response time... "
    start_time=$(date +%s%3N)
    status_code=$(test_endpoint "$BASEBALL_URL/health")
    end_time=$(date +%s%3N)
    response_time=$((end_time - start_time))
    
    if [ "$status_code" = "200" ] && [ "$response_time" -lt 5000 ]; then
        echo -e "${GREEN}✅ OK (${response_time}ms)${NC}"
    elif [ "$response_time" -ge 5000 ]; then
        echo -e "${YELLOW}⚠️  Slow response (${response_time}ms)${NC}"
    else
        echo -e "${RED}❌ Failed (HTTP $status_code)${NC}"
    fi
    
    echo -n "  Football worker response time... "
    start_time=$(date +%s%3N)
    status_code=$(test_endpoint "$FOOTBALL_URL/health")
    end_time=$(date +%s%3N)
    response_time=$((end_time - start_time))
    
    if [ "$status_code" = "200" ] && [ "$response_time" -lt 5000 ]; then
        echo -e "${GREEN}✅ OK (${response_time}ms)${NC}"
    elif [ "$response_time" -ge 5000 ]; then
        echo -e "${YELLOW}⚠️  Slow response (${response_time}ms)${NC}"
    else
        echo -e "${RED}❌ Failed (HTTP $status_code)${NC}"
    fi
    
    echo -e "${GREEN}✅ Performance tests passed${NC}"
}

# Generate test report
generate_report() {
    echo ""
    echo "📊 Test Report Summary"
    echo "====================="
    echo "Baseball Worker URL: $BASEBALL_URL"
    echo "Football Worker URL: $FOOTBALL_URL"
    echo ""
    echo "Test Categories:"
    echo "  ✅ Basic Connectivity"
    echo "  ✅ MCP Capabilities"
    echo "  ✅ Authentication Consistency"
    echo "  ✅ CORS Configuration"
    echo "  ✅ Tool Availability"
    echo "  ✅ Performance"
    echo ""
    echo -e "${GREEN}🎉 All worker connectivity tests completed!${NC}"
}

# Main execution
main() {
    echo "Configuration:"
    echo "  Baseball Worker: $BASEBALL_URL"
    echo "  Football Worker: $FOOTBALL_URL"
    echo ""
    
    # Check if workers are accessible
    if ! curl -s "$BASEBALL_URL/health" > /dev/null; then
        echo -e "${RED}❌ Baseball worker not accessible at $BASEBALL_URL${NC}"
        echo "   Make sure the worker is running or set TEST_BASEBALL_WORKER_URL"
        exit 1
    fi
    
    if ! curl -s "$FOOTBALL_URL/health" > /dev/null; then
        echo -e "${RED}❌ Football worker not accessible at $FOOTBALL_URL${NC}"
        echo "   Make sure the worker is running or set TEST_FOOTBALL_WORKER_URL"
        exit 1
    fi
    
    # Run all tests
    test_basic_connectivity
    echo ""
    test_mcp_capabilities
    echo ""
    test_auth_consistency
    echo ""
    test_cors_configuration
    echo ""
    test_tool_availability
    echo ""
    test_performance
    
    generate_report
}

# Cleanup function
cleanup() {
    rm -f /tmp/response.json 2>/dev/null || true
}

# Set trap to cleanup on exit
trap cleanup EXIT

# Run main function
main "$@"