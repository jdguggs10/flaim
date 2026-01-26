# Default Per Sport Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow users to set one default league per sport (not globally) and one default sport, with stars on sport headers and league cards instead of season chips.

**Architecture:** Database constraint changes from "one default per user" to "one default per user per sport". New `user_preferences` table stores default sport. UI moves stars from season chips to sport headers and league cards. Starring a league auto-stars that sport if none set.

**Tech Stack:** PostgreSQL (Supabase), TypeScript, React, Cloudflare Workers

---

## Task 1: Database Migration

**Files:**
- Create: `docs/migrations/011_default_per_sport.sql`

**Step 1: Write the migration**

```sql
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
```

**Step 2: Run migration in Supabase Dashboard**

Run: Open Supabase Dashboard → SQL Editor → Paste and execute
Expected: All statements succeed

**Step 3: Commit**

```bash
git add docs/migrations/011_default_per_sport.sql
git commit -m "feat: add migration for default per sport"
```

---

## Task 2: User Preferences Storage

**Files:**
- Modify: `workers/auth-worker/src/supabase-storage.ts`

**Step 1: Add UserPreferences interface and methods**

Add after line 50 (after existing interfaces):

```typescript
export interface UserPreferences {
  clerkUserId: string;
  defaultSport: 'football' | 'baseball' | 'basketball' | 'hockey' | null;
}
```

Add new methods to `EspnSupabaseStorage` class (after `setDefaultLeague` around line 650):

```typescript
  /**
   * Get user preferences
   */
  async getUserPreferences(clerkUserId: string): Promise<UserPreferences> {
    const { data, error } = await this.supabase
      .from('user_preferences')
      .select('clerk_user_id, default_sport')
      .eq('clerk_user_id', clerkUserId)
      .single();

    if (error || !data) {
      return { clerkUserId, defaultSport: null };
    }

    return {
      clerkUserId: data.clerk_user_id,
      defaultSport: data.default_sport,
    };
  }

  /**
   * Set user's default sport
   */
  async setDefaultSport(
    clerkUserId: string,
    sport: 'football' | 'baseball' | 'basketball' | 'hockey' | null
  ): Promise<void> {
    const { error } = await this.supabase
      .from('user_preferences')
      .upsert(
        {
          clerk_user_id: clerkUserId,
          default_sport: sport,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'clerk_user_id' }
      );

    if (error) {
      console.error('[storage] Failed to set default sport:', error);
      throw new Error('Failed to set default sport');
    }

    console.log(`[storage] Set default sport to ${sport} for user ${clerkUserId.substring(0, 8)}...`);
  }
```

**Step 2: Run existing tests to ensure no regression**

Run: `cd workers/auth-worker && npm test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add workers/auth-worker/src/supabase-storage.ts
git commit -m "feat: add user preferences storage methods"
```

---

## Task 3: Update ESPN setDefaultLeague to scope by sport

**Files:**
- Modify: `workers/auth-worker/src/supabase-storage.ts:603-613`

**Step 1: Change the clear operation to scope by sport**

Find this code around line 603-613:

```typescript
    // Clear any existing default for this user
    const { error: clearError } = await this.supabase
      .from('espn_leagues')
      .update({ is_default: false })
      .eq('clerk_user_id', clerkUserId);
```

Replace with:

```typescript
    // Clear any existing default for this user IN THIS SPORT ONLY
    const { error: clearError } = await this.supabase
      .from('espn_leagues')
      .update({ is_default: false })
      .eq('clerk_user_id', clerkUserId)
      .eq('sport', sport);
```

**Step 2: Run tests**

Run: `cd workers/auth-worker && npm test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add workers/auth-worker/src/supabase-storage.ts
git commit -m "feat: scope ESPN default clearing to same sport"
```

---

## Task 4: Update Yahoo setDefaultYahooLeague to scope by sport

**Files:**
- Modify: `workers/auth-worker/src/yahoo-storage.ts:363-387`

**Step 1: Update function to get league's sport first, then scope clear**

Replace the `setDefaultYahooLeague` function:

```typescript
  /**
   * Set a league as the default for a user
   * Clears any existing default FOR THE SAME SPORT first
   */
  async setDefaultYahooLeague(clerkUserId: string, leagueId: string): Promise<void> {
    // First, get the league to find its sport
    const { data: league, error: fetchError } = await this.supabase
      .from('yahoo_leagues')
      .select('sport')
      .eq('id', leagueId)
      .single();

    if (fetchError || !league) {
      console.error('[yahoo-storage] Failed to find Yahoo league:', fetchError);
      throw new Error('League not found');
    }

    // Clear existing defaults for this user IN THIS SPORT ONLY
    const { error: clearError } = await this.supabase
      .from('yahoo_leagues')
      .update({ is_default: false })
      .eq('clerk_user_id', clerkUserId)
      .eq('sport', league.sport);

    if (clearError) {
      console.error('[yahoo-storage] Failed to clear default Yahoo league:', clearError);
      throw new Error('Failed to clear default Yahoo league');
    }

    // Set new default
    const { error: setError } = await this.supabase
      .from('yahoo_leagues')
      .update({ is_default: true })
      .eq('id', leagueId);

    if (setError) {
      console.error('[yahoo-storage] Failed to set default Yahoo league:', setError);
      throw new Error('Failed to set default Yahoo league');
    }

    console.log(`[yahoo-storage] Set default Yahoo league ${leagueId} for user ${clerkUserId.substring(0, 8)}...`);
  }
```

**Step 2: Run tests**

Run: `cd workers/auth-worker && npm test`
Expected: All tests pass

**Step 3: Commit**

```bash
git add workers/auth-worker/src/yahoo-storage.ts
git commit -m "feat: scope Yahoo default clearing to same sport"
```

---

## Task 5: Add API routes for user preferences

**Files:**
- Create: `web/app/api/user/preferences/route.ts`
- Modify: `workers/auth-worker/src/index-hono.ts`

**Step 1: Add auth-worker routes**

Add to `workers/auth-worker/src/index-hono.ts` (after the Yahoo routes, around line 770):

```typescript
// =============================================================================
// USER PREFERENCES ROUTES
// =============================================================================

// Get user preferences
api.get('/user/preferences', async (c) => {
  const { userId, error: authError } = await getVerifiedUserId(c.req.raw, c.env);
  if (!userId) {
    return c.json({ error: 'unauthorized', error_description: authError || 'Authentication required' }, 401);
  }

  const storage = new EspnSupabaseStorage(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);
  const preferences = await storage.getUserPreferences(userId);
  return c.json(preferences);
});

// Set default sport
api.post('/user/preferences/default-sport', async (c) => {
  const { userId, error: authError } = await getVerifiedUserId(c.req.raw, c.env);
  if (!userId) {
    return c.json({ error: 'unauthorized', error_description: authError || 'Authentication required' }, 401);
  }

  const body = await c.req.json() as { sport: string | null };
  const validSports = ['football', 'baseball', 'basketball', 'hockey', null];

  if (!validSports.includes(body.sport)) {
    return c.json({ error: 'invalid_sport', error_description: 'Sport must be football, baseball, basketball, hockey, or null' }, 400);
  }

  const storage = new EspnSupabaseStorage(c.env.SUPABASE_URL, c.env.SUPABASE_SERVICE_KEY);
  await storage.setDefaultSport(userId, body.sport as any);

  const preferences = await storage.getUserPreferences(userId);
  return c.json(preferences);
});
```

**Step 2: Create Next.js API route**

Create `web/app/api/user/preferences/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * GET /api/user/preferences
 * Get user preferences including default sport
 */
export async function GET() {
  try {
    const { userId, getToken } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'AUTH_WORKER_URL not configured' }, { status: 500 });
    }

    const bearer = (await getToken?.()) || undefined;
    const res = await fetch(`${authWorkerUrl}/user/preferences`, {
      headers: bearer ? { Authorization: `Bearer ${bearer}` } : {},
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error('User preferences GET error:', error);
    return NextResponse.json({ error: 'Failed to get preferences' }, { status: 500 });
  }
}

/**
 * POST /api/user/preferences
 * Update user preferences (default sport)
 */
export async function POST(request: NextRequest) {
  try {
    const { userId, getToken } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json() as { defaultSport?: string | null };

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'AUTH_WORKER_URL not configured' }, { status: 500 });
    }

    const bearer = (await getToken?.()) || undefined;
    const res = await fetch(`${authWorkerUrl}/user/preferences/default-sport`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify({ sport: body.defaultSport }),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (error) {
    console.error('User preferences POST error:', error);
    return NextResponse.json({ error: 'Failed to update preferences' }, { status: 500 });
  }
}
```

