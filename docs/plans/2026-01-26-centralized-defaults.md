# Centralized Defaults Implementation Plan

> ✅ **COMPLETE** (2026-01-27) - All tasks completed. Extension set-default endpoint was REMOVED entirely rather than updated (Task 5, Step 4 in original plan) since default selection is now exclusively managed via web UI at `/leagues`.

**Goal:** Consolidate all user defaults (default sport + per-sport default leagues) into the `user_preferences` table, eliminating cross-platform coordination bugs and simplifying the codebase.

**Architecture:**
- Move defaults from `espn_leagues.is_default` and `yahoo_leagues.is_default` to `user_preferences` table
- Store per-sport defaults as JSONB columns: `default_football`, `default_baseball`, `default_basketball`, `default_hockey`
- Each column holds `{ platform, leagueId, seasonYear }` or NULL
- Cross-platform exclusivity is automatic (one column per sport = one value)
- All defaults are optional; users can operate with zero defaults set

**Tech Stack:** TypeScript, Next.js, Cloudflare Workers (Hono), Supabase PostgreSQL, Vitest

---

## Task 1: Database Migration - Add new columns and drop old

**Files:**
- Create: `docs/migrations/012_centralized_defaults.sql`

**Step 1: Write the migration SQL**

```sql
-- Migration: Centralized defaults in user_preferences
-- Purpose: Move defaults from league tables to user_preferences for cross-platform consistency
-- Run this in Supabase Dashboard → SQL Editor
-- Created: 2026-01-26

-- =============================================================================
-- 1. ADD NEW COLUMNS TO user_preferences
-- =============================================================================

-- Add per-sport default league columns (nullable JSONB)
-- Each stores: { "platform": "espn"|"yahoo", "leagueId": "123", "seasonYear": 2024 }
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

-- Migrate ESPN defaults to user_preferences
INSERT INTO user_preferences (clerk_user_id, default_sport, default_football, default_baseball, default_basketball, default_hockey, created_at, updated_at)
SELECT
  e.clerk_user_id,
  NULL as default_sport,
  CASE WHEN e.sport = 'football' THEN jsonb_build_object('platform', 'espn', 'leagueId', e.league_id, 'seasonYear', e.season_year) END as default_football,
  CASE WHEN e.sport = 'baseball' THEN jsonb_build_object('platform', 'espn', 'leagueId', e.league_id, 'seasonYear', e.season_year) END as default_baseball,
  CASE WHEN e.sport = 'basketball' THEN jsonb_build_object('platform', 'espn', 'leagueId', e.league_id, 'seasonYear', e.season_year) END as default_basketball,
  CASE WHEN e.sport = 'hockey' THEN jsonb_build_object('platform', 'espn', 'leagueId', e.league_id, 'seasonYear', e.season_year) END as default_hockey,
  NOW() as created_at,
  NOW() as updated_at
FROM espn_leagues e
WHERE e.is_default = TRUE
ON CONFLICT (clerk_user_id) DO UPDATE SET
  default_football = COALESCE(
    CASE WHEN (SELECT sport FROM espn_leagues WHERE clerk_user_id = EXCLUDED.clerk_user_id AND is_default = TRUE AND sport = 'football' LIMIT 1) = 'football'
    THEN EXCLUDED.default_football END,
    user_preferences.default_football
  ),
  default_baseball = COALESCE(
    CASE WHEN (SELECT sport FROM espn_leagues WHERE clerk_user_id = EXCLUDED.clerk_user_id AND is_default = TRUE AND sport = 'baseball' LIMIT 1) = 'baseball'
    THEN EXCLUDED.default_baseball END,
    user_preferences.default_baseball
  ),
  default_basketball = COALESCE(
    CASE WHEN (SELECT sport FROM espn_leagues WHERE clerk_user_id = EXCLUDED.clerk_user_id AND is_default = TRUE AND sport = 'basketball' LIMIT 1) = 'basketball'
    THEN EXCLUDED.default_basketball END,
    user_preferences.default_basketball
  ),
  default_hockey = COALESCE(
    CASE WHEN (SELECT sport FROM espn_leagues WHERE clerk_user_id = EXCLUDED.clerk_user_id AND is_default = TRUE AND sport = 'hockey' LIMIT 1) = 'hockey'
    THEN EXCLUDED.default_hockey END,
    user_preferences.default_hockey
  ),
  updated_at = NOW();

-- Migrate Yahoo defaults (override ESPN if both exist - Yahoo wins since it was set later conceptually)
UPDATE user_preferences up
SET
  default_football = CASE
    WHEN y.sport = 'football' THEN jsonb_build_object('platform', 'yahoo', 'leagueId', y.league_key, 'seasonYear', y.season_year)
    ELSE up.default_football
  END,
  default_baseball = CASE
    WHEN y.sport = 'baseball' THEN jsonb_build_object('platform', 'yahoo', 'leagueId', y.league_key, 'seasonYear', y.season_year)
    ELSE up.default_baseball
  END,
  default_basketball = CASE
    WHEN y.sport = 'basketball' THEN jsonb_build_object('platform', 'yahoo', 'leagueId', y.league_key, 'seasonYear', y.season_year)
    ELSE up.default_basketball
  END,
  default_hockey = CASE
    WHEN y.sport = 'hockey' THEN jsonb_build_object('platform', 'yahoo', 'leagueId', y.league_key, 'seasonYear', y.season_year)
    ELSE up.default_hockey
  END,
  updated_at = NOW()
FROM yahoo_leagues y
WHERE y.clerk_user_id = up.clerk_user_id AND y.is_default = TRUE;

-- Insert Yahoo defaults for users who don't have a user_preferences row yet
INSERT INTO user_preferences (clerk_user_id, default_sport, default_football, default_baseball, default_basketball, default_hockey, created_at, updated_at)
SELECT
  y.clerk_user_id,
  NULL as default_sport,
  CASE WHEN y.sport = 'football' THEN jsonb_build_object('platform', 'yahoo', 'leagueId', y.league_key, 'seasonYear', y.season_year) END,
  CASE WHEN y.sport = 'baseball' THEN jsonb_build_object('platform', 'yahoo', 'leagueId', y.league_key, 'seasonYear', y.season_year) END,
  CASE WHEN y.sport = 'basketball' THEN jsonb_build_object('platform', 'yahoo', 'leagueId', y.league_key, 'seasonYear', y.season_year) END,
  CASE WHEN y.sport = 'hockey' THEN jsonb_build_object('platform', 'yahoo', 'leagueId', y.league_key, 'seasonYear', y.season_year) END,
  NOW(),
  NOW()
FROM yahoo_leagues y
WHERE y.is_default = TRUE
AND NOT EXISTS (SELECT 1 FROM user_preferences WHERE clerk_user_id = y.clerk_user_id);

-- =============================================================================
-- 3. DROP OLD COLUMNS AND INDEXES
-- =============================================================================

-- Drop the partial unique indexes (no longer needed)
DROP INDEX IF EXISTS idx_espn_leagues_one_default_per_user_sport;
DROP INDEX IF EXISTS idx_yahoo_leagues_one_default_per_user_sport;

-- Drop the is_default columns from league tables
ALTER TABLE espn_leagues DROP COLUMN IF EXISTS is_default;
ALTER TABLE yahoo_leagues DROP COLUMN IF EXISTS is_default;

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
```

