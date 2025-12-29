-- Add resource column for RFC 8707 support (OpenAI ChatGPT)
-- Phase 6: OpenAI ChatGPT Integration
-- Created: 2025-12-28
-- Status: ✅ EXECUTED
--
-- RFC 8707 Resource Indicators for OAuth 2.0 requires the 'resource' parameter
-- to be stored and validated throughout the OAuth flow. This allows token
-- audience validation to ensure tokens are only used for their intended resource.
--
-- Run this in Supabase Dashboard → SQL Editor

-- Add resource column to oauth_codes table
ALTER TABLE oauth_codes ADD COLUMN IF NOT EXISTS resource TEXT;

-- Add resource column to oauth_tokens table
ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS resource TEXT;

-- =============================================================================
-- Verification Queries (run these to verify setup)
-- =============================================================================

-- Check columns added to oauth_codes:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'oauth_codes' AND column_name = 'resource';

-- Check columns added to oauth_tokens:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'oauth_tokens' AND column_name = 'resource';
