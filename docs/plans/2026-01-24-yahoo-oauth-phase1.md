# Yahoo OAuth Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement Yahoo OAuth flow and league discovery so users can connect their Yahoo Fantasy accounts.

**Architecture:** Add `/connect/yahoo/*` routes to auth-worker for Platform OAuth (Flaim as client). Store Yahoo credentials and leagues in Supabase. Reuse existing patterns from MCP OAuth (OAuthStorage) and ESPN storage (EspnSupabaseStorage).

**Tech Stack:** Cloudflare Workers (Hono), Supabase, TypeScript, Vitest

**Reference docs:**
- `docs/dev/ADD_YAHOO_PLATFORM.md` - Full design document
- `workers/auth-worker/src/oauth-handlers.ts` - MCP OAuth patterns to follow
- `workers/auth-worker/src/oauth-storage.ts` - Storage class patterns

---

## Task 1: Supabase Migration for Yahoo Tables

**Files:**
- Create: `docs/migrations/009_yahoo_platform.sql`

**Step 1: Write the migration file**

```sql
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
```

**Step 2: Verify file was created**

Run: `cat docs/migrations/009_yahoo_platform.sql | head -20`
Expected: Shows the migration header

**Step 3: Commit**

```bash
git add docs/migrations/009_yahoo_platform.sql
git commit -m "chore(db): add Yahoo platform migration (009)"
```

---

## Task 2: Yahoo Storage Class

**Files:**
- Create: `workers/auth-worker/src/yahoo-storage.ts`
- Reference: `workers/auth-worker/src/oauth-storage.ts` (follow same patterns)

**Step 1: Write the failing test**

Create `workers/auth-worker/src/__tests__/yahoo-storage.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { YahooStorage } from '../yahoo-storage';

// Mock Supabase client
const mockSupabase = {
  from: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  upsert: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  single: vi.fn(),
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => mockSupabase,
}));

describe('YahooStorage', () => {
  let storage: YahooStorage;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = new YahooStorage('https://test.supabase.co', 'test-key');
  });

  describe('createPlatformOAuthState', () => {
    it('stores state with platform and user ID', async () => {
      mockSupabase.single.mockResolvedValue({ data: null, error: null });

      await storage.createPlatformOAuthState({
        state: 'test-state-123',
        platform: 'yahoo',
        clerkUserId: 'user_abc',
        redirectAfter: '/leagues',
        expiresInSeconds: 600,
      });

      expect(mockSupabase.from).toHaveBeenCalledWith('platform_oauth_states');
      expect(mockSupabase.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'test-state-123',
          platform: 'yahoo',
          clerk_user_id: 'user_abc',
        })
      );
    });
  });

  describe('consumePlatformOAuthState', () => {
    it('returns state data and deletes record', async () => {
      const expiresAt = new Date(Date.now() + 60000).toISOString();
      mockSupabase.single.mockResolvedValue({
        data: {
          state: 'test-state',
          platform: 'yahoo',
          clerk_user_id: 'user_abc',
          redirect_after: '/leagues',
          expires_at: expiresAt,
        },
        error: null,
      });

      const result = await storage.consumePlatformOAuthState('test-state', 'yahoo');

      expect(result).toEqual({
        state: 'test-state',
        platform: 'yahoo',
        clerkUserId: 'user_abc',
        redirectAfter: '/leagues',
      });
      expect(mockSupabase.delete).toHaveBeenCalled();
    });

    it('returns null for expired state', async () => {
      const expiredAt = new Date(Date.now() - 60000).toISOString();
      mockSupabase.single.mockResolvedValue({
        data: {
          state: 'test-state',
          platform: 'yahoo',
          clerk_user_id: 'user_abc',
          expires_at: expiredAt,
        },
        error: null,
      });

      const result = await storage.consumePlatformOAuthState('test-state', 'yahoo');

      expect(result).toBeNull();
    });
  });

  describe('saveYahooCredentials', () => {
    it('upserts credentials with expiry', async () => {
      mockSupabase.single.mockResolvedValue({ data: null, error: null });

      await storage.saveYahooCredentials({
        clerkUserId: 'user_abc',
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresInSeconds: 3600,
      });

      expect(mockSupabase.from).toHaveBeenCalledWith('yahoo_credentials');
      expect(mockSupabase.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          clerk_user_id: 'user_abc',
          access_token: 'access-token',
          refresh_token: 'refresh-token',
        }),
        { onConflict: 'clerk_user_id' }
      );
    });
  });

  describe('getYahooCredentials', () => {
    it('returns credentials when valid', async () => {
      const expiresAt = new Date(Date.now() + 3600000).toISOString();
      mockSupabase.single.mockResolvedValue({
        data: {
          clerk_user_id: 'user_abc',
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_at: expiresAt,
        },
        error: null,
      });

      const result = await storage.getYahooCredentials('user_abc');

      expect(result).toEqual({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: expect.any(Date),
        needsRefresh: false,
      });
    });

    it('sets needsRefresh when token expires soon', async () => {
      // Expires in 2 minutes (under 5 minute buffer)
      const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
      mockSupabase.single.mockResolvedValue({
        data: {
          clerk_user_id: 'user_abc',
          access_token: 'access-token',
          refresh_token: 'refresh-token',
          expires_at: expiresAt,
        },
        error: null,
      });

      const result = await storage.getYahooCredentials('user_abc');

      expect(result?.needsRefresh).toBe(true);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd workers/auth-worker && npm test -- yahoo-storage.test.ts`
Expected: FAIL with "Cannot find module '../yahoo-storage'"

**Step 3: Write minimal implementation**

Create `workers/auth-worker/src/yahoo-storage.ts`:

```typescript
/**
 * Yahoo Storage - Supabase-based storage for Yahoo OAuth credentials and leagues
 * ---------------------------------------------------------------------------
 *
 * Handles Platform OAuth credentials (Flaim as CLIENT to Yahoo).
 * Separate from OAuthStorage which handles MCP OAuth (Flaim as PROVIDER).
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// =============================================================================
// TYPES
// =============================================================================

export interface PlatformOAuthState {
  state: string;
  platform: 'yahoo' | 'sleeper' | 'cbs';
  clerkUserId: string;
  redirectAfter?: string;
}

export interface CreateStateParams {
  state: string;
  platform: 'yahoo' | 'sleeper' | 'cbs';
  clerkUserId: string;
  redirectAfter?: string;
  expiresInSeconds?: number;
}

export interface YahooCredentials {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  needsRefresh: boolean;
}

export interface SaveCredentialsParams {
  clerkUserId: string;
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  yahooGuid?: string;
}

export interface YahooLeague {
  id?: string;
  clerkUserId: string;
  sport: 'football' | 'baseball' | 'basketball' | 'hockey';
  seasonYear: number;
  leagueKey: string;
  leagueName: string;
  teamId?: string;
  teamKey?: string;
  isDefault: boolean;
}

export interface SaveLeagueParams {
  clerkUserId: string;
  sport: 'football' | 'baseball' | 'basketball' | 'hockey';
  seasonYear: number;
  leagueKey: string;
  leagueName: string;
  teamId?: string;
  teamKey?: string;
}

// =============================================================================
// CONSTANTS
// =============================================================================

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

// =============================================================================
// YAHOO STORAGE CLASS
// =============================================================================

export class YahooStorage {
  private supabase: SupabaseClient;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  // ---------------------------------------------------------------------------
  // PLATFORM OAUTH STATE (CSRF protection)
  // ---------------------------------------------------------------------------

  async createPlatformOAuthState(params: CreateStateParams): Promise<void> {
    const expiresInSeconds = params.expiresInSeconds ?? 600;
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    const { error } = await this.supabase.from('platform_oauth_states').insert({
      state: params.state,
      platform: params.platform,
      clerk_user_id: params.clerkUserId,
      redirect_after: params.redirectAfter || null,
      expires_at: expiresAt.toISOString(),
    });

    if (error) {
      console.error('[yahoo-storage] Failed to create OAuth state:', error);
      throw new Error('Failed to create OAuth state');
    }
  }

  async consumePlatformOAuthState(
    state: string,
    platform: string
  ): Promise<PlatformOAuthState | null> {
    const { data, error } = await this.supabase
      .from('platform_oauth_states')
      .select('state, platform, clerk_user_id, redirect_after, expires_at')
      .eq('state', state)
      .eq('platform', platform)
      .single();

    if (error || !data) {
      return null;
    }

    // Check expiry
    const expiresAt = new Date(data.expires_at);
    if (expiresAt.getTime() < Date.now()) {
      await this.supabase.from('platform_oauth_states').delete().eq('state', state);
      return null;
    }

    // Delete the state (single-use)
    await this.supabase.from('platform_oauth_states').delete().eq('state', state);

    return {
      state: data.state,
      platform: data.platform as 'yahoo' | 'sleeper' | 'cbs',
      clerkUserId: data.clerk_user_id,
      redirectAfter: data.redirect_after || undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // YAHOO CREDENTIALS
  // ---------------------------------------------------------------------------

  async saveYahooCredentials(params: SaveCredentialsParams): Promise<void> {
    const expiresAt = new Date(Date.now() + params.expiresInSeconds * 1000);

    const { error } = await this.supabase.from('yahoo_credentials').upsert(
      {
        clerk_user_id: params.clerkUserId,
        access_token: params.accessToken,
        refresh_token: params.refreshToken,
        expires_at: expiresAt.toISOString(),
        yahoo_guid: params.yahooGuid || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'clerk_user_id' }
    );

    if (error) {
      console.error('[yahoo-storage] Failed to save credentials:', error);
      throw new Error('Failed to save Yahoo credentials');
    }
  }

  async getYahooCredentials(clerkUserId: string): Promise<YahooCredentials | null> {
    const { data, error } = await this.supabase
      .from('yahoo_credentials')
      .select('access_token, refresh_token, expires_at')
      .eq('clerk_user_id', clerkUserId)
      .single();

    if (error || !data) {
      return null;
    }

    const expiresAt = new Date(data.expires_at);
    const needsRefresh = expiresAt.getTime() - Date.now() < REFRESH_BUFFER_MS;

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
      needsRefresh,
    };
  }

  async updateYahooCredentials(
    clerkUserId: string,
    accessToken: string,
    refreshToken: string,
    expiresInSeconds: number
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    const { error } = await this.supabase
      .from('yahoo_credentials')
      .update({
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('clerk_user_id', clerkUserId);

    if (error) {
      console.error('[yahoo-storage] Failed to update credentials:', error);
      throw new Error('Failed to update Yahoo credentials');
    }
  }

  async deleteYahooCredentials(clerkUserId: string): Promise<void> {
    const { error } = await this.supabase
      .from('yahoo_credentials')
      .delete()
      .eq('clerk_user_id', clerkUserId);

    if (error) {
      console.error('[yahoo-storage] Failed to delete credentials:', error);
      throw new Error('Failed to delete Yahoo credentials');
    }
  }

  async hasYahooCredentials(clerkUserId: string): Promise<boolean> {
    const { data } = await this.supabase
      .from('yahoo_credentials')
      .select('clerk_user_id')
      .eq('clerk_user_id', clerkUserId)
      .single();

    return !!data;
  }

  // ---------------------------------------------------------------------------
  // YAHOO LEAGUES
  // ---------------------------------------------------------------------------

  async upsertYahooLeague(params: SaveLeagueParams): Promise<void> {
    const { error } = await this.supabase.from('yahoo_leagues').upsert(
      {
        clerk_user_id: params.clerkUserId,
        sport: params.sport,
        season_year: params.seasonYear,
        league_key: params.leagueKey,
        league_name: params.leagueName,
        team_id: params.teamId || null,
        team_key: params.teamKey || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'clerk_user_id,league_key,season_year' }
    );

    if (error) {
      console.error('[yahoo-storage] Failed to upsert league:', error);
      throw new Error('Failed to save Yahoo league');
    }
  }

  async getYahooLeagues(clerkUserId: string): Promise<YahooLeague[]> {
    const { data, error } = await this.supabase
      .from('yahoo_leagues')
      .select('*')
      .eq('clerk_user_id', clerkUserId)
      .order('season_year', { ascending: false });

    if (error || !data) {
      return [];
    }

    return data.map((row) => ({
      id: row.id,
      clerkUserId: row.clerk_user_id,
      sport: row.sport,
      seasonYear: row.season_year,
      leagueKey: row.league_key,
      leagueName: row.league_name,
      teamId: row.team_id || undefined,
      teamKey: row.team_key || undefined,
      isDefault: row.is_default,
    }));
  }

  async setDefaultYahooLeague(clerkUserId: string, leagueKey: string): Promise<void> {
    // Clear existing defaults
    await this.supabase
      .from('yahoo_leagues')
      .update({ is_default: false })
      .eq('clerk_user_id', clerkUserId);

    // Set new default
    const { error } = await this.supabase
      .from('yahoo_leagues')
      .update({ is_default: true })
      .eq('clerk_user_id', clerkUserId)
      .eq('league_key', leagueKey);

    if (error) {
      console.error('[yahoo-storage] Failed to set default league:', error);
      throw new Error('Failed to set default Yahoo league');
    }
  }

  async deleteYahooLeague(clerkUserId: string, leagueKey: string): Promise<void> {
    const { error } = await this.supabase
      .from('yahoo_leagues')
      .delete()
      .eq('clerk_user_id', clerkUserId)
      .eq('league_key', leagueKey);

    if (error) {
      console.error('[yahoo-storage] Failed to delete league:', error);
      throw new Error('Failed to delete Yahoo league');
    }
  }

  async deleteAllYahooLeagues(clerkUserId: string): Promise<void> {
    const { error } = await this.supabase
      .from('yahoo_leagues')
      .delete()
      .eq('clerk_user_id', clerkUserId);

    if (error) {
      console.error('[yahoo-storage] Failed to delete all leagues:', error);
      throw new Error('Failed to delete Yahoo leagues');
    }
  }

  // ---------------------------------------------------------------------------
  // FACTORY
  // ---------------------------------------------------------------------------

  static fromEnvironment(env: { SUPABASE_URL: string; SUPABASE_SERVICE_KEY: string }): YahooStorage {
    return new YahooStorage(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd workers/auth-worker && npm test -- yahoo-storage.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add workers/auth-worker/src/yahoo-storage.ts workers/auth-worker/src/__tests__/yahoo-storage.test.ts
git commit -m "feat(auth-worker): add YahooStorage class for credentials and leagues"
```

