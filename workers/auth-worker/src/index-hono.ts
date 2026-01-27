/**
 * Auth Worker v3.1 - Hono Migration
 *
 * Centralized Cloudflare Worker for handling ESPN credentials
 * with Supabase PostgreSQL storage, plus OAuth 2.1 for Claude MCP connectors.
 *
 * Migrated to Hono framework for cleaner routing and middleware.
 */

import { Hono, Context } from 'hono';
import { EspnSupabaseStorage } from './supabase-storage';
import { EspnCredentials, EspnLeague, AutomaticLeagueDiscoveryFailed } from './espn-types';
import {
  handleMetadataDiscovery,
  handleClientRegistration,
  handleAuthorize,
  handleCreateCode,
  handleToken,
  handleRevoke,
  handleCheckStatus,
  handleRevokeAll,
  handleRevokeSingle,
  validateOAuthToken,
  OAuthEnv,
} from './oauth-handlers';
import { OAuthStorage } from './oauth-storage';
import {
  handleSyncCredentials,
  handleGetExtensionStatus,
  handleGetConnection,
  ExtensionEnv,
} from './extension-handlers';
import {
  discoverAndSaveLeagues,
  type DiscoveredLeague,
  type CurrentSeasonLeague,
} from './v3/league-discovery';
import {
  handleYahooAuthorize,
  handleYahooCallback,
  handleYahooCredentials,
  handleYahooDisconnect,
  handleYahooDiscover,
  handleYahooStatus,
  YahooConnectEnv,
} from './yahoo-connect-handlers';
import { YahooStorage } from './yahoo-storage';

// =============================================================================
// TYPES
// =============================================================================

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  NODE_ENV?: string;
  ENVIRONMENT?: string; // 'dev' | 'preview' | 'prod'
  // Yahoo OAuth
  YAHOO_CLIENT_ID?: string;
  YAHOO_CLIENT_SECRET?: string;
}

type Jwk = {
  kty: string;
  kid: string;
  n: string;
  e: string;
  alg?: string;
  use?: string;
};

type JwtHeader = { alg: string; kid?: string; typ?: string };
type JwtPayload = { sub?: string; iss?: string; exp?: number; [k: string]: unknown };

// =============================================================================
// CONSTANTS
// =============================================================================

const RATE_LIMIT_PER_DAY = 200;

const ALLOWED_ORIGINS = [
  'https://flaim-*.vercel.app',
  'https://flaim.vercel.app',
  'https://flaim.app',
  'https://www.flaim.app',
  'http://localhost:8787',
  'https://localhost:8787',
  'http://localhost:3000',
];

// =============================================================================
// JWT VERIFICATION (Clerk JWKS-based)
// =============================================================================

const jwksCache: Map<string, { keysByKid: Map<string, Jwk>; fetchedAt: number }> = new Map();
const JWKS_TTL_MS = 5 * 60 * 1000;

function b64urlToUint8Array(b64url: string): Uint8Array {
  const pad = b64url.length % 4 === 2 ? '==' : b64url.length % 4 === 3 ? '=' : '';
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const str = atob(b64);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

function decodeSection<T = unknown>(b64url: string): T {
  const bytes = b64urlToUint8Array(b64url);
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as T;
}

type JwksFetchOptions = {
  timeoutMs: number;
  retries: number;
  allowStaleMs: number;
};

function getJwksOptions(env: Env): JwksFetchOptions {
  const isProd = env.ENVIRONMENT === 'prod' && env.NODE_ENV === 'production';
  if (isProd) {
    return { timeoutMs: 5000, retries: 0, allowStaleMs: 0 };
  }
  return { timeoutMs: 10000, retries: 1, allowStaleMs: 60 * 60 * 1000 };
}

async function fetchJwks(issuer: string, options: JwksFetchOptions): Promise<Map<string, Jwk>> {
  const now = Date.now();
  const cached = jwksCache.get(issuer);
  if (cached && now - cached.fetchedAt < JWKS_TTL_MS) {
    return cached.keysByKid;
  }

  const wellKnown = issuer.replace(/\/$/, '') + '/.well-known/jwks.json';

  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const res = await fetch(wellKnown, {
        signal: controller.signal,
        cf: { cacheTtl: 300, cacheEverything: true }
      });
      clearTimeout(timeoutId);

      if (!res.ok) throw new Error(`Failed to fetch JWKS from ${wellKnown}: ${res.status}`);
      const data = await res.json() as { keys: Jwk[] };
      const map = new Map<string, Jwk>();
      for (const k of data.keys || []) {
        if (k.kid) map.set(k.kid, k);
      }
      jwksCache.set(issuer, { keysByKid: map, fetchedAt: now });
      return map;
    } catch (error) {
      clearTimeout(timeoutId);
      const isAbort = error instanceof Error && error.name === 'AbortError';
      if (attempt >= options.retries) {
        if (cached && options.allowStaleMs > 0 && now - cached.fetchedAt < options.allowStaleMs) {
          return cached.keysByKid;
        }
        if (isAbort) {
          throw new Error(`JWKS fetch timeout for ${wellKnown}`);
        }
        throw error;
      }

      if (isAbort) {
        await new Promise(resolve => setTimeout(resolve, 250));
      }
    }
  }

  throw new Error('JWKS fetch failed after retries');
}

