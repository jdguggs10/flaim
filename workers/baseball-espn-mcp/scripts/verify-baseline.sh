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

# Test individual endpoints
test_health() {
  echo -n "  Health endpoint: "
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/baseball/health")
  if [ "$status" = "200" ]; then
    echo "✅ $status"
    PASSED=$((PASSED + 1))
  else
    echo "❌ Expected 200, got $status"
    FAILED=$((FAILED + 1))
  fi
}

test_oauth_metadata() {
  echo -n "  OAuth metadata: "
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/baseball/.well-known/oauth-protected-resource")
  if [ "$status" = "200" ]; then
    echo "✅ $status"
    PASSED=$((PASSED + 1))
  else
    echo "❌ Expected 200, got $status"
    FAILED=$((FAILED + 1))
  fi
}

test_cors_preflight() {
  echo -n "  CORS preflight: "
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS "$BASE_URL/baseball/mcp" \
    -H "Origin: https://flaim.app" \
    -H "Access-Control-Request-Method: POST")
  if [ "$status" = "200" ]; then
    echo "✅ $status"
    PASSED=$((PASSED + 1))
  else
    echo "❌ Expected 200, got $status"
    FAILED=$((FAILED + 1))
  fi
}

test_mcp_unauthorized() {
  echo -n "  MCP unauthorized: "
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/baseball/mcp" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"initialize","id":1}')
  if [ "$status" = "401" ]; then
    echo "✅ $status"
    PASSED=$((PASSED + 1))
  else
    echo "❌ Expected 401, got $status"
    FAILED=$((FAILED + 1))
  fi
}

test_onboarding_unauthorized() {
  echo -n "  Onboarding unauthorized: "
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/baseball/onboarding/initialize" \
    -H "Content-Type: application/json" \
    -d '{}')
  if [ "$status" = "401" ]; then
    echo "✅ $status"
    PASSED=$((PASSED + 1))
  else
    echo "❌ Expected 401, got $status"
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
