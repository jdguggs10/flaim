# Yahoo Frontend Connect UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the "Connect Yahoo" button functional on the leagues page so users can complete the Yahoo OAuth flow and see their Yahoo leagues.

**Architecture:** Create Next.js API routes that proxy to auth-worker (following the existing ESPN pattern: server-side Clerk auth → forward to auth-worker with Bearer token). Update the leagues page to initiate the Yahoo OAuth flow, handle the callback redirect, trigger league discovery, and display Yahoo leagues alongside ESPN leagues.

**Tech Stack:** Next.js (App Router), React, Clerk (auth), TypeScript

**Reference docs:**
- `docs/ADD_YAHOO_PLATFORM.md` — Full design document (Phase 1, section 6)
- `web/app/api/auth/espn/credentials/route.ts` — Pattern for proxying to auth-worker with Clerk auth
- `web/app/(site)/leagues/page.tsx` — Current leagues page with placeholder Yahoo card
- `workers/auth-worker/src/yahoo-connect-handlers.ts` — Backend handlers (already complete)
- `workers/auth-worker/src/index-hono.ts:663-740` — Yahoo route definitions in auth-worker

**Key context:**
- Auth-worker Yahoo endpoints are already deployed and tested (95 unit tests passing)
- `NEXT_PUBLIC_AUTH_WORKER_URL` env var provides the auth-worker base URL
- Clerk auth pattern: `const { userId, getToken } = await auth()` then `Authorization: Bearer ${token}`
- The auth-worker's `/connect/yahoo/authorize` returns a 302 redirect to Yahoo OAuth
- After OAuth success, auth-worker redirects to `https://flaim.app/leagues?yahoo=connected`
- The `League` interface in the leagues page currently has no `platform` field

---

## Task 1: Yahoo Connect API Routes

Create Next.js API routes that proxy Yahoo connect endpoints to auth-worker with Clerk auth.

**Files:**
- Create: `web/app/api/connect/yahoo/authorize/route.ts`
- Create: `web/app/api/connect/yahoo/status/route.ts`
- Create: `web/app/api/connect/yahoo/discover/route.ts`
- Create: `web/app/api/connect/yahoo/disconnect/route.ts`
- Create: `web/app/api/connect/yahoo/leagues/route.ts`

**Step 1: Create the authorize route**

This is the trickiest route because auth-worker returns a 302 redirect. The Next.js route needs to:
1. Authenticate user with Clerk
2. Call auth-worker with `redirect: 'manual'` to prevent auto-following the redirect
3. Extract the `Location` header
4. Return a redirect to the client

```typescript
// web/app/api/connect/yahoo/authorize/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * GET /api/connect/yahoo/authorize
 * Initiates Yahoo OAuth flow.
 * Proxies to auth-worker which returns a 302 redirect to Yahoo.
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
    const workerRes = await fetch(`${authWorkerUrl}/connect/yahoo/authorize`, {
      redirect: 'manual',
      headers: {
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
    });

    // auth-worker returns 302 with Location header
    const location = workerRes.headers.get('Location');
    if (workerRes.status === 302 && location) {
      return NextResponse.redirect(location);
    }

    // If not a redirect, proxy the error
    const data = await workerRes.json().catch(() => ({ error: 'Unknown error' }));
    return NextResponse.json(data, { status: workerRes.status });
  } catch (error) {
    console.error('Yahoo authorize route error:', error);
    return NextResponse.json({ error: 'Failed to start Yahoo connection' }, { status: 500 });
  }
}
```

**Step 2: Create the status route**

```typescript
// web/app/api/connect/yahoo/status/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * GET /api/connect/yahoo/status
 * Check if user has connected their Yahoo account.
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
    const workerRes = await fetch(`${authWorkerUrl}/connect/yahoo/status`, {
      headers: {
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
    });

    const data = await workerRes.json() as Record<string, unknown>;
    return NextResponse.json(data, { status: workerRes.status });
  } catch (error) {
    console.error('Yahoo status route error:', error);
    return NextResponse.json({ error: 'Failed to check Yahoo status' }, { status: 500 });
  }
}
```

**Step 3: Create the discover route**

```typescript
// web/app/api/connect/yahoo/discover/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * POST /api/connect/yahoo/discover
 * Trigger Yahoo league discovery.
 */
export async function POST() {
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
    const workerRes = await fetch(`${authWorkerUrl}/connect/yahoo/discover`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
    });

    const data = await workerRes.json() as Record<string, unknown>;
    return NextResponse.json(data, { status: workerRes.status });
  } catch (error) {
    console.error('Yahoo discover route error:', error);
    return NextResponse.json({ error: 'Failed to discover Yahoo leagues' }, { status: 500 });
  }
}
```