**Step 2: Run migration in Supabase Dashboard**

1. Go to Supabase Dashboard → SQL Editor
2. Paste the migration SQL
3. Run the migration
4. Run verification queries to confirm success

**Step 3: Commit**

```bash
git add docs/migrations/012_centralized_defaults.sql
git commit -m "chore: add migration for centralized defaults"
```

---

## Task 2: Update TypeScript types

**Files:**
- Modify: `workers/auth-worker/src/supabase-storage.ts` (lines 41-44)
- Modify: `workers/auth-worker/src/espn-types.ts`
- Modify: `workers/auth-worker/src/yahoo-storage.ts` (lines 63-74)

**Step 1: Update UserPreferences interface**

In `workers/auth-worker/src/supabase-storage.ts`, replace the `UserPreferences` interface (around line 41):

```typescript
export interface LeagueDefault {
  platform: 'espn' | 'yahoo';
  leagueId: string;
  seasonYear: number;
}

export interface UserPreferences {
  clerkUserId: string;
  defaultSport: 'football' | 'baseball' | 'basketball' | 'hockey' | null;
  defaultFootball: LeagueDefault | null;
  defaultBaseball: LeagueDefault | null;
  defaultBasketball: LeagueDefault | null;
  defaultHockey: LeagueDefault | null;
}
```

**Step 2: Remove isDefault from EspnLeague type**

In `workers/auth-worker/src/espn-types.ts`, find the `EspnLeague` interface and remove the `isDefault` field:

```typescript
export interface EspnLeague {
  leagueId: string;
  sport: 'football' | 'hockey' | 'baseball' | 'basketball';
  teamId?: string;
  teamName?: string;
  leagueName?: string;
  seasonYear?: number;
  // REMOVED: isDefault?: boolean;
}
```

**Step 3: Remove isDefault from YahooLeague type**

In `workers/auth-worker/src/yahoo-storage.ts`, update the `YahooLeague` interface (around line 63):

```typescript
export interface YahooLeague {
  id: string;
  clerkUserId: string;
  sport: Sport;
  seasonYear: number;
  leagueKey: string;
  leagueName: string;
  teamId?: string;
  teamKey?: string;
  teamName?: string;
  // REMOVED: isDefault: boolean;
}
```

**Step 4: Commit**

```bash
git add workers/auth-worker/src/supabase-storage.ts workers/auth-worker/src/espn-types.ts workers/auth-worker/src/yahoo-storage.ts
git commit -m "refactor: update types for centralized defaults"
```

---

## Task 3: Update storage layer - getUserPreferences and setDefaultLeague

**Files:**
- Modify: `workers/auth-worker/src/supabase-storage.ts`

**Step 1: Update getUserPreferences method**

Replace the `getUserPreferences` method (around line 657):

```typescript
  /**
   * Get user preferences including per-sport defaults
   */
  async getUserPreferences(clerkUserId: string): Promise<UserPreferences> {
    if (!clerkUserId) {
      console.log('[supabase-storage] getUserPreferences: no clerkUserId provided');
      return {
        clerkUserId: '',
        defaultSport: null,
        defaultFootball: null,
        defaultBaseball: null,
        defaultBasketball: null,
        defaultHockey: null,
      };
    }

    try {
      console.log(`[supabase-storage] getUserPreferences: fetching for user ${maskUserId(clerkUserId)}`);

      const { data, error } = await this.supabase
        .from('user_preferences')
        .select('clerk_user_id, default_sport, default_football, default_baseball, default_basketball, default_hockey')
        .eq('clerk_user_id', clerkUserId)
        .single();

      if (error || !data) {
        console.log(`[supabase-storage] getUserPreferences: no preferences found, returning defaults`);
        return {
          clerkUserId,
          defaultSport: null,
          defaultFootball: null,
          defaultBaseball: null,
          defaultBasketball: null,
          defaultHockey: null,
        };
      }

      console.log(`[supabase-storage] getUserPreferences: found defaultSport=${data.default_sport}`);

      return {
        clerkUserId: data.clerk_user_id,
        defaultSport: data.default_sport,
        defaultFootball: data.default_football as LeagueDefault | null,
        defaultBaseball: data.default_baseball as LeagueDefault | null,
        defaultBasketball: data.default_basketball as LeagueDefault | null,
        defaultHockey: data.default_hockey as LeagueDefault | null,
      };
    } catch (error) {
      console.error('[supabase-storage] getUserPreferences error:', error);
      return {
        clerkUserId,
        defaultSport: null,
        defaultFootball: null,
        defaultBaseball: null,
        defaultBasketball: null,
        defaultHockey: null,
      };
    }
  }
```

**Step 2: Replace setDefaultLeague with new implementation**

Replace the entire `setDefaultLeague` method (around line 575):