**Step 3: Deploy auth-worker and test**

Run: `cd workers/auth-worker && npm run deploy`
Expected: Deployment succeeds

**Step 4: Commit**

```bash
git add workers/auth-worker/src/index-hono.ts web/app/api/user/preferences/route.ts
git commit -m "feat: add user preferences API routes"
```

---

## Task 6: Update Leagues Page UI - Move stars to league level

**Files:**
- Modify: `web/app/(site)/leagues/page.tsx`

**Step 1: Add state for default sport**

Add after line 173 (after `isDiscoveringYahoo` state):

```typescript
  const [defaultSport, setDefaultSport] = useState<string | null>(null);
  const [settingSportDefault, setSettingSportDefault] = useState<string | null>(null);
```

**Step 2: Fetch user preferences on mount**

Add to the useEffect that runs on mount (around line 346, inside the `if (!isSignedIn) return;` block):

```typescript
    // Fetch user preferences
    const loadPreferences = async () => {
      try {
        const res = await fetch('/api/user/preferences');
        if (res.ok) {
          const data = await res.json() as { defaultSport?: string | null };
          setDefaultSport(data.defaultSport || null);
        }
      } catch (err) {
        console.error('Failed to load preferences:', err);
      }
    };
    loadPreferences();
```

**Step 3: Add handler for setting default sport**

Add after `handleSetYahooDefault` (around line 567):

```typescript
  // Set default sport
  const handleSetDefaultSport = async (sport: string) => {
    setSettingSportDefault(sport);
    try {
      const newDefault = defaultSport === sport ? null : sport; // Toggle off if already default
      const res = await fetch('/api/user/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultSport: newDefault }),
      });
      if (res.ok) {
        setDefaultSport(newDefault);
      }
    } catch (err) {
      console.error('Failed to set default sport:', err);
    } finally {
      setSettingSportDefault(null);
    }
  };
```

**Step 4: Update handleSetDefault to auto-set sport default**

Modify `handleSetDefault` (around line 507) to auto-set the sport if none is set. Add at the end of the try block, before the catch:

```typescript
      // Auto-set sport as default if no sport default exists
      if (!defaultSport) {
        await fetch('/api/user/preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ defaultSport: sport }),
        });
        setDefaultSport(sport);
      }
```

**Step 5: Do the same for handleSetYahooDefault**

Get the sport from the league first, then auto-set. Modify `handleSetYahooDefault` (around line 543):

```typescript
  // Set default Yahoo league
  const handleSetYahooDefault = async (yahooId: string, sport: string) => {
    setSettingDefaultKey(`yahoo:${yahooId}`);
    setLeagueError(null);
    setLeagueNotice(null);

    try {
      const res = await fetch(`/api/connect/yahoo/leagues/${yahooId}/default`, {
        method: 'POST',
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error || 'Failed to set default league');
      }

      const data = await res.json() as { leagues?: YahooLeague[] };
      if (data.leagues) {
        setYahooLeagues(data.leagues);
      }

      // Auto-set sport as default if no sport default exists
      if (!defaultSport) {
        await fetch('/api/user/preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ defaultSport: sport }),
        });
        setDefaultSport(sport);
      }
    } catch (err) {
      setLeagueError(err instanceof Error ? err.message : 'Failed to set default league');
    } finally {
      setSettingDefaultKey(null);
    }
  };
```

**Step 6: Commit partial progress**

```bash
git add web/app/(site)/leagues/page.tsx
git commit -m "feat: add default sport state and handlers"
```

---

## Task 7: Update Leagues Page UI - Sport header stars

**Files:**
- Modify: `web/app/(site)/leagues/page.tsx`

**Step 1: Update sport header rendering**

Find the sport header section (around line 782-786):

