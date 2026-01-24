-- Migration: Yahoo Fantasy Platform Support
-- Purpose: Store Yahoo OAuth credentials and discovered leagues
-- Run this in Supabase Dashboard → SQL Editor
-- Created: 2026-01-24
-- Status: ⏳ PENDING

-- =============================================================================
-- yahoo_credentials: OAuth tokens for Yahoo Fantasy API access
-- =============================================================================

CREATE TABLE IF NOT EXISTS yahoo_credentials (
  clerk_user_id TEXT PRIMARY KEY,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  yahoo_guid TEXT,  -- Optional stable Yahoo user ID
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for expiry checks during token refresh
CREATE INDEX IF NOT EXISTS idx_yahoo_credentials_expires_at ON yahoo_credentials(expires_at);

-- =============================================================================
-- yahoo_leagues: Discovered Yahoo Fantasy leagues
-- =============================================================================

CREATE TABLE IF NOT EXISTS yahoo_leagues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  sport TEXT NOT NULL CHECK (sport IN ('football', 'baseball', 'basketball', 'hockey')),
  season_year INTEGER NOT NULL,
  league_key TEXT NOT NULL,  -- Full Yahoo key e.g., "nfl.l.12345"
  league_name TEXT NOT NULL,
  team_id TEXT,              -- User's team number in this league
  team_key TEXT,             -- Full Yahoo team key e.g., "nfl.l.12345.t.3"
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint: one entry per user+league+season
  CONSTRAINT yahoo_leagues_unique_user_league_season
    UNIQUE (clerk_user_id, league_key, season_year)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_yahoo_leagues_user_id ON yahoo_leagues(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_yahoo_leagues_sport ON yahoo_leagues(sport);
CREATE INDEX IF NOT EXISTS idx_yahoo_leagues_season ON yahoo_leagues(season_year);

-- =============================================================================
-- platform_oauth_states: CSRF protection for platform OAuth flows
-- Separate from oauth_states (which is for MCP OAuth)
-- =============================================================================

CREATE TABLE IF NOT EXISTS platform_oauth_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL CHECK (platform IN ('yahoo', 'sleeper', 'cbs')),
  clerk_user_id TEXT NOT NULL,
  redirect_after TEXT,  -- Where to redirect user after OAuth completes
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_oauth_states_state ON platform_oauth_states(state);
CREATE INDEX IF NOT EXISTS idx_platform_oauth_states_expires_at ON platform_oauth_states(expires_at);

-- Cleanup function
CREATE OR REPLACE FUNCTION cleanup_expired_platform_oauth_states()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM platform_oauth_states
  WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- Enable RLS (service role bypasses)
-- =============================================================================

ALTER TABLE yahoo_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE yahoo_leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_oauth_states ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Verification Queries
-- =============================================================================

-- Check tables exist:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name LIKE 'yahoo_%';

-- Check platform_oauth_states:
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public' AND table_name = 'platform_oauth_states';