```typescript
  /**
   * Set a league as the user's default for a sport.
   * Validates the league exists and has a team selected before setting.
   * Stores the default in user_preferences (not in the league table).
   */
  async setDefaultLeague(
    clerkUserId: string,
    platform: 'espn' | 'yahoo',
    sport: 'football' | 'baseball' | 'basketball' | 'hockey',
    leagueId: string,
    seasonYear: number
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Validate the league exists and has a team_id
      if (platform === 'espn') {
        const { data: targetLeague, error: checkError } = await this.supabase
          .from('espn_leagues')
          .select('league_id, team_id')
          .eq('clerk_user_id', clerkUserId)
          .eq('league_id', leagueId)
          .eq('sport', sport)
          .eq('season_year', seasonYear)
          .single();

        if (checkError || !targetLeague) {
          console.error('ESPN league not found for default:', checkError);
          return { success: false, error: 'League not found' };
        }

        if (!targetLeague.team_id) {
          return { success: false, error: 'Cannot set default: no team selected for this league' };
        }
      }
      // Note: Yahoo validation would go here if needed

      // Build the default object
      const defaultValue: LeagueDefault = { platform, leagueId, seasonYear };
      const columnName = `default_${sport}`;

      // Upsert into user_preferences
      const { error: upsertError } = await this.supabase
        .from('user_preferences')
        .upsert(
          {
            clerk_user_id: clerkUserId,
            [columnName]: defaultValue,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'clerk_user_id' }
        );

      if (upsertError) {
        console.error('[supabase-storage] setDefaultLeague upsert error:', upsertError);
        return { success: false, error: 'Failed to set default' };
      }

      console.log(`[supabase-storage] setDefaultLeague: set ${sport} default to ${platform}:${leagueId}:${seasonYear} for user ${maskUserId(clerkUserId)}`);
      return { success: true };
    } catch (error) {
      console.error('Failed to set default league:', error);
      return { success: false, error: 'Internal error' };
    }
  }

  /**
   * Clear a user's default for a sport
   */
  async clearDefaultLeague(
    clerkUserId: string,
    sport: 'football' | 'baseball' | 'basketball' | 'hockey'
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const columnName = `default_${sport}`;

      const { error } = await this.supabase
        .from('user_preferences')
        .upsert(
          {
            clerk_user_id: clerkUserId,
            [columnName]: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'clerk_user_id' }
        );

      if (error) {
        console.error('[supabase-storage] clearDefaultLeague error:', error);
        return { success: false, error: 'Failed to clear default' };
      }

      console.log(`[supabase-storage] clearDefaultLeague: cleared ${sport} default for user ${maskUserId(clerkUserId)}`);
      return { success: true };
    } catch (error) {
      console.error('Failed to clear default league:', error);
      return { success: false, error: 'Internal error' };
    }
  }
```

**Step 3: Remove getDefaultLeague method**

Delete the old `getDefaultLeague` method (around line 348) - it's no longer needed since defaults come from `getUserPreferences`.

**Step 4: Update getLeagues to not return isDefault**

In the `getLeagues` method (around line 319), remove `is_default` from the select and mapping:

```typescript
  async getLeagues(clerkUserId: string): Promise<EspnLeague[]> {
    try {
      if (!clerkUserId) return [];

      const { data, error } = await this.supabase
        .from('espn_leagues')
        .select('league_id, sport, team_id, team_name, league_name, season_year')
        .eq('clerk_user_id', clerkUserId);

      if (error || !data) return [];

      return data.map(row => ({
        leagueId: row.league_id,
        sport: row.sport as 'football' | 'hockey' | 'baseball' | 'basketball',
        teamId: row.team_id || undefined,
        teamName: row.team_name || undefined,
        leagueName: row.league_name || undefined,
        seasonYear: row.season_year || undefined,
      }));
    } catch (error) {
      console.error('Failed to retrieve ESPN leagues:', error);
      return [];
    }
  }
```

**Step 5: Commit**

```bash
git add workers/auth-worker/src/supabase-storage.ts
git commit -m "refactor: update storage layer for centralized defaults"
```

---

## Task 4: Update Yahoo storage layer

**Files:**
- Modify: `workers/auth-worker/src/yahoo-storage.ts`

**Step 1: Remove setDefaultYahooLeague method**

Delete the entire `setDefaultYahooLeague` method (around line 363-401). Yahoo defaults will now be set through `EspnSupabaseStorage.setDefaultLeague()` with `platform: 'yahoo'`.

**Step 2: Update getYahooLeagues to not return isDefault**

Update the `getYahooLeagues` method (around line 330) to remove `is_default`:

```typescript
  async getYahooLeagues(clerkUserId: string): Promise<YahooLeague[]> {
    const { data, error } = await this.supabase
      .from('yahoo_leagues')
      .select('id, clerk_user_id, sport, season_year, league_key, league_name, team_id, team_key, team_name')
      .eq('clerk_user_id', clerkUserId);

    if (error) {
      console.error('[yahoo-storage] Failed to get Yahoo leagues:', error);
      throw new Error('Failed to get Yahoo leagues');
    }

    return (data || []).map((row) => ({
      id: row.id,
      clerkUserId: row.clerk_user_id,
      sport: row.sport as Sport,
      seasonYear: row.season_year,
      leagueKey: row.league_key,
      leagueName: row.league_name,
      teamId: row.team_id || undefined,
      teamKey: row.team_key || undefined,
      teamName: row.team_name || undefined,
    }));
  }
```

**Step 3: Commit**

```bash
git add workers/auth-worker/src/yahoo-storage.ts
git commit -m "refactor: remove isDefault from Yahoo storage"
```

---

## Task 5: Update auth-worker API endpoints

**Files:**
- Modify: `workers/auth-worker/src/index-hono.ts`

**Step 1: Update GET /user/preferences endpoint**

Update the endpoint (around line 795) to return the new shape:

```typescript
// Get user preferences
api.get('/user/preferences', async (c) => {
  const { userId, error: authError } = await getVerifiedUserId(c.req.raw, c.env);
  if (!userId) {
    return c.json({ error: 'unauthorized', error_description: authError || 'Authentication required' }, 401);
  }

  const storage = EspnSupabaseStorage.fromEnvironment(c.env);
  const preferences = await storage.getUserPreferences(userId);

  return c.json({
    defaultSport: preferences.defaultSport,
    defaultFootball: preferences.defaultFootball,
    defaultBaseball: preferences.defaultBaseball,
    defaultBasketball: preferences.defaultBasketball,
    defaultHockey: preferences.defaultHockey,
  });
});
```

**Step 2: Update POST /leagues/default endpoint**

