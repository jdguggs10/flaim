-- Migration: Add is_default column to espn_leagues
-- Purpose: Track which league is the user's default for chat app
-- Constraint: Only one default league per user across all sports (partial unique index)
-- Idempotent: Safe to run multiple times

-- Add column if it doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'espn_leagues' AND column_name = 'is_default'
  ) THEN
    ALTER TABLE espn_leagues ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;
END $$;

-- Ensure only one default per user using a partial unique index
-- This allows multiple FALSE values but only one TRUE per clerk_user_id
CREATE UNIQUE INDEX IF NOT EXISTS idx_espn_leagues_one_default_per_user
ON espn_leagues (clerk_user_id)
WHERE is_default = TRUE;

-- Comment for documentation
COMMENT ON COLUMN espn_leagues.is_default IS 'Whether this is the users default league for the chat app. Only one per user across all sports.';
