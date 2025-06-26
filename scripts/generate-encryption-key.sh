#!/bin/bash

# FLAIM Platform - Encryption Key Generator
# Generates a secure base64 encryption key for ESPN credential storage

set -e

echo "🔑 FLAIM Encryption Key Generator"
echo "=================================="
echo ""

# Check if openssl is available
if ! command -v openssl &> /dev/null; then
    echo "❌ Error: openssl is required but not installed."
    echo "   Please install openssl and try again."
    echo ""
    echo "   macOS: brew install openssl"
    echo "   Ubuntu/Debian: sudo apt-get install openssl"
    echo "   CentOS/RHEL: sudo yum install openssl"
    exit 1
fi

# Generate the encryption key
echo "🔄 Generating 32-byte base64 encryption key..."
KEY=$(openssl rand -base64 32)

echo ""
echo "✅ Encryption key generated successfully!"
echo ""
echo "📋 Your encryption key:"
echo "======================================================"
echo "$KEY"
echo "======================================================"
echo ""
echo "🔐 SECURITY NOTES:"
echo "   • Store this key securely - it encrypts all ESPN credentials"
echo "   • Use the SAME key in all workers and Next.js app"
echo "   • Never commit this key to version control"
echo "   • If lost, all stored credentials will be unrecoverable"
echo ""
echo "📝 SETUP INSTRUCTIONS:"
echo "   1. Set in workers (run in each worker directory):"
echo "      wrangler secret put CF_ENCRYPTION_KEY"
echo "      # Paste the key above when prompted"
echo ""
echo "   2. Set in Next.js app (.env.local):"
echo "      CF_ENCRYPTION_KEY=$KEY"
echo ""
echo "   3. Continue with KV setup guide: docs/KV_SETUP.md"
echo ""

# Optionally copy to clipboard if available
if command -v pbcopy &> /dev/null; then
    echo "$KEY" | pbcopy
    echo "✅ Key copied to clipboard (macOS)"
elif command -v xclip &> /dev/null; then
    echo "$KEY" | xclip -selection clipboard
    echo "✅ Key copied to clipboard (Linux)"
elif command -v clip &> /dev/null; then
    echo "$KEY" | clip
    echo "✅ Key copied to clipboard (Windows/WSL)"
fi

echo ""