async function importRsaPublicKey(jwk: Jwk): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    {
      kty: jwk.kty,
      n: jwk.n,
      e: jwk.e,
      alg: 'RS256',
      ext: true,
      key_ops: ['verify']
    } as JsonWebKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
}

async function verifyJwtAndGetUserId(authorization: string | null, env: Env): Promise<string | null> {
  if (!authorization || !authorization.toLowerCase().startsWith('bearer ')) return null;
  const token = authorization.slice(7).trim();
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');

  const [h, p, s] = parts;
  const header = decodeSection<JwtHeader>(h);
  const payload = decodeSection<JwtPayload>(p);
  const sig = b64urlToUint8Array(s);

  if (header.alg !== 'RS256') throw new Error('Unsupported JWT alg');
  if (!payload.iss) throw new Error('JWT missing iss');
  if (!header.kid) throw new Error('JWT missing kid');
  if (payload.exp && Date.now() / 1000 > payload.exp) throw new Error('JWT expired');

  const keys = await fetchJwks(payload.iss, getJwksOptions(env));
  const jwk = keys.get(header.kid);
  if (!jwk) throw new Error('JWKS key not found');

  const key = await importRsaPublicKey(jwk);
  const data = new TextEncoder().encode(`${h}.${p}`);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data);
  if (!ok) throw new Error('JWT signature invalid');

  return payload.sub || null;
}

// =============================================================================
// DEBUG LOGGING HELPER
// =============================================================================

// Only log debug messages in non-production environments to reduce log noise
function debugLog(env: Env, message: string): void {
  if (env.ENVIRONMENT !== 'prod' || env.NODE_ENV !== 'production') {
    console.log(message);
  }
}

// =============================================================================
// AUTH HELPERS
// =============================================================================

interface AuthResult {
  userId: string | null;
  error?: string;
  authType?: 'clerk' | 'oauth';
}

async function getVerifiedUserId(request: Request, env: Env): Promise<AuthResult> {
  const authz = request.headers.get('Authorization');
  const requestUrl = new URL(request.url);
  debugLog(env, `🔐 [auth-worker] getVerifiedUserId called for ${requestUrl.pathname}`);
  debugLog(env, `🔐 [auth-worker] Authorization header present: ${!!authz}, length: ${authz?.length || 0}`);

  // Try Clerk JWT first (in-app requests)
  try {
    debugLog(env, `🔐 [auth-worker] Attempting Clerk JWT verification...`);
    const verified = await verifyJwtAndGetUserId(authz, env);
    if (verified) {
      debugLog(env, `✅ [auth-worker] Clerk JWT verified, userId: ${maskUserId(verified)}`);
      return { userId: verified, authType: 'clerk' };
    }
    debugLog(env, `⚠️ [auth-worker] Clerk JWT verification returned null`);
  } catch (e) {
    debugLog(env, `⚠️ [auth-worker] Clerk JWT verification failed: ${e instanceof Error ? e.message : 'unknown error'}`);
  }

  // Try OAuth token (Claude direct access)
  if (authz && authz.toLowerCase().startsWith('bearer ')) {
    const token = authz.slice(7).trim();
    try {
      debugLog(env, `🔐 [auth-worker] Attempting OAuth token validation...`);
      const oauthResult = await validateOAuthToken(token, env as OAuthEnv);
      if (oauthResult) {
        debugLog(env, `✅ [auth-worker] OAuth token validated, userId: ${maskUserId(oauthResult.userId)}`);
        return { userId: oauthResult.userId, authType: 'oauth' };
      }
      debugLog(env, `⚠️ [auth-worker] OAuth token validation returned null`);
    } catch (e) {
      debugLog(env, `[auth] OAuth token validation failed: ${e}`);
    }
  }

  debugLog(env, `❌ [auth-worker] All auth methods failed, returning null userId`);
  return { userId: null, error: 'Missing or invalid Authorization token' };
}

