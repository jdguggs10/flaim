#!/bin/bash

# FLAIM Build Script
# Builds all components of the FLAIM project

set -e  # Exit on any error

echo "🔨 FLAIM Build Process"
echo "====================="

# Color codes for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print status messages
print_status() {
    echo -e "${BLUE}[BUILD]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
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

# Build the auth module
print_status "Building auth module..."
cd auth
npm run build
check_success "Auth module built successfully!" "build auth module"
cd ..

# Build the frontend
print_status "Building frontend..."
cd openai
npm run build
check_success "Frontend built successfully!" "build frontend"
cd ..

# Type check baseball worker
print_status "Type checking Baseball ESPN MCP worker..."
cd workers/baseball-espn-mcp
npm run type-check
check_success "Baseball worker type checking passed!" "type check baseball worker"
cd ../../

# Type check football worker
print_status "Type checking Football ESPN MCP worker..."
cd workers/football-espn-mcp
npm run type-check
check_success "Football worker type checking passed!" "type check football worker"
cd ../../

echo -e "\n${GREEN}🎉 All components built successfully!${NC}"
echo "You can now deploy your application or start the production servers."
echo -e "\nTo start in production mode, run: ${YELLOW}./start-prod.sh${NC} (if available)"
echo -e "To start in development mode, run: ${YELLOW}./start-dev.sh${NC}"

# Make the script executable
chmod +x build.sh