Update the endpoint (around line 1111) to use new signature:

```typescript
// Set default league endpoint
api.post('/leagues/default', async (c) => {
  const { userId: clerkUserId, error: authError } = await getVerifiedUserId(c.req.raw, c.env);
  if (!clerkUserId) {
    return c.json({
      error: 'Authentication required',
      message: authError || 'Missing or invalid Authorization token'
    }, 401);
  }

  const body = await c.req.json() as {
    platform?: 'espn' | 'yahoo';
    leagueId?: string;
    sport?: string;
    seasonYear?: number;
  };
  const { platform, leagueId, sport, seasonYear } = body;

  if (!platform || !leagueId || !sport || seasonYear === undefined) {
    return c.json({
      error: 'platform, leagueId, sport, and seasonYear are required in request body'
    }, 400);
  }

  const validSports = ['football', 'baseball', 'basketball', 'hockey'];
  if (!validSports.includes(sport)) {
    return c.json({ error: 'Invalid sport' }, 400);
  }

  const storage = EspnSupabaseStorage.fromEnvironment(c.env);
  const result = await storage.setDefaultLeague(
    clerkUserId,
    platform,
    sport as 'football' | 'baseball' | 'basketball' | 'hockey',
    leagueId,
    seasonYear
  );

  if (!result.success) {
    const status = result.error === 'League not found' ? 404 : 400;
    return c.json({
      error: result.error || 'Failed to set default league'
    }, status);
  }

  // Return updated preferences
  const preferences = await storage.getUserPreferences(clerkUserId);

  return c.json({
    success: true,
    message: 'Default league set successfully',
    preferences: {
      defaultSport: preferences.defaultSport,
      defaultFootball: preferences.defaultFootball,
      defaultBaseball: preferences.defaultBaseball,
      defaultBasketball: preferences.defaultBasketball,
      defaultHockey: preferences.defaultHockey,
    }
  });
});
```

**Step 3: Add DELETE /leagues/default/:sport endpoint**

Add a new endpoint to clear defaults (after the POST /leagues/default endpoint):

```typescript
// Clear default league for a sport
api.delete('/leagues/default/:sport', async (c) => {
  const { userId: clerkUserId, error: authError } = await getVerifiedUserId(c.req.raw, c.env);
  if (!clerkUserId) {
    return c.json({
      error: 'Authentication required',
      message: authError || 'Missing or invalid Authorization token'
    }, 401);
  }

  const sport = c.req.param('sport');
  const validSports = ['football', 'baseball', 'basketball', 'hockey'];
  if (!validSports.includes(sport)) {
    return c.json({ error: 'Invalid sport' }, 400);
  }

  const storage = EspnSupabaseStorage.fromEnvironment(c.env);
  const result = await storage.clearDefaultLeague(
    clerkUserId,
    sport as 'football' | 'baseball' | 'basketball' | 'hockey'
  );

  if (!result.success) {
    return c.json({ error: result.error || 'Failed to clear default' }, 400);
  }

  const preferences = await storage.getUserPreferences(clerkUserId);

  return c.json({
    success: true,
    preferences: {
      defaultSport: preferences.defaultSport,
      defaultFootball: preferences.defaultFootball,
      defaultBaseball: preferences.defaultBaseball,
      defaultBasketball: preferences.defaultBasketball,
      defaultHockey: preferences.defaultHockey,
    }
  });
});
```

**Step 4: Update POST /extension/set-default endpoint**

Update the extension endpoint (around line 629):

```typescript
// Set default league (requires Clerk JWT)
api.post('/extension/set-default', async (c) => {
  const { userId, error: authError } = await getVerifiedUserId(c.req.raw, c.env);
  if (!userId) {
    return c.json({
      error: 'unauthorized',
      error_description: authError || 'Authentication required',
    }, 401);
  }

  const body = await c.req.json() as {
    platform?: 'espn' | 'yahoo';
    leagueId?: string;
    sport?: string;
    seasonYear?: number;
  };
  const { platform = 'espn', leagueId, sport, seasonYear } = body;

  if (!leagueId || !sport || seasonYear === undefined) {
    return c.json({
      error: 'invalid_request',
      error_description: 'leagueId, sport, and seasonYear are required',
    }, 400);
  }

  const validSports = ['football', 'baseball', 'basketball', 'hockey'];
  if (!validSports.includes(sport)) {
    return c.json({ error: 'invalid_sport' }, 400);
  }

  const storage = EspnSupabaseStorage.fromEnvironment(c.env);
  const result = await storage.setDefaultLeague(
    userId,
    platform,
    sport as 'football' | 'baseball' | 'basketball' | 'hockey',
    leagueId,
    seasonYear
  );

  if (!result.success) {
    return c.json({
      error: 'set_default_failed',
      error_description: result.error || 'Failed to set default league',
    }, result.error === 'League not found' ? 404 : 400);
  }

  return c.json({});
});
```

**Step 5: Remove POST /leagues/yahoo/:id/default endpoint**

Delete the Yahoo-specific default endpoint (around line 747). Yahoo defaults now go through the unified `/leagues/default` endpoint with `platform: 'yahoo'`.

**Step 6: Commit**

```bash
git add workers/auth-worker/src/index-hono.ts
git commit -m "refactor: update auth-worker endpoints for centralized defaults"
```

---

## Task 6: Update Next.js API routes

**Files:**
- Modify: `web/app/api/espn/leagues/default/route.ts`
- Modify: `web/app/api/user/preferences/route.ts`
- Delete: `web/app/api/connect/yahoo/leagues/[id]/default/route.ts`

**Step 1: Update ESPN default route to accept platform**

Replace `web/app/api/espn/leagues/default/route.ts`:

