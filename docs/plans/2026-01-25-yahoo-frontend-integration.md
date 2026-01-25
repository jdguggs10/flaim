# Yahoo Frontend Integration Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate Yahoo leagues into the frontend with consistent UX alongside ESPN - unified Active Leagues display by sport, side-by-side platform connection on homepage.

**Architecture:** Yahoo leagues merge into existing Active Leagues card grouped by sport (not platform). Homepage Box 2 becomes dual-column for ESPN and Yahoo connection. Backend needs two new endpoints for Yahoo league management (set-default, delete).

**Tech Stack:** Next.js, React, Clerk auth, shadcn/ui components, Cloudflare Workers (auth-worker)

---

## Task 1: Add Yahoo League Management Endpoints to auth-worker

**Files:**
- Modify: `workers/auth-worker/src/index-hono.ts`

**Step 1: Add POST /leagues/yahoo/:id/default endpoint**

Add after line 744 (after the existing `GET /leagues/yahoo` route):

```typescript
// Set Yahoo league as default (requires auth)
api.post('/leagues/yahoo/:id/default', async (c) => {
  const { userId, error: authError } = await getVerifiedUserId(c.req.raw, c.env);
  if (!userId) {
    return c.json({
      error: 'unauthorized',
      error_description: authError || 'Authentication required',
    }, 401);
  }

  const leagueId = c.req.param('id');
  if (!leagueId) {
    return c.json({ error: 'League ID required' }, 400);
  }

  const storage = YahooStorage.fromEnvironment(c.env);
  await storage.setDefaultYahooLeague(userId, leagueId);
  const leagues = await storage.getYahooLeagues(userId);

  return c.json({ success: true, leagues }, 200);
});
```

**Step 2: Add DELETE /leagues/yahoo/:id endpoint**

Add immediately after the previous endpoint:

```typescript
// Delete Yahoo league (requires auth)
api.delete('/leagues/yahoo/:id', async (c) => {
  const { userId, error: authError } = await getVerifiedUserId(c.req.raw, c.env);
  if (!userId) {
    return c.json({
      error: 'unauthorized',
      error_description: authError || 'Authentication required',
    }, 401);
  }

  const leagueId = c.req.param('id');
  if (!leagueId) {
    return c.json({ error: 'League ID required' }, 400);
  }

  const storage = YahooStorage.fromEnvironment(c.env);
  await storage.deleteYahooLeague(userId, leagueId);
  const leagues = await storage.getYahooLeagues(userId);

  return c.json({ success: true, leagues }, 200);
});
```

**Step 3: Test locally**

```bash
npm run dev:workers
# In another terminal, test with curl (will fail auth, but confirms route exists):
curl -X POST http://localhost:8786/leagues/yahoo/test-id/default -v
# Expected: 401 unauthorized (route exists)
```

**Step 4: Commit**

```bash
git add workers/auth-worker/src/index-hono.ts
git commit -m "feat(auth-worker): add Yahoo league default and delete endpoints"
```

---

## Task 2: Add Next.js API Routes for Yahoo League Management

**Files:**
- Create: `web/app/api/connect/yahoo/leagues/[id]/default/route.ts`
- Create: `web/app/api/connect/yahoo/leagues/[id]/route.ts`

**Step 1: Create set-default route**

Create `web/app/api/connect/yahoo/leagues/[id]/default/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * POST /api/connect/yahoo/leagues/[id]/default
 * Set a Yahoo league as the user's default.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, getToken } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { id: leagueId } = await params;
    if (!leagueId) {
      return NextResponse.json({ error: 'League ID required' }, { status: 400 });
    }

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'AUTH_WORKER_URL not configured' }, { status: 500 });
    }

    const bearer = (await getToken?.()) || undefined;
    const workerRes = await fetch(`${authWorkerUrl}/leagues/yahoo/${leagueId}/default`, {
      method: 'POST',
      headers: {
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
    });

    const data = await workerRes.json().catch(() => ({ error: 'Unknown error' })) as Record<string, unknown>;
    return NextResponse.json(data, { status: workerRes.status });
  } catch (error) {
    console.error('Yahoo set-default route error:', error);
    return NextResponse.json({ error: 'Failed to set default league' }, { status: 500 });
  }
}
```

**Step 2: Create delete route**

