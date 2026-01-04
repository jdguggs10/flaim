/**
 * Auth Worker - Supabase-based Credential Storage + OAuth for Claude Direct Access
 *
 * Centralized Cloudflare Worker for handling ESPN credentials
 * with Supabase PostgreSQL storage, plus OAuth 2.1 for Claude MCP connectors.
 *
 * Credential Endpoints:
 * - GET /health - Health check with Supabase connectivity test
 * - POST /credentials/espn - Store ESPN credentials
 * - GET /credentials/espn - Get ESPN credential metadata
 * - DELETE /credentials/espn - Delete ESPN credentials
 * - GET /credentials/espn?raw=true - Get raw credentials for MCP workers
 * - POST /leagues - Store ESPN leagues
 * - GET /leagues - Get ESPN leagues
 * - DELETE /leagues - Remove specific league
 * - PATCH /leagues/:leagueId/team - Update team selection
 *
 * OAuth Endpoints (for Claude direct access):
 * - GET /.well-known/oauth-authorization-server - OAuth metadata discovery
 * - GET /authorize - Start OAuth flow (redirects to frontend)
 * - POST /oauth/code - Create auth code (called by frontend after consent)
 * - POST /token - Exchange code for access token
 * - POST /revoke - Revoke access token
 *
 * @version 3.0.0 - Added OAuth for Claude direct access
 */

import { EspnSupabaseStorage } from './supabase-storage';
import { EspnCredentials, EspnLeague } from './espn-types';
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
  handleCreatePairingCode,
  handlePairExtension,
  handleSyncCredentials,
  handleGetExtensionStatus,
  handleGetConnection,
  handleRevokeToken,
  validateExtensionToken,
  ExtensionEnv,
} from './extension-handlers';

// Rate limit configuration
const RATE_LIMIT_PER_DAY = 200;

// ------------------------------------------------------------
// Clerk JWT verification (JWKS-based)
// ------------------------------------------------------------
type Jwk = {
  kty: string;
  kid: string;
  n: string;
  e: string;
  alg?: string;
  use?: string;
};

type JwtHeader = { alg: string; kid?: string; typ?: string };
type JwtPayload = { sub?: string; iss?: string; exp?: number;[k: string]: any };

const jwksCache: Map<string, { keysByKid: Map<string, Jwk>; fetchedAt: number }> = new Map();
const JWKS_TTL_MS = 5 * 60 * 1000; // 5 minutes

function b64urlToUint8Array(b64url: string): Uint8Array {
  const pad = b64url.length % 4 === 2 ? '==' : b64url.length % 4 === 3 ? '=' : '';
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const str = atob(b64);
  const bytes = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) bytes[i] = str.charCodeAt(i);
  return bytes;
}

function decodeSection<T = any>(b64url: string): T {
  const bytes = b64urlToUint8Array(b64url);
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json) as T;
}

async function fetchJwks(issuer: string): Promise<Map<string, Jwk>> {
  const now = Date.now();
  const cached = jwksCache.get(issuer);
  if (cached && now - cached.fetchedAt < JWKS_TTL_MS) {
    return cached.keysByKid;
  }

  const wellKnown = issuer.replace(/\/$/, '') + '/.well-known/jwks.json';
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

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
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`JWKS fetch timeout for ${wellKnown}`);
    }
    throw error;
  }
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
    } as any,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );
}

async function verifyJwtAndGetUserId(authorization: string | null): Promise<string | null> {
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

  const keys = await fetchJwks(payload.iss);
  const jwk = keys.get(header.kid);
  if (!jwk) throw new Error('JWKS key not found');

  const key = await importRsaPublicKey(jwk);
  const data = new TextEncoder().encode(`${h}.${p}`);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data);
  if (!ok) throw new Error('JWT signature invalid');

  return payload.sub || null;
}