```typescript
/**
 * Default League API Route
 * ---------------------------------------------------------------------------
 * Sets a league as the user's default for a sport (works for ESPN and Yahoo).
 */

import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

export async function POST(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body: {
      platform?: 'espn' | 'yahoo';
      leagueId?: string;
      sport?: string;
      seasonYear?: number;
    } = await request.json();

    if (!body.platform || !body.leagueId || !body.sport || body.seasonYear === undefined) {
      return NextResponse.json({
        error: 'platform, leagueId, sport, and seasonYear are required in request body'
      }, { status: 400 });
    }

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_AUTH_WORKER_URL is not configured' }, { status: 500 });
    }

    const bearer = (await getToken?.()) || undefined;
    const workerResponse = await fetch(`${authWorkerUrl}/leagues/default`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(bearer ? { 'Authorization': `Bearer ${bearer}` } : {})
      },
      body: JSON.stringify(body)
    });

    const workerData = await workerResponse.json() as any;

    if (!workerResponse.ok) {
      return NextResponse.json({
        error: workerData?.error || 'Failed to set default league'
      }, { status: workerResponse.status });
    }

    return NextResponse.json(workerData, { status: 200 });

  } catch (error) {
    console.error('Default league API error:', error);
    return NextResponse.json({
      error: 'Failed to set default league'
    }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const sport = searchParams.get('sport');

    if (!sport) {
      return NextResponse.json({ error: 'sport query param is required' }, { status: 400 });
    }

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'NEXT_PUBLIC_AUTH_WORKER_URL is not configured' }, { status: 500 });
    }

    const bearer = (await getToken?.()) || undefined;
    const workerResponse = await fetch(`${authWorkerUrl}/leagues/default/${sport}`, {
      method: 'DELETE',
      headers: bearer ? { 'Authorization': `Bearer ${bearer}` } : {}
    });

    const workerData = await workerResponse.json() as any;
    return NextResponse.json(workerData, { status: workerResponse.status });

  } catch (error) {
    console.error('Clear default league API error:', error);
    return NextResponse.json({ error: 'Failed to clear default league' }, { status: 500 });
  }
}
```

**Step 2: Delete Yahoo default route**

```bash
rm web/app/api/connect/yahoo/leagues/\[id\]/default/route.ts
```

(If directory is empty after, remove it too)

**Step 3: Commit**

```bash
git add web/app/api/espn/leagues/default/route.ts
git rm web/app/api/connect/yahoo/leagues/\[id\]/default/route.ts
git commit -m "refactor: unify default league API routes"
```

---

## Task 7: Update frontend leagues page

**Files:**
- Modify: `web/app/(site)/leagues/page.tsx`

**Step 1: Update League interfaces**

Remove `isDefault` from the League and YahooLeague interfaces (around line 46-66):

```typescript
interface League {
  leagueId: string;
  sport: string;
  leagueName?: string;
  teamId?: string;
  teamName?: string;
  seasonYear?: number;
  // REMOVED: isDefault?: boolean;
}

interface YahooLeague {
  id: string;
  sport: string;
  seasonYear: number;
  leagueKey: string;
  leagueName: string;
  teamId?: string;
  teamKey?: string;
  teamName?: string;
  // REMOVED: isDefault?: boolean;
}
```

**Step 2: Add preferences state type**

Add after the interfaces (around line 82):

```typescript
interface LeagueDefault {
  platform: 'espn' | 'yahoo';
  leagueId: string;
  seasonYear: number;
}

interface UserPreferencesState {
  defaultSport: string | null;
  defaultFootball: LeagueDefault | null;
  defaultBaseball: LeagueDefault | null;
  defaultBasketball: LeagueDefault | null;
  defaultHockey: LeagueDefault | null;
}
```

**Step 3: Update state and conversion functions**

Replace the conversion functions (around line 124-150) and update state:

```typescript
// Convert ESPN leagues to unified format (isDefault computed from preferences)
function espnToUnified(leagues: League[], preferences: UserPreferencesState): UnifiedLeague[] {
  return leagues.map((l) => {
    const sportDefault = preferences[`default${capitalize(l.sport)}` as keyof UserPreferencesState] as LeagueDefault | null;
    const isDefault = sportDefault?.platform === 'espn' &&
                      sportDefault?.leagueId === l.leagueId &&
                      sportDefault?.seasonYear === l.seasonYear;
    return {
      platform: 'espn' as const,
      sport: l.sport,
      seasonYear: l.seasonYear || new Date().getFullYear(),
      leagueName: l.leagueName || `League ${l.leagueId}`,
      teamName: l.teamName,
      isDefault,
      leagueId: l.leagueId,
      teamId: l.teamId,
    };
  });
}

// Convert Yahoo leagues to unified format (isDefault computed from preferences)
function yahooToUnified(leagues: YahooLeague[], preferences: UserPreferencesState): UnifiedLeague[] {
  return leagues.map((l) => {
    const sportDefault = preferences[`default${capitalize(l.sport)}` as keyof UserPreferencesState] as LeagueDefault | null;
    const isDefault = sportDefault?.platform === 'yahoo' &&
                      sportDefault?.leagueId === l.leagueKey &&
                      sportDefault?.seasonYear === l.seasonYear;
    return {
      platform: 'yahoo' as const,
      sport: l.sport,
      seasonYear: l.seasonYear,
      leagueName: l.leagueName,
      teamName: l.teamName,
      isDefault,
      leagueId: l.leagueKey,
      teamId: l.teamId,
      yahooId: l.id,
    };
  });
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
```

**Step 4: Update component state**

In `LeaguesPageContent`, replace `defaultSport` state with full preferences (around line 175):

```typescript
  const [preferences, setPreferences] = useState<UserPreferencesState>({
    defaultSport: null,
    defaultFootball: null,
    defaultBaseball: null,
    defaultBasketball: null,
    defaultHockey: null,
  });

  // Convenience accessor
  const defaultSport = preferences.defaultSport;
```

**Step 5: Update leaguesBySport memo**

Update the memo to pass preferences to conversion functions (around line 198):

```typescript
  const leaguesBySport = useMemo(() => {
    const allLeagues = [
      ...espnToUnified(leagues, preferences),
      ...yahooToUnified(yahooLeagues, preferences),
    ];
    // ... rest stays the same
  }, [leagues, yahooLeagues, preferences]);
```

**Step 6: Update loadPreferences**

Update the preferences loading effect (around line 364):

```typescript
    const loadPreferences = async () => {
      try {
        const res = await fetch('/api/user/preferences');
        if (res.ok) {
          const data = await res.json() as UserPreferencesState;
          setPreferences({
            defaultSport: data.defaultSport || null,
            defaultFootball: data.defaultFootball || null,
            defaultBaseball: data.defaultBaseball || null,
            defaultBasketball: data.defaultBasketball || null,
            defaultHockey: data.defaultHockey || null,
          });
        }
      } catch (err) {
        console.error('Failed to load preferences:', err);
      }
    };
```

