-- Migration: Extension pairing codes and tokens
-- Purpose: Support Chrome extension for automatic ESPN credential capture
-- Idempotent: Safe to run multiple times

-- ============================================================================
-- Extension Pairing Codes
-- Short-lived codes for linking extension to user account
-- ============================================================================
CREATE TABLE IF NOT EXISTS extension_pairing_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  code CHAR(6) NOT NULL,  -- e.g., "A3F8K2"
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,  -- created_at + 10 minutes
  used_at TIMESTAMPTZ  -- NULL until code is exchanged for token
);

-- Index for code lookup (only unused codes matter)
CREATE UNIQUE INDEX IF NOT EXISTS idx_extension_pairing_codes_code
  ON extension_pairing_codes(code);

-- Index for cleanup job (delete expired codes)
CREATE INDEX IF NOT EXISTS idx_extension_pairing_codes_expires
  ON extension_pairing_codes(expires_at)
  WHERE used_at IS NULL;

-- Index for user lookup (to delete existing codes before generating new one)
CREATE INDEX IF NOT EXISTS idx_extension_pairing_codes_user
  ON extension_pairing_codes(clerk_user_id)
  WHERE used_at IS NULL;

-- ============================================================================
-- Extension Tokens
-- Long-lived tokens for extension authentication
-- ============================================================================
CREATE TABLE IF NOT EXISTS extension_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  token TEXT NOT NULL,  -- 32-byte random hex string (64 chars)
  name TEXT,  -- Optional label for audit
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,  -- Updated on each API call
  revoked_at TIMESTAMPTZ  -- NULL unless manually revoked
);

-- Index for token validation
CREATE UNIQUE INDEX IF NOT EXISTS idx_extension_tokens_token
  ON extension_tokens(token);

-- Index for user's tokens (for /extension page status)
CREATE INDEX IF NOT EXISTS idx_extension_tokens_user
  ON extension_tokens(clerk_user_id)
  WHERE revoked_at IS NULL;

-- Enforce at most one active token per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_extension_tokens_one_active_per_user
  ON extension_tokens(clerk_user_id)
  WHERE revoked_at IS NULL;

-- Comments for documentation
COMMENT ON TABLE extension_pairing_codes IS 'Short-lived pairing codes for linking Chrome extension to user account';
COMMENT ON COLUMN extension_pairing_codes.code IS '6-character alphanumeric code (uppercase, no ambiguous chars)';
COMMENT ON COLUMN extension_pairing_codes.expires_at IS 'Code expires 10 minutes after creation';
COMMENT ON COLUMN extension_pairing_codes.used_at IS 'Timestamp when code was exchanged for token (prevents reuse)';

COMMENT ON TABLE extension_tokens IS 'Long-lived tokens for Chrome extension authentication';
COMMENT ON COLUMN extension_tokens.token IS '64-character hex string (32 bytes of randomness)';
COMMENT ON COLUMN extension_tokens.last_used_at IS 'Updated on each successful API call for audit';
COMMENT ON COLUMN extension_tokens.revoked_at IS 'Set when user disconnects extension; NULL = active';

-- ============================================================================
-- Cleanup function for expired pairing codes
-- ============================================================================
CREATE OR REPLACE FUNCTION cleanup_expired_extension_codes()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM extension_pairing_codes
  WHERE expires_at < NOW()
     OR used_at IS NOT NULL;

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_expired_extension_codes IS 'Removes expired and used pairing codes. Call periodically for cleanup.';