---

## Task 3: Yahoo OAuth Handlers

**Files:**
- Create: `workers/auth-worker/src/yahoo-connect-handlers.ts`
- Create: `workers/auth-worker/src/__tests__/yahoo-connect-handlers.test.ts`

**Step 1: Write the failing test**

Create `workers/auth-worker/src/__tests__/yahoo-connect-handlers.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  handleYahooAuthorize,
  handleYahooCallback,
  handleYahooDisconnect,
  YahooConnectEnv,
} from '../yahoo-connect-handlers';
import { YahooStorage } from '../yahoo-storage';

const env: YahooConnectEnv = {
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
  YAHOO_CLIENT_ID: 'test-client-id',
  YAHOO_CLIENT_SECRET: 'test-client-secret',
  ENVIRONMENT: 'test',
};

const corsHeaders = { 'Access-Control-Allow-Origin': '*' };

describe('yahoo-connect-handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleYahooAuthorize', () => {
    it('redirects to Yahoo OAuth with correct params', async () => {
      const createState = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(YahooStorage, 'fromEnvironment').mockReturnValue({
        createPlatformOAuthState: createState,
      } as unknown as YahooStorage);

      const response = await handleYahooAuthorize(env, 'user_abc', corsHeaders);

      expect(response.status).toBe(302);
      const location = response.headers.get('Location');
      expect(location).toContain('api.login.yahoo.com/oauth2/request_auth');
      expect(location).toContain('client_id=test-client-id');
      expect(location).toContain('scope=fspt-r');
      expect(location).toContain('response_type=code');
      expect(createState).toHaveBeenCalled();
    });
  });

  describe('handleYahooCallback', () => {
    it('returns error for missing code', async () => {
      const request = new Request('https://api.flaim.app/connect/yahoo/callback?state=test-state');
      const response = await handleYahooCallback(request, env, corsHeaders);

      expect(response.status).toBe(302);
      const location = response.headers.get('Location');
      expect(location).toContain('error=invalid_request');
    });

    it('returns error for invalid state', async () => {
      const consumeState = vi.fn().mockResolvedValue(null);
      vi.spyOn(YahooStorage, 'fromEnvironment').mockReturnValue({
        consumePlatformOAuthState: consumeState,
      } as unknown as YahooStorage);

      const request = new Request(
        'https://api.flaim.app/connect/yahoo/callback?code=auth-code&state=invalid-state'
      );
      const response = await handleYahooCallback(request, env, corsHeaders);

      expect(response.status).toBe(302);
      const location = response.headers.get('Location');
      expect(location).toContain('error=invalid_state');
    });
  });

  describe('handleYahooDisconnect', () => {
    it('deletes credentials and returns success', async () => {
      const deleteCreds = vi.fn().mockResolvedValue(undefined);
      const deleteLeagues = vi.fn().mockResolvedValue(undefined);
      vi.spyOn(YahooStorage, 'fromEnvironment').mockReturnValue({
        deleteYahooCredentials: deleteCreds,
        deleteAllYahooLeagues: deleteLeagues,
      } as unknown as YahooStorage);

      const response = await handleYahooDisconnect(env, 'user_abc', corsHeaders);

      expect(response.status).toBe(200);
      expect(deleteCreds).toHaveBeenCalledWith('user_abc');
      expect(deleteLeagues).toHaveBeenCalledWith('user_abc');

      const body = await response.json();
      expect(body).toEqual({ success: true });
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd workers/auth-worker && npm test -- yahoo-connect-handlers.test.ts`
Expected: FAIL with "Cannot find module '../yahoo-connect-handlers'"

