#!/bin/bash
# verify-baseline.sh - Verify baseball-mcp endpoints
# Usage: ./verify-baseline.sh [ENVIRONMENT]
#   local:   ./verify-baseline.sh local     (default, http://localhost:8787)
#   preview: ./verify-baseline.sh preview   (workers.dev preview)
#   prod:    ./verify-baseline.sh prod      (workers.dev production)
#   custom:  ./verify-baseline.sh https://custom-url.example.com

set -e

# Determine BASE_URL from environment argument
case "${1:-local}" in
  local)
    BASE_URL="http://localhost:8787"
    ;;
  preview)
    BASE_URL="https://baseball-espn-mcp-preview.gerrygugger.workers.dev"
    ;;
  prod|production)
    BASE_URL="https://baseball-espn-mcp.gerrygugger.workers.dev"
    ;;
  http*|https*)
    BASE_URL="$1"
    ;;
  *)
    echo "Unknown environment: $1"
    echo "Usage: $0 [local|preview|prod|https://custom-url]"
    exit 1
    ;;
esac
PASSED=0
FAILED=0

echo "🧪 Baseball MCP Verification Script"
echo "   Target: $BASE_URL"
echo "   Time:   $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo ""

# Helpers
get_status() {
  echo "$1" | awk 'NR==1 {print $2}'
}

# Test individual endpoints
test_health() {
  echo -n "  Health endpoint: "
  local headers body status
  headers=$(curl -s -D - -o /dev/null "$BASE_URL/baseball/health" | tr -d '\r')
  body=$(curl -s "$BASE_URL/baseball/health")
  status=$(get_status "$headers")
  if [ "$status" = "200" ] && echo "$body" | grep -q 'baseball-espn-mcp'; then
    echo "✅ $status"
    PASSED=$((PASSED + 1))
  else
    echo "❌ Expected 200 + service field, got $status"
    FAILED=$((FAILED + 1))
  fi
}

test_oauth_metadata() {
  echo -n "  OAuth metadata: "
  local headers body status
  headers=$(curl -s -D - -o /dev/null "$BASE_URL/baseball/.well-known/oauth-protected-resource" | tr -d '\r')
  body=$(curl -s "$BASE_URL/baseball/.well-known/oauth-protected-resource")
  status=$(get_status "$headers")
  if [ "$status" = "200" ] && echo "$body" | grep -q 'api.flaim.app/baseball/mcp'; then
    echo "✅ $status"
    PASSED=$((PASSED + 1))
  else
    echo "❌ Expected 200 + resource field, got $status"
    FAILED=$((FAILED + 1))
  fi
}

test_cors_preflight() {
  echo -n "  CORS preflight: "
  local headers status
  headers=$(curl -s -D - -o /dev/null -X OPTIONS "$BASE_URL/baseball/mcp" \
    -H "Origin: https://flaim.app" \
    -H "Access-Control-Request-Method: POST" | tr -d '\r')
  status=$(get_status "$headers")
  if [ "$status" = "200" ] \
    && echo "$headers" | grep -qi '^access-control-allow-origin: https://flaim.app$' \
    && echo "$headers" | grep -qi '^access-control-allow-headers: .*authorization.*x-clerk-user-id'; then
    echo "✅ $status"
    PASSED=$((PASSED + 1))
  else
    echo "❌ Expected 200 + CORS headers, got $status"
    FAILED=$((FAILED + 1))
  fi
}

test_mcp_unauthorized() {
  echo -n "  MCP unauthorized: "
  local headers body status
  headers=$(curl -s -D - -o /dev/null -X POST "$BASE_URL/baseball/mcp" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"initialize","id":1}' | tr -d '\r')
  body=$(curl -s -X POST "$BASE_URL/baseball/mcp" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"initialize","id":1}')
  status=$(get_status "$headers")
  if [ "$status" = "401" ] \
    && echo "$headers" | grep -qi '^www-authenticate: Bearer' \
    && echo "$body" | grep -q '"mcp/www_authenticate"'; then
    echo "✅ $status"
    PASSED=$((PASSED + 1))
  else
    echo "❌ Expected 401 + OAuth headers/body, got $status"
    FAILED=$((FAILED + 1))
  fi
}

test_onboarding_unauthorized() {
  echo -n "  Onboarding unauthorized: "
  local headers body status
  headers=$(curl -s -D - -o /dev/null -X POST "$BASE_URL/baseball/onboarding/initialize" \
    -H "Content-Type: application/json" \
    -d '{}' | tr -d '\r')
  body=$(curl -s -X POST "$BASE_URL/baseball/onboarding/initialize" \
    -H "Content-Type: application/json" \
    -d '{}')
  status=$(get_status "$headers")
  if [ "$status" = "401" ] && echo "$body" | grep -q 'Authentication required'; then
    echo "✅ $status"
    PASSED=$((PASSED + 1))
  else
    echo "❌ Expected 401 + auth error, got $status"
    FAILED=$((FAILED + 1))
  fi
}

# Helper to capture response for baseline documentation
capture_response() {
  local name="$1"
  local method="$2"
  local path="$3"
  local extra_args="${4:-}"

  echo ""
  echo "📋 $name response:"
  curl -s -X "$method" "$BASE_URL$path" $extra_args | jq '.' 2>/dev/null || curl -s -X "$method" "$BASE_URL$path" $extra_args
  echo ""
}

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📡 Testing Endpoints"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

test_health
test_oauth_metadata
test_cors_preflight
test_mcp_unauthorized
test_onboarding_unauthorized

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📄 Capturing Response Bodies (Baseline)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

capture_response "Health" "GET" "/baseball/health"
capture_response "OAuth metadata" "GET" "/baseball/.well-known/oauth-protected-resource"
capture_response "MCP 401" "POST" "/baseball/mcp" '-H "Content-Type: application/json" -d '\''{"jsonrpc":"2.0","method":"initialize","id":1}'\'''

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ Passed: $PASSED"
echo "  ❌ Failed: $FAILED"
echo ""

if [ "$FAILED" -gt 0 ]; then
  echo "⚠️  Some tests failed!"
  exit 1
else
  echo "🎉 All tests passed!"
  exit 0
fi
