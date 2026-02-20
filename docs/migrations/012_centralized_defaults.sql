-- Migration: Centralized defaults in user_preferences
-- Purpose: Move defaults from league tables to user_preferences for cross-platform consistency
-- Run this in Supabase Dashboard → SQL Editor
-- Created: 2026-01-26

BEGIN;

-- =============================================================================
-- 1. ADD NEW COLUMNS TO user_preferences
-- =============================================================================

-- Add per-sport default league columns (nullable JSONB)
-- Each stores: { "platform": "espn"|"yahoo"|"sleeper", "leagueId": "123", "seasonYear": 2024 }
ALTER TABLE user_preferences
ADD COLUMN IF NOT EXISTS default_football JSONB,
ADD COLUMN IF NOT EXISTS default_baseball JSONB,
ADD COLUMN IF NOT EXISTS default_basketball JSONB,
ADD COLUMN IF NOT EXISTS default_hockey JSONB;

-- Add comments for documentation
COMMENT ON COLUMN user_preferences.default_football IS 'Default football league: { platform, leagueId, seasonYear } or null';
COMMENT ON COLUMN user_preferences.default_baseball IS 'Default baseball league: { platform, leagueId, seasonYear } or null';
COMMENT ON COLUMN user_preferences.default_basketball IS 'Default basketball league: { platform, leagueId, seasonYear } or null';
COMMENT ON COLUMN user_preferences.default_hockey IS 'Default hockey league: { platform, leagueId, seasonYear } or null';

-- =============================================================================
-- 2. MIGRATE EXISTING DEFAULTS FROM LEAGUE TABLES
-- =============================================================================

-- Migrate one sport at a time to avoid JSONB aggregation issues
-- ESPN Football defaults
INSERT INTO user_preferences (clerk_user_id, default_football, created_at, updated_at)
SELECT clerk_user_id, jsonb_build_object('platform', 'espn', 'leagueId', league_id, 'seasonYear', season_year), NOW(), NOW()
FROM espn_leagues WHERE is_default = TRUE AND sport = 'football'
ON CONFLICT (clerk_user_id) DO UPDATE SET default_football = EXCLUDED.default_football, updated_at = NOW();

-- ESPN Baseball defaults
INSERT INTO user_preferences (clerk_user_id, default_baseball, created_at, updated_at)
SELECT clerk_user_id, jsonb_build_object('platform', 'espn', 'leagueId', league_id, 'seasonYear', season_year), NOW(), NOW()
FROM espn_leagues WHERE is_default = TRUE AND sport = 'baseball'
ON CONFLICT (clerk_user_id) DO UPDATE SET default_baseball = EXCLUDED.default_baseball, updated_at = NOW();

-- ESPN Basketball defaults
INSERT INTO user_preferences (clerk_user_id, default_basketball, created_at, updated_at)
SELECT clerk_user_id, jsonb_build_object('platform', 'espn', 'leagueId', league_id, 'seasonYear', season_year), NOW(), NOW()
FROM espn_leagues WHERE is_default = TRUE AND sport = 'basketball'
ON CONFLICT (clerk_user_id) DO UPDATE SET default_basketball = EXCLUDED.default_basketball, updated_at = NOW();

-- ESPN Hockey defaults
INSERT INTO user_preferences (clerk_user_id, default_hockey, created_at, updated_at)
SELECT clerk_user_id, jsonb_build_object('platform', 'espn', 'leagueId', league_id, 'seasonYear', season_year), NOW(), NOW()
FROM espn_leagues WHERE is_default = TRUE AND sport = 'hockey'
ON CONFLICT (clerk_user_id) DO UPDATE SET default_hockey = EXCLUDED.default_hockey, updated_at = NOW();

-- Yahoo defaults (override ESPN if both exist for same sport)
-- NOTE: If a user has defaults in BOTH ESPN and Yahoo for the same sport, Yahoo wins.
-- This is arbitrary since we don't have timestamps to determine which was set most recently.
-- Going forward, the new centralized system handles this correctly: the last selection always wins.

-- Yahoo Football defaults
INSERT INTO user_preferences (clerk_user_id, default_football, created_at, updated_at)
SELECT clerk_user_id, jsonb_build_object('platform', 'yahoo', 'leagueId', league_key, 'seasonYear', season_year), NOW(), NOW()
FROM yahoo_leagues WHERE is_default = TRUE AND sport = 'football'
ON CONFLICT (clerk_user_id) DO UPDATE SET default_football = EXCLUDED.default_football, updated_at = NOW();

-- Yahoo Baseball defaults
INSERT INTO user_preferences (clerk_user_id, default_baseball, created_at, updated_at)
SELECT clerk_user_id, jsonb_build_object('platform', 'yahoo', 'leagueId', league_key, 'seasonYear', season_year), NOW(), NOW()
FROM yahoo_leagues WHERE is_default = TRUE AND sport = 'baseball'
ON CONFLICT (clerk_user_id) DO UPDATE SET default_baseball = EXCLUDED.default_baseball, updated_at = NOW();

-- Yahoo Basketball defaults
INSERT INTO user_preferences (clerk_user_id, default_basketball, created_at, updated_at)
SELECT clerk_user_id, jsonb_build_object('platform', 'yahoo', 'leagueId', league_key, 'seasonYear', season_year), NOW(), NOW()
FROM yahoo_leagues WHERE is_default = TRUE AND sport = 'basketball'
ON CONFLICT (clerk_user_id) DO UPDATE SET default_basketball = EXCLUDED.default_basketball, updated_at = NOW();

-- Yahoo Hockey defaults
INSERT INTO user_preferences (clerk_user_id, default_hockey, created_at, updated_at)
SELECT clerk_user_id, jsonb_build_object('platform', 'yahoo', 'leagueId', league_key, 'seasonYear', season_year), NOW(), NOW()
FROM yahoo_leagues WHERE is_default = TRUE AND sport = 'hockey'
ON CONFLICT (clerk_user_id) DO UPDATE SET default_hockey = EXCLUDED.default_hockey, updated_at = NOW();

-- =============================================================================
-- 3. DROP OLD COLUMNS AND INDEXES
-- =============================================================================

-- Drop the partial unique indexes (no longer needed)
DROP INDEX IF EXISTS idx_espn_leagues_one_default_per_user_sport;
DROP INDEX IF EXISTS idx_yahoo_leagues_one_default_per_user_sport;

-- Drop the is_default columns from league tables
ALTER TABLE espn_leagues DROP COLUMN IF EXISTS is_default;
ALTER TABLE yahoo_leagues DROP COLUMN IF EXISTS is_default;

COMMIT;

-- =============================================================================
-- VERIFICATION QUERIES (run manually after migration)
-- =============================================================================

-- Check new columns exist:
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_name = 'user_preferences' AND column_name LIKE 'default_%';

-- Check defaults were migrated:
-- SELECT clerk_user_id, default_sport, default_football, default_baseball FROM user_preferences
-- WHERE default_football IS NOT NULL OR default_baseball IS NOT NULL;

-- Check is_default columns are gone:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'espn_leagues' AND column_name = 'is_default';
-- (should return 0 rows)
