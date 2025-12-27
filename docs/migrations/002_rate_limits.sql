-- Rate Limits Table for Claude Direct Access
-- Run this in Supabase Dashboard → SQL Editor
-- Part of Phase 3: Rate Limiting Implementation
-- Created: 2025-12-22
-- Status: ✅ EXECUTED

-- =============================================================================
-- rate_limits: Per-user daily call counters
-- Tracks tool call usage for both Clerk JWT and OAuth token users
-- =============================================================================

CREATE TABLE IF NOT EXISTS rate_limits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Clerk user ID (links to espn_credentials.clerk_user_id)
  user_id TEXT NOT NULL,

  -- Date window for rate limiting (resets daily at midnight UTC)
  window_date DATE NOT NULL DEFAULT CURRENT_DATE,

  -- Number of tool calls made in this window
  request_count INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- One row per user per day
  UNIQUE(user_id, window_date)
);

-- Index for fast lookup by user + date (primary use case)
CREATE INDEX IF NOT EXISTS idx_rate_limits_user_date ON rate_limits(user_id, window_date);

-- Index for cleanup of old records
CREATE INDEX IF NOT EXISTS idx_rate_limits_window_date ON rate_limits(window_date);

-- =============================================================================
-- Helper function to increment counter (upsert pattern)
-- =============================================================================

CREATE OR REPLACE FUNCTION increment_rate_limit(p_user_id TEXT)
RETURNS TABLE(request_count INTEGER, window_date DATE) AS $$
BEGIN
  RETURN QUERY
  INSERT INTO rate_limits (user_id, window_date, request_count, updated_at)
  VALUES (p_user_id, CURRENT_DATE, 1, NOW())
  ON CONFLICT (user_id, window_date)
  DO UPDATE SET
    request_count = rate_limits.request_count + 1,
    updated_at = NOW()
  RETURNING rate_limits.request_count, rate_limits.window_date;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Cleanup function (run daily to remove old rate limit records)
-- =============================================================================

CREATE OR REPLACE FUNCTION cleanup_old_rate_limits()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  -- Keep 7 days of history for debugging, delete older
  DELETE FROM rate_limits
  WHERE window_date < CURRENT_DATE - INTERVAL '7 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Row Level Security (RLS) - Service role bypasses RLS
-- =============================================================================

ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Verification Queries
-- =============================================================================

-- Check table exists:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name = 'rate_limits';

-- Check current rate limits:
-- SELECT user_id, window_date, request_count FROM rate_limits
-- WHERE window_date = CURRENT_DATE ORDER BY request_count DESC LIMIT 10;
