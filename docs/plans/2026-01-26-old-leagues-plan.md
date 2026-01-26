# Old Leagues / Ancient History Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce MCP token usage by hiding old leagues/seasons, while keeping them accessible via a new `get_ancient_history` tool.

**Architecture:** Filter `get_user_session` to only return active leagues (season within 2 years) with last 2 seasons each. Add `get_ancient_history` tool for historical data. Frontend adds collapsible "Old Leagues" section with muted styling.

**Tech Stack:** TypeScript, React, Cloudflare Workers

---

## Task 1: Add helper function to determine current year threshold

**Files:**
- Modify: `workers/fantasy-mcp/src/mcp/tools.ts`

**Step 1: Add helper function after imports (around line 30)**

```typescript
/**
 * Get the threshold year for "active" leagues.
 * A league is active if it has a season >= this year.
 */
function getActiveThresholdYear(): number {
  return new Date().getFullYear() - 2;
}
```

**Step 2: Commit**

```bash
git add workers/fantasy-mcp/src/mcp/tools.ts
git commit -m "feat: add getActiveThresholdYear helper for old leagues filtering"
```

---

## Task 2: Filter get_user_session to active leagues with 2 seasons

**Files:**
- Modify: `workers/fantasy-mcp/src/mcp/tools.ts:240-315`

**Step 1: Replace the league combining and filtering logic**

Find line 240-241:
```typescript
          // Combine all leagues
          const leagues = [...espnLeagues, ...yahooLeagues];
```

Replace with:
```typescript
          // Combine all leagues
          const allLeagues = [...espnLeagues, ...yahooLeagues];

          // Filter to active leagues (have a season within 2 years) and limit to 2 most recent seasons
          const thresholdYear = getActiveThresholdYear();

          // Group leagues by unique league identifier
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

          // Filter to active leagues and limit seasons
          const leagues: typeof allLeagues = [];
          for (const [, groupSeasons] of leagueGroups) {
            // Sort by seasonYear descending
            groupSeasons.sort((a, b) => b.seasonYear - a.seasonYear);
            const mostRecentYear = groupSeasons[0]?.seasonYear || 0;

            // Only include if most recent season is within threshold
            if (mostRecentYear >= thresholdYear) {
              // Take only the 2 most recent seasons
              leagues.push(...groupSeasons.slice(0, 2));
            }
          }
```

**Step 2: Update the instructions message**

Find the sessionMessage logic (around line 253-264) and update the multi-league case:

```typescript
          } else {
            sessionMessage = `User has ${leagues.length} league-seasons configured across: ${Object.entries(sportCounts)
              .map(([sport, count]) => `${count} ${sport}`)
              .join(', ')}. For historical leagues/seasons (2+ years old), use get_ancient_history. ASK which league they want to work with if unclear.`;
          }
```

**Step 3: Run lint**

Run: `npm run lint`
Expected: No new errors

**Step 4: Commit**

```bash
git add workers/fantasy-mcp/src/mcp/tools.ts
git commit -m "feat: filter get_user_session to active leagues with 2 seasons max"
```

---

## Task 3: Add get_ancient_history MCP tool

**Files:**
- Modify: `workers/fantasy-mcp/src/mcp/tools.ts`

**Step 1: Add the new tool after get_user_session (around line 320)**

