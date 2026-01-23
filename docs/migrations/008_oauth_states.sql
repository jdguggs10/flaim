-- Migration: OAuth state storage for server-side validation
-- Purpose: Prevent CSRF by validating state on /oauth/code
-- Run this in Supabase Dashboard → SQL Editor
-- Created: 2026-01-23
-- Status: ⏳ PENDING

-- =============================================================================
-- oauth_states: Short-lived, single-use state values
-- =============================================================================

CREATE TABLE IF NOT EXISTS oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state TEXT NOT NULL UNIQUE,
  redirect_uri TEXT NOT NULL,
  client_id TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_state ON oauth_states(state);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON oauth_states(expires_at);

-- Cleanup function (optional)
CREATE OR REPLACE FUNCTION cleanup_expired_oauth_states()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM oauth_states
  WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