Create `web/app/api/connect/yahoo/leagues/[id]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * DELETE /api/connect/yahoo/leagues/[id]
 * Delete a specific Yahoo league.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, getToken } = await auth();
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const { id: leagueId } = await params;
    if (!leagueId) {
      return NextResponse.json({ error: 'League ID required' }, { status: 400 });
    }

    const authWorkerUrl = process.env.NEXT_PUBLIC_AUTH_WORKER_URL;
    if (!authWorkerUrl) {
      return NextResponse.json({ error: 'AUTH_WORKER_URL not configured' }, { status: 500 });
    }

    const bearer = (await getToken?.()) || undefined;
    const workerRes = await fetch(`${authWorkerUrl}/leagues/yahoo/${leagueId}`, {
      method: 'DELETE',
      headers: {
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
    });

    const data = await workerRes.json().catch(() => ({ error: 'Unknown error' })) as Record<string, unknown>;
    return NextResponse.json(data, { status: workerRes.status });
  } catch (error) {
    console.error('Yahoo delete league route error:', error);
    return NextResponse.json({ error: 'Failed to delete league' }, { status: 500 });
  }
}
```

**Step 3: Commit**

```bash
git add web/app/api/connect/yahoo/leagues/
git commit -m "feat(web): add Yahoo league default and delete API routes"
```

---

## Task 3: Create Unified League Type and Grouping Logic

**Files:**
- Modify: `web/app/(site)/leagues/page.tsx`

**Step 1: Add UnifiedLeague type and update interfaces**

At the top of the file (around line 46), update the types:

```typescript
interface League {
  leagueId: string;
  sport: string;
  leagueName?: string;
  teamId?: string;
  teamName?: string;
  seasonYear?: number;
  isDefault?: boolean;
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
  isDefault?: boolean;
}

// New: Unified league for display
interface UnifiedLeague {
  platform: 'espn' | 'yahoo';
  // Common fields
  sport: string;
  seasonYear: number;
  leagueName: string;
  teamName?: string;
  isDefault: boolean;
  // Platform-specific identifiers
  leagueId: string;      // ESPN: numeric ID, Yahoo: league_key
  teamId?: string;
  // Yahoo-specific
  yahooId?: string;      // UUID for Yahoo league (for API calls)
}

interface UnifiedLeagueGroup {
  key: string;           // e.g., "espn:football:12345" or "yahoo:football:nfl.l.54321"
  platform: 'espn' | 'yahoo';
  sport: string;
  leagueId: string;
  leagueName: string;
  teamId?: string;
  seasons: UnifiedLeague[];
}
```

**Step 2: Commit**

```bash
git add web/app/(site)/leagues/page.tsx
git commit -m "feat(leagues): add unified league types for multi-platform support"
```

---

## Task 4: Add Unified League Grouping Logic

**Files:**
- Modify: `web/app/(site)/leagues/page.tsx`

**Step 1: Create helper function to convert to unified format**

Add after the type definitions (around line 90):

```typescript
// Convert ESPN leagues to unified format
function espnToUnified(leagues: League[]): UnifiedLeague[] {
  return leagues.map((l) => ({
    platform: 'espn' as const,
    sport: l.sport,
    seasonYear: l.seasonYear || new Date().getFullYear(),
    leagueName: l.leagueName || `League ${l.leagueId}`,
    teamName: l.teamName,
    isDefault: l.isDefault || false,
    leagueId: l.leagueId,
    teamId: l.teamId,
  }));
}

// Convert Yahoo leagues to unified format
function yahooToUnified(leagues: YahooLeague[]): UnifiedLeague[] {
  return leagues.map((l) => ({
    platform: 'yahoo' as const,
    sport: l.sport,
    seasonYear: l.seasonYear,
    leagueName: l.leagueName,
    teamName: l.teamName,
    isDefault: l.isDefault || false,
    leagueId: l.leagueKey,
    teamId: l.teamId,
    yahooId: l.id,
  }));
}
```

**Step 2: Update the grouping memo**

Replace the existing `leaguesBySport` memo (around line 143) with:

