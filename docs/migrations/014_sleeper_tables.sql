-- Sleeper connections (user identity, no credentials needed)
CREATE TABLE sleeper_connections (
  clerk_user_id TEXT PRIMARY KEY,
  sleeper_user_id TEXT NOT NULL,
  sleeper_username TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE sleeper_connections ENABLE ROW LEVEL SECURITY;

-- Sleeper leagues
CREATE TABLE sleeper_leagues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  clerk_user_id TEXT NOT NULL,
  league_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  season_year INTEGER NOT NULL,
  league_name TEXT NOT NULL,
  roster_id INTEGER,
  sleeper_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT sleeper_leagues_unique
    UNIQUE (clerk_user_id, league_id, season_year)
);

ALTER TABLE sleeper_leagues ENABLE ROW LEVEL SECURITY;

-- Index for league lookups by user
CREATE INDEX idx_sleeper_leagues_user ON sleeper_leagues(clerk_user_id);
