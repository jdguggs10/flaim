#!/bin/bash

# FLAIM Production Deployment Quickstart
# This script deploys FLAIM to production in one command

set -e  # Exit on any error

echo "🚀 FLAIM Production Deployment Quickstart"
echo "========================================"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check prerequisites
print_status "Checking prerequisites..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    print_error "Node.js is not installed. Please install Node.js 18+ and try again."
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    print_error "npm is not installed. Please install npm and try again."
    exit 1
fi

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    print_warning "Wrangler CLI not found. Installing globally..."
    npm install -g wrangler@latest
fi

# Check if user is logged into Cloudflare
print_status "Checking Cloudflare authentication..."
if ! wrangler whoami &> /dev/null; then
    print_warning "Not logged into Cloudflare. Please login..."
    wrangler login
fi

print_success "Prerequisites check passed!"

# Check if .env.example exists
print_status "Checking environment configuration..."

if [ ! -f ".env.example" ]; then
    print_error ".env.example not found. Please ensure you're in the FLAIM root directory."
    exit 1
fi

# Create frontend .env.local if it doesn't exist
if [ ! -f "openai/.env.local" ]; then
    print_status "Creating frontend environment file..."
    cp .env.example openai/.env.local
    print_warning "Please edit openai/.env.local with your production API keys."
    print_warning "Required: OPENAI_API_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY"
    
    read -p "Press Enter after you've configured openai/.env.local with PRODUCTION values..."
fi

# Confirm production deployment
echo ""
print_warning "⚠️  PRODUCTION DEPLOYMENT WARNING ⚠️"
print_warning "This will deploy FLAIM to production with the following components:"
print_warning "• Baseball ESPN MCP Worker → baseball-espn-mcp-prod"
print_warning "• Football ESPN MCP Worker → football-espn-mcp-prod" 
print_warning "• Next.js Frontend → Cloudflare Pages"
echo ""
read -p "Are you sure you want to proceed with production deployment? (y/N): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_status "Deployment cancelled."
    exit 0
fi

# Install dependencies for all components
print_status "Installing dependencies..."

# Install auth module dependencies first
print_status "Installing auth module dependencies..."
cd auth
npm install
cd ..

# Install frontend dependencies
print_status "Installing frontend dependencies..."
cd openai
npm install
cd ..

# Install baseball worker dependencies
print_status "Installing baseball worker dependencies..."
cd workers/baseball-espn-mcp
npm install
cd ../..

# Install football worker dependencies
print_status "Installing football worker dependencies..."
cd workers/football-espn-mcp
npm install
cd ../..

print_success "All dependencies installed!"

# Set up worker secrets for production
print_status "Setting up worker secrets for production..."

echo ""
print_warning "You need to set up Cloudflare Worker secrets for production."
print_warning "Please have your encryption key and Clerk secret key ready."
echo ""

# Generate encryption key
print_status "Generating encryption key..."
ENCRYPTION_KEY=$(openssl rand -base64 32)
echo "Generated encryption key: $ENCRYPTION_KEY"
echo ""
print_warning "💾 SAVE THIS KEY: You'll need it for both workers!"
echo ""

# Set up baseball worker secrets
print_status "Setting up baseball worker secrets..."
cd workers/baseball-espn-mcp

echo "Setting ENCRYPTION_KEY for baseball worker..."
echo "$ENCRYPTION_KEY" | wrangler secret put ENCRYPTION_KEY --env prod

echo ""
print_warning "Please enter your Clerk secret key for baseball worker:"
wrangler secret put CLERK_SECRET_KEY --env prod

cd ../..

# Set up football worker secrets
print_status "Setting up football worker secrets..."
cd workers/football-espn-mcp

echo "Setting ENCRYPTION_KEY for football worker (same as above)..."
echo "$ENCRYPTION_KEY" | wrangler secret put ENCRYPTION_KEY --env prod

echo ""
print_warning "Please enter your Clerk secret key for football worker (same as above):"
wrangler secret put CLERK_SECRET_KEY --env prod

cd ../..

print_success "Worker secrets configured!"

# Deploy Baseball Worker
print_status "Deploying Baseball ESPN MCP Worker..."
cd workers/baseball-espn-mcp
wrangler deploy --env prod
BASEBALL_URL=$(wrangler subdomain list | grep -o '[^[:space:]]*\.workers\.dev' | head -1)
if [ -z "$BASEBALL_URL" ]; then
    BASEBALL_URL="your-subdomain.workers.dev"