function maskUserId(userId: string): string {
  if (!userId || userId.length <= 8) return '***';
  return `${userId.substring(0, 8)}...`;
}

// =============================================================================
// CORS HELPERS
// =============================================================================

function isOriginAllowed(origin: string): boolean {
  return ALLOWED_ORIGINS.some(allowedOrigin => {
    if (allowedOrigin.includes('*')) {
      const pattern = allowedOrigin.replace(/\*/g, '.*');
      const regex = new RegExp(`^${pattern}$`);
      return regex.test(origin);
    }
    return allowedOrigin === origin;
  });
}

function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin');
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };

  if (origin && isOriginAllowed(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

function validateEspnCredentials(credentials: { swid?: string; s2?: string }): { valid: boolean; error?: string } {
  if (!credentials.swid || !credentials.s2) {
    return { valid: false, error: 'ESPN credentials require swid and s2 fields' };
  }
  return { valid: true };
}

// =============================================================================
// HONO APP SETUP
// =============================================================================

const app = new Hono<{ Bindings: Env }>();
const api = new Hono<{ Bindings: Env }>();

// =============================================================================
// MIDDLEWARE
// =============================================================================

// CORS middleware - handles preflight and adds headers to all responses
api.use('*', async (c, next) => {
  const corsHeaders = getCorsHeaders(c.req.raw);

  // Handle preflight
  if (c.req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  await next();

  // Add CORS headers to response (clone to avoid immutable header errors on redirects)
  const headers = new Headers(c.res.headers);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  });
  return new Response(c.res.body, {
    status: c.res.status,
    statusText: c.res.statusText,
    headers,
  });
});

// =============================================================================
// HEALTH ENDPOINT
// =============================================================================

api.get('/health', async (c) => {
  const env = c.env;
  const healthData: Record<string, unknown> = {
    status: 'healthy',
    service: 'auth-worker',
    version: '3.1.0',
    timestamp: new Date().toISOString(),
    storage: 'supabase'
  };

  // Test Supabase connectivity
  try {
    if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
      const storage = EspnSupabaseStorage.fromEnvironment(env);
      await storage.hasCredentials('health-check-test');
      healthData.supabase_status = 'connected';
    } else {
      healthData.supabase_status = 'not_configured';
      healthData.status = 'degraded';
    }
  } catch (error) {
    healthData.supabase_status = 'error';
    healthData.supabase_error = error instanceof Error ? error.message : 'Unknown Supabase error';
    healthData.status = 'degraded';
  }

  healthData.auth_method = 'Clerk JWT + OAuth token';
  healthData.oauth_enabled = true;

  const statusCode = healthData.status === 'healthy' ? 200 : 503;
  return c.json(healthData, statusCode);
});

// =============================================================================
// OAUTH ENDPOINTS (Public)
// =============================================================================

// OAuth metadata discovery (RFC 8414)
api.get('/.well-known/oauth-authorization-server', (c) => {
  return handleMetadataDiscovery(c.env as OAuthEnv, getCorsHeaders(c.req.raw));
});

// Dynamic Client Registration (RFC 7591)
api.all('/register', (c) => {
  return handleClientRegistration(c.req.raw, c.env as OAuthEnv, getCorsHeaders(c.req.raw));
});

// Authorization endpoint - redirects to frontend consent page
api.get('/authorize', (c) => {
  return handleAuthorize(c.req.raw, c.env as OAuthEnv);
});

// Token endpoint - exchange code for access token
api.post('/token', (c) => {
  return handleToken(c.req.raw, c.env as OAuthEnv, getCorsHeaders(c.req.raw));
});

// Revocation endpoint (public)
api.post('/revoke', (c) => {
  return handleRevoke(c.req.raw, c.env as OAuthEnv, getCorsHeaders(c.req.raw));
});

// =============================================================================
// OAUTH ENDPOINTS (Auth Required)
// =============================================================================

