-- Migration: Add client_name column to oauth_tokens
-- Purpose: Track which AI platform (Claude, ChatGPT, etc.) created each connection
-- Run this in Supabase SQL Editor

-- Add client_name column to oauth_tokens
ALTER TABLE oauth_tokens
ADD COLUMN IF NOT EXISTS client_name TEXT;

-- Add comment explaining the column
COMMENT ON COLUMN oauth_tokens.client_name IS 'AI platform name derived from redirect_uri (e.g., Claude, ChatGPT)';

-- Backfill existing tokens based on resource field (best effort)
-- New tokens will have client_name set properly from redirect_uri
UPDATE oauth_tokens
SET client_name = 'MCP Client'
WHERE client_name IS NULL;