**Step 3: Write the implementation**

Create `workers/auth-worker/src/yahoo-connect-handlers.ts`:

```typescript
/**
 * Yahoo Connect Handlers - Platform OAuth for Yahoo Fantasy
 * ---------------------------------------------------------------------------
 *
 * Implements OAuth flow for Flaim as CLIENT connecting to Yahoo.
 * Completely separate from MCP OAuth (oauth-handlers.ts) where Flaim is PROVIDER.
 *
 * Routes (all under /connect/yahoo/*):
 * - GET /connect/yahoo/authorize   - Redirect to Yahoo OAuth
 * - GET /connect/yahoo/callback    - Handle Yahoo redirect, exchange code
 * - GET /connect/yahoo/credentials - Get access token (internal, refresh if needed)
 * - DELETE /connect/yahoo/disconnect - Revoke and delete credentials
 * - POST /connect/yahoo/discover   - Fetch and save user's leagues
 */

import { YahooStorage } from './yahoo-storage';

// =============================================================================
// TYPES
// =============================================================================

export interface YahooConnectEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  YAHOO_CLIENT_ID: string;
  YAHOO_CLIENT_SECRET: string;
  ENVIRONMENT?: string;
  NODE_ENV?: string;
}

interface YahooTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  xoauth_yahoo_guid?: string;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const YAHOO_AUTH_URL = 'https://api.login.yahoo.com/oauth2/request_auth';
const YAHOO_TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';
const YAHOO_API_BASE = 'https://fantasysports.yahooapis.com/fantasy/v2';

const getCallbackUrl = (env: YahooConnectEnv): string => {
  if (env.ENVIRONMENT === 'dev' || env.NODE_ENV === 'development') {
    return 'http://localhost:8786/connect/yahoo/callback';
  }
  return 'https://api.flaim.app/auth/connect/yahoo/callback';
};

const getFrontendUrl = (env: YahooConnectEnv): string => {
  if (env.ENVIRONMENT === 'dev' || env.NODE_ENV === 'development') {
    return 'http://localhost:3000';
  }
  if (env.ENVIRONMENT === 'preview') {
    return 'https://flaim-preview.vercel.app';
  }
  return 'https://flaim.app';
};

// =============================================================================
// UTILITIES
// =============================================================================

function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function buildErrorRedirect(frontendUrl: string, error: string, description: string): string {
  const url = new URL(`${frontendUrl}/leagues`);
  url.searchParams.set('yahoo_error', error);
  url.searchParams.set('yahoo_error_description', description);
  return url.toString();
}

function buildSuccessRedirect(frontendUrl: string): string {
  return `${frontendUrl}/leagues?yahoo=connected`;
}

// =============================================================================
// AUTHORIZE HANDLER
// =============================================================================

/**
 * Redirect user to Yahoo OAuth authorization
 * GET /connect/yahoo/authorize
 */
export async function handleYahooAuthorize(
  env: YahooConnectEnv,
  userId: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const storage = YahooStorage.fromEnvironment(env);

    // Generate state with nonce for CSRF protection
    const nonce = generateNonce();
    const state = `${userId}:${nonce}`;

    // Store state for validation on callback
    await storage.createPlatformOAuthState({
      state,
      platform: 'yahoo',
      clerkUserId: userId,
      redirectAfter: '/leagues',
      expiresInSeconds: 600, // 10 minutes
    });

    // Build Yahoo OAuth URL
    const authUrl = new URL(YAHOO_AUTH_URL);
    authUrl.searchParams.set('client_id', env.YAHOO_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', getCallbackUrl(env));
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', 'fspt-r'); // Fantasy Sports read-only
    authUrl.searchParams.set('state', state);

    console.log(`[yahoo-connect] Redirecting user to Yahoo OAuth`);

    return Response.redirect(authUrl.toString(), 302);
  } catch (error) {
    console.error('[yahoo-connect] Authorize error:', error);
    return new Response(
      JSON.stringify({
        error: 'server_error',
        error_description: 'Failed to initiate Yahoo authorization',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }
}

// =============================================================================
// CALLBACK HANDLER
// =============================================================================

/**
 * Handle Yahoo OAuth callback
 * GET /connect/yahoo/callback?code=xxx&state=xxx
 */
export async function handleYahooCallback(
  request: Request,
  env: YahooConnectEnv,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  const frontendUrl = getFrontendUrl(env);

  // Handle Yahoo-side errors
  if (error) {
    console.log(`[yahoo-connect] Yahoo returned error: ${error}`);
    return Response.redirect(
      buildErrorRedirect(frontendUrl, error, errorDescription || 'Yahoo authorization failed'),
      302
    );
  }

  // Validate required params
  if (!code) {
    return Response.redirect(
      buildErrorRedirect(frontendUrl, 'invalid_request', 'Missing authorization code'),
      302
    );
  }

  if (!state) {
    return Response.redirect(
      buildErrorRedirect(frontendUrl, 'invalid_request', 'Missing state parameter'),
      302
    );
  }

  try {
    const storage = YahooStorage.fromEnvironment(env);

    // Validate and consume state
    const stateData = await storage.consumePlatformOAuthState(state, 'yahoo');
    if (!stateData) {
      console.log(`[yahoo-connect] Invalid or expired state: ${state.substring(0, 20)}...`);
      return Response.redirect(
        buildErrorRedirect(frontendUrl, 'invalid_state', 'Invalid or expired state'),
        302
      );
    }

    // Exchange code for tokens
    const tokenResponse = await exchangeCodeForTokens(code, env);
    if (!tokenResponse) {
      return Response.redirect(
        buildErrorRedirect(frontendUrl, 'token_exchange_failed', 'Failed to exchange authorization code'),
        302
      );
    }

    // Save credentials
    await storage.saveYahooCredentials({
      clerkUserId: stateData.clerkUserId,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresInSeconds: tokenResponse.expires_in,
      yahooGuid: tokenResponse.xoauth_yahoo_guid,
    });

    console.log(`[yahoo-connect] Successfully connected Yahoo for user`);

    // Redirect to frontend with success
    return Response.redirect(buildSuccessRedirect(frontendUrl), 302);
  } catch (error) {
    console.error('[yahoo-connect] Callback error:', error);
    return Response.redirect(
      buildErrorRedirect(frontendUrl, 'server_error', 'Failed to complete Yahoo connection'),
      302
    );
  }
}

/**
 * Exchange authorization code for access/refresh tokens
 */
async function exchangeCodeForTokens(
  code: string,
  env: YahooConnectEnv
): Promise<YahooTokenResponse | null> {
  const credentials = btoa(`${env.YAHOO_CLIENT_ID}:${env.YAHOO_CLIENT_SECRET}`);

  const response = await fetch(YAHOO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: getCallbackUrl(env),
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[yahoo-connect] Token exchange failed: ${response.status} ${errorText}`);
    return null;
  }

  return (await response.json()) as YahooTokenResponse;
}