// Create authorization code (called by frontend after user consent)
api.post('/oauth/code', async (c) => {
  const { userId, error: authError } = await getVerifiedUserId(c.req.raw, c.env);
  if (!userId) {
    return c.json({
      error: 'unauthorized',
      error_description: authError || 'Authentication required',
    }, 401);
  }
  return handleCreateCode(c.req.raw, c.env as OAuthEnv, userId, getCorsHeaders(c.req.raw));
});

// Check connection status (called by frontend)
api.get('/oauth/status', async (c) => {
  const { userId, error: authError } = await getVerifiedUserId(c.req.raw, c.env);
  if (!userId) {
    return c.json({
      error: 'unauthorized',
      error_description: authError || 'Authentication required',
    }, 401);
  }
  return handleCheckStatus(c.env as OAuthEnv, userId, getCorsHeaders(c.req.raw));
});

// Revoke all tokens for user (called by frontend)
api.post('/oauth/revoke-all', async (c) => {
  const { userId, error: authError } = await getVerifiedUserId(c.req.raw, c.env);
  if (!userId) {
    return c.json({
      error: 'unauthorized',
      error_description: authError || 'Authentication required',
    }, 401);
  }
  return handleRevokeAll(c.env as OAuthEnv, userId, getCorsHeaders(c.req.raw));
});

// Revoke a single token by ID (called by frontend)
api.post('/oauth/revoke', async (c) => {
  const { userId, error: authError } = await getVerifiedUserId(c.req.raw, c.env);
  if (!userId) {
    return c.json({
      error: 'unauthorized',
      error_description: authError || 'Authentication required',
    }, 401);
  }
  return handleRevokeSingle(c.req.raw, c.env as OAuthEnv, userId, getCorsHeaders(c.req.raw));
});

// =============================================================================
// EXTENSION ENDPOINTS
// =============================================================================

// Sync ESPN credentials (requires Clerk JWT)
api.post('/extension/sync', async (c) => {
  const { userId, error: authError } = await getVerifiedUserId(c.req.raw, c.env);
  if (!userId) {
    return c.json({
      error: 'unauthorized',
      error_description: authError || 'Authentication required',
    }, 401);
  }
  return handleSyncCredentials(c.req.raw, c.env as ExtensionEnv, userId, getCorsHeaders(c.req.raw));
});

// Get extension status (requires Clerk JWT)
api.get('/extension/status', async (c) => {
  const { userId, error: authError } = await getVerifiedUserId(c.req.raw, c.env);
  if (!userId) {
    return c.json({
      error: 'unauthorized',
      error_description: authError || 'Authentication required',
    }, 401);
  }
  return handleGetExtensionStatus(c.env as ExtensionEnv, userId, getCorsHeaders(c.req.raw));
});

// Get extension connection for web UI (requires Clerk auth)
api.get('/extension/connection', async (c) => {
  const { userId, error: authError } = await getVerifiedUserId(c.req.raw, c.env);
  if (!userId) {
    return c.json({
      error: 'unauthorized',
      error_description: authError || 'Authentication required',
    }, 401);
  }
  return handleGetConnection(c.env as ExtensionEnv, userId, getCorsHeaders(c.req.raw));
});

