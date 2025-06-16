#!/bin/bash

# FLAIM Local Development Quickstart
# This script sets up FLAIM for local development in one command

set -e  # Exit on any error

echo "🚀 FLAIM Local Development Quickstart"
echo "====================================="

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

print_success "Prerequisites check passed!"

# Check if .env.example exists and create .env files
print_status "Setting up environment configuration..."

if [ ! -f ".env.example" ]; then
    print_error ".env.example not found. Please ensure you're in the FLAIM root directory."
    exit 1
fi

# Create frontend .env.local if it doesn't exist
if [ ! -f "openai/.env.local" ]; then
    print_status "Creating frontend environment file..."
    cp .env.example openai/.env.local
    print_warning "Please edit openai/.env.local with your API keys before continuing."
    print_warning "Required: OPENAI_API_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_SECRET_KEY"
    
    read -p "Press Enter after you've configured openai/.env.local..."
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

# Set up worker secrets for development
print_status "Setting up worker secrets for development..."

echo ""
print_warning "You need to set up Cloudflare Worker secrets for development."
print_warning "Please have your encryption key and Clerk secret key ready."
echo ""

# Generate encryption key if needed
print_status "Generating encryption key (if needed)..."
ENCRYPTION_KEY=$(openssl rand -base64 32)
echo "Generated encryption key: $ENCRYPTION_KEY"
echo ""

# Set up baseball worker secrets
print_status "Setting up baseball worker secrets..."
cd workers/baseball-espn-mcp

echo "Setting ENCRYPTION_KEY for baseball worker..."
echo "$ENCRYPTION_KEY" | wrangler secret put ENCRYPTION_KEY --env dev

echo ""
print_warning "Please enter your Clerk secret key for baseball worker:"
wrangler secret put CLERK_SECRET_KEY --env dev

cd ../..

# Set up football worker secrets
print_status "Setting up football worker secrets..."
cd workers/football-espn-mcp

echo "Setting ENCRYPTION_KEY for football worker..."
echo "$ENCRYPTION_KEY" | wrangler secret put ENCRYPTION_KEY --env dev

echo ""
print_warning "Please enter your Clerk secret key for football worker (same as above):"
wrangler secret put CLERK_SECRET_KEY --env dev

cd ../..

print_success "Worker secrets configured!"

# Create start script
print_status "Creating development startup script..."

cat > start-dev.sh << 'EOF'
#!/bin/bash

# FLAIM Development Startup Script
# Starts all services for local development

echo "🚀 Starting FLAIM Development Environment"
echo "======================================="

# Function to cleanup background processes on exit
cleanup() {
    echo ""
    echo "🛑 Shutting down services..."
    jobs -p | xargs -r kill
    exit 0
}

# Set up cleanup on script exit
trap cleanup SIGINT SIGTERM EXIT

# Start baseball worker in background
echo "📊 Starting Baseball ESPN MCP Worker (port 8787)..."
cd workers/baseball-espn-mcp
wrangler dev --env dev --port 8787 &
BASEBALL_PID=$!
cd ../..

# Start football worker in background
echo "🏈 Starting Football ESPN MCP Worker (port 8788)..."
cd workers/football-espn-mcp
wrangler dev --env dev --port 8788 &
FOOTBALL_PID=$!
cd ../..

# Give workers time to start
sleep 3

# Start frontend
echo "🖥️  Starting Next.js Frontend (port 3000)..."
cd openai
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "✅ All services started!"
echo ""
echo "🌐 Frontend:        http://localhost:3000"
echo "⚾ Baseball Worker: http://localhost:8787"
echo "🏈 Football Worker: http://localhost:8788"
echo ""
echo "📊 Health Checks:"
echo "   curl http://localhost:8787/health"
echo "   curl http://localhost:8788/health"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for any process to exit
wait
EOF

chmod +x start-dev.sh

print_success "Development startup script created: ./start-dev.sh"

echo ""
echo "🎉 Local Development Setup Complete!"
echo "===================================="
echo ""
echo "📋 Next Steps:"
echo "1. Ensure your openai/.env.local file has valid API keys"
echo "2. Run: ./start-dev.sh"
echo "3. Visit http://localhost:3000 to use FLAIM"
echo ""
echo "🔧 Manual Start (if needed):"
echo "Terminal 1: cd workers/baseball-espn-mcp && wrangler dev --env dev --port 8787"
echo "Terminal 2: cd workers/football-espn-mcp && wrangler dev --env dev --port 8788"
echo "Terminal 3: cd openai && npm run dev"
echo ""
echo "📚 Documentation: ./docs/DEPLOYMENT.md"
print_success "Happy coding! 🚀"