async function getVerifiedUserId(request: Request, env: Env): Promise<{ userId: string | null; error?: string; authType?: 'clerk' | 'oauth' }> {
  const authz = request.headers.get('Authorization');
  const requestUrl = new URL(request.url);
  console.log(`🔐 [auth-worker] getVerifiedUserId called for ${requestUrl.pathname}`);
  console.log(`🔐 [auth-worker] Authorization header present: ${!!authz}, length: ${authz?.length || 0}`);

  // Try Clerk JWT first (in-app requests)
  try {
    console.log(`🔐 [auth-worker] Attempting Clerk JWT verification...`);
    const verified = await verifyJwtAndGetUserId(authz);
    if (verified) {
      console.log(`✅ [auth-worker] Clerk JWT verified, userId: ${maskUserId(verified)}`);
      return { userId: verified, authType: 'clerk' };
    }
    console.log(`⚠️ [auth-worker] Clerk JWT verification returned null`);
  } catch (e) {
    // JWT verification failed, try OAuth token next
    console.log(`⚠️ [auth-worker] Clerk JWT verification failed: ${e instanceof Error ? e.message : 'unknown error'}`);
  }

  // Try OAuth token (Claude direct access)
  if (authz && authz.toLowerCase().startsWith('bearer ')) {
    const token = authz.slice(7).trim();
    // Only try OAuth if it doesn't look like a JWT (no dots or not 3 parts)
    const parts = token.split('.');
    console.log(`🔐 [auth-worker] Token has ${parts.length} parts (JWT has 3)`);
    if (parts.length !== 3) {
      try {
        console.log(`🔐 [auth-worker] Attempting OAuth token validation...`);
        const oauthResult = await validateOAuthToken(token, env as OAuthEnv);
        if (oauthResult) {
          console.log(`✅ [auth-worker] OAuth token validated, userId: ${maskUserId(oauthResult.userId)}`);
          return { userId: oauthResult.userId, authType: 'oauth' };
        }
        console.log(`⚠️ [auth-worker] OAuth token validation returned null`);
      } catch (e) {
        console.log('[auth] OAuth token validation failed:', e);
      }
    }
  }

  // Dev fallback only: allow header for local testing
  const isDev = (env as any).ENVIRONMENT === 'dev' || env.NODE_ENV === 'development';
  console.log(`🔐 [auth-worker] Environment check - ENVIRONMENT: ${(env as any).ENVIRONMENT}, NODE_ENV: ${env.NODE_ENV}, isDev: ${isDev}`);
  if (isDev) {
    const clerkHeader = request.headers.get('X-Clerk-User-ID');
    if (clerkHeader) {
      console.log(`⚠️ [auth-worker] DEV MODE: Using X-Clerk-User-ID header fallback: ${maskUserId(clerkHeader)}`);
      return { userId: clerkHeader, authType: 'clerk' };
    }
  }

  console.log(`❌ [auth-worker] All auth methods failed, returning null userId`);
  return { userId: null, error: 'Missing or invalid Authorization token' };
}

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  NODE_ENV?: string;
  ENVIRONMENT?: string; // 'dev' | 'preview' | 'prod'
}

// CORS helper - Allow sport workers and Next.js origins
const ALLOWED_ORIGINS = [
  // Vercel deployments
  'https://*.vercel.app',                          // All Vercel preview deployments
  // Production
  'https://flaim.app',
  'https://www.flaim.app',                         // Production with www subdomain
  // Local development
  'http://localhost:8787',                         // Wrangler dev server (HTTP)
  'https://localhost:8787',                        // Wrangler dev server (HTTPS)
  'http://localhost:3000',                         // Next.js dev server
];