**Step 4: Create the disconnect route**

```typescript
// web/app/api/connect/yahoo/disconnect/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * DELETE /api/connect/yahoo/disconnect
 * Disconnect Yahoo account and remove all Yahoo leagues.
 */
export async function DELETE() {
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
    const workerRes = await fetch(`${authWorkerUrl}/connect/yahoo/disconnect`, {
      method: 'DELETE',
      headers: {
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
    });

    const data = await workerRes.json() as Record<string, unknown>;
    return NextResponse.json(data, { status: workerRes.status });
  } catch (error) {
    console.error('Yahoo disconnect route error:', error);
    return NextResponse.json({ error: 'Failed to disconnect Yahoo' }, { status: 500 });
  }
}
```

**Step 5: Create the leagues route**

```typescript
// web/app/api/connect/yahoo/leagues/route.ts
import { NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * GET /api/connect/yahoo/leagues
 * List user's Yahoo leagues.
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
    const workerRes = await fetch(`${authWorkerUrl}/leagues/yahoo`, {
      headers: {
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
    });

    if (workerRes.status === 404) {
      return NextResponse.json({ leagues: [] });
    }

    const data = await workerRes.json() as Record<string, unknown>;
    return NextResponse.json(data, { status: workerRes.status });
  } catch (error) {
    console.error('Yahoo leagues route error:', error);
    return NextResponse.json({ error: 'Failed to fetch Yahoo leagues' }, { status: 500 });
  }
}
```

**Step 6: Run the dev server to verify routes compile**

Run: `cd /Users/ggugger/Code/flaim && npm run build 2>&1 | tail -20`
Expected: Build succeeds (or at least no TypeScript errors in the new routes)

**Step 7: Commit**

```bash
git add web/app/api/connect/yahoo/
git commit -m "feat: add Next.js API routes for Yahoo connect flow"
```

---

## Task 2: Update Leagues Page — Yahoo Connection State & Button

Make the "Connect Yahoo" button functional and add Yahoo connection status checking.

**Files:**
- Modify: `web/app/(site)/leagues/page.tsx`

**Context:**
- The page already has `isYahooSetupOpen` state and a placeholder card (lines 968-1009)
- The page uses `useAuth` from Clerk and `useEspnCredentials` hook
- The "Connect Yahoo" button currently says "coming soon" and is `disabled`

**Step 1: Add Yahoo connection state and status checking**

Add new state variables and a status check effect near the existing ESPN state (around line 106):

```typescript
// After line 106: const [isYahooSetupOpen, setIsYahooSetupOpen] = useState(false);
// Add:
const [isYahooConnected, setIsYahooConnected] = useState(false);
const [isCheckingYahoo, setIsCheckingYahoo] = useState(true);
const [isYahooDisconnecting, setIsYahooDisconnecting] = useState(false);
const [yahooLeagues, setYahooLeagues] = useState<YahooLeague[]>([]);
const [isDiscoveringYahoo, setIsDiscoveringYahoo] = useState(false);
```

Add a `YahooLeague` interface near the existing `League` interface (around line 44):

```typescript
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
```

**Step 2: Add Yahoo status check and league loading functions**

Add these functions after `loadLeagues` (around line 200):

```typescript
// Check Yahoo connection status
const checkYahooStatus = async () => {
  try {
    const res = await fetch('/api/connect/yahoo/status');
    if (res.ok) {
      const data = await res.json() as { connected?: boolean };
      setIsYahooConnected(data.connected ?? false);
    }
  } catch (err) {
    console.error('Failed to check Yahoo status:', err);
  } finally {
    setIsCheckingYahoo(false);
  }
};

// Load Yahoo leagues
const loadYahooLeagues = async () => {
  try {
    const res = await fetch('/api/connect/yahoo/leagues');
    if (res.ok) {
      const data = await res.json() as { leagues?: YahooLeague[] };
      setYahooLeagues(data.leagues || []);
    }
  } catch (err) {
    console.error('Failed to load Yahoo leagues:', err);
  }
};

// Discover Yahoo leagues after connecting
const discoverYahooLeagues = async () => {
  setIsDiscoveringYahoo(true);
  try {
    const res = await fetch('/api/connect/yahoo/discover', { method: 'POST' });
    if (res.ok) {
      await loadYahooLeagues();
    }
  } catch (err) {
    console.error('Failed to discover Yahoo leagues:', err);
  } finally {
    setIsDiscoveringYahoo(false);
  }
};

// Disconnect Yahoo
const disconnectYahoo = async () => {
  setIsYahooDisconnecting(true);
  try {
    const res = await fetch('/api/connect/yahoo/disconnect', { method: 'DELETE' });
    if (res.ok) {
      setIsYahooConnected(false);
      setYahooLeagues([]);
    }
  } catch (err) {
    console.error('Failed to disconnect Yahoo:', err);
  } finally {
    setIsYahooDisconnecting(false);
  }
};
```

