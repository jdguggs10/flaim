// Baseball ESPN MCP Server v4.0 - Open Access
// Focuses purely on ESPN API integration with auth-worker service

import { McpAgent } from './mcp/agent.js';
import { getBasicLeagueInfo } from './mcp/basic-league-info.js';

export interface Env {
  NODE_ENV?: string;
  ENVIRONMENT?: string;
  AUTH_WORKER_URL: string;
  AUTH_WORKER?: Fetcher;  // Service Binding for auth-worker
}

/**
 * Fetch from auth-worker using service binding (preferred) or URL fallback.
 * Service bindings avoid Cloudflare error 1042 for same-zone worker-to-worker calls.
 */
function authWorkerFetch(env: Env, path: string, init?: RequestInit): Promise<Response> {
  const safePath = path.startsWith('/') ? path : `/${path}`;
  if (env.AUTH_WORKER) {
    const url = new URL(safePath, 'https://auth-worker.internal');
    return env.AUTH_WORKER.fetch(new Request(url.toString(), init));
  }
  // Log warning in prod when binding is missing
  if (env.ENVIRONMENT === 'prod') {
    console.warn('[authWorkerFetch] AUTH_WORKER binding missing in prod; using URL fallback');
  }
  if (!env.AUTH_WORKER_URL) {
    throw new Error('AUTH_WORKER_URL is not configured');
  }
  return fetch(`${env.AUTH_WORKER_URL}${safePath}`, init);
}

// ESPN Credentials interface
export interface EspnCredentials {
  swid: string;
  s2: string;
  email?: string;
}

/**
 * Fetch ESPN credentials from auth-worker for a given Clerk user ID
 */
async function getCredentials(
  env: Env,
  clerkUserId: string,
  authHeader?: string | null
): Promise<EspnCredentials | null> {
  try {
    // Debug: Log configuration
    console.log(`🔧 [baseball] getCredentials: hasBinding=${!!env.AUTH_WORKER}, hasAuthHeader=${!!authHeader}, authHeaderLength=${authHeader?.length || 0}`);

    console.log(`🔑 [baseball] Fetching ESPN credentials for user ${clerkUserId}`);

    // Parse JWT to compare user ID
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
      try {
        const token = authHeader.slice(7);
        const parts = token.split('.');
        if (parts.length === 3) {
          const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
          console.log(`🔍 [baseball] JWT payload.sub: ${payload.sub}, clerkUserId param: ${clerkUserId}, match: ${payload.sub === clerkUserId}`);
        }
      } catch (e) {
        console.log(`⚠️ [baseball] Could not parse JWT for comparison`);
      }
    }

    const headers: Record<string, string> = {
      'X-Clerk-User-ID': clerkUserId,
      'Content-Type': 'application/json',
    };

    if (authHeader) {
      headers['Authorization'] = authHeader;
      console.log(`🔐 [baseball] Authorization header present, starts with: ${authHeader.substring(0, 15)}...`);
    } else {
      console.warn(`⚠️ [baseball] No Authorization header provided - auth-worker may reject this request`);
    }

    const response = await authWorkerFetch(env, '/credentials/espn?raw=true', {
      method: 'GET',
      headers
    });

    console.log(`📡 [baseball] Auth-worker response: ${response.status} ${response.statusText}`);

    // Log response headers for debugging
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => { responseHeaders[key] = value; });
    console.log(`📋 [baseball] Auth-worker response headers: ${JSON.stringify(responseHeaders)}`);

    if (response.status === 404) {
      const errorBody = await response.text().catch(() => 'unknown');
      console.log(`ℹ️ [baseball] 404 response body: ${errorBody}`);
      console.log(`❓ [baseball] 404 indicates auth-worker could not find credentials for this user`);
      return null;
    }

    if (response.status === 401) {
      const errorBody = await response.text().catch(() => 'unknown');
      console.error(`❌ [baseball] Auth failed (401): ${errorBody}`);
      throw new Error(`Auth-worker authentication failed: ${errorBody}`);
    }

    if (!response.ok) {
      console.error(`❌ [baseball] Auth-worker error: ${response.status} ${response.statusText}`);
      const errorData = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(`Auth-worker error: ${errorData.error || response.statusText}`);
    }

    const data = await response.json() as { success?: boolean; credentials?: EspnCredentials };

    if (!data.success || !data.credentials) {
      console.error('❌ [baseball] Invalid response from auth-worker:', JSON.stringify(data));
      throw new Error('Invalid credentials response from auth-worker');
    }

    console.log('✅ [baseball] Successfully retrieved ESPN credentials');
    return data.credentials;

  } catch (error) {
    console.error('❌ [baseball] Failed to fetch credentials from auth-worker:', error);
    throw error;
  }
}

