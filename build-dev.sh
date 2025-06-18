#!/bin/bash

# FLAIM Development Build Script
# Performs fast builds optimized for local development

set -e  # Exit on any error

echo "🔨 FLAIM Development Build"
echo "========================"

# Color codes for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print status messages
print_status() {
    echo -e "${BLUE}[DEV BUILD]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

# Function to check if a command was successful
check_success() {
    if [ $? -eq 0 ]; then
        print_success "$1"
    else
        print_error "Failed to $2"
    fi
}

# Build the auth module in development mode
print_status "Building auth module (development mode)..."
cd auth
npm run build:dev 2>/dev/null || npm run build  # Fallback to regular build if dev script doesn't exist
check_success "Auth module built for development!" "build auth module"
cd ..

# Build the frontend in development mode
print_status "Building frontend (development mode)..."
cd openai
NEXT_TELEMETRY_DISABLED=1 NODE_ENV=development npm run build
check_success "Frontend built for development!" "build frontend"
cd ..

# Type check baseball worker (development)
print_status "Type checking Baseball ESPN MCP worker..."
cd workers/baseball-espn-mcp
npm run type-check
check_success "Baseball worker type checking passed!" "type check baseball worker"
cd ../../

# Type check football worker (development)
print_status "Type checking Football ESPN MCP worker..."
cd workers/football-espn-mcp
npm run type-check
check_success "Football worker type checking passed!" "type check football worker"
cd ../../

echo -e "\n${GREEN}🎉 Development build completed successfully!${NC}"
echo -e "\nTo start the development environment, run: ${YELLOW}./start-dev.sh${NC}"
echo -e "\nThis build is optimized for development with debugging enabled."

# Make the script executable
chmod +x build-dev.sh