**Step 3: Add useEffect for Yahoo status check and `?yahoo=connected` handling**

Add a useEffect that runs on mount to check Yahoo status and handle the OAuth callback redirect. Use `useSearchParams` from Next.js (will need to import it):

```typescript
// At the top, add import:
import { useSearchParams, useRouter } from 'next/navigation';

// Inside the component, add:
const searchParams = useSearchParams();
const router = useRouter();

// Add this effect after existing useEffects:
useEffect(() => {
  if (!isSignedIn) return;

  checkYahooStatus().then(() => loadYahooLeagues());

  // Handle ?yahoo=connected callback from OAuth flow
  const yahooParam = searchParams.get('yahoo');
  if (yahooParam === 'connected') {
    setIsYahooConnected(true);
    discoverYahooLeagues();
    // Clean up the URL param
    router.replace('/leagues', { scroll: false });
  }
}, [isSignedIn]);
```

Note: `useSearchParams` requires a `Suspense` boundary. The page may already have one; if not, wrap the component usage.

**Step 4: Replace the Yahoo placeholder card with functional UI**

Replace the Yahoo card section (lines 968-1009) with:

```tsx
<Card>
  <button
    type="button"
    onClick={() => setIsYahooSetupOpen((prev) => !prev)}
    aria-expanded={isYahooSetupOpen}
    aria-controls="yahoo-setup-content"
    className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
  >
    <CardHeader className="flex flex-row items-start justify-between gap-4">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <CardTitle className="text-lg">Yahoo</CardTitle>
          {isYahooConnected && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
              Connected
            </span>
          )}
        </div>
        <CardDescription>
          {isYahooConnected
            ? `${yahooLeagues.length} league${yahooLeagues.length !== 1 ? 's' : ''} discovered`
            : 'Connect your Yahoo account to add leagues.'}
        </CardDescription>
      </div>
      <ChevronDown
        className={`h-5 w-5 text-muted-foreground transition-transform ${
          isYahooSetupOpen ? 'rotate-180' : ''
        }`}
      />
    </CardHeader>
  </button>
  {isYahooSetupOpen && (
    <CardContent id="yahoo-setup-content" className="space-y-3">
      {isCheckingYahoo ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking Yahoo connection...
        </div>
      ) : isYahooConnected ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4" />
            Yahoo account connected
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={discoverYahooLeagues}
              disabled={isDiscoveringYahoo}
            >
              {isDiscoveringYahoo ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Discovering...
                </>
              ) : (
                'Refresh Leagues'
              )}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={disconnectYahoo}
              disabled={isYahooDisconnecting}
              className="text-destructive hover:text-destructive"
            >
              {isYahooDisconnecting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Disconnect'
              )}
            </Button>
          </div>
        </div>
      ) : (
        <div className="p-4 border rounded-lg bg-muted/40 space-y-2">
          <p className="text-sm text-muted-foreground">
            Sign in with Yahoo to connect your fantasy leagues. Uses OAuth — no passwords stored.
          </p>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => { window.location.href = '/api/connect/yahoo/authorize'; }}
          >
            Connect Yahoo
          </Button>
        </div>
      )}
    </CardContent>
  )}
</Card>
```

**Step 5: Run the dev server and verify the page renders**

Run: `cd /Users/ggugger/Code/flaim && npm run build 2>&1 | tail -20`
Expected: Build succeeds

**Step 6: Commit**

```bash
git add web/app/\(site\)/leagues/page.tsx
git commit -m "feat: make Yahoo connect button functional on leagues page"
```

---

## Task 3: Display Yahoo Leagues on Leagues Page

Show Yahoo leagues below the Yahoo connect card, grouped by sport and season — similar to how ESPN leagues are displayed.

**Files:**
- Modify: `web/app/(site)/leagues/page.tsx`

**Context:**
- ESPN leagues are displayed in a grouped list below the ESPN card
- Yahoo leagues use a different data shape (leagueKey instead of leagueId, etc.)
- Keep it simple: show Yahoo leagues in their own section, not merged with ESPN
- Yahoo leagues come from the `yahooLeagues` state added in Task 2