```typescript
// Group all leagues by sport, then by platform+leagueId
const leaguesBySport = useMemo(() => {
  // Convert both platforms to unified format
  const allLeagues = [
    ...espnToUnified(leagues),
    ...yahooToUnified(yahooLeagues),
  ];

  // Group by platform + leagueId
  const grouped = new Map<string, UnifiedLeagueGroup>();

  for (const league of allLeagues) {
    const key = `${league.platform}:${league.sport}:${league.leagueId}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        platform: league.platform,
        sport: league.sport,
        leagueId: league.leagueId,
        leagueName: league.leagueName,
        teamId: league.teamId,
        seasons: [],
      });
    }
    grouped.get(key)!.seasons.push(league);
  }

  // Sort seasons desc within each group
  for (const group of grouped.values()) {
    group.seasons.sort((a, b) => b.seasonYear - a.seasonYear);
    // Use most recent season's league name
    group.leagueName = group.seasons[0]?.leagueName || group.leagueName;
    group.teamId = group.seasons.find((s) => s.teamId)?.teamId;
  }

  // Group by sport
  const bySport = new Map<string, UnifiedLeagueGroup[]>();
  for (const group of grouped.values()) {
    if (!bySport.has(group.sport)) {
      bySport.set(group.sport, []);
    }
    bySport.get(group.sport)!.push(group);
  }

  // Sort leagues within each sport by most recent season
  for (const sportGroups of bySport.values()) {
    sportGroups.sort((a, b) => {
      const aYear = a.seasons[0]?.seasonYear || 0;
      const bYear = b.seasons[0]?.seasonYear || 0;
      return bYear - aYear;
    });
  }

  // Return sorted by sport order
  const sportOrder = ['football', 'baseball', 'basketball', 'hockey'];
  return Array.from(bySport.entries()).sort((a, b) => {
    return sportOrder.indexOf(a[0]) - sportOrder.indexOf(b[0]);
  });
}, [leagues, yahooLeagues]);
```

**Step 3: Commit**

```bash
git add web/app/(site)/leagues/page.tsx
git commit -m "feat(leagues): add unified league grouping by sport"
```

---

## Task 5: Add Yahoo League Action Handlers

**Files:**
- Modify: `web/app/(site)/leagues/page.tsx`

**Step 1: Add Yahoo set-default handler**

Add after the existing `handleSetDefault` function (around line 490):

```typescript
// Set default Yahoo league
const handleSetYahooDefault = async (yahooId: string) => {
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
  } catch (err) {
    setLeagueError(err instanceof Error ? err.message : 'Failed to set default league');
  } finally {
    setSettingDefaultKey(null);
  }
};
```

**Step 2: Add Yahoo delete handler**

Add immediately after:

```typescript
// Delete Yahoo league
const handleDeleteYahooLeague = async (yahooId: string) => {
  setDeletingLeagueKey(`yahoo:${yahooId}`);
  setLeagueNotice(null);

  try {
    const res = await fetch(`/api/connect/yahoo/leagues/${yahooId}`, {
      method: 'DELETE',
    });

    if (!res.ok) {
      const data = await res.json() as { error?: string };
      throw new Error(data.error || 'Failed to delete league');
    }

    const data = await res.json() as { leagues?: YahooLeague[] };
    if (data.leagues) {
      setYahooLeagues(data.leagues);
    }
  } catch (err) {
    setLeagueError(err instanceof Error ? err.message : 'Failed to delete league');
  } finally {
    setDeletingLeagueKey(null);
  }
};
```

**Step 3: Commit**

```bash
git add web/app/(site)/leagues/page.tsx
git commit -m "feat(leagues): add Yahoo league action handlers"
```

---

## Task 6: Update Active Leagues Card Rendering

**Files:**
- Modify: `web/app/(site)/leagues/page.tsx`

**Step 1: Replace the Active Leagues card content**

Replace the league rendering section (lines 627-775 approximately) with the unified rendering. This is a large change - replace the entire `{leaguesBySport.map(([sport, sportLeagues]) => (` block:

```typescript
{leaguesBySport.map(([sport, sportLeagues]) => (
  <div key={sport} className="space-y-3">
    {/* Sport Header */}
    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
      <span className="text-base">{getSportEmoji(sport)}</span>
      <span className="capitalize">{sport}</span>
    </div>

    {/* Leagues in this sport */}
    <div className="space-y-3">
      {sportLeagues.map((group) => {
        const isEspn = group.platform === 'espn';
        const baseKey = group.key;
        const isDeleting = deletingLeagueKey === (isEspn ? `${group.leagueId}-${group.sport}` : `yahoo:${group.seasons[0]?.yahooId}`);
        const isDiscovering = discoveringLeagueKey === `${group.leagueId}-${group.sport}`;
        const canDiscover = isEspn && (group.sport === 'baseball' || group.sport === 'football');
        const isExpanded = expandedGroups.has(group.key);
        const visibleSeasons = isExpanded ? group.seasons : group.seasons.slice(0, 3);
        const hasMoreSeasons = group.seasons.length > 3;
        const hasTeamSelection = group.seasons.some((season) => !!season.teamId);

        return (
          <div key={group.key} className="rounded-lg border bg-card">
            {/* Group Header */}
            <div className="flex items-center justify-between gap-3 p-3 border-b">
              <div className="min-w-0">
                <div className="font-medium break-words">
                  {group.leagueName}
                </div>
                <div className="text-xs text-muted-foreground break-words">
                  {isEspn ? (
                    <>ESPN • League ID: {group.leagueId}{group.teamId && ` • Team ID: ${group.teamId}`}</>
                  ) : (
                    <>Yahoo • {group.leagueId}{group.teamId && ` • Team: ${group.teamId}`}</>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                {canDiscover && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-muted-foreground hover:text-primary"
                    onClick={() => handleDiscoverSeasons(group.leagueId, group.sport)}
                    disabled={isDiscovering || !!discoveringLeagueKey || !hasTeamSelection}
                    title={
                      !hasTeamSelection
                        ? 'Select a team first'
                        : 'Discover historical seasons'
                    }
                  >
                    {isDiscovering ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <History className="h-4 w-4" />
                    )}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                  onClick={() => {
                    if (isEspn) {
                      handleDeleteLeague(group.leagueId, group.sport);
                    } else {
                      // For Yahoo, delete all seasons (find any yahooId)
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

            {/* Season Chips */}
            <div className="p-3">
              <div className="flex flex-wrap gap-2">
                {visibleSeasons.map((season) => {
                  const seasonKey = isEspn
                    ? `${season.leagueId}-${season.sport}-${season.seasonYear}`
                    : `yahoo:${season.yahooId}`;
                  const isSettingDefault = settingDefaultKey === seasonKey;

                  return (
                    <div
                      key={seasonKey}
                      className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm ${
                        season.isDefault
                          ? 'bg-primary/10 border border-primary/30'
                          : 'bg-muted'
                      }`}
                    >
                      <div className="flex flex-col">
                        <div className="flex items-center gap-1">
                          <span className="font-medium">{season.seasonYear}</span>
                          {season.isDefault && (
                            <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
                              Default
                            </span>
                          )}
                        </div>
                        {season.teamName && (
                          <span className="text-xs text-muted-foreground">{season.teamName}</span>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={`h-6 w-6 ${
                          season.isDefault
                            ? 'text-yellow-500'
                            : 'text-muted-foreground hover:text-yellow-500'
                        }`}
                        onClick={() => {
                          if (isEspn) {
                            handleSetDefault(season.leagueId, season.sport, season.seasonYear);
                          } else if (season.yahooId) {
                            handleSetYahooDefault(season.yahooId);
                          }
                        }}
                        disabled={isSettingDefault || season.isDefault || !season.teamId}
                        title={
                          !season.teamId
                            ? 'No team selected'
                            : season.isDefault
                            ? 'Already default'
                            : 'Set as default'
                        }
                      >
                        {isSettingDefault ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Star className={`h-3 w-3 ${season.isDefault ? 'fill-current' : ''}`} />
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
              {hasMoreSeasons && (
                <button
                  type="button"
                  className="mt-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => toggleGroup(group.key)}
                >
                  {isExpanded
                    ? 'Show less'
                    : `Show all (${group.seasons.length})`}
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  </div>
))}
```

**Step 2: Remove the separate Yahoo Leagues section**

Delete the entire Yahoo leagues section (lines 780-814 approximately):

```typescript
// DELETE THIS ENTIRE BLOCK:
{/* Yahoo Leagues */}
{yahooLeagues.length > 0 && (
  <div className="space-y-4">
    ...
  </div>
)}
```

**Step 3: Update empty state check**

Update the empty state condition (around line 622) to check both:

```typescript
) : leaguesBySport.length === 0 ? (
```

This already works because `leaguesBySport` now includes both platforms.

**Step 4: Test locally**

```bash
npm run dev
# Navigate to /leagues and verify:
# - ESPN and Yahoo leagues appear together under sport headers
# - Yahoo leagues show "Yahoo • nfl.l.X • Team: Y" format
# - Delete and set-default buttons work for Yahoo
```

**Step 5: Commit**

```bash
git add web/app/(site)/leagues/page.tsx
git commit -m "feat(leagues): unified Active Leagues card with ESPN and Yahoo"
```

---

## Task 7: Create StepConnectPlatforms Component

**Files:**
- Create: `web/components/site/StepConnectPlatforms.tsx`

**Step 1: Create the new component**

```typescript
'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Chrome, Check, Loader2, Monitor, LogIn, Shield, RefreshCw, Eye, EyeOff, Info } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { pingExtension, isChromeBrowser, type ExtensionPingResult } from '@/lib/extension-ping';

const CHROME_EXTENSION_URL = "https://chromewebstore.google.com/detail/flaim-espn-fantasy-connec/mbnokejgglkfgkeeenolgdpcnfakpbkn";

type EspnStatus =
  | 'loading'
  | 'connected'
  | 'installed_not_signed_in'
  | 'not_installed'
  | 'server_only'
  | 'non_chrome';

type YahooStatus = 'loading' | 'connected' | 'not_connected';

interface StepConnectPlatformsProps {
  className?: string;
}

export function StepConnectPlatforms({ className }: StepConnectPlatformsProps) {
  const { isLoaded, isSignedIn } = useAuth();

  // ESPN state
  const [espnStatus, setEspnStatus] = useState<EspnStatus>('loading');
  const [hasCredentials, setHasCredentials] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [swid, setSwid] = useState('');
  const [espnS2, setEspnS2] = useState('');
  const [showCredentials, setShowCredentials] = useState(false);
  const [hasLoadedCreds, setHasLoadedCreds] = useState(false);
  const [isLoadingCreds, setIsLoadingCreds] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [espnError, setEspnError] = useState<string | null>(null);

  // Yahoo state
  const [yahooStatus, setYahooStatus] = useState<YahooStatus>('loading');
  const [yahooLeagueCount, setYahooLeagueCount] = useState(0);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setEspnStatus('loading');
      setYahooStatus('loading');
      return;
    }

    // Check ESPN
    const checkEspn = async () => {
      const isChrome = isChromeBrowser();
      let ping: ExtensionPingResult | null = null;
      if (isChrome) {
        try {
          ping = await pingExtension(1500);
        } catch {
          ping = null;
        }
      }

      let serverHasCredentials = false;
      try {
        const response = await fetch('/api/extension/connection');
        if (response.ok) {
          const data = (await response.json()) as { connected?: boolean };
          serverHasCredentials = !!data.connected;
        }
      } catch { /* ignore */ }

      try {
        const credsRes = await fetch('/api/auth/espn/credentials?forEdit=true');
        if (credsRes.ok) {
          const data = (await credsRes.json()) as { hasCredentials?: boolean; swid?: string; s2?: string };
          setHasCredentials(!!data.hasCredentials);
          if (data.swid || data.s2) {
            if (data.swid) setSwid(data.swid);
            if (data.s2) setEspnS2(data.s2);
            setHasLoadedCreds(true);
          }
        }
      } catch { /* ignore */ }

      if (ping?.reachable) {
        setEspnStatus(ping.signedIn ? 'connected' : 'installed_not_signed_in');
      } else if (!isChrome) {
        setEspnStatus(serverHasCredentials ? 'server_only' : 'non_chrome');
      } else {
        setEspnStatus('not_installed');
      }
    };

    // Check Yahoo
    const checkYahoo = async () => {
      try {
        const res = await fetch('/api/connect/yahoo/status');
        if (res.ok) {
          const data = (await res.json()) as { connected?: boolean };
          if (data.connected) {
            setYahooStatus('connected');
            // Get league count
            const leaguesRes = await fetch('/api/connect/yahoo/leagues');
            if (leaguesRes.ok) {
              const leaguesData = (await leaguesRes.json()) as { leagues?: unknown[] };
              setYahooLeagueCount(leaguesData.leagues?.length || 0);
            }
          } else {
            setYahooStatus('not_connected');
          }
        } else {
          setYahooStatus('not_connected');
        }
      } catch {
        setYahooStatus('not_connected');
      }
    };

    checkEspn();
    checkYahoo();
  }, [isLoaded, isSignedIn]);

  const handleOpenDialog = async () => {
    setDialogOpen(true);
    if (hasLoadedCreds || swid || espnS2) {
      setIsLoadingCreds(false);
      return;
    }
    setIsLoadingCreds(true);
    try {
      const res = await fetch('/api/auth/espn/credentials?forEdit=true');
      if (res.ok) {
        const data = await res.json() as { swid?: string; s2?: string };
        if (data.swid) setSwid(data.swid);
        if (data.s2) setEspnS2(data.s2);
        if (data.swid || data.s2) setHasLoadedCreds(true);
      }
    } catch { /* ignore */ }
    setIsLoadingCreds(false);
  };

  const handleSaveCredentials = async () => {
    if (!swid.trim() || !espnS2.trim()) {
      setEspnError('Both SWID and ESPN_S2 are required');
      return;
    }
    setIsSaving(true);
    setEspnError(null);
    try {
      const res = await fetch('/api/auth/espn/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ swid: swid.trim(), s2: espnS2.trim() }),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error || 'Failed to save credentials');
      }
      setHasCredentials(true);
      setDialogOpen(false);
    } catch (err) {
      setEspnError(err instanceof Error ? err.message : 'Failed to save');
    }
    setIsSaving(false);
  };

  const handleConnectYahoo = () => {
    window.location.href = '/api/connect/yahoo/authorize';
  };

  if (!isLoaded) {
    return (
      <div className={`bg-background rounded-xl p-5 border ${className ?? ''}`}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">2</div>
          <h3 className="font-semibold text-lg">Connect Your Leagues</h3>
        </div>
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className={`bg-background rounded-xl p-5 border ${className ?? ''}`}>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">2</div>
          <h3 className="font-semibold text-lg">Connect Your Leagues</h3>
        </div>
        <p className="text-sm text-muted-foreground">Sign in first to connect your fantasy platforms.</p>
      </div>
    );
  }

  return (
    <div className={`bg-background rounded-xl p-5 border ${className ?? ''}`}>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold">2</div>
        <h3 className="font-semibold text-lg">Connect Your Leagues</h3>
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="ml-auto text-muted-foreground hover:text-foreground transition-colors" aria-label="Security information">
              <Shield className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-72 text-sm">
            <p className="text-muted-foreground">
              Your credentials are encrypted and stored securely. We only use them to fetch your fantasy data.{' '}
              <a href="/privacy" className="text-primary hover:underline">Privacy Policy</a>
            </p>
          </PopoverContent>
        </Popover>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* ESPN Column */}
        <div className="p-4 border rounded-lg space-y-3">
          <div className="font-medium text-sm">ESPN</div>
          <p className="text-xs text-muted-foreground">Chrome extension grabs credentials automatically.</p>

          {espnStatus === 'loading' ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking...
            </div>
          ) : espnStatus === 'connected' ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
                <Check className="h-4 w-4" />
                Extension connected
              </div>
              {hasCredentials && (
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <Check className="h-4 w-4" />
                  Credentials saved
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <a href={CHROME_EXTENSION_URL} target="_blank" rel="noopener noreferrer">
                <Button variant="outline" size="sm" className="w-full">
                  <Chrome className="h-4 w-4 mr-2" />
                  Install Extension
                </Button>
              </a>
              {hasCredentials && (
                <div className="flex items-center gap-2 text-sm text-green-600">
                  <Check className="h-4 w-4" />
                  Credentials saved
                </div>
              )}
              <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={handleOpenDialog}>
                    Add manually
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>ESPN Credentials</DialogTitle>
                    <DialogDescription>Enter your ESPN authentication cookies.</DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 pt-2">
                    {isLoadingCreds ? (
                      <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
                    ) : (
                      <>
                        {espnError && <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{espnError}</div>}
                        <div className="space-y-2">
                          <Label htmlFor="swid">SWID</Label>
                          <Input id="swid" type={showCredentials ? 'text' : 'password'} value={swid} onChange={(e) => setSwid(e.target.value)} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="espn_s2">ESPN_S2</Label>
                          <Input id="espn_s2" type={showCredentials ? 'text' : 'password'} value={espnS2} onChange={(e) => setEspnS2(e.target.value)} />
                        </div>
                        <div className="flex items-center gap-2">
                          <Button variant="ghost" size="sm" onClick={() => setShowCredentials(!showCredentials)}>
                            {showCredentials ? <EyeOff className="h-4 w-4 mr-1" /> : <Eye className="h-4 w-4 mr-1" />}
                            {showCredentials ? 'Hide' : 'Show'}
                          </Button>
                        </div>
                        <div className="flex gap-2">
                          <Button onClick={handleSaveCredentials} disabled={isSaving}>
                            {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                            Save
                          </Button>
                          <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
                        </div>
                      </>
                    )}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </div>

        {/* Yahoo Column */}
        <div className="p-4 border rounded-lg space-y-3">
          <div className="font-medium text-sm">Yahoo</div>
          <p className="text-xs text-muted-foreground">Sign in with Yahoo to auto-discover leagues.</p>

          {yahooStatus === 'loading' ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Checking...
            </div>
          ) : yahooStatus === 'connected' ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
                <Check className="h-4 w-4" />
                Connected
              </div>
              {yahooLeagueCount > 0 && (
                <div className="text-xs text-muted-foreground">
                  {yahooLeagueCount} league{yahooLeagueCount !== 1 ? 's' : ''} discovered
                </div>
              )}
            </div>
          ) : (
            <Button variant="outline" size="sm" className="w-full" onClick={handleConnectYahoo}>
              Connect Yahoo
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add web/components/site/StepConnectPlatforms.tsx
git commit -m "feat(homepage): create StepConnectPlatforms component"
```

---

## Task 8: Update Homepage to Use New Component

**Files:**
- Modify: `web/app/(site)/page.tsx`

**Step 1: Replace StepSyncEspn with StepConnectPlatforms**

Update the imports at the top:

```typescript
import { SignedIn, SignedOut } from '@clerk/nextjs';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { User, Check } from 'lucide-react';
import { StepConnectPlatforms } from '@/components/site/StepConnectPlatforms';
import { StepConnectAI } from '@/components/site/StepConnectAI';
```

**Step 2: Replace the component usage**

Change line 53 from:

```typescript
<StepSyncEspn />
```

To:

```typescript
<StepConnectPlatforms />
```

**Step 3: Test locally**

```bash
npm run dev
# Navigate to homepage and verify:
# - Box 2 shows "Connect Your Leagues" with two columns
# - ESPN column shows extension button + manual option
# - Yahoo column shows Connect button or Connected status
```

**Step 4: Commit**

```bash
git add web/app/(site)/page.tsx
git commit -m "feat(homepage): use StepConnectPlatforms for dual-platform support"
```

---

## Task 9: Update League Maintenance Yahoo Card Description

**Files:**
- Modify: `web/app/(site)/leagues/page.tsx`

**Step 1: Update Yahoo card description**

Find the Yahoo maintenance card (around line 1105) and update the CardDescription:

```typescript
<CardDescription>
  {isYahooConnected
    ? `${yahooLeagues.length} league${yahooLeagues.length !== 1 ? 's' : ''} discovered`
    : 'Connect your Yahoo account to add leagues.'}
</CardDescription>
```

This is already present - verify it matches this pattern.

**Step 2: Commit (if changes made)**

```bash
git add web/app/(site)/leagues/page.tsx
git commit -m "chore(leagues): polish Yahoo maintenance card description"
```

---

## Task 10: Final Integration Test

**Step 1: Run full dev environment**

```bash
npm run dev
```

**Step 2: Test ESPN flow**

1. Go to homepage - verify ESPN column in Box 2
2. Go to /leagues - verify ESPN leagues appear under sport headers
3. Test set-default and delete on ESPN leagues

**Step 3: Test Yahoo flow**

1. Go to homepage - click "Connect Yahoo" if not connected
2. Complete OAuth flow - should redirect back to /leagues
3. Verify Yahoo leagues appear under sport headers alongside ESPN
4. Test set-default on Yahoo league (star button)
5. Test delete on Yahoo league (trash button)
6. Verify Yahoo shows "Yahoo • nfl.l.X • Team: Y" format

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete Yahoo frontend integration

- Unified Active Leagues card shows both ESPN and Yahoo grouped by sport
- Homepage Box 2 has side-by-side ESPN and Yahoo connection options
- Yahoo leagues support set-default and delete actions
- New API endpoints: POST /leagues/yahoo/:id/default, DELETE /leagues/yahoo/:id"
```

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Add auth-worker endpoints for Yahoo default/delete |
| 2 | Add Next.js API routes for Yahoo default/delete |
| 3 | Add unified league types |
| 4 | Add unified grouping logic |
| 5 | Add Yahoo action handlers |
| 6 | Update Active Leagues rendering |
| 7 | Create StepConnectPlatforms component |
| 8 | Update homepage to use new component |
| 9 | Polish Yahoo maintenance card |
| 10 | Final integration test |
