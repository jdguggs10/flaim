-- OAuth Tables for Claude Direct Access
-- Run this in Supabase Dashboard → SQL Editor
-- Part of Phase 1: MCP Connector Implementation
-- Created: 2025-12-20
-- Status: ✅ EXECUTED

-- =============================================================================
-- oauth_codes: Authorization codes (short-lived, one-time use)
-- Used during OAuth flow: user consents → code issued → code exchanged for token
-- =============================================================================

CREATE TABLE IF NOT EXISTS oauth_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The authorization code (URL-safe random string)
  code TEXT NOT NULL UNIQUE,

  -- Clerk user ID (links to espn_credentials.clerk_user_id)
  user_id TEXT NOT NULL,

  -- OAuth redirect URI (must match on token exchange)
  redirect_uri TEXT NOT NULL,

  -- PKCE support (required by OAuth 2.1)
  code_challenge TEXT,
  code_challenge_method TEXT CHECK (code_challenge_method IN ('S256', 'plain')),

  -- Requested scopes (space-separated, e.g., 'mcp:read mcp:write')
  scope TEXT DEFAULT 'mcp:read',

  -- Short expiration (5-10 minutes)
  expires_at TIMESTAMPTZ NOT NULL,

  -- Mark as used to prevent replay attacks
  used_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for code lookup (primary use case)
CREATE INDEX IF NOT EXISTS idx_oauth_codes_code ON oauth_codes(code);

-- Index for cleanup of expired codes
CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires_at ON oauth_codes(expires_at);

-- =============================================================================
-- oauth_tokens: Access tokens (longer-lived)
-- Claude uses these to authenticate MCP requests
-- =============================================================================

CREATE TABLE IF NOT EXISTS oauth_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The access token (URL-safe random string or JWT)
  access_token TEXT NOT NULL UNIQUE,

  -- Clerk user ID (links to espn_credentials.clerk_user_id)
  user_id TEXT NOT NULL,

  -- Granted scopes
  scope TEXT DEFAULT 'mcp:read',

  -- Token expiration (1-24 hours recommended)
  expires_at TIMESTAMPTZ NOT NULL,

  -- Revocation timestamp (null = active)
  revoked_at TIMESTAMPTZ,

  -- Optional refresh token for token renewal
  refresh_token TEXT UNIQUE,
  refresh_token_expires_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for token lookup (primary use case - every MCP request)
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_access_token ON oauth_tokens(access_token);

-- Index for user lookup (list user's tokens, revoke all)
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_user_id ON oauth_tokens(user_id);

-- Index for refresh token lookup
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_refresh_token ON oauth_tokens(refresh_token);

-- Index for cleanup of expired tokens
CREATE INDEX IF NOT EXISTS idx_oauth_tokens_expires_at ON oauth_tokens(expires_at);

-- =============================================================================
-- Cleanup Functions (optional - can run manually or via cron)
-- =============================================================================

-- Function to delete expired/used codes (run daily)
CREATE OR REPLACE FUNCTION cleanup_expired_oauth_codes()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM oauth_codes
  WHERE expires_at < NOW() OR used_at IS NOT NULL;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Function to delete expired/revoked tokens (run daily)
CREATE OR REPLACE FUNCTION cleanup_expired_oauth_tokens()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM oauth_tokens
  WHERE expires_at < NOW()
    OR (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '7 days');
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Row Level Security (RLS) - Service role bypasses RLS
-- These policies are for additional security if using anon key
-- =============================================================================

-- Enable RLS (service role key bypasses these)
ALTER TABLE oauth_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;

-- For now, no anon access - all access via service role in workers
-- If you need anon access later, add policies here

-- =============================================================================
-- Verification Queries (run these to verify setup)
-- =============================================================================

-- Check tables exist:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name LIKE 'oauth_%';

-- Check indexes:
-- SELECT indexname FROM pg_indexes WHERE tablename LIKE 'oauth_%';