**Step 7: Update handleSetDefault**

Replace the `handleSetDefault` function (around line 544):

```typescript
  // Set default league (unified for ESPN and Yahoo)
  const handleSetDefault = async (
    platform: 'espn' | 'yahoo',
    leagueId: string,
    sport: string,
    seasonYear: number,
    yahooId?: string // For Yahoo, we need the UUID for other operations but use leagueKey for default
  ) => {
    const leagueKey = platform === 'yahoo'
      ? `yahoo:${yahooId}`
      : `${leagueId}-${sport}-${seasonYear}`;
    setSettingDefaultKey(leagueKey);
    setLeagueError(null);
    setLeagueNotice(null);

    try {
      const res = await fetch('/api/espn/leagues/default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, leagueId, sport, seasonYear }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error || 'Failed to set default league');
      }

      const data = await res.json() as { preferences?: UserPreferencesState };
      if (data.preferences) {
        setPreferences(data.preferences);
      }

      // Auto-set sport as default if no sport default exists
      if (!preferences.defaultSport) {
        await fetch('/api/user/preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ defaultSport: sport }),
        });
        setPreferences(prev => ({ ...prev, defaultSport: sport }));
      }
    } catch (err) {
      setLeagueError(err instanceof Error ? err.message : 'Failed to set default league');
    } finally {
      setSettingDefaultKey(null);
    }
  };
```

**Step 8: Remove handleSetYahooDefault**

Delete the `handleSetYahooDefault` function (around line 596-637) - it's now unified with `handleSetDefault`.

**Step 9: Update handleSetDefaultSport**

Update to use new preferences state (around line 639):

```typescript
  const handleSetDefaultSport = async (sport: string) => {
    setSettingSportDefault(sport);
    try {
      const newDefault = preferences.defaultSport === sport ? null : sport;
      const res = await fetch('/api/user/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultSport: newDefault }),
      });
      if (res.ok) {
        setPreferences(prev => ({ ...prev, defaultSport: newDefault }));
      }
    } catch (err) {
      console.error('Failed to set default sport:', err);
    } finally {
      setSettingSportDefault(null);
    }
  };
```

**Step 10: Update star button onClick handlers in the render**

Find all places where the star button calls `handleSetDefault` or `handleSetYahooDefault` and update them to use the unified signature. The star button for a season should now be:

```tsx
// For ESPN leagues:
onClick={() => handleSetDefault('espn', season.leagueId, season.sport, season.seasonYear)}

// For Yahoo leagues:
onClick={() => handleSetDefault('yahoo', season.leagueId, season.sport, season.seasonYear, season.yahooId)}
```

**Step 11: Commit**

```bash
git add web/app/(site)/leagues/page.tsx
git commit -m "refactor: update leagues page for centralized defaults"
```

---

## Task 8: Update MCP tools to read from preferences

**Files:**
- Modify: `workers/fantasy-mcp/src/mcp/tools.ts`

**Step 1: Add preferences fetch to get_user_session**

Update the `get_user_session` handler (around line 199) to fetch preferences and compute defaults from there:

```typescript
      handler: async (_args, env, authHeader, correlationId) => {
        try {
          // Fetch ESPN leagues
          const { leagues: espnLeagues, status: fetchStatus } = await fetchUserLeagues(env, authHeader, correlationId);

          if (fetchStatus === 401 || fetchStatus === 403) {
            throw new Error('AUTH_FAILED: Authentication failed');
          }

          // Fetch Yahoo leagues
          const yahooLeagues: UserLeague[] = [];
          try {
            const baseHeaders: Record<string, string> = {
              'Content-Type': 'application/json',
              ...(authHeader ? { Authorization: authHeader } : {}),
            };
            const headers = correlationId ? withCorrelationId(baseHeaders, correlationId) : baseHeaders;

            const yahooResponse = await env.AUTH_WORKER.fetch(
              new Request('https://internal/leagues/yahoo', { headers })
            );
            if (yahooResponse.ok) {
              const yahooData = (await yahooResponse.json()) as {
                leagues?: Array<{
                  sport: string;
                  leagueKey: string;
                  leagueName: string;
                  teamId?: string;
                  seasonYear: number;
                }>;
              };
              if (yahooData.leagues) {
                for (const league of yahooData.leagues) {
                  yahooLeagues.push({
                    platform: 'yahoo',
                    sport: league.sport,
                    leagueId: league.leagueKey,
                    leagueName: league.leagueName,
                    teamId: league.teamId || '',
                    seasonYear: league.seasonYear,
                  });
                }
              }
            }
          } catch (error) {
            console.error('[get_user_session] Failed to fetch Yahoo leagues:', error);
          }

          // Fetch user preferences (contains defaults)
          interface LeagueDefault {
            platform: 'espn' | 'yahoo';
            leagueId: string;
            seasonYear: number;
          }
          interface Preferences {
            defaultSport?: string | null;
            defaultFootball?: LeagueDefault | null;
            defaultBaseball?: LeagueDefault | null;
            defaultBasketball?: LeagueDefault | null;
            defaultHockey?: LeagueDefault | null;
          }
          let preferences: Preferences = {};
          try {
            const baseHeaders: Record<string, string> = {
              'Content-Type': 'application/json',
              ...(authHeader ? { Authorization: authHeader } : {}),
            };
            const headers = correlationId ? withCorrelationId(baseHeaders, correlationId) : baseHeaders;

            const prefsResponse = await env.AUTH_WORKER.fetch(
              new Request('https://internal/user/preferences', { headers })
            );
            if (prefsResponse.ok) {
              preferences = await prefsResponse.json();
            }
          } catch (error) {
            console.error('[get_user_session] Failed to fetch preferences:', error);
          }

          // Combine all leagues
          const allLeagues = [...espnLeagues, ...yahooLeagues];

          // Filter to active leagues and limit seasons (existing logic)
          const thresholdYear = getActiveThresholdYear();
          const leagueGroups = new Map<string, typeof allLeagues>();
          for (const league of allLeagues) {
            const key = league.platform === 'yahoo'
              ? `${league.platform}:${league.leagueName}`
              : `${league.platform}:${league.leagueId}`;
            if (!leagueGroups.has(key)) {
              leagueGroups.set(key, []);
            }
            leagueGroups.get(key)!.push(league);
          }

          const leagues: typeof allLeagues = [];
          for (const [, groupSeasons] of leagueGroups) {
            groupSeasons.sort((a, b) => (b.seasonYear || 0) - (a.seasonYear || 0));
            const mostRecentYear = groupSeasons[0]?.seasonYear || 0;
            if (mostRecentYear >= thresholdYear) {
              leagues.push(...groupSeasons.slice(0, 2));
            }
          }

          const hasLeagues = leagues.length > 0;
          const sportCounts = leagues.reduce(
            (acc, l) => {
              const sport = l.sport?.toLowerCase() || 'unknown';
              acc[sport] = (acc[sport] || 0) + 1;
              return acc;
            },
            {} as Record<string, number>
          );

          let sessionMessage: string;
          if (!hasLeagues) {
            sessionMessage =
              'No leagues configured. Please go to flaim.app/settings to add your fantasy platform credentials.';
          } else if (leagues.length === 1) {
            const league = leagues[0];
            sessionMessage = `Use platform="${league.platform}", sport="${league.sport}", leagueId="${league.leagueId}", teamId="${league.teamId || 'none'}", seasonYear=${league.seasonYear} for all tool calls.`;
          } else {
            sessionMessage = `User has ${leagues.length} league-seasons configured across: ${Object.entries(sportCounts)
              .map(([sport, count]) => `${count} ${sport}`)
              .join(', ')}. For historical leagues/seasons (2+ years old), use get_ancient_history. ASK which league they want to work with if unclear.`;
          }

          // Build per-sport default leagues from preferences (not from league.isDefault)
          const defaultLeagues: Record<string, (typeof leagues)[0]> = {};
          const sportDefaultMap: Record<string, LeagueDefault | null> = {
            football: preferences.defaultFootball || null,
            baseball: preferences.defaultBaseball || null,
            basketball: preferences.defaultBasketball || null,
            hockey: preferences.defaultHockey || null,
          };

          for (const [sport, defaultInfo] of Object.entries(sportDefaultMap)) {
            if (defaultInfo) {
              // Find the matching league
              const matchingLeague = leagues.find(
                (l) =>
                  l.platform === defaultInfo.platform &&
                  l.leagueId === defaultInfo.leagueId &&
                  l.seasonYear === defaultInfo.seasonYear
              );
              if (matchingLeague) {
                defaultLeagues[sport] = matchingLeague;
              }
            }
          }

          // Primary default: use default sport's league, or first available
          const primarySport = preferences.defaultSport as string | undefined;
          const defaultLeague = (primarySport && defaultLeagues[primarySport])
            || Object.values(defaultLeagues)[0]
            || leagues[0];

          return mcpSuccess({
            success: true,
            currentDate: new Date().toISOString(),
            currentSeasons: {
              football: getCurrentSeason('football'),
              baseball: getCurrentSeason('baseball'),
              basketball: getCurrentSeason('basketball'),
              hockey: getCurrentSeason('hockey'),
            },
            timezone: 'America/New_York',
            totalLeaguesFound: leagues.length,
            leaguesBySport: sportCounts,
            defaultSport: preferences.defaultSport || null,
            defaultLeague: defaultLeague
              ? {
                  platform: defaultLeague.platform,
                  sport: defaultLeague.sport,
                  leagueId: defaultLeague.leagueId,
                  teamId: defaultLeague.teamId,
                  seasonYear: defaultLeague.seasonYear,
                  leagueName: defaultLeague.leagueName,
                  teamName: defaultLeague.teamName,
                }
              : null,
            defaultLeagues: Object.fromEntries(
              Object.entries(defaultLeagues).map(([sport, league]) => [
                sport,
                {
                  platform: league.platform,
                  leagueId: league.leagueId,
                  leagueName: league.leagueName,
                  sport: league.sport,
                  seasonYear: league.seasonYear,
                  teamId: league.teamId,
                  teamName: league.teamName,
                },
              ])
            ),
            allLeagues: leagues,
            instructions: sessionMessage,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          if (message.includes('AUTH_FAILED')) {
            throw error;
          }
          return mcpError(`Failed to fetch user session: ${message}`);
        }
      },
```

**Step 2: Remove isDefault from UserLeague type**

In the same file, find the `UserLeague` interface and remove `isDefault`:

```typescript
interface UserLeague {
  platform: 'espn' | 'yahoo';
  sport: string;
  leagueId: string;
  leagueName: string;
  teamId: string;
  teamName?: string;
  seasonYear: number;
  // REMOVED: isDefault?: boolean;
}
```

**Step 3: Update fetchUserLeagues helper**

Find the `fetchUserLeagues` function and remove `isDefault` from the mapping (it no longer comes from the API):

```typescript
// In the mapping section, remove isDefault:
for (const league of data.leagues) {
  leagues.push({
    platform: 'espn',
    sport: league.sport,
    leagueId: league.leagueId,
    leagueName: league.leagueName || `League ${league.leagueId}`,
    teamId: league.teamId || '',
    teamName: league.teamName,
    seasonYear: league.seasonYear || getCurrentSeason(league.sport as SeasonSport),
    // REMOVED: isDefault: league.isDefault,
  });
}
```

**Step 4: Commit**

```bash
git add workers/fantasy-mcp/src/mcp/tools.ts
git commit -m "refactor: update MCP tools to read defaults from preferences"
```

---

## Task 9: Update tests

**Files:**
- Modify: `workers/auth-worker/src/__tests__/yahoo-storage.test.ts`
- Create: `workers/auth-worker/src/__tests__/defaults.test.ts`

**Step 1: Remove default-related tests from yahoo-storage.test.ts**

Delete any tests that test `setDefaultYahooLeague` since that method no longer exists.

**Step 2: Create new test file for centralized defaults**

