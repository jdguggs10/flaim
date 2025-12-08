/**
 * Auth Worker - Supabase-based Credential Storage
 * 
 * Centralized Cloudflare Worker for handling ESPN credentials
 * with Supabase PostgreSQL storage.
 * 
 * Endpoints:
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
 * @version 2.0.0 - Supabase implementation
 */

import { EspnSupabaseStorage } from './supabase-storage';
import { EspnCredentials, EspnLeague } from './espn-types';

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
type JwtPayload = { sub?: string; iss?: string; exp?: number; [k: string]: any };

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
  const res = await fetch(wellKnown, { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!res.ok) throw new Error(`Failed to fetch JWKS from ${wellKnown}: ${res.status}`);
  const data = await res.json() as { keys: Jwk[] };
  const map = new Map<string, Jwk>();
  for (const k of data.keys || []) {
    if (k.kid) map.set(k.kid, k);
  }
  jwksCache.set(issuer, { keysByKid: map, fetchedAt: now });
  return map;
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

async function getVerifiedUserId(request: Request, env: Env): Promise<{ userId: string | null; error?: string }> {
  try {
    const authz = request.headers.get('Authorization');
    const verified = await verifyJwtAndGetUserId(authz);
    if (verified) return { userId: verified };
  } catch (e) {
    // fall through to dev fallback or return error below
  }

  // Dev fallback only: allow header for local testing
  const isDev = (env as any).ENVIRONMENT === 'dev' || env.NODE_ENV === 'development';
  if (isDev) {
    const clerkHeader = request.headers.get('X-Clerk-User-ID');
    if (clerkHeader) return { userId: clerkHeader };
  }

  return { userId: null, error: 'Missing or invalid Authorization token' };
}

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  NODE_ENV?: string;
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

// Main request handler
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = getCorsHeaders(request);

    // Strip /auth prefix if present (for custom domain routing)
    let pathname = url.pathname;
    if (pathname.startsWith('/auth')) {
      pathname = pathname.slice(5) || '/';
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

        healthData.auth_method = 'X-Clerk-User-ID header';

        const statusCode = healthData.status === 'healthy' ? 200 : 503;

        return new Response(JSON.stringify(healthData), {
          status: statusCode,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // ESPN credential management endpoints
      if (pathname === '/credentials/espn') {
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
            const credentials = await storage.getCredentials(clerkUserId);
            
            if (!credentials) {
              return new Response(JSON.stringify({
                error: 'Credentials not found',
                message: 'No ESPN credentials found for user'
              }), {
                status: 404,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
              });
            }

            return new Response(JSON.stringify({
              success: true,
              platform: 'espn',
              credentials
            }), {
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          } else {
            // Get credential metadata (default behavior for frontend)
            const metadata = await storage.getCredentialMetadata(clerkUserId);
            
            if (!metadata?.hasCredentials) {
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
              email: metadata.email,
              lastUpdated: metadata.lastUpdated
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
          '/health': 'GET - Health check with Supabase connectivity test',
          '/credentials/espn': 'GET/POST/DELETE - ESPN credential management',
          '/credentials/espn?raw=true': 'GET - Retrieve actual credentials for sport workers',
          '/leagues': 'GET/POST/DELETE - League management (list, store, remove)',
          '/leagues/:leagueId/team': 'PATCH - Update team selection for specific league'
        },
        storage: 'supabase',
        version: '2.0.0'
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