// Discover and save leagues (requires Clerk JWT)
api.post('/extension/discover', async (c) => {
  const { userId, error: authError } = await getVerifiedUserId(c.req.raw, c.env);
  if (!userId) {
    return c.json({
      error: 'unauthorized',
      error_description: authError || 'Authentication required',
    }, 401);
  }

  const storage = EspnSupabaseStorage.fromEnvironment(c.env);
  const corsHeaders = getCorsHeaders(c.req.raw);

  // Get stored credentials
  const credentials = await storage.getCredentials(userId);
  if (!credentials) {
    return new Response(JSON.stringify({
      error: 'credentials_not_found',
      error_description: 'ESPN credentials not found. Please sync credentials first.',
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    // Run discovery (includes historical seasons, fully synchronous)
    const result = await discoverAndSaveLeagues(
      userId,
      credentials.swid,
      credentials.s2,
      storage
    );

    // Get current season leagues for default dropdown
    const currentSeasonLeagues = await storage.getCurrentSeasonLeagues(userId);
    const currentSeasonWithDefault: CurrentSeasonLeague[] = currentSeasonLeagues.map(l => ({
      sport: l.sport,
      leagueId: l.leagueId,
      leagueName: l.leagueName || '',
      teamId: l.teamId || '',
      teamName: l.teamName || '',
      seasonYear: l.seasonYear || 0,
    }));

    return c.json({
      discovered: result.discovered,
      currentSeasonLeagues: currentSeasonWithDefault,
      currentSeason: result.currentSeason,
      pastSeasons: result.pastSeasons,
      added: result.added,
      skipped: result.skipped,
      historical: result.historical,
    });

  } catch (error) {
    if (error instanceof AutomaticLeagueDiscoveryFailed) {
      console.log('No new leagues found from ESPN - checking saved leagues');

      const currentSeasonLeagues = await storage.getCurrentSeasonLeagues(userId);
      const savedCount = currentSeasonLeagues.length;
      const currentSeasonWithDefault: CurrentSeasonLeague[] = currentSeasonLeagues.map(l => ({
        sport: l.sport,
        leagueId: l.leagueId,
        leagueName: l.leagueName || '',
        teamId: l.teamId || '',
        teamName: l.teamName || '',
        seasonYear: l.seasonYear || 0,
      }));

      const discovered: DiscoveredLeague[] = currentSeasonWithDefault.map(l => ({
        sport: l.sport,
        leagueId: l.leagueId,
        leagueName: l.leagueName,
        teamId: l.teamId,
        teamName: l.teamName,
        seasonYear: l.seasonYear,
      }));

      return c.json({
        discovered,
        currentSeasonLeagues: currentSeasonWithDefault,
        currentSeason: { found: savedCount, added: 0, alreadySaved: savedCount },
        pastSeasons: { found: 0, added: 0, alreadySaved: 0 },
        added: 0,
        skipped: savedCount,
        historical: 0,
      });
    }

    console.error('Discovery failed:', error);

    const errorMessage = error instanceof Error ? error.message : 'Discovery failed';
    const isAuthError = errorMessage.includes('authentication') ||
      errorMessage.includes('expired') ||
      errorMessage.includes('invalid');

    return c.json({
      error: isAuthError ? 'espn_auth_failed' : 'discovery_failed',
      error_description: errorMessage,
    }, isAuthError ? 401 : 500);
  }
});

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

// =============================================================================
// USER PREFERENCES ROUTES
// =============================================================================

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

  const storage = EspnSupabaseStorage.fromEnvironment(c.env);
  await storage.setDefaultSport(userId, body.sport as 'football' | 'baseball' | 'basketball' | 'hockey' | null);

  const preferences = await storage.getUserPreferences(userId);
  return c.json(preferences);
});

// =============================================================================
// CREDENTIALS ENDPOINTS
// =============================================================================

api.post('/credentials/espn', async (c) => {
  return handleCredentialsEspn(c, 'POST');
});

api.put('/credentials/espn', async (c) => {
  return handleCredentialsEspn(c, 'PUT');
});

api.get('/credentials/espn', async (c) => {
  return handleCredentialsEspn(c, 'GET');
});

api.delete('/credentials/espn', async (c) => {
  return handleCredentialsEspn(c, 'DELETE');
});

async function handleCredentialsEspn(c: Context<{ Bindings: Env }>, method: string): Promise<Response> {
  const env = c.env;
  const url = new URL(c.req.url);
  const corsHeaders = getCorsHeaders(c.req.raw);

  const { userId: clerkUserId, error: authError, authType } = await getVerifiedUserId(c.req.raw, env);
  debugLog(env, `🔐 [auth-worker] /credentials/espn - Verified user: ${clerkUserId ? maskUserId(clerkUserId) : 'null'}, authType: ${authType || 'none'}, authError: ${authError || 'none'}`);

  if (!clerkUserId) {
    return c.json({
      error: 'Authentication required',
      message: authError || 'Missing or invalid Authorization token'
    }, 401);
  }

  const storage = EspnSupabaseStorage.fromEnvironment(env);

  if (method === 'POST' || method === 'PUT') {
    const body = await c.req.json() as { swid?: string; s2?: string; email?: string };
    const validation = validateEspnCredentials(body);

    if (!validation.valid) {
      return c.json({
        error: 'Invalid credentials',
        message: validation.error
      }, 400);
    }

    const success = await storage.setCredentials(clerkUserId, body.swid!, body.s2!, body.email);

    if (!success) {
      return c.json({ error: 'Failed to store credentials' }, 500);
    }

    return c.json({
      success: true,
      message: 'ESPN credentials stored successfully'
    });

  } else if (method === 'GET') {
    const getRawCredentials = url.searchParams.get('raw') === 'true';

    if (getRawCredentials) {
      console.log(`🔍 [auth-worker] GET raw credentials for user: ${maskUserId(clerkUserId)}`);

      // Check rate limit before returning credentials
      const oauthStorage = OAuthStorage.fromEnvironment(env);
      const rateLimit = await oauthStorage.checkRateLimit(clerkUserId, RATE_LIMIT_PER_DAY);

      if (!rateLimit.allowed) {
        console.log(`⚠️ [auth-worker] Rate limit exceeded for user: ${maskUserId(clerkUserId)}`);
        return new Response(JSON.stringify({
          error: 'Rate limit exceeded',
          message: `Daily limit of ${rateLimit.limit} calls reached. Limit resets at ${rateLimit.resetAt.toISOString()}.`,
          resetAt: rateLimit.resetAt.toISOString(),
        }), {
          status: 429,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': String(rateLimit.limit),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': String(Math.floor(rateLimit.resetAt.getTime() / 1000)),
            'Retry-After': String(Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 1000)),
            ...corsHeaders
          }
        });
      }

      // Increment rate limit counter
      const currentUsage = await oauthStorage.incrementRateLimit(clerkUserId);
      const remaining = Math.max(0, RATE_LIMIT_PER_DAY - currentUsage);

      const credentials = await storage.getCredentials(clerkUserId);

      if (!credentials) {
        return new Response(JSON.stringify({
          error: 'Credentials not found',
          message: 'No ESPN credentials found for user. Add your ESPN credentials at /settings/espn'
        }), {
          status: 404,
          headers: {
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': String(RATE_LIMIT_PER_DAY),
            'X-RateLimit-Remaining': String(remaining),
            'X-RateLimit-Reset': String(Math.floor(rateLimit.resetAt.getTime() / 1000)),
            ...corsHeaders
          }
        });
      }

      return new Response(JSON.stringify({
        success: true,
        platform: 'espn',
        credentials
      }), {
        headers: {
          'Content-Type': 'application/json',
          'X-RateLimit-Limit': String(RATE_LIMIT_PER_DAY),
          'X-RateLimit-Remaining': String(remaining),
          'X-RateLimit-Reset': String(Math.floor(rateLimit.resetAt.getTime() / 1000)),
          ...corsHeaders
        }
      });
    }

    // Check if this is an edit request
    const forEdit = url.searchParams.get('forEdit') === 'true';

    if (forEdit) {
      const credentials = await storage.getCredentials(clerkUserId);

      if (!credentials) {
        return c.json({
          hasCredentials: false,
          message: 'No ESPN credentials found'
        }, 404);
      }

      return c.json({
        hasCredentials: true,
        platform: 'espn',
        swid: credentials.swid,
        s2: credentials.s2
      });
    }

    // Default: Get full setup status
    const setupStatus = await storage.getSetupStatus(clerkUserId);
    const metadata = await storage.getCredentialMetadata(clerkUserId);

    return c.json({
      hasCredentials: setupStatus.hasCredentials,
      hasLeagues: setupStatus.hasLeagues,
      hasDefaultTeam: setupStatus.hasDefaultTeam,
      platform: 'espn',
      email: metadata?.email,
      lastUpdated: metadata?.lastUpdated
    });

  } else if (method === 'DELETE') {
    const success = await storage.deleteCredentials(clerkUserId);

    if (!success) {
      return c.json({ error: 'Failed to delete credentials' }, 500);
    }

    return c.json({
      success: true,
      message: 'ESPN credentials deleted successfully'
    });
  }

  return c.json({ error: 'Method not allowed' }, 405);
}