```typescript
                    {/* Sport Header */}
                    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <span className="text-base">{getSportEmoji(sport)}</span>
                      <span className="capitalize">{sport}</span>
                    </div>
```

Replace with:

```typescript
                    {/* Sport Header with Default Star */}
                    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <span className="text-base">{getSportEmoji(sport)}</span>
                      <span className="capitalize">{sport}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`h-6 w-6 ${
                          defaultSport === sport
                            ? 'text-yellow-500'
                            : 'text-muted-foreground hover:text-yellow-500'
                        }`}
                        onClick={() => handleSetDefaultSport(sport)}
                        disabled={settingSportDefault === sport}
                        title={defaultSport === sport ? 'Default sport' : 'Set as default sport'}
                      >
                        {settingSportDefault === sport ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Star className={`h-3 w-3 ${defaultSport === sport ? 'fill-current' : ''}`} />
                        )}
                      </Button>
                    </div>
```

**Step 2: Verify lint passes**

Run: `npm run lint`
Expected: No errors (warnings OK)

**Step 3: Commit**

```bash
git add web/app/(site)/leagues/page.tsx
git commit -m "feat: add star icon to sport headers"
```

---

## Task 8: Update Leagues Page UI - League card stars

**Files:**
- Modify: `web/app/(site)/leagues/page.tsx`

**Step 1: Add star to league card header**

Find the league group header (around line 804-816). Update to add a star button. The current code is:

```typescript
                            {/* Group Header */}
                            <div className="flex items-center justify-between gap-3 p-3 border-b">
                              <div className="min-w-0">
                                <div className="font-medium break-words">
                                  {group.leagueName || `League ${group.leagueId}`}
                                </div>
                                <div className="text-xs text-muted-foreground break-words">
                                  {group.platform === 'espn' ? 'ESPN' : 'Yahoo'}
                                  {` • League ID: ${group.leagueId}`}
                                  {primaryTeamId && ` • Team ID: ${primaryTeamId}`}
                                </div>
                              </div>
```

Replace with:

```typescript
                            {/* Group Header */}
                            <div className="flex items-center justify-between gap-3 p-3 border-b">
                              <div className="min-w-0 flex items-center gap-2">
                                <div>
                                  <div className="font-medium break-words">
                                    {group.leagueName || `League ${group.leagueId}`}
                                  </div>
                                  <div className="text-xs text-muted-foreground break-words">
                                    {group.platform === 'espn' ? 'ESPN' : 'Yahoo'}
                                    {` • League ID: ${group.leagueId}`}
                                    {primaryTeamId && ` • Team ID: ${primaryTeamId}`}
                                  </div>
                                </div>
                                {(() => {
                                  const mostRecentSeason = group.seasons[0];
                                  const isLeagueDefault = mostRecentSeason?.isDefault;
                                  const leagueKey = group.platform === 'espn'
                                    ? `${mostRecentSeason?.leagueId}-${mostRecentSeason?.sport}-${mostRecentSeason?.seasonYear || 'all'}`
                                    : `yahoo:${mostRecentSeason?.yahooId}`;
                                  const isSettingThis = settingDefaultKey === leagueKey;

                                  return (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className={`h-7 w-7 shrink-0 ${
                                        isLeagueDefault
                                          ? 'text-yellow-500'
                                          : 'text-muted-foreground hover:text-yellow-500'
                                      }`}
                                      onClick={() => {
                                        if (group.platform === 'espn') {
                                          handleSetDefault(
                                            mostRecentSeason.leagueId,
                                            mostRecentSeason.sport,
                                            mostRecentSeason.seasonYear
                                          );
                                        } else if (mostRecentSeason?.yahooId) {
                                          handleSetYahooDefault(mostRecentSeason.yahooId, mostRecentSeason.sport);
                                        }
                                      }}
                                      disabled={isSettingThis || isLeagueDefault || !mostRecentSeason?.teamId}
                                      title={
                                        !mostRecentSeason?.teamId
                                          ? 'No team selected'
                                          : isLeagueDefault
                                          ? 'Default league for this sport'
                                          : 'Set as default for this sport'
                                      }
                                    >
                                      {isSettingThis ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <Star className={`h-4 w-4 ${isLeagueDefault ? 'fill-current' : ''}`} />
                                      )}
                                    </Button>
                                  );
                                })()}
                              </div>
```