/**
 * Fetch user's leagues from auth-worker
 */
async function getUserLeagues(
  env: Env,
  clerkUserId: string,
  authHeader?: string | null
): Promise<Array<{ leagueId: string; sport: string; teamId?: string; seasonYear?: number }>> {
  try {
    console.log(`🏈 Fetching user leagues for ${clerkUserId}`);

    const response = await authWorkerFetch(env, '/leagues', {
      method: 'GET',
      headers: {
        'X-Clerk-User-ID': clerkUserId,
        'Content-Type': 'application/json',
        ...(authHeader ? { 'Authorization': authHeader } : {})
      }
    });

    console.log(`📡 Auth-worker leagues response: ${response.status} ${response.statusText}`);

    if (response.status === 404) {
      console.log('ℹ️ No leagues found for user');
      return [];
    }

    if (!response.ok) {
      console.error(`❌ Auth-worker leagues error: ${response.status} ${response.statusText}`);
      const errorData = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(`Auth-worker error: ${errorData.error || response.statusText}`);
    }

    const data = await response.json() as { success?: boolean; leagues?: Array<{ leagueId: string; sport: string; teamId?: string; seasonYear?: number }> };

    if (!data.success) {
      console.error('❌ Invalid leagues response from auth-worker:', data);
      return [];
    }

    console.log(`✅ Successfully retrieved ${data.leagues?.length || 0} leagues`);
    return data.leagues || [];

  } catch (error) {
    console.error('❌ Failed to fetch leagues from auth-worker:', error);
    throw error;
  }
}

// Helper function for CORS headers
const ALLOWED_ORIGINS = [
  'https://*.vercel.app',                          // All Vercel preview deployments
  'https://flaim.app',                             // Production
  'http://localhost:8787',                         // Wrangler dev server (HTTP)
  'https://localhost:8787',                        // Wrangler dev server (HTTPS)
  'http://localhost:3000'                          // Next.js dev server
];