// =============================================================================
// LEAGUES ENDPOINTS
// =============================================================================

api.get('/leagues', async (c) => {
  return handleLeagues(c, 'GET');
});

api.post('/leagues', async (c) => {
  return handleLeagues(c, 'POST');
});

api.put('/leagues', async (c) => {
  return handleLeagues(c, 'PUT');
});

api.delete('/leagues', async (c) => {
  return handleLeagues(c, 'DELETE');
});

async function handleLeagues(c: Context<{ Bindings: Env }>, method: string): Promise<Response> {
  const env = c.env;
  const url = new URL(c.req.url);
  const corsHeaders = getCorsHeaders(c.req.raw);

  const { userId: clerkUserId, error: authError } = await getVerifiedUserId(c.req.raw, env);
  if (!clerkUserId) {
    return c.json({
      error: 'Authentication required',
      message: authError || 'Missing or invalid Authorization token'
    }, 401);
  }

  const storage = EspnSupabaseStorage.fromEnvironment(env);

  if (method === 'POST' || method === 'PUT') {
    const body = (await c.req.json()) as { leagues?: EspnLeague[] };
    const leagues = body?.leagues;

    if (!leagues || !Array.isArray(leagues)) {
      return c.json({
        error: 'Invalid request: leagues array is required'
      }, 400);
    }

    if (leagues.length > 10) {
      return c.json({
        error: 'Maximum of 10 leagues allowed per user'
      }, 400);
    }

    const success = await storage.setLeagues(clerkUserId, leagues);

    if (!success) {
      return c.json({ error: 'Failed to store leagues' }, 500);
    }

    return c.json({
      success: true,
      message: 'Leagues saved successfully',
      totalLeagues: leagues.length,
      leagues
    });

  } else if (method === 'GET') {
    const leagues = await storage.getLeagues(clerkUserId);

    // Add platform field to all leagues (currently all are ESPN)
    const leaguesWithPlatform = leagues.map(league => ({
      ...league,
      platform: 'espn' as const
    }));

    return c.json({
      success: true,
      leagues: leaguesWithPlatform,
      totalLeagues: leagues.length
    });

  } else if (method === 'DELETE') {
    const leagueId = url.searchParams.get('leagueId');
    const sport = url.searchParams.get('sport');

    if (!leagueId || !sport) {
      return c.json({
        error: 'leagueId and sport query parameters are required'
      }, 400);
    }

    const success = await storage.removeLeague(clerkUserId, leagueId, sport);

    if (!success) {
      return c.json({ error: 'Failed to remove league' }, 500);
    }

    const updatedLeagues = await storage.getLeagues(clerkUserId);

    return c.json({
      success: true,
      message: 'League removed',
      totalLeagues: updatedLeagues.length,
      leagues: updatedLeagues
    });
  }

  return c.json({ error: 'Method not allowed' }, 405);
}

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