```typescript
    // -------------------------------------------------------------------------
    // GET ANCIENT HISTORY - Retrieve old leagues and seasons
    // -------------------------------------------------------------------------
    {
      name: 'get_ancient_history',
      title: 'Ancient History',
      description:
        'Retrieve archived leagues and old seasons beyond the 2-year window. Use when user asks about inactive leagues, past seasons, or historical performance.',
      inputSchema: {
        type: 'object',
        properties: {
          platform: {
            type: 'string',
            enum: ['espn', 'yahoo'],
            description: 'Optional: filter to specific platform',
          },
        },
      },
      handler: async (args, env, authHeader, correlationId) => {
        const { platform } = args as { platform?: 'espn' | 'yahoo' };

        try {
          // Fetch all leagues (same logic as get_user_session)
          const allLeagues: UserLeague[] = [];

          // Fetch ESPN leagues
          if (!platform || platform === 'espn') {
            const { leagues: espnLeagues } = await fetchUserLeagues(env, authHeader, correlationId);
            allLeagues.push(...espnLeagues);
          }

          // Fetch Yahoo leagues
          if (!platform || platform === 'yahoo') {
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
                    isDefault?: boolean;
                  }>;
                };
                if (yahooData.leagues) {
                  for (const league of yahooData.leagues) {
                    allLeagues.push({
                      platform: 'yahoo',
                      sport: league.sport,
                      leagueId: league.leagueKey,
                      leagueName: league.leagueName,
                      teamId: league.teamId || '',
                      seasonYear: league.seasonYear,
                      isDefault: league.isDefault,
                    });
                  }
                }
              }
            } catch (error) {
              console.error('[get_ancient_history] Failed to fetch Yahoo leagues:', error);
            }
          }

          const thresholdYear = getActiveThresholdYear();

          // Group by league
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

          // Separate old leagues vs old seasons of active leagues
          const oldLeagues: typeof allLeagues = [];
          const oldSeasons: Record<string, typeof allLeagues> = {};

          for (const [key, groupSeasons] of leagueGroups) {
            groupSeasons.sort((a, b) => b.seasonYear - a.seasonYear);
            const mostRecentYear = groupSeasons[0]?.seasonYear || 0;

            if (mostRecentYear < thresholdYear) {
              // Entire league is old - include all seasons
              oldLeagues.push(...groupSeasons);
            } else {
              // Active league - only include seasons beyond the 2-season window
              const ancientSeasons = groupSeasons.slice(2);
              if (ancientSeasons.length > 0) {
                oldSeasons[key] = ancientSeasons;
              }
            }
          }

          return mcpSuccess({
            success: true,
            thresholdYear,
            oldLeagues,
            oldSeasonsFromActiveLeagues: oldSeasons,
            totalOldLeagues: oldLeagues.length,
            totalOldSeasons: Object.values(oldSeasons).flat().length,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          return mcpError(`Failed to fetch ancient history: ${message}`);
        }
      },
    },
```

**Step 2: Run lint**

Run: `npm run lint`
Expected: No errors

**Step 3: Commit**

```bash
git add workers/fantasy-mcp/src/mcp/tools.ts
git commit -m "feat: add get_ancient_history MCP tool for historical leagues/seasons"
```

---

## Task 4: Frontend - Add old leagues state and filtering

**Files:**
- Modify: `web/app/(site)/leagues/page.tsx`

**Step 1: Add state for old leagues visibility (after existing useState calls, around line 175)**

```typescript
  const [showOldLeagues, setShowOldLeagues] = useState(false);
```

**Step 2: Add helper function to determine if a league group is old (before the leaguesBySport useMemo, around line 190)**

```typescript
  // Helper to determine if a league is "old" (no seasons in last 2 years)
  const isOldLeague = (seasons: { seasonYear: number }[]): boolean => {
    const thresholdYear = new Date().getFullYear() - 2;
    const mostRecentYear = Math.max(...seasons.map(s => s.seasonYear), 0);
    return mostRecentYear < thresholdYear;
  };
```

**Step 3: Modify leaguesBySport useMemo to also return old leagues (around line 195-253)**

Find the return statement at the end of the useMemo and replace:

```typescript
    // Return sorted by sport order
    const sportOrder = ['football', 'baseball', 'basketball', 'hockey'];
    return Array.from(bySport.entries()).sort((a, b) => {
      return sportOrder.indexOf(a[0]) - sportOrder.indexOf(b[0]);
    });
  }, [leagues, yahooLeagues]);
```

With:

```typescript
    // Separate active vs old leagues
    const activeLeagues: UnifiedLeagueGroup[] = [];
    const oldLeagueGroups: UnifiedLeagueGroup[] = [];

    for (const group of grouped.values()) {
      if (isOldLeague(group.seasons)) {
        oldLeagueGroups.push(group);
      } else {
        activeLeagues.push(group);
      }
    }

    // Group active leagues by sport
    const bySportActive = new Map<string, UnifiedLeagueGroup[]>();
    for (const group of activeLeagues) {
      if (!bySportActive.has(group.sport)) {
        bySportActive.set(group.sport, []);
      }
      bySportActive.get(group.sport)!.push(group);
    }

    // Sort leagues within each sport by most recent season
    for (const sportGroups of bySportActive.values()) {
      sportGroups.sort((a, b) => {
        const aYear = a.seasons[0]?.seasonYear || 0;
        const bYear = b.seasons[0]?.seasonYear || 0;
        return bYear - aYear;
      });
    }

    // Return sorted by sport order
    const sportOrder = ['football', 'baseball', 'basketball', 'hockey'];
    const sortedActive = Array.from(bySportActive.entries()).sort((a, b) => {
      return sportOrder.indexOf(a[0]) - sportOrder.indexOf(b[0]);
    });

    return { active: sortedActive, old: oldLeagueGroups };
  }, [leagues, yahooLeagues]);
```

