-- Migration: Default per sport + user preferences
-- Purpose: Allow one default league per sport (not globally) and track default sport
-- Run this in Supabase Dashboard → SQL Editor
-- Created: 2026-01-25

-- =============================================================================
-- 1. ESPN: Change from "one default per user" to "one default per user per sport"
-- =============================================================================

-- Drop the old global constraint
DROP INDEX IF EXISTS idx_espn_leagues_one_default_per_user;

-- Create new per-sport constraint
CREATE UNIQUE INDEX idx_espn_leagues_one_default_per_user_sport
ON espn_leagues (clerk_user_id, sport)
WHERE is_default = TRUE;

-- Update comment
COMMENT ON COLUMN espn_leagues.is_default IS 'Whether this is the users default league for this sport. One default per user per sport.';

-- =============================================================================
-- 2. Yahoo: Add same constraint for consistency
-- =============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_yahoo_leagues_one_default_per_user_sport
ON yahoo_leagues (clerk_user_id, sport)
WHERE is_default = TRUE;

-- =============================================================================
-- 3. User preferences table for default sport
-- =============================================================================

CREATE TABLE IF NOT EXISTS user_preferences (
  clerk_user_id TEXT PRIMARY KEY,
  default_sport TEXT CHECK (default_sport IS NULL OR default_sport IN ('football', 'baseball', 'basketball', 'hockey')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Verification Queries
-- =============================================================================

-- Check ESPN index changed:
-- SELECT indexname FROM pg_indexes WHERE tablename = 'espn_leagues' AND indexname LIKE '%default%';

-- Check Yahoo index added:
-- SELECT indexname FROM pg_indexes WHERE tablename = 'yahoo_leagues' AND indexname LIKE '%default%';

-- Check user_preferences table:
-- SELECT table_name FROM information_schema.tables WHERE table_name = 'user_preferences';