// =============================================================================
// CREDENTIALS HANDLER (Internal use)
// =============================================================================

/**
 * Get Yahoo credentials for a user, refreshing if needed
 * GET /connect/yahoo/credentials
 * Internal use only - called by yahoo-client worker
 */
export async function handleYahooCredentials(
  env: YahooConnectEnv,
  userId: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const storage = YahooStorage.fromEnvironment(env);
    const credentials = await storage.getYahooCredentials(userId);

    if (!credentials) {
      return new Response(
        JSON.stringify({
          error: 'not_connected',
          error_description: 'Yahoo account not connected',
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }

    // Refresh if needed
    if (credentials.needsRefresh) {
      const refreshed = await refreshYahooToken(credentials.refreshToken, env);
      if (refreshed) {
        await storage.updateYahooCredentials(
          userId,
          refreshed.access_token,
          refreshed.refresh_token,
          refreshed.expires_in
        );
        return new Response(
          JSON.stringify({
            access_token: refreshed.access_token,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          }
        );
      }
      // Refresh failed - credentials may be revoked
      return new Response(
        JSON.stringify({
          error: 'refresh_failed',
          error_description: 'Failed to refresh Yahoo token. Please reconnect.',
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }

    return new Response(
      JSON.stringify({
        access_token: credentials.accessToken,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  } catch (error) {
    console.error('[yahoo-connect] Credentials error:', error);
    return new Response(
      JSON.stringify({
        error: 'server_error',
        error_description: 'Failed to get Yahoo credentials',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }
}

/**
 * Refresh Yahoo access token
 */
async function refreshYahooToken(
  refreshToken: string,
  env: YahooConnectEnv
): Promise<YahooTokenResponse | null> {
  const credentials = btoa(`${env.YAHOO_CLIENT_ID}:${env.YAHOO_CLIENT_SECRET}`);

  const response = await fetch(YAHOO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[yahoo-connect] Token refresh failed: ${response.status} ${errorText}`);
    return null;
  }

  return (await response.json()) as YahooTokenResponse;
}

// =============================================================================
// DISCONNECT HANDLER
// =============================================================================

/**
 * Disconnect Yahoo account
 * DELETE /connect/yahoo/disconnect
 */
export async function handleYahooDisconnect(
  env: YahooConnectEnv,
  userId: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const storage = YahooStorage.fromEnvironment(env);

    // Delete credentials and leagues
    await storage.deleteYahooCredentials(userId);
    await storage.deleteAllYahooLeagues(userId);

    console.log(`[yahoo-connect] Disconnected Yahoo for user`);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (error) {
    console.error('[yahoo-connect] Disconnect error:', error);
    return new Response(
      JSON.stringify({
        error: 'server_error',
        error_description: 'Failed to disconnect Yahoo account',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }
}

// =============================================================================
// STATUS HANDLER
// =============================================================================

/**
 * Check Yahoo connection status
 * GET /connect/yahoo/status
 */
export async function handleYahooStatus(
  env: YahooConnectEnv,
  userId: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const storage = YahooStorage.fromEnvironment(env);
    const hasCredentials = await storage.hasYahooCredentials(userId);
    const leagues = hasCredentials ? await storage.getYahooLeagues(userId) : [];

    return new Response(
      JSON.stringify({
        connected: hasCredentials,
        leagueCount: leagues.length,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  } catch (error) {
    console.error('[yahoo-connect] Status error:', error);
    return new Response(
      JSON.stringify({
        error: 'server_error',
        error_description: 'Failed to check Yahoo status',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd workers/auth-worker && npm test -- yahoo-connect-handlers.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add workers/auth-worker/src/yahoo-connect-handlers.ts workers/auth-worker/src/__tests__/yahoo-connect-handlers.test.ts
git commit -m "feat(auth-worker): add Yahoo OAuth connect handlers"
```

---

## Task 4: Wire Up Routes in index-hono.ts

**Files:**
- Modify: `workers/auth-worker/src/index-hono.ts`

**Step 1: Add imports at top of file**

After the existing imports (around line 26), add:

```typescript
import {
  handleYahooAuthorize,
  handleYahooCallback,
  handleYahooCredentials,
  handleYahooDisconnect,
  handleYahooStatus,
  YahooConnectEnv,
} from './yahoo-connect-handlers';
```

**Step 2: Add Env interface update**

Update the `Env` interface (around line 43) to include Yahoo secrets:

```typescript
export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  NODE_ENV?: string;
  ENVIRONMENT?: string;
  // Yahoo OAuth
  YAHOO_CLIENT_ID?: string;
  YAHOO_CLIENT_SECRET?: string;
}
```

**Step 3: Add Yahoo connect routes**

After the extension endpoints section (around line 550), add a new section:

```typescript
// =============================================================================
// YAHOO CONNECT ENDPOINTS (Platform OAuth - Flaim as CLIENT)
// =============================================================================

// Redirect to Yahoo OAuth (requires Clerk JWT)
api.get('/connect/yahoo/authorize', async (c) => {
  const { userId, error: authError } = await getVerifiedUserId(c.req.raw, c.env);
  if (!userId) {
    return c.json({
      error: 'unauthorized',
      error_description: authError || 'Authentication required',
    }, 401);
  }
  return handleYahooAuthorize(c.env as YahooConnectEnv, userId, getCorsHeaders(c.req.raw));
});

// Yahoo OAuth callback (public - Yahoo redirects here)
api.get('/connect/yahoo/callback', async (c) => {
  return handleYahooCallback(c.req.raw, c.env as YahooConnectEnv, getCorsHeaders(c.req.raw));
});

// Get Yahoo credentials (internal use - requires auth)
api.get('/connect/yahoo/credentials', async (c) => {
  const { userId, error: authError } = await getVerifiedUserId(c.req.raw, c.env);
  if (!userId) {
    return c.json({
      error: 'unauthorized',
      error_description: authError || 'Authentication required',
    }, 401);
  }
  return handleYahooCredentials(c.env as YahooConnectEnv, userId, getCorsHeaders(c.req.raw));
});

// Check Yahoo connection status (requires Clerk JWT)
api.get('/connect/yahoo/status', async (c) => {
  const { userId, error: authError } = await getVerifiedUserId(c.req.raw, c.env);
  if (!userId) {
    return c.json({
      error: 'unauthorized',
      error_description: authError || 'Authentication required',
    }, 401);
  }
  return handleYahooStatus(c.env as YahooConnectEnv, userId, getCorsHeaders(c.req.raw));
});

// Disconnect Yahoo (requires Clerk JWT)
api.delete('/connect/yahoo/disconnect', async (c) => {
  const { userId, error: authError } = await getVerifiedUserId(c.req.raw, c.env);
  if (!userId) {
    return c.json({
      error: 'unauthorized',
      error_description: authError || 'Authentication required',
    }, 401);
  }
  return handleYahooDisconnect(c.env as YahooConnectEnv, userId, getCorsHeaders(c.req.raw));
});
```

**Step 4: Run type-check to verify**

Run: `cd workers/auth-worker && npm run type-check`
Expected: No errors

**Step 5: Commit**

```bash
git add workers/auth-worker/src/index-hono.ts
git commit -m "feat(auth-worker): wire up Yahoo connect routes"
```

---

## Task 5: Add wrangler.jsonc secrets configuration

**Files:**
- Modify: `workers/auth-worker/wrangler.jsonc`

**Step 1: Document required secrets**

The Yahoo OAuth secrets need to be added via Cloudflare dashboard or wrangler CLI. Add a comment in wrangler.jsonc after other secret references:

Find the existing secrets/vars section and add a comment:

```jsonc
// Required secrets (set via `wrangler secret put` or Cloudflare dashboard):
// - SUPABASE_URL
// - SUPABASE_SERVICE_KEY
// - YAHOO_CLIENT_ID      (Yahoo Developer App)
// - YAHOO_CLIENT_SECRET  (Yahoo Developer App)
```

**Step 2: Commit**

```bash
git add workers/auth-worker/wrangler.jsonc
git commit -m "docs(auth-worker): document Yahoo OAuth secrets requirement"
```

---

## Task 6: League Discovery Handler

**Files:**
- Modify: `workers/auth-worker/src/yahoo-connect-handlers.ts`

**Step 1: Add league discovery handler**

Add this function to `yahoo-connect-handlers.ts` before the export section:

```typescript
// =============================================================================
// LEAGUE DISCOVERY HANDLER
// =============================================================================

interface YahooGame {
  game_key: string;
  code: string; // 'nfl', 'mlb', 'nba', 'nhl'
  name: string;
  season: string;
}

interface YahooLeagueInfo {
  league_key: string;
  name: string;
  num_teams: number;
  season: string;
}

interface YahooTeamInfo {
  team_key: string;
  team_id: string;
  name: string;
}

const SPORT_CODE_MAP: Record<string, 'football' | 'baseball' | 'basketball' | 'hockey'> = {
  nfl: 'football',
  mlb: 'baseball',
  nba: 'basketball',
  nhl: 'hockey',
};

/**
 * Discover and save Yahoo leagues
 * POST /connect/yahoo/discover
 */
export async function handleYahooDiscover(
  env: YahooConnectEnv,
  userId: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const storage = YahooStorage.fromEnvironment(env);
    const credentials = await storage.getYahooCredentials(userId);

    if (!credentials) {
      return new Response(
        JSON.stringify({
          error: 'not_connected',
          error_description: 'Yahoo account not connected',
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }

    // Get fresh access token if needed
    let accessToken = credentials.accessToken;
    if (credentials.needsRefresh) {
      const refreshed = await refreshYahooToken(credentials.refreshToken, env);
      if (!refreshed) {
        return new Response(
          JSON.stringify({
            error: 'refresh_failed',
            error_description: 'Failed to refresh Yahoo token',
          }),
          {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          }
        );
      }
      accessToken = refreshed.access_token;
      await storage.updateYahooCredentials(
        userId,
        refreshed.access_token,
        refreshed.refresh_token,
        refreshed.expires_in
      );
    }

    // Call Yahoo API to discover leagues
    const leagues = await discoverYahooLeagues(accessToken);

    // Save each league
    for (const league of leagues) {
      await storage.upsertYahooLeague({
        clerkUserId: userId,
        sport: league.sport,
        seasonYear: league.seasonYear,
        leagueKey: league.leagueKey,
        leagueName: league.leagueName,
        teamId: league.teamId,
        teamKey: league.teamKey,
      });
    }

    console.log(`[yahoo-connect] Discovered ${leagues.length} leagues for user`);

    // Return the discovered leagues
    const savedLeagues = await storage.getYahooLeagues(userId);

    return new Response(
      JSON.stringify({
        success: true,
        count: savedLeagues.length,
        leagues: savedLeagues.map((l) => ({
          sport: l.sport,
          seasonYear: l.seasonYear,
          leagueKey: l.leagueKey,
          leagueName: l.leagueName,
          teamId: l.teamId,
        })),
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  } catch (error) {
    console.error('[yahoo-connect] Discovery error:', error);
    return new Response(
      JSON.stringify({
        error: 'server_error',
        error_description: 'Failed to discover Yahoo leagues',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }
}

interface DiscoveredLeague {
  sport: 'football' | 'baseball' | 'basketball' | 'hockey';
  seasonYear: number;
  leagueKey: string;
  leagueName: string;
  teamId?: string;
  teamKey?: string;
}

/**
 * Call Yahoo Fantasy API to discover user's leagues
 */
async function discoverYahooLeagues(accessToken: string): Promise<DiscoveredLeague[]> {
  const url = `${YAHOO_API_BASE}/users;use_login=1/games/leagues?format=json`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[yahoo-connect] League discovery failed: ${response.status} ${errorText}`);
    throw new Error('Failed to fetch Yahoo leagues');
  }

  const data = await response.json();
  const leagues: DiscoveredLeague[] = [];

  // Yahoo's JSON structure is... unique. Parse carefully.
  // Structure: fantasy_content.users[0].user[1].games[0].game[N]
  try {
    const users = data?.fantasy_content?.users;
    if (!users) return leagues;

    const userContent = users['0']?.user;
    if (!userContent) return leagues;

    // Games are in userContent[1].games
    const games = userContent['1']?.games;
    if (!games) return leagues;

    // Iterate through games (sports/seasons)
    const gameCount = games.count || 0;
    for (let i = 0; i < gameCount; i++) {
      const gameWrapper = games[String(i)]?.game;
      if (!gameWrapper) continue;

      // Game info is in gameWrapper[0]
      const gameInfo = gameWrapper['0'] as YahooGame;
      if (!gameInfo?.code) continue;

      const sport = SPORT_CODE_MAP[gameInfo.code.toLowerCase()];
      if (!sport) continue;

      const seasonYear = parseInt(gameInfo.season, 10);
      if (isNaN(seasonYear)) continue;

      // Leagues are in gameWrapper[1].leagues
      const leaguesWrapper = gameWrapper['1']?.leagues;
      if (!leaguesWrapper) continue;

      const leagueCount = leaguesWrapper.count || 0;
      for (let j = 0; j < leagueCount; j++) {
        const leagueWrapper = leaguesWrapper[String(j)]?.league;
        if (!leagueWrapper) continue;

        const leagueInfo = leagueWrapper['0'] as YahooLeagueInfo;
        if (!leagueInfo?.league_key) continue;

        // Try to get team info from leagueWrapper[1].teams if available
        let teamId: string | undefined;
        let teamKey: string | undefined;
        const teamsWrapper = leagueWrapper['1']?.teams;
        if (teamsWrapper) {
          const teamData = teamsWrapper['0']?.team;
          if (teamData) {
            const teamInfo = teamData['0'] as YahooTeamInfo[];
            // teamInfo is an array of team properties
            if (Array.isArray(teamInfo)) {
              for (const prop of teamInfo) {
                if (typeof prop === 'object' && prop !== null) {
                  if ('team_key' in prop) teamKey = (prop as YahooTeamInfo).team_key;
                  if ('team_id' in prop) teamId = (prop as YahooTeamInfo).team_id;
                }
              }
            }
          }
        }

        leagues.push({
          sport,
          seasonYear,
          leagueKey: leagueInfo.league_key,
          leagueName: leagueInfo.name,
          teamId,
          teamKey,
        });
      }
    }
  } catch (parseError) {
    console.error('[yahoo-connect] Error parsing Yahoo response:', parseError);
    // Return empty array rather than failing completely
  }

  return leagues;
}
```

**Step 2: Add route in index-hono.ts**

Add after the other Yahoo connect routes:

```typescript
// Discover Yahoo leagues (requires Clerk JWT)
api.post('/connect/yahoo/discover', async (c) => {
  const { userId, error: authError } = await getVerifiedUserId(c.req.raw, c.env);
  if (!userId) {
    return c.json({
      error: 'unauthorized',
      error_description: authError || 'Authentication required',
    }, 401);
  }
  return handleYahooDiscover(c.env as YahooConnectEnv, userId, getCorsHeaders(c.req.raw));
});
```

**Step 3: Update import in index-hono.ts**

Update the import to include `handleYahooDiscover`:

```typescript
import {
  handleYahooAuthorize,
  handleYahooCallback,
  handleYahooCredentials,
  handleYahooDisconnect,
  handleYahooDiscover,
  handleYahooStatus,
  YahooConnectEnv,
} from './yahoo-connect-handlers';
```

**Step 4: Run type-check**

Run: `cd workers/auth-worker && npm run type-check`
Expected: No errors

**Step 5: Commit**

```bash
git add workers/auth-worker/src/yahoo-connect-handlers.ts workers/auth-worker/src/index-hono.ts
git commit -m "feat(auth-worker): add Yahoo league discovery handler"
```

---

## Task 7: Update get_user_session to include Yahoo leagues

**Files:**
- Modify: `workers/fantasy-mcp/src/mcp/tools.ts`

**Step 1: Find the get_user_session handler**

The `get_user_session` tool needs to return Yahoo leagues alongside ESPN leagues.

Read the current implementation and add Yahoo league fetching.

In the handler for `get_user_session`, after fetching ESPN leagues, add:

```typescript
// Fetch Yahoo leagues
const yahooLeagues: League[] = [];
try {
  const yahooResponse = await env.AUTH_WORKER.fetch(
    new Request('https://internal/leagues/yahoo', {
      headers: { Authorization: authHeader },
    })
  );
  if (yahooResponse.ok) {
    const yahooData = await yahooResponse.json() as { leagues?: YahooLeague[] };
    if (yahooData.leagues) {
      for (const league of yahooData.leagues) {
        yahooLeagues.push({
          platform: 'yahoo',
          sport: league.sport,
          league_id: league.leagueKey,
          league_key: league.leagueKey,
          team_id: league.teamId || '',
          season_year: league.seasonYear,
          league_name: league.leagueName,
          is_default: league.isDefault,
        });
      }
    }
  }
} catch (error) {
  console.error('[get_user_session] Failed to fetch Yahoo leagues:', error);
  // Don't fail the whole request - just return ESPN leagues
}

// Combine all leagues
const allLeagues = [...espnLeagues, ...yahooLeagues];
```

**Step 2: Add Yahoo leagues endpoint to auth-worker**

In `workers/auth-worker/src/index-hono.ts`, add after the Yahoo connect endpoints:

```typescript
// List Yahoo leagues (requires auth)
api.get('/leagues/yahoo', async (c) => {
  const { userId, error: authError } = await getVerifiedUserId(c.req.raw, c.env);
  if (!userId) {
    return c.json({
      error: 'unauthorized',
      error_description: authError || 'Authentication required',
    }, 401);
  }

  const storage = YahooStorage.fromEnvironment(c.env);
  const leagues = await storage.getYahooLeagues(userId);

  return c.json({ leagues }, 200);
});
```

**Step 3: Add import for YahooStorage**

At the top of `index-hono.ts`, add:

```typescript
import { YahooStorage } from './yahoo-storage';
```

**Step 4: Commit**

```bash
git add workers/auth-worker/src/index-hono.ts workers/fantasy-mcp/src/mcp/tools.ts
git commit -m "feat: include Yahoo leagues in get_user_session response"
```

---

## Task 8: Run All Tests

**Step 1: Run auth-worker tests**

Run: `cd workers/auth-worker && npm test`
Expected: All tests pass

**Step 2: Run type-check on all workers**

Run: `cd workers/auth-worker && npm run type-check && cd ../fantasy-mcp && npm run type-check`
Expected: No errors

**Step 3: Final commit**

```bash
git add -A
git commit -m "test: verify Yahoo OAuth Phase 1 implementation"
```

---

## Summary

After completing all tasks, you will have:

1. **Supabase migration** (`009_yahoo_platform.sql`) with:
   - `yahoo_credentials` table for OAuth tokens
   - `yahoo_leagues` table for discovered leagues
   - `platform_oauth_states` table for CSRF protection

2. **YahooStorage class** for all Supabase operations

3. **Yahoo connect handlers** with routes:
   - `GET /connect/yahoo/authorize` - Start OAuth flow
   - `GET /connect/yahoo/callback` - Handle Yahoo redirect
   - `GET /connect/yahoo/credentials` - Get token (with refresh)
   - `GET /connect/yahoo/status` - Check connection status
   - `DELETE /connect/yahoo/disconnect` - Remove connection
   - `POST /connect/yahoo/discover` - Fetch and save leagues

4. **Updated get_user_session** to return both ESPN and Yahoo leagues

**Next steps after this plan:**
1. Run the Supabase migration in dashboard
2. Add Yahoo secrets to Cloudflare (`wrangler secret put YAHOO_CLIENT_ID`, etc.)
3. Create Yahoo Developer app and configure redirect URI
4. Test the full flow locally
5. Deploy to preview environment
6. Test with real Yahoo account