Create `workers/auth-worker/src/__tests__/defaults.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EspnSupabaseStorage, LeagueDefault } from '../supabase-storage';

// Mock Supabase client
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockUpsert = vi.fn();
const mockEq = vi.fn();
const mockSingle = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: mockFrom,
  }),
}));

describe('Centralized Defaults', () => {
  let storage: EspnSupabaseStorage;

  beforeEach(() => {
    storage = new EspnSupabaseStorage({
      supabaseUrl: 'https://example.supabase.co',
      supabaseKey: 'test-key',
    });

    vi.clearAllMocks();

    // Setup chain mocking
    mockFrom.mockReturnValue({
      select: mockSelect,
      update: mockUpdate,
      upsert: mockUpsert,
    });
    mockSelect.mockReturnValue({ eq: mockEq, single: mockSingle });
    mockEq.mockReturnValue({ eq: mockEq, single: mockSingle, select: mockSelect });
    mockUpsert.mockReturnValue({ error: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('setDefaultLeague', () => {
    it('should set ESPN football default successfully', async () => {
      // Mock league exists with team_id
      mockSingle.mockResolvedValueOnce({
        data: { league_id: '123', team_id: 'team1' },
        error: null,
      });

      const result = await storage.setDefaultLeague(
        'user_123',
        'espn',
        'football',
        '123',
        2024
      );

      expect(result.success).toBe(true);
      expect(mockFrom).toHaveBeenCalledWith('espn_leagues');
      expect(mockFrom).toHaveBeenCalledWith('user_preferences');
    });

    it('should fail if league has no team selected', async () => {
      mockSingle.mockResolvedValueOnce({
        data: { league_id: '123', team_id: null },
        error: null,
      });

      const result = await storage.setDefaultLeague(
        'user_123',
        'espn',
        'football',
        '123',
        2024
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Cannot set default: no team selected for this league');
    });

    it('should fail if league not found', async () => {
      mockSingle.mockResolvedValueOnce({
        data: null,
        error: { message: 'Not found' },
      });

      const result = await storage.setDefaultLeague(
        'user_123',
        'espn',
        'football',
        '999',
        2024
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('League not found');
    });
  });

  describe('clearDefaultLeague', () => {
    it('should clear default for a sport', async () => {
      const result = await storage.clearDefaultLeague('user_123', 'football');

      expect(result.success).toBe(true);
      expect(mockFrom).toHaveBeenCalledWith('user_preferences');
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          clerk_user_id: 'user_123',
          default_football: null,
        }),
        expect.any(Object)
      );
    });
  });

  describe('getUserPreferences', () => {
    it('should return all preference fields', async () => {
      mockSingle.mockResolvedValueOnce({
        data: {
          clerk_user_id: 'user_123',
          default_sport: 'football',
          default_football: { platform: 'espn', leagueId: '123', seasonYear: 2024 },
          default_baseball: null,
          default_basketball: null,
          default_hockey: null,
        },
        error: null,
      });

      const prefs = await storage.getUserPreferences('user_123');

      expect(prefs.defaultSport).toBe('football');
      expect(prefs.defaultFootball).toEqual({
        platform: 'espn',
        leagueId: '123',
        seasonYear: 2024,
      });
      expect(prefs.defaultBaseball).toBeNull();
    });

    it('should return empty preferences if user has none', async () => {
      mockSingle.mockResolvedValueOnce({
        data: null,
        error: { message: 'Not found' },
      });

      const prefs = await storage.getUserPreferences('user_123');

      expect(prefs.defaultSport).toBeNull();
      expect(prefs.defaultFootball).toBeNull();
    });
  });
});
```

**Step 3: Run tests**

```bash
cd workers/auth-worker && npm test
```

**Step 4: Commit**

```bash
git add workers/auth-worker/src/__tests__/
git commit -m "test: add tests for centralized defaults"
```

---

## Task 10: Clean up legacy code and documentation

**Files:**
- Modify: `docs/DATABASE.md` (if exists)
- Modify: `docs/ARCHITECTURE.md`
- Delete: `docs/plans/2026-01-26-platform-agnostic-defaults.md` (superseded)
- Delete: `docs/plans/2026-01-25-default-per-sport.md` (superseded)

**Step 1: Update ARCHITECTURE.md**

Update the defaults section to reflect the new architecture:

```markdown
## User Defaults

Defaults are stored centrally in `user_preferences`:

- `default_sport` - User's preferred sport (football, baseball, etc.)
- `default_football` - Default football league: `{ platform, leagueId, seasonYear }`
- `default_baseball` - Default baseball league
- `default_basketball` - Default basketball league
- `default_hockey` - Default hockey league

Each per-sport column is nullable JSONB. Cross-platform exclusivity is automatic (one column per sport = one value).
```

**Step 2: Delete superseded plan files**

```bash
rm docs/plans/2026-01-26-platform-agnostic-defaults.md
rm docs/plans/2026-01-25-default-per-sport.md
```

**Step 3: Commit**

```bash
git add docs/
git commit -m "docs: update for centralized defaults, remove old plans"
```

---

## Task 11: Final verification and deployment

**Step 1: Run all tests**

```bash
npm run lint
npm test
```

**Step 2: Test locally**

```bash
npm run dev
```

Manual verification:
1. Load `/leagues` page
2. Set an ESPN league as default for football
3. Set a Yahoo league as default for football (should replace ESPN)
4. Refresh page - only Yahoo football should show as default
5. Set ESPN baseball as default
6. Verify both defaults show correctly
7. Clear football default via star toggle
8. Verify MCP tools return correct defaults

**Step 3: Deploy**

```bash
git push origin main
```

Monitor: `gh run list --limit 5`

**Step 4: Final commit (if needed)**

```bash
git commit -m "feat: centralized defaults - complete implementation"
```

---

## Rollback Plan

If issues appear in production:

1. **Revert the migration** - Run reverse SQL to add back `is_default` columns and restore data from `user_preferences`
2. **Revert code** - `git revert <commit-range>` for the implementation commits
3. **Redeploy** - Push to main

The migration preserves data in both directions, so rollback is safe.

---

## Summary

This plan:
1. Consolidates all defaults into `user_preferences` table
2. Removes `is_default` from `espn_leagues` and `yahoo_leagues`
3. Simplifies the API to a single `/leagues/default` endpoint
4. Updates frontend to compute defaults from preferences
5. Updates MCP tools to read from preferences
6. Cleans up legacy code and documentation

Total estimated changes: ~500 lines modified/deleted, ~300 lines added (net reduction in complexity).