fi
BASEBALL_FULL_URL="https://baseball-espn-mcp-prod.$BASEBALL_URL"
cd ../..
print_success "Baseball worker deployed: $BASEBALL_FULL_URL"

# Deploy Football Worker
print_status "Deploying Football ESPN MCP Worker..."
cd workers/football-espn-mcp
wrangler deploy --env prod
FOOTBALL_FULL_URL="https://football-espn-mcp-prod.$BASEBALL_URL"
cd ../..
print_success "Football worker deployed: $FOOTBALL_FULL_URL"

# Test worker health
print_status "Testing worker health..."
sleep 5  # Give workers time to initialize

echo "Testing Baseball worker..."
if curl -s --fail "$BASEBALL_FULL_URL/health" > /dev/null; then
    print_success "Baseball worker health check passed!"
else
    print_warning "Baseball worker health check failed (this might be normal during initial deployment)"
fi

echo "Testing Football worker..."
if curl -s --fail "$FOOTBALL_FULL_URL/health" > /dev/null; then
    print_success "Football worker health check passed!"
else
    print_warning "Football worker health check failed (this might be normal during initial deployment)"
fi

# Deploy Frontend
print_status "Deploying Next.js Frontend to Cloudflare Pages..."
cd openai

# Build the frontend
print_status "Building frontend..."
npm run build

# Deploy to Cloudflare Pages
print_status "Deploying to Cloudflare Pages..."

# Check if @cloudflare/next-on-pages is available
if ! npm list @cloudflare/next-on-pages &> /dev/null; then
    print_status "Installing @cloudflare/next-on-pages..."
    npm install --save-dev @cloudflare/next-on-pages
fi

# Run next-on-pages
npx @cloudflare/next-on-pages

# Deploy with wrangler pages
print_status "Publishing to Cloudflare Pages..."
npx wrangler pages deploy .vercel/output/static --project-name flaim-frontend --compatibility-date 2024-12-01

cd ..

print_success "Frontend deployed to Cloudflare Pages!"

# Create production info file
print_status "Creating production deployment info..."

cat > production-info.md << EOF
# FLAIM Production Deployment Info

Deployment completed: $(date)

## 🌐 Service URLs

### Workers
- **Baseball MCP**: $BASEBALL_FULL_URL
- **Football MCP**: $FOOTBALL_FULL_URL

### Frontend
- **Cloudflare Pages**: Check Cloudflare dashboard for URL

## 🔧 Health Checks

\`\`\`bash
# Test workers
curl $BASEBALL_FULL_URL/health
curl $FOOTBALL_FULL_URL/health

# Test MCP endpoints
curl $BASEBALL_FULL_URL/mcp
curl $FOOTBALL_FULL_URL/mcp
\`\`\`

## 📊 Monitoring

\`\`\`bash
# View worker logs
wrangler tail baseball-espn-mcp-prod
wrangler tail football-espn-mcp-prod

# Worker analytics in Cloudflare dashboard
\`\`\`

## 🔐 Secrets Configured

- ✅ ENCRYPTION_KEY (both workers)
- ✅ CLERK_SECRET_KEY (both workers)

## 📝 Next Steps

1. Test your frontend deployment
2. Configure MCP tools in external AI assistants
3. Set up monitoring and alerting
4. Configure custom domain (optional)

## 🆘 Support

- Documentation: ./docs/DEPLOYMENT.md
- Health endpoints: /health on each worker
- Logs: wrangler tail <worker-name>
EOF

print_success "Production info saved to: ./production-info.md"

echo ""
echo "🎉 Production Deployment Complete!"
echo "=================================="
echo ""
echo "✅ Deployed Services:"
echo "   📊 Baseball Worker: $BASEBALL_FULL_URL"
echo "   🏈 Football Worker: $FOOTBALL_FULL_URL" 
echo "   🖥️  Frontend: Check Cloudflare Pages dashboard"
echo ""
echo "🔍 Quick Health Check:"
echo "   curl $BASEBALL_FULL_URL/health"
echo "   curl $FOOTBALL_FULL_URL/health"
echo ""
echo "📋 Next Steps:"
echo "1. Check Cloudflare Pages dashboard for frontend URL"
echo "2. Test your application end-to-end"
echo "3. Configure custom domain (optional)"
echo "4. Set up monitoring and alerts"
echo ""
echo "📚 Documentation:"
echo "   • Production info: ./production-info.md"
echo "   • Full guide: ./docs/DEPLOYMENT.md"
echo ""
print_success "Your FLAIM platform is now live in production! 🚀"