// Add single league endpoint
api.post('/leagues/add', async (c) => {
  const { userId: clerkUserId, error: authError } = await getVerifiedUserId(c.req.raw, c.env);
  if (!clerkUserId) {
    return c.json({
      error: 'Authentication required',
      message: authError || 'Missing or invalid Authorization token'
    }, 401);
  }

  const body = await c.req.json() as EspnLeague;
  if (!body.leagueId || !body.sport) {
    return c.json({
      error: 'leagueId and sport are required'
    }, 400);
  }

  const storage = EspnSupabaseStorage.fromEnvironment(c.env);
  const result = await storage.addLeague(clerkUserId, body);

  if (!result.success) {
    const statusMap: Record<string, 400 | 409 | 500> = {
      'DUPLICATE': 409,
      'LIMIT_EXCEEDED': 400,
      'DB_ERROR': 500
    };
    const status = result.code ? statusMap[result.code] || 500 : 500;

    return c.json({
      error: result.error || 'Failed to add league',
      code: result.code
    }, status as 400 | 409 | 500);
  }

  return c.json({ success: true });
});

// League team selection endpoint
api.patch('/leagues/:leagueId/team', async (c) => {
  const leagueId = c.req.param('leagueId');

  const { userId: clerkUserId, error: authError } = await getVerifiedUserId(c.req.raw, c.env);
  if (!clerkUserId) {
    return c.json({
      error: 'Authentication required',
      message: authError || 'Missing or invalid Authorization token'
    }, 401);
  }

  const body = await c.req.json() as {
    teamId?: string;
    sport?: string;
    teamName?: string;
    leagueName?: string;
    seasonYear?: number;
  };
  const { teamId, sport, teamName, leagueName, seasonYear } = body;

  if (!teamId) {
    return c.json({
      error: 'teamId is required in request body'
    }, 400);
  }

  const storage = EspnSupabaseStorage.fromEnvironment(c.env);

  // Get current leagues
  const currentLeagues = await storage.getLeagues(clerkUserId);

  // Find the specific league
  const league = currentLeagues.find(l =>
    l.leagueId === leagueId &&
    (sport ? l.sport === sport : true) &&
    (seasonYear !== undefined ? l.seasonYear === seasonYear : true)
  );

  if (!league) {
    return c.json({
      error: 'League not found',
      message: `League ${leagueId}${sport ? ` for sport ${sport}` : ''}${seasonYear ? ` season ${seasonYear}` : ''} not found for user`
    }, 404);
  }

  // Update league with new team information
  const targetSport = sport || league.sport;
  const targetSeasonYear = seasonYear ?? league.seasonYear;

  const updates: Partial<EspnLeague> = { teamId };
  if (teamName) updates.teamName = teamName;
  if (leagueName) updates.leagueName = leagueName;

  const success = await storage.updateLeague(clerkUserId, leagueId, targetSport, targetSeasonYear, updates);

  if (!success) {
    return c.json({ error: 'Failed to update team selection' }, 500);
  }

  const updatedLeagues = await storage.getLeagues(clerkUserId);
  const updatedLeague = updatedLeagues.find(l => l.leagueId === leagueId && l.sport === league.sport);

  return c.json({
    success: true,
    message: 'Team selection updated successfully',
    league: updatedLeague
  });
});

