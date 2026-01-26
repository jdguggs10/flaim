-- Migration: Add team_name to yahoo_leagues
-- Purpose: Store the user's team name for display in the UI
-- Run this in Supabase Dashboard → SQL Editor
-- Created: 2026-01-26

ALTER TABLE yahoo_leagues ADD COLUMN IF NOT EXISTS team_name TEXT;

-- Verification:
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'yahoo_leagues' AND column_name = 'team_name';
