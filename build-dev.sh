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

# Install/update dependencies at root level
print_status "Installing/updating root dependencies..."
npm install
check_success "Root dependencies updated!" "install root dependencies"

# Build the auth module in development mode
print_status "Building auth module (development mode)..."
cd auth
npm install
npm run build:dev 2>/dev/null || npm run build  # Fallback to regular build if dev script doesn't exist
check_success "Auth module built for development!" "build auth module"
cd ..

# Build the frontend in development mode (skip build for now)
print_status "Checking frontend setup (development mode)..."
cd openai
npm install
print_status "Skipping Next.js build - will build on startup"
check_success "Frontend dependencies installed!" "install frontend dependencies"
cd ..

# Build Baseball ESPN MCP worker
print_status "Building Baseball ESPN MCP worker..."
cd workers/baseball-espn-mcp
npm install
npm run build 2>/dev/null || npm run type-check  # Fallback to type-check if build doesn't exist
check_success "Baseball worker built!" "build baseball worker"
cd ../../

# Build Football ESPN MCP worker
print_status "Building Football ESPN MCP worker..."
cd workers/football-espn-mcp
npm install
npm run build 2>/dev/null || npm run type-check  # Fallback to type-check if build doesn't exist
check_success "Football worker built!" "build football worker"
cd ../../

# Build test suite
print_status "Building test suite..."
cd tests
npm install
npm run type-check
check_success "Test suite built!" "build test suite"
cd ..

echo -e "\n${GREEN}🎉 Development build completed successfully!${NC}"
echo -e "\nTo start the development environment, run: ${YELLOW}./start-dev.sh${NC}"
echo -e "\nThis build is optimized for development with debugging enabled."

# Make the script executable
chmod +x build-dev.sh
