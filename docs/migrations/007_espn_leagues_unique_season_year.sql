-- Migration: Update espn_leagues unique constraint to include season_year
-- Run this in Supabase Dashboard → SQL Editor
-- Created: 2026-01-05
-- Status: ⏳ PENDING
--
-- Why:
-- Current unique constraint is (clerk_user_id, league_id, sport), which blocks
-- storing multiple seasons for the same league. We need season_year in the
-- uniqueness key.

-- 1) Drop the old unique constraint (created by initial table definition)
ALTER TABLE espn_leagues
  DROP CONSTRAINT IF EXISTS espn_leagues_clerk_user_id_league_id_sport_key;

-- 2) Add a new unique index including season_year
-- Use COALESCE to prevent multiple NULL season_year rows for the same league
CREATE UNIQUE INDEX IF NOT EXISTS idx_espn_leagues_user_league_sport_season_unique
ON espn_leagues (
  clerk_user_id,
  league_id,
  sport,
  COALESCE(season_year, -1)
);

COMMENT ON INDEX idx_espn_leagues_user_league_sport_season_unique
IS 'Uniqueness per user/league/sport/season (null season_year treated as -1)';