**Step 4: Update the destructuring where leaguesBySport is used**

Find where `leaguesBySport` is used (around line 830) and update:

```typescript
// Change from:
leaguesBySport.length === 0
// To:
leaguesBySport.active.length === 0 && leaguesBySport.old.length === 0
```

And:
```typescript
// Change from:
leaguesBySport.map(([sport, sportLeagues]) => (
// To:
leaguesBySport.active.map(([sport, sportLeagues]) => (
```

**Step 5: Commit**

```bash
git add web/app/(site)/leagues/page.tsx
git commit -m "feat: split leagues into active and old groups"
```

---

## Task 5: Frontend - Add Old Leagues collapsible section UI

**Files:**
- Modify: `web/app/(site)/leagues/page.tsx`

**Step 1: Add the Old Leagues section after the sport sections (after the closing of the active leagues map, before CardContent closing)**

Find where the sport sections end (after the `leaguesBySport.active.map` closes) and add:

```typescript
                    {/* Old Leagues Section */}
                    {leaguesBySport.old.length > 0 && (
                      <div className="space-y-3 pt-3 border-t">
                        <button
                          type="button"
                          className="flex items-center gap-2 font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
                          onClick={() => setShowOldLeagues(!showOldLeagues)}
                        >
                          <span className="text-lg">🗄️</span>
                          <span className="text-base">Old Leagues ({leaguesBySport.old.length})</span>
                          <ChevronDown className={`h-4 w-4 ml-auto transition-transform ${showOldLeagues ? 'rotate-180' : ''}`} />
                        </button>

                        {showOldLeagues && (
                          <div className="space-y-3">
                            {leaguesBySport.old.map((group) => {
                              const baseKey = `${group.leagueId}-${group.sport}`;
                              const isDeleting = deletingLeagueKey === baseKey;
                              const mostRecentYear = group.seasons[0]?.seasonYear;

                              return (
                                <div key={group.key} className="rounded-lg border bg-muted/30">
                                  {/* Old League Header */}
                                  <div className="flex items-center justify-between gap-3 p-3">
                                    <div className="min-w-0">
                                      <div className="font-medium break-words text-muted-foreground">
                                        {group.leagueName || `League ${group.leagueId}`}
                                      </div>
                                      <div className="text-xs text-muted-foreground/70 break-words">
                                        {group.platform === 'espn' ? 'ESPN' : 'Yahoo'}
                                        {` • Last active: ${mostRecentYear}`}
                                      </div>
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                                      onClick={() => {
                                        if (group.platform === 'espn') {
                                          handleDeleteLeague(group.leagueId, group.sport);
                                        } else {
                                          const yahooId = group.seasons[0]?.yahooId;
                                          if (yahooId) handleDeleteYahooLeague(yahooId);
                                        }
                                      }}
                                      disabled={isDeleting}
                                      title="Delete league"
                                    >
                                      {isDeleting ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <Trash2 className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
```

**Step 2: Ensure ChevronDown is imported**

Check imports at top of file. If not present, add to lucide-react imports:

```typescript
import { ..., ChevronDown, ... } from 'lucide-react';
```

**Step 3: Run lint**

Run: `npm run lint`
Expected: No new errors

**Step 4: Commit**

```bash
git add web/app/(site)/leagues/page.tsx
git commit -m "feat: add collapsible Old Leagues section with muted styling"
```

---

## Task 6: Deploy and test

**Step 1: Deploy MCP worker**

Run: `cd workers/fantasy-mcp && npm run deploy`
Expected: Deployment succeeds

**Step 2: Run all lints and tests**

Run: `npm run lint && cd workers/auth-worker && npm test`
Expected: All pass

**Step 3: Manual testing checklist**

1. Open leagues page - verify old leagues appear in gray section at bottom (if you have any)
2. Verify old leagues section is collapsed by default
3. Click to expand - verify muted styling
4. Test MCP: call get_user_session - verify only active leagues with 2 seasons returned
5. Test MCP: call get_ancient_history - verify old leagues and seasons returned

**Step 4: Final commit and push**

```bash
git add -A
git commit -m "feat: complete old leagues / ancient history implementation"
git push
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Add getActiveThresholdYear helper |
| 2 | Filter get_user_session to active leagues + 2 seasons |
| 3 | Add get_ancient_history MCP tool |
| 4 | Frontend state and filtering for old leagues |
| 5 | Old Leagues collapsible UI section |
| 6 | Deploy and test |