**Step 1: Add Yahoo leagues display section**

After the existing ESPN leagues display (the section that renders `leaguesBySport`), add a Yahoo leagues section. Place it after the ESPN leagues list but before the closing `</div>` of the main content area.

Group Yahoo leagues by sport. Show: league name, sport, season year, team name (if available). No delete/edit functionality for now — just display.

```tsx
{/* Yahoo Leagues */}
{yahooLeagues.length > 0 && (
  <div className="space-y-4">
    <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
      <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
        Yahoo
      </span>
      Leagues
    </h3>
    <div className="space-y-2">
      {yahooLeagues.map((league) => (
        <div
          key={league.id}
          className="flex items-center justify-between p-3 border rounded-lg"
        >
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{league.leagueName}</span>
              <span className="text-xs text-muted-foreground capitalize">
                {league.sport}
              </span>
            </div>
            <div className="text-xs text-muted-foreground">
              {league.seasonYear} season
              {league.teamName && ` · ${league.teamName}`}
            </div>
          </div>
          {league.isDefault && (
            <Star className="h-4 w-4 text-yellow-500 fill-yellow-500" />
          )}
        </div>
      ))}
    </div>
  </div>
)}
```

**Step 2: Run the dev server and verify**

Run: `cd /Users/ggugger/Code/flaim && npm run build 2>&1 | tail -20`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add web/app/\(site\)/leagues/page.tsx
git commit -m "feat: display Yahoo leagues on leagues page"
```

---

## Task 4: Handle Suspense Boundary for useSearchParams

`useSearchParams()` in Next.js App Router requires a `<Suspense>` boundary. If the leagues page doesn't already have one, it needs to be added.

**Files:**
- Modify: `web/app/(site)/leagues/page.tsx`

**Step 1: Check if the page already uses useSearchParams or has a Suspense boundary**

Look at the existing imports and component structure. If `useSearchParams` is not already imported, it was added in Task 2.

If needed, wrap the main component content in a Suspense boundary by either:
- Splitting the component into a wrapper + inner component, OR
- Wrapping the `<LeaguesPage>` export at the page level

The simplest approach: create a wrapper.

```tsx
// At the top of the file, add to imports:
import { Suspense } from 'react';

// Rename the existing component:
function LeaguesPageContent() {
  // ... all existing component code ...
}

// New default export:
export default function LeaguesPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>}>
      <LeaguesPageContent />
    </Suspense>
  );
}
```

**Step 2: Run the dev server and verify no hydration errors**

Run: `cd /Users/ggugger/Code/flaim && npm run dev:frontend &` then visit `/leagues`
Expected: Page loads without console errors about Suspense

**Step 3: Commit**

```bash
git add web/app/\(site\)/leagues/page.tsx
git commit -m "feat: add Suspense boundary for useSearchParams in leagues page"
```

---

## Task 5: E2E Manual Test of Full OAuth Flow

Test the complete Yahoo connect flow end-to-end.

**Files:** None (testing only)

**Step 1: Start the dev server**

Run: `cd /Users/ggugger/Code/flaim && npm run dev`

**Step 2: Navigate to leagues page**

Go to `http://localhost:3000/leagues` while signed in with Clerk.

**Step 3: Test the connect flow**

1. Click "Yahoo" card to expand it
2. Click "Connect Yahoo" button
3. Should redirect to Yahoo login/authorization page
4. Authorize the app on Yahoo
5. Should redirect back to `/leagues?yahoo=connected`
6. Should see "Connected" badge on Yahoo card
7. Leagues should be discovered and displayed

**Step 4: Test the disconnect flow**

1. Click "Disconnect" button
2. Should show loading spinner
3. Yahoo card should return to "Connect" state
4. Yahoo leagues should be removed from display

**Step 5: Test error cases**

1. Navigate to `/api/connect/yahoo/authorize` while signed out → should get 401
2. Verify the callback handles errors (Yahoo denies access)

**Step 6: Document any issues found**

If issues are found, create follow-up tasks.

---

## Task 6: Deploy and Verify Production

Push changes to main for auto-deployment and verify in production.

**Files:** None (deployment only)

**Step 1: Verify all tests pass**

Run: `cd /Users/ggugger/Code/flaim && npm run build && npm run lint`
Expected: No errors

**Step 2: Push to main**

```bash
git push origin main
```

**Step 3: Verify deployment**

Run: `gh run list --limit 3`
Expected: Deployment succeeds

**Step 4: Test on production**

Go to `https://flaim.app/leagues`, sign in, and test the Yahoo connect flow.

---