**Step 2: Remove stars from season chips**

Find the season chip star button (around line 877-906) and remove the entire Button component for the star. The season chips should just show year + team name, no star.

Find this block inside the season chip map:

```typescript
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className={`h-6 w-6 ${
                                          season.isDefault
                                            ? 'text-yellow-500'
                                            : 'text-muted-foreground hover:text-yellow-500'
                                        }`}
                                        onClick={() => {
                                          // ... handler code
                                        }}
                                        disabled={isSettingDefault || season.isDefault || !season.teamId}
                                        title={/* ... */}
                                      >
                                        {/* ... star icon */}
                                      </Button>
```

Remove this entire Button block. The season chip should just contain the year, default badge (if default), and team name.

**Step 3: Run lint and verify**

Run: `npm run lint`
Expected: No errors

**Step 4: Commit**

```bash
git add web/app/(site)/leagues/page.tsx
git commit -m "feat: move stars to league cards, remove from season chips"
```

---

## Task 9: Update MCP get_user_session tool

**Files:**
- Modify: `workers/fantasy-mcp/src/mcp/tools.ts:266-291`

**Step 1: Update to return per-sport defaults**

Find the default league logic (around line 266):

```typescript
  const defaultLeague = leagues.find((l) => l.isDefault) || leagues[0];
```

Replace the entire default league section with:

```typescript
  // Build per-sport default leagues map
  const defaultLeagues: Record<string, typeof leagues[0]> = {};
  for (const league of leagues) {
    if (league.isDefault) {
      defaultLeagues[league.sport] = league;
    }
  }

  // Get user's default sport preference
  // Note: This would need an additional API call to get preferences
  // For now, infer from time of year or use first default found
  const defaultLeague = Object.values(defaultLeagues)[0] || leagues[0];
```

**Step 2: Update the response to include defaultLeagues**

Find where `defaultLeague` is added to the response (around line 281-291) and also add `defaultLeagues`:

```typescript
        defaultLeague: defaultLeague ? {
          leagueId: defaultLeague.leagueId,
          leagueName: defaultLeague.leagueName,
          sport: defaultLeague.sport,
          seasonYear: defaultLeague.seasonYear,
          teamId: defaultLeague.teamId,
          teamName: defaultLeague.teamName,
        } : null,
        defaultLeagues: Object.fromEntries(
          Object.entries(defaultLeagues).map(([sport, league]) => [
            sport,
            {
              leagueId: league.leagueId,
              leagueName: league.leagueName,
              sport: league.sport,
              seasonYear: league.seasonYear,
              teamId: league.teamId,
              teamName: league.teamName,
            }
          ])
        ),
```

**Step 3: Deploy MCP worker**

Run: `cd workers/fantasy-mcp && npm run deploy`
Expected: Deployment succeeds

**Step 4: Commit**

```bash
git add workers/fantasy-mcp/src/mcp/tools.ts
git commit -m "feat: return per-sport default leagues in get_user_session"
```

---

## Task 10: Test end-to-end

**Step 1: Run all tests**

Run: `npm run lint && cd workers/auth-worker && npm test`
Expected: All pass

**Step 2: Manual testing checklist**

1. Open leagues page
2. Verify stars appear next to sport headers
3. Verify stars appear on league cards (not season chips)
4. Click star on a league → should fill star AND fill sport star if none set
5. Click star on a different league in same sport → first should unfill, second should fill
6. Click star on sport header → should toggle sport default
7. Verify multiple sports can each have their own default league

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete default per sport implementation"
git push
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Database migration - per-sport index + user_preferences table |
| 2 | User preferences storage methods |
| 3 | ESPN setDefaultLeague scoped to sport |
| 4 | Yahoo setDefaultYahooLeague scoped to sport |
| 5 | API routes for user preferences |
| 6 | Leagues page state and handlers |
| 7 | Sport header stars |
| 8 | League card stars (remove from season chips) |
| 9 | MCP tool returns per-sport defaults |
| 10 | End-to-end testing |