function getCorsHeaders(request: Request) {
  const origin = request.headers.get('Origin');
  const headers: { [key: string]: string } = {
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Clerk-User-ID',
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


export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const corsHeaders = getCorsHeaders(request);

    // Strip /baseball prefix if present (for custom domain routing)
    let pathname = url.pathname;
    if (pathname.startsWith('/baseball')) {
      pathname = pathname.slice(9) || '/';
    }

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Health check endpoint with auth-worker connectivity test
      if (pathname === '/health') {
        const healthData: any = {
          status: 'healthy',
          service: 'baseball-espn-mcp',
          version: '4.0.0',
          timestamp: new Date().toISOString()
        };

        // Test auth-worker connectivity
        try {
          const authResponse = await authWorkerFetch(env, '/health');
          healthData.auth_worker_status = authResponse.ok ? 'connected' : 'error';
          healthData.auth_worker_binding = !!env.AUTH_WORKER;
          if (!authResponse.ok) {
            healthData.status = 'degraded';
          }
        } catch (error) {
          healthData.auth_worker_status = 'error';
          healthData.auth_worker_error = error instanceof Error ? error.message : 'Unknown auth-worker error';
          healthData.status = 'degraded';
        }

        healthData.credential_storage = 'supabase_via_auth_worker';

        const statusCode = healthData.status === 'healthy' ? 200 : 503;

        return new Response(JSON.stringify(healthData), {
          status: statusCode,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // OAuth Protected Resource Metadata (RFC 9728)
      // This tells Claude where to find the authorization server
      if (pathname === '/.well-known/oauth-protected-resource') {
        const metadata = {
          resource: 'https://api.flaim.app/baseball/mcp',
          authorization_servers: ['https://api.flaim.app'],
          bearer_methods_supported: ['header'],
          scopes_supported: ['mcp:read', 'mcp:write']
        };
        return new Response(JSON.stringify(metadata), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=3600',
            ...corsHeaders
          }
        });
      }

      // Onboarding initialize endpoint
      if (pathname === '/onboarding/initialize' && request.method === 'POST') {
        try {
          const clerkUserId = request.headers.get('X-Clerk-User-ID');
          const authHeader = request.headers.get('Authorization');

          // Debug: Log all relevant headers
          console.log(`🔍 [baseball] /onboarding/initialize - Headers received:`);
          console.log(`   X-Clerk-User-ID: ${clerkUserId || 'MISSING'}`);
          console.log(`   Authorization: ${authHeader ? `present (${authHeader.length} chars, starts with: ${authHeader.substring(0, 15)}...)` : 'MISSING'}`);
          console.log(`   AUTH_WORKER_URL env: ${env.AUTH_WORKER_URL || 'NOT SET'}`);

          if (!clerkUserId) {
            return new Response(JSON.stringify({
              error: 'Authentication required - X-Clerk-User-ID header missing'
            }), {
              status: 401,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          const body = await request.json() as { sport?: string; leagueId?: string; seasonYear?: number };
          const { sport, leagueId, seasonYear } = body;

          console.log(`🚀 [baseball] Initialize onboarding for user: ${clerkUserId}, sport: ${sport}, leagueId: ${leagueId}, seasonYear: ${seasonYear || 'default'}`);

          // Get credentials from auth-worker
          const credentials = await getCredentials(env, clerkUserId, request.headers.get('Authorization'));
          if (!credentials) {
            return new Response(JSON.stringify({
              error: 'ESPN credentials not found. Please add your ESPN credentials first.',
              code: 'CREDENTIALS_MISSING'
            }), {
              status: 404,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          // If leagueId is provided, use discovery mode (don't require pre-saved league)
          // This enables auto-pull for new leagues
          let targetLeagues: Array<{ leagueId: string; sport: string; teamId?: string; seasonYear?: number }> = [];

          if (leagueId) {
            // Discovery mode: fetch league info directly without requiring it to be saved
            // Use seasonYear from request body for discovery
            console.log(`🔍 [baseball] Discovery mode: fetching league ${leagueId} directly from ESPN`);
            targetLeagues = [{ leagueId, sport: 'baseball', seasonYear }];
          } else {
            // Get user's saved leagues from auth-worker (includes seasonYear)
            const leagues = await getUserLeagues(env, clerkUserId, request.headers.get('Authorization'));
            const baseballLeagues = leagues.filter(league => league.sport === 'baseball');

            if (baseballLeagues.length === 0) {
              return new Response(JSON.stringify({
                error: 'No baseball leagues found. Please add baseball leagues first.',
                code: 'LEAGUES_MISSING'
              }), {
                status: 404,
                headers: { 'Content-Type': 'application/json', ...corsHeaders }
              });
            }
            targetLeagues = baseballLeagues;
          }

          console.log(`⚾ Processing ${targetLeagues.length} baseball league(s) for user`);

          // Fetch basic info for the target league(s)
          const leagueResults = [];
          for (const league of targetLeagues) {
            try {
              // Use the league's stored seasonYear, or fallback to request seasonYear
              const leagueSeasonYear = league.seasonYear ?? seasonYear;
              const basicInfo = await getBasicLeagueInfo({
                leagueId: league.leagueId,
                sport: league.sport,
                gameId: 'flb', // ESPN Fantasy Baseball game ID
                credentials,
                seasonYear: leagueSeasonYear
              });

              leagueResults.push({
                leagueId: league.leagueId,
                sport: league.sport,
                teamId: league.teamId,
                seasonYear: leagueSeasonYear,
                ...basicInfo
              });
            } catch (error) {
              console.error(`❌ Failed to get info for league ${league.leagueId}:`, error);
              leagueResults.push({
                leagueId: league.leagueId,
                sport: league.sport,
                teamId: league.teamId,
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
              });
            }
          }

          return new Response(JSON.stringify({
            success: true,
            message: 'Onboarding initialized successfully',
            sport: 'baseball',
            totalLeagues: targetLeagues.length,
            leagues: leagueResults
          }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });

        } catch (error) {
          console.error('❌ Onboarding initialize error:', error);
          return new Response(JSON.stringify({
            error: 'Failed to initialize onboarding',
            details: error instanceof Error ? error.message : 'Unknown error'
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
      }

      // Discover seasons endpoint - probes ESPN for all historical seasons of a league
      if (pathname === '/onboarding/discover-seasons' && request.method === 'POST') {
        try {
          const clerkUserId = request.headers.get('X-Clerk-User-ID');
          const authHeader = request.headers.get('Authorization');

          console.log(`🔍 [baseball] /onboarding/discover-seasons - userId: ${clerkUserId || 'MISSING'}`);

          if (!clerkUserId) {
            return new Response(JSON.stringify({
              error: 'Authentication required',
              code: 'AUTH_MISSING'
            }), {
              status: 401,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          const body = await request.json() as { leagueId?: string };
          const { leagueId } = body;

          if (!leagueId) {
            return new Response(JSON.stringify({
              error: 'leagueId is required'
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          // Get credentials
          const credentials = await getCredentials(env, clerkUserId, authHeader || undefined);
          if (!credentials) {
            return new Response(JSON.stringify({
              error: 'ESPN credentials not found',
              code: 'CREDENTIALS_MISSING'
            }), {
              status: 404,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          // Fetch existing leagues to skip already-stored seasons
          const leaguesResponse = await authWorkerFetch(env, '/leagues', {
            method: 'GET',
            headers: {
              'X-Clerk-User-ID': clerkUserId,
              ...(authHeader ? { 'Authorization': authHeader } : {})
            }
          });
          const leaguesData = await leaguesResponse.json() as { leagues?: Array<{ leagueId: string; sport: string; seasonYear?: number; teamId?: string }> };
          const matchingLeagues = (leaguesData.leagues || []).filter(
            (league) => league.leagueId === leagueId && league.sport === 'baseball'
          );
          const baseTeamId = matchingLeagues.find((league) => league.teamId)?.teamId;

          if (!baseTeamId) {
            return new Response(JSON.stringify({
              error: 'Team selection required before discovering seasons',
              code: 'TEAM_ID_MISSING'
            }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }

          const existingSeasons = new Set(
            matchingLeagues.map((league) => league.seasonYear)
          );

          // Discovery algorithm
          const MIN_YEAR = 2000;
          const MAX_CONSECUTIVE_MISSES = 2;
          const PROBE_DELAY_MS = 200;
          const currentYear = new Date().getFullYear();

          interface DiscoveredSeason {
            seasonYear: number;
            leagueName: string;
            teamCount: number;
            teamId?: string;
            teamName?: string;
          }

          const discovered: DiscoveredSeason[] = [];
          let consecutiveMisses = 0;
          let skippedCount = 0;
          let rateLimited = false;
          let limitExceeded = false;
          let minYearReached = false;

          for (let year = currentYear; year >= MIN_YEAR; year--) {
            // Track if we've reached MIN_YEAR
            if (year === MIN_YEAR) {
              minYearReached = true;
            }

            // Skip if already stored (but do NOT reset consecutiveMisses - stored seasons don't count as hits)
            if (existingSeasons.has(year)) {
              console.log(`📋 [discover] Year ${year} already stored, skipping`);
              skippedCount++;
              continue;
            }

            // Force probe currentYear and currentYear-1 regardless of misses
            const mustProbe = year >= currentYear - 1;

            if (!mustProbe && consecutiveMisses >= MAX_CONSECUTIVE_MISSES) {
              console.log(`📋 [discover] Stopping at ${year} after ${MAX_CONSECUTIVE_MISSES} consecutive misses`);
              break;
            }

            // Rate limit: add delay between probes (after first probe)
            if (discovered.length > 0 || consecutiveMisses > 0) {
              await new Promise(resolve => setTimeout(resolve, PROBE_DELAY_MS));
            }

            const info = await getBasicLeagueInfo({
              leagueId,
              sport: 'baseball',
              gameId: 'flb',
              credentials,
              seasonYear: year
            });

            // Treat success with no teams as a miss (invalid season data)
            if (info.success && (!info.teams || info.teams.length === 0)) {
              console.log(`📋 [discover] Year ${year} has no teams, treating as miss`);
              consecutiveMisses++;
              continue;
            }

            if (info.success) {
              const matchedTeam = info.teams?.find((team) => team.teamId === baseTeamId);
              const seasonTeamName = matchedTeam?.teamName;
              discovered.push({
                seasonYear: year,
                leagueName: info.leagueName || `Baseball League ${leagueId}`,
                teamCount: info.teams?.length || 0,
                teamId: baseTeamId,
                teamName: seasonTeamName
              });
              consecutiveMisses = 0;

              // Auto-save this season via /leagues/add
              try {
                const addResponse = await authWorkerFetch(env, '/leagues/add', {
                  method: 'POST',
                  headers: {
                    'X-Clerk-User-ID': clerkUserId,
                    ...(authHeader ? { 'Authorization': authHeader } : {}),
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    leagueId,
                    sport: 'baseball',
                    seasonYear: year,
                    leagueName: info.leagueName,
                    teamId: baseTeamId,
                    teamName: seasonTeamName
                  })
                });

                if (addResponse.status === 409) {
                  console.log(`📋 [discover] Season ${year} already exists (409), continuing`);
                } else if (addResponse.status === 400) {
                  // Check if limit exceeded
                  const addData = await addResponse.json().catch(() => ({})) as { code?: string };
                  if (addData.code === 'LIMIT_EXCEEDED') {
                    console.log(`📋 [discover] League limit reached, stopping discovery`);
                    limitExceeded = true;
                    break;
                  }
                } else if (!addResponse.ok) {
                  console.warn(`⚠️ [discover] Failed to save season ${year}: ${addResponse.status}`);
                }
              } catch (addError) {
                console.warn(`⚠️ [discover] Error saving season ${year}:`, addError);
              }

            } else if (info.httpStatus === 404) {
              consecutiveMisses++;
            } else if (info.httpStatus === 429) {
              console.log(`📋 [discover] Rate limited at year ${year}, returning partial results`);
              rateLimited = true;
              break;
            } else if (info.httpStatus === 401 || info.httpStatus === 403) {
              const hasKnownSeason = discovered.length > 0 || existingSeasons.size > 0;
              if (hasKnownSeason) {
                console.log(`📋 [discover] Year ${year} unauthorized (season access), treating as miss`);
                consecutiveMisses++;
              } else {
                return new Response(JSON.stringify({
                  error: 'ESPN credentials expired or invalid',
                  code: 'AUTH_FAILED'
                }), {
                  status: 401,
                  headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
              }
            } else {
              // Other error - retry once
              await new Promise(resolve => setTimeout(resolve, 1000));
              const retry = await getBasicLeagueInfo({
                leagueId,
                sport: 'baseball',
                gameId: 'flb',
                credentials,
                seasonYear: year
              });

              // Treat retry success with no teams as a miss
              if (retry.success && (!retry.teams || retry.teams.length === 0)) {
                console.log(`📋 [discover] Year ${year} has no teams on retry, treating as miss`);
                consecutiveMisses++;
                continue;
              }

              if (retry.success) {
                const matchedTeam = retry.teams?.find((team) => team.teamId === baseTeamId);
                const seasonTeamName = matchedTeam?.teamName;
                discovered.push({
                  seasonYear: year,
                  leagueName: retry.leagueName || `Baseball League ${leagueId}`,
                  teamCount: retry.teams?.length || 0,
                  teamId: baseTeamId,
                  teamName: seasonTeamName
                });
                consecutiveMisses = 0;
                // Auto-save on retry success
                try {
                  const addResponse = await authWorkerFetch(env, '/leagues/add', {
                    method: 'POST',
                    headers: {
                      'X-Clerk-User-ID': clerkUserId,
                      ...(authHeader ? { 'Authorization': authHeader } : {}),
                      'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                      leagueId,
                      sport: 'baseball',
                      seasonYear: year,
                      leagueName: retry.leagueName,
                      teamId: baseTeamId,
                      teamName: seasonTeamName
                    })
                  });
                  if (addResponse.status === 400) {
                    const addData = await addResponse.json().catch(() => ({})) as { code?: string };
                    if (addData.code === 'LIMIT_EXCEEDED') {
                      limitExceeded = true;
                      break;
                    }
                  }
                } catch (e) { /* ignore save errors */ }
              } else if (retry.httpStatus === 404) {
                consecutiveMisses++;
              } else if (retry.httpStatus === 401 || retry.httpStatus === 403) {
                const hasKnownSeason = discovered.length > 0 || existingSeasons.size > 0;
                if (hasKnownSeason) {
                  console.log(`📋 [discover] Year ${year} unauthorized on retry, treating as miss`);
                  consecutiveMisses++;
                } else {
                  return new Response(JSON.stringify({
                    error: 'ESPN credentials expired or invalid',
                    code: 'AUTH_FAILED'
                  }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json', ...corsHeaders }
                  });
                }
              } else {
                return new Response(JSON.stringify({
                  error: `ESPN API error: ${retry.error}`,
                  code: 'ESPN_ERROR'
                }), {
                  status: 502,
                  headers: { 'Content-Type': 'application/json', ...corsHeaders }
                });
              }
            }
          }

          return new Response(JSON.stringify({
            success: true,
            leagueId,
            sport: 'baseball',
            startYear: currentYear,
            minYearReached,
            rateLimited,
            limitExceeded,
            discovered,
            skipped: skippedCount,
            ...(limitExceeded ? { error: 'League limit reached - some seasons may not have been saved' } : {})
          }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });

        } catch (error) {
          console.error('❌ Discover seasons error:', error);
          return new Response(JSON.stringify({
            error: 'Failed to discover seasons',
            details: error instanceof Error ? error.message : 'Unknown error'
          }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
      }

      // MCP endpoints - delegate to agent
      if (pathname === '/mcp' || pathname.startsWith('/mcp/')) {
        const agent = new McpAgent();
        return await agent.handleRequest(request, env);
      }

      // 404 for unknown endpoints
      return new Response(JSON.stringify({
        error: 'Endpoint not found',
        message: 'Available endpoints',
        endpoints: {
          '/health': 'GET - Health check with auth-worker connectivity test',
          '/onboarding/initialize': 'POST - Initialize onboarding with league data fetching (requires X-Clerk-User-ID header)',
          '/onboarding/discover-seasons': 'POST - Discover and save historical seasons for a league (requires X-Clerk-User-ID header)',
          '/mcp': 'POST - MCP protocol endpoints for Claude integration'
        },
        version: '4.0.0'
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders }
      });

    } catch (error) {
      console.error('Worker error:', error);
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