// =============================================================================
// 404 HANDLER
// =============================================================================

api.notFound((c) => {
  return c.json({
    error: 'Endpoint not found',
    message: 'Available endpoints',
    endpoints: {
      '/health': 'GET - Health check with Supabase connectivity test',
      '/credentials/espn': 'GET/POST/DELETE - ESPN credential management',
      '/credentials/espn?raw=true': 'GET - Retrieve actual credentials for sport workers',
      '/leagues': 'GET/POST/DELETE - League management (list, store, remove)',
      '/leagues/default': 'POST - Set default league (requires platform, leagueId, sport, seasonYear)',
      '/leagues/default/:sport': 'DELETE - Clear default league for a sport',
      '/leagues/add': 'POST - Add single league',
      '/leagues/:leagueId/team': 'PATCH - Update team selection for specific league',
      '/.well-known/oauth-authorization-server': 'GET - OAuth 2.0 metadata discovery',
      '/authorize': 'GET - Start OAuth authorization flow',
      '/oauth/code': 'POST - Create authorization code (requires Clerk JWT)',
      '/oauth/status': 'GET - Check OAuth connection status',
      '/oauth/revoke-all': 'POST - Revoke all tokens',
      '/oauth/revoke': 'POST - Revoke single token',
      '/token': 'POST - Exchange code for access token',
      '/revoke': 'POST - Revoke access token',
      '/register': 'POST - Dynamic client registration',
      '/extension/sync': 'POST - Sync ESPN credentials',
      '/extension/status': 'GET - Extension status',
      '/extension/connection': 'GET - Extension connection info',
      '/extension/discover': 'POST - Discover and save leagues',
      '/connect/yahoo/authorize': 'GET - Start Yahoo OAuth flow',
      '/connect/yahoo/callback': 'GET - Yahoo OAuth callback (public)',
      '/connect/yahoo/credentials': 'GET - Get Yahoo access token',
      '/connect/yahoo/status': 'GET - Check Yahoo connection status',
      '/connect/yahoo/disconnect': 'DELETE - Disconnect Yahoo account',
      '/user/preferences': 'GET - Get user preferences (default sport and per-sport defaults)',
      '/user/preferences/default-sport': 'POST - Set user default sport',
    },
    storage: 'supabase',
    oauth: 'enabled',
    version: '3.1.0'
  }, 404);
});

// =============================================================================
// ERROR HANDLER
// =============================================================================

api.onError((err, c) => {
  console.error('Auth worker error:', err);
  const corsHeaders = getCorsHeaders(c.req.raw);
  return new Response(JSON.stringify({
    error: 'Internal server error',
    details: err instanceof Error ? err.message : 'Unknown error'
  }), {
    status: 500,
    headers: { 'Content-Type': 'application/json', ...corsHeaders }
  });
});

// =============================================================================
// MOUNT ROUTES
// =============================================================================

// Gate preview-only routes to preview environment
app.use('/auth-preview', async (c, next) => {
  if (c.env.ENVIRONMENT !== 'preview') {
    return c.json({ error: 'Endpoint not found' }, 404);
  }
  await next();
});

app.use('/auth-preview/*', async (c, next) => {
  if (c.env.ENVIRONMENT !== 'preview') {
    return c.json({ error: 'Endpoint not found' }, 404);
  }
  await next();
});

// Mount API on root and with /auth prefix for custom domain routing
app.route('/', api);
app.route('/auth', api);
app.route('/auth-preview', api);

export default app;