function getCorsHeaders(request: Request) {
  const origin = request.headers.get('Origin');
  const headers: { [key: string]: string } = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Clerk-User-ID',
    'Access-Control-Max-Age': '86400', // Cache preflight for 24 hours
  };

  if (origin && isOriginAllowed(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

function isOriginAllowed(origin: string): boolean {
  return ALLOWED_ORIGINS.some(allowedOrigin => {
    if (allowedOrigin.includes('*')) {
      // Handle wildcard patterns
      const pattern = allowedOrigin.replace(/\*/g, '.*');
      const regex = new RegExp(`^${pattern}$`);
      return regex.test(origin);
    }
    return allowedOrigin === origin;
  });
}

// Extract Clerk User ID from header
// getClerkUserId is replaced by getVerifiedUserId for prod; dev keeps header fallback

// Validate ESPN credentials
function validateEspnCredentials(credentials: any): { valid: boolean; error?: string } {
  if (!credentials.swid || !credentials.s2) {
    return { valid: false, error: 'ESPN credentials require swid and s2 fields' };
  }

  return { valid: true };
}

// Mask user ID for logging to avoid PII exposure
function maskUserId(userId: string): string {
  if (!userId || userId.length <= 8) return '***';
  return `${userId.substring(0, 8)}...`;
}

// Main request handler
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = getCorsHeaders(request);

    // Strip /auth or /auth-preview prefix if present (for custom domain routing)
    let pathname = url.pathname;
    if (pathname.startsWith('/auth-preview')) {
      pathname = pathname.slice(13) || '/';  // Strip '/auth-preview' (13 chars)
    } else if (pathname.startsWith('/auth')) {
      pathname = pathname.slice(5) || '/';   // Strip '/auth' (5 chars)
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Health check endpoint
      if (pathname === '/health') {
        const healthData: any = {
          status: 'healthy',
          service: 'auth-worker',
          version: '2.0.0',
          timestamp: new Date().toISOString(),
          storage: 'supabase'
        };

        // Test Supabase connectivity
        try {
          if (env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
            const storage = EspnSupabaseStorage.fromEnvironment(env);
            // Simple connectivity test
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

        return new Response(JSON.stringify(healthData), {
          status: statusCode,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // ================================================================
      // OAuth 2.1 Endpoints (for Claude direct access)
      // ================================================================

      // OAuth metadata discovery (RFC 8414)
      if (pathname === '/.well-known/oauth-authorization-server') {
        return handleMetadataDiscovery(env as OAuthEnv, corsHeaders);
      }

      // Dynamic Client Registration (RFC 7591)
      if (pathname === '/register') {
        return handleClientRegistration(request, env as OAuthEnv, corsHeaders);
      }

      // Authorization endpoint - redirects to frontend consent page
      if (pathname === '/authorize' && request.method === 'GET') {
        return handleAuthorize(request, env as OAuthEnv);
      }

      // Create authorization code (called by frontend after user consent)
      if (pathname === '/oauth/code' && request.method === 'POST') {
        const { userId, error: authError } = await getVerifiedUserId(request, env);
        if (!userId) {
          return new Response(JSON.stringify({
            error: 'unauthorized',
            error_description: authError || 'Authentication required',
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        return handleCreateCode(request, env as OAuthEnv, userId, corsHeaders);
      }

      // Check connection status (called by frontend)
      if (pathname === '/oauth/status' && request.method === 'GET') {
        const { userId, error: authError } = await getVerifiedUserId(request, env);
        if (!userId) {
          return new Response(JSON.stringify({
            error: 'unauthorized',
            error_description: authError || 'Authentication required',
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        return handleCheckStatus(env as OAuthEnv, userId, corsHeaders);
      }

      // Revoke all tokens for user (called by frontend)
      if (pathname === '/oauth/revoke-all' && request.method === 'POST') {
        const { userId, error: authError } = await getVerifiedUserId(request, env);
        if (!userId) {
          return new Response(JSON.stringify({
            error: 'unauthorized',
            error_description: authError || 'Authentication required',
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        return handleRevokeAll(env as OAuthEnv, userId, corsHeaders);
      }

      // Revoke a single token by ID (called by frontend)
      if (pathname === '/oauth/revoke' && request.method === 'POST') {
        const { userId, error: authError } = await getVerifiedUserId(request, env);
        if (!userId) {
          return new Response(JSON.stringify({
            error: 'unauthorized',
            error_description: authError || 'Authentication required',
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        return handleRevokeSingle(request, env as OAuthEnv, userId, corsHeaders);
      }

      // Token endpoint - exchange code for access token
      if (pathname === '/token' && request.method === 'POST') {
        return handleToken(request, env as OAuthEnv, corsHeaders);
      }

      // Revocation endpoint
      if (pathname === '/revoke' && request.method === 'POST') {
        return handleRevoke(request, env as OAuthEnv, corsHeaders);
      }

      // ================================================================
      // Chrome Extension Endpoints
      // ================================================================

      // Generate pairing code (requires Clerk auth)
      if (pathname === '/extension/code' && request.method === 'POST') {
        const { userId, error: authError } = await getVerifiedUserId(request, env);
        if (!userId) {
          return new Response(JSON.stringify({
            error: 'unauthorized',
            error_description: authError || 'Authentication required',
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        return handleCreatePairingCode(env as ExtensionEnv, userId, corsHeaders);
      }

      // Exchange pairing code for token (no auth - code IS auth)
      if (pathname === '/extension/pair' && request.method === 'POST') {
        return handlePairExtension(request, env as ExtensionEnv, corsHeaders);
      }

      // Sync ESPN credentials (requires extension token)
      if (pathname === '/extension/sync' && request.method === 'POST') {
        const tokenResult = await validateExtensionToken(request, env as ExtensionEnv);
        if (!tokenResult.valid || !tokenResult.userId || !tokenResult.token) {
          return new Response(JSON.stringify({
            error: 'unauthorized',
            error_description: tokenResult.error || 'Invalid token',
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        return handleSyncCredentials(request, env as ExtensionEnv, tokenResult.userId, tokenResult.token, corsHeaders);
      }

      // Get extension status (requires extension token)
      if (pathname === '/extension/status' && request.method === 'GET') {
        const tokenResult = await validateExtensionToken(request, env as ExtensionEnv);
        if (!tokenResult.valid || !tokenResult.userId || !tokenResult.token) {
          return new Response(JSON.stringify({
            error: 'unauthorized',
            error_description: tokenResult.error || 'Invalid token',
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        return handleGetExtensionStatus(env as ExtensionEnv, tokenResult.userId, tokenResult.token, corsHeaders);
      }

      // Get extension connection for web UI (requires Clerk auth)
      if (pathname === '/extension/connection' && request.method === 'GET') {
        const { userId, error: authError } = await getVerifiedUserId(request, env);
        if (!userId) {
          return new Response(JSON.stringify({
            error: 'unauthorized',
            error_description: authError || 'Authentication required',
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        return handleGetConnection(env as ExtensionEnv, userId, corsHeaders);
      }

      // Revoke extension token (requires Clerk auth)
      if (pathname === '/extension/token' && request.method === 'DELETE') {
        const { userId, error: authError } = await getVerifiedUserId(request, env);
        if (!userId) {
          return new Response(JSON.stringify({
            error: 'unauthorized',
            error_description: authError || 'Authentication required',
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        return handleRevokeToken(request, env as ExtensionEnv, userId, corsHeaders);
      }

      // ESPN credential management endpoints
      if (pathname === '/credentials/espn') {
        // Extract Clerk User ID from header
        const { userId: clerkUserId, error: authError, authType } = await getVerifiedUserId(request, env);
        console.log(`🔐 [auth-worker] /credentials/espn - Verified user: ${clerkUserId ? maskUserId(clerkUserId) : 'null'}, authType: ${authType || 'none'}, authError: ${authError || 'none'}`);
        console.log(`🔐 [auth-worker] /credentials/espn - Raw query: ${url.search}, raw param: ${url.searchParams.get('raw')}`);

        if (!clerkUserId) {
          return new Response(JSON.stringify({
            error: 'Authentication required',
            message: authError || 'Missing or invalid Authorization token'
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const storage = EspnSupabaseStorage.fromEnvironment(env);

        if (request.method === 'POST' || request.method === 'PUT') {
          // Store ESPN credentials
          const body = await request.json() as { swid?: string; s2?: string; email?: string };
          const validation = validateEspnCredentials(body);

          if (!validation.valid) {
            return new Response(JSON.stringify({
              error: 'Invalid credentials',
              message: validation.error
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          const success = await storage.setCredentials(clerkUserId, body.swid!, body.s2!, body.email);

          if (!success) {
            return new Response(JSON.stringify({
              error: 'Failed to store credentials'
            }), {
              status: 500,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          return new Response(JSON.stringify({
            success: true,
            message: 'ESPN credentials stored successfully'
          }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });

        } else if (request.method === 'GET') {
          // Check if this is a request for actual credentials (from sport workers)
          const getRawCredentials = url.searchParams.get('raw') === 'true';

          if (getRawCredentials) {
            // Return actual credentials for sport workers
            console.log(`🔍 [auth-worker] GET raw credentials for user: ${maskUserId(clerkUserId)}`);
            console.log(`🔍 [auth-worker] Authorization header present: ${!!request.headers.get('Authorization')}`);

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
                  'X-User-Id': clerkUserId,
                  'X-RateLimit-Limit': String(rateLimit.limit),
                  'X-RateLimit-Remaining': '0',
                  'X-RateLimit-Reset': String(Math.floor(rateLimit.resetAt.getTime() / 1000)),
                  'Retry-After': String(Math.ceil((rateLimit.resetAt.getTime() - Date.now()) / 1000)),
                  ...corsHeaders
                }
              });
            }

            // Increment rate limit counter immediately
            const currentUsage = await oauthStorage.incrementRateLimit(clerkUserId);
            const remaining = Math.max(0, RATE_LIMIT_PER_DAY - currentUsage);

            console.log(`🔍 [auth-worker] Fetching raw credentials from Supabase for user: ${maskUserId(clerkUserId)}`);
            const credentials = await storage.getCredentials(clerkUserId);

            if (!credentials) {
              console.log(`❌ [auth-worker] No credentials found in Supabase for user: ${maskUserId(clerkUserId)}`);
              return new Response(JSON.stringify({
                error: 'Credentials not found',
                message: 'No ESPN credentials found for user. Add your ESPN credentials at /settings/espn'
              }), {
                status: 404,
                headers: {
                  'Content-Type': 'application/json',
                  'X-User-Id': clerkUserId,
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
                'X-User-Id': clerkUserId,
                'X-RateLimit-Limit': String(RATE_LIMIT_PER_DAY),
                'X-RateLimit-Remaining': String(remaining),
                'X-RateLimit-Reset': String(Math.floor(rateLimit.resetAt.getTime() / 1000)),
                ...corsHeaders
              }
            });
          } else {
            // Check if this is an edit request (return actual credentials for frontend editing)
            const forEdit = url.searchParams.get('forEdit') === 'true';

            if (forEdit) {
              // Return actual credentials for editing (frontend use only, no rate limit)
              const credentials = await storage.getCredentials(clerkUserId);

              if (!credentials) {
                return new Response(JSON.stringify({
                  hasCredentials: false,
                  message: 'No ESPN credentials found'
                }), {
                  status: 404,
                  headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
              }

              return new Response(JSON.stringify({
                hasCredentials: true,
                platform: 'espn',
                swid: credentials.swid,
                s2: credentials.s2
              }), {
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
              });
            }

            // Get full setup status (default behavior for frontend)
            const setupStatus = await storage.getSetupStatus(clerkUserId);
            const metadata = await storage.getCredentialMetadata(clerkUserId);

            // Return setup status even if credentials don't exist (for inline banner logic)
            return new Response(JSON.stringify({
              hasCredentials: setupStatus.hasCredentials,
              hasLeagues: setupStatus.hasLeagues,
              hasDefaultTeam: setupStatus.hasDefaultTeam,
              platform: 'espn',
              email: metadata?.email,
              lastUpdated: metadata?.lastUpdated
            }), {
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

        } else if (request.method === 'DELETE') {
          // Delete ESPN credentials
          const success = await storage.deleteCredentials(clerkUserId);

          if (!success) {
            return new Response(JSON.stringify({
              error: 'Failed to delete credentials'
            }), {
              status: 500,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          return new Response(JSON.stringify({
            success: true,
            message: 'ESPN credentials deleted successfully'
          }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        return new Response(JSON.stringify({
          error: 'Method not allowed'
        }), {
          status: 405,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // League management endpoints
      if (pathname === '/leagues') {
        // Extract Clerk User ID from header
        const { userId: clerkUserId, error: authError } = await getVerifiedUserId(request, env);
        if (!clerkUserId) {
          return new Response(JSON.stringify({
            error: 'Authentication required',
            message: authError || 'Missing or invalid Authorization token'
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const storage = EspnSupabaseStorage.fromEnvironment(env);

        if (request.method === 'POST' || request.method === 'PUT') {
          // Save leagues
          const body = (await request.json()) as any;
          const leagues = body?.leagues as EspnLeague[] | undefined;

          if (!leagues || !Array.isArray(leagues)) {
            return new Response(JSON.stringify({
              error: 'Invalid request: leagues array is required'
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          // Basic validation
          if (leagues.length > 10) {
            return new Response(JSON.stringify({
              error: 'Maximum of 10 leagues allowed per user'
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          const success = await storage.setLeagues(clerkUserId, leagues);

          if (!success) {
            return new Response(JSON.stringify({
              error: 'Failed to store leagues'
            }), {
              status: 500,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          return new Response(JSON.stringify({
            success: true,
            message: 'Leagues saved successfully',
            totalLeagues: leagues.length,
            leagues
          }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });

        } else if (request.method === 'GET') {
          const leagues = await storage.getLeagues(clerkUserId);

          return new Response(JSON.stringify({
            success: true,
            leagues,
            totalLeagues: leagues.length
          }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });

        } else if (request.method === 'DELETE') {
          // Remove a single league
          const urlObj = new URL(request.url);
          const leagueId = urlObj.searchParams.get('leagueId');
          const sport = urlObj.searchParams.get('sport');

          if (!leagueId || !sport) {
            return new Response(JSON.stringify({
              error: 'leagueId and sport query parameters are required'
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          const success = await storage.removeLeague(clerkUserId, leagueId, sport);

          if (!success) {
            return new Response(JSON.stringify({
              error: 'Failed to remove league'
            }), {
              status: 500,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          // Get updated leagues list
          const updatedLeagues = await storage.getLeagues(clerkUserId);

          return new Response(JSON.stringify({
            success: true,
            message: 'League removed',
            totalLeagues: updatedLeagues.length,
            leagues: updatedLeagues
          }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        return new Response(JSON.stringify({
          error: 'Method not allowed'
        }), {
          status: 405,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // Set default league endpoint
      if (pathname === '/leagues/default' && request.method === 'POST') {
        const { userId: clerkUserId, error: authError } = await getVerifiedUserId(request, env);
        if (!clerkUserId) {
          return new Response(JSON.stringify({
            error: 'Authentication required',
            message: authError || 'Missing or invalid Authorization token'
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const body = await request.json() as { leagueId?: string; sport?: string };
        const { leagueId, sport } = body;

        if (!leagueId || !sport) {
          return new Response(JSON.stringify({
            error: 'leagueId and sport are required in request body'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const storage = EspnSupabaseStorage.fromEnvironment(env);
        const result = await storage.setDefaultLeague(clerkUserId, leagueId, sport);

        if (!result.success) {
          // Return appropriate status based on error type
          const status = result.error === 'League not found' ? 404 : 400;
          return new Response(JSON.stringify({
            error: result.error || 'Failed to set default league'
          }), {
            status,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        // Get updated leagues list
        const updatedLeagues = await storage.getLeagues(clerkUserId);

        return new Response(JSON.stringify({
          success: true,
          message: 'Default league set successfully',
          leagues: updatedLeagues
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // League team selection endpoint
      const leagueTeamMatch = pathname.match(/^\/leagues\/([^\/]+)\/team$/);
      if (leagueTeamMatch && request.method === 'PATCH') {
        const leagueId = leagueTeamMatch[1];

        // Extract Clerk User ID from header
        const { userId: clerkUserId, error: authError } = await getVerifiedUserId(request, env);
        if (!clerkUserId) {
          return new Response(JSON.stringify({
            error: 'Authentication required',
            message: authError || 'Missing or invalid Authorization token'
          }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const body = await request.json() as any;
        const { teamId, sport, teamName, leagueName, seasonYear } = body;

        if (!teamId) {
          return new Response(JSON.stringify({
            error: 'teamId is required in request body'
          }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const storage = EspnSupabaseStorage.fromEnvironment(env);

        // Get current leagues
        const currentLeagues = await storage.getLeagues(clerkUserId);

        // Find the specific league
        const league = currentLeagues.find(l =>
          l.leagueId === leagueId &&
          (sport ? l.sport === sport : true)
        );

        if (!league) {
          return new Response(JSON.stringify({
            error: 'League not found',
            message: `League ${leagueId}${sport ? ` for sport ${sport}` : ''} not found for user`
          }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        // Update league with new team information
        const updates: Partial<EspnLeague> = { teamId };
        if (teamName) updates.teamName = teamName;
        if (leagueName) updates.leagueName = leagueName;
        if (seasonYear) updates.seasonYear = seasonYear;

        const success = await storage.updateLeague(clerkUserId, leagueId, updates);

        if (!success) {
          return new Response(JSON.stringify({
            error: 'Failed to update team selection'
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        // Get updated league info
        const updatedLeagues = await storage.getLeagues(clerkUserId);
        const updatedLeague = updatedLeagues.find(l => l.leagueId === leagueId && l.sport === league.sport);

        return new Response(JSON.stringify({
          success: true,
          message: 'Team selection updated successfully',
          league: updatedLeague
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // 404 for unknown endpoints
      return new Response(JSON.stringify({
        error: 'Endpoint not found',
        message: 'Available endpoints',
        endpoints: {
          // Health
          '/health': 'GET - Health check with Supabase connectivity test',
          // Credentials
          '/credentials/espn': 'GET/POST/DELETE - ESPN credential management',
          '/credentials/espn?raw=true': 'GET - Retrieve actual credentials for sport workers',
          // Leagues
          '/leagues': 'GET/POST/DELETE - League management (list, store, remove)',
          '/leagues/default': 'POST - Set default league for user',
          '/leagues/:leagueId/team': 'PATCH - Update team selection for specific league',
          // OAuth (Claude direct access)
          '/.well-known/oauth-authorization-server': 'GET - OAuth 2.0 metadata discovery',
          '/authorize': 'GET - Start OAuth authorization flow',
          '/oauth/code': 'POST - Create authorization code (requires Clerk JWT)',
          '/token': 'POST - Exchange code for access token',
          '/revoke': 'POST - Revoke access token',
        },
        storage: 'supabase',
        oauth: 'enabled',
        version: '3.0.0'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

    } catch (error) {
      console.error('Auth worker error:', error);
      return new Response(JSON.stringify({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });
    }
  }
};
