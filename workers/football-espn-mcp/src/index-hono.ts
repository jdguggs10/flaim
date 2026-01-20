// Football ESPN MCP Server v2.0 - Hono + MCP SDK Migration
// Routing via Hono framework, MCP protocol via official SDK

import { Hono } from 'hono';
import {
  createMcpCorsHeaders,
  isCorsPreflightRequest,
  authWorkerFetch,
  type BaseEnvWithAuth,
  type EspnCredentials,
} from '@flaim/worker-shared';
import { createFootballMcpServer } from './mcp/sdk-agent.js';
import { createMcpHandler } from './mcp/create-mcp-handler.js';
import { getBasicLeagueInfo } from './mcp/basic-league-info.js';

// Extend BaseEnvWithAuth for this worker
export interface Env extends BaseEnvWithAuth {
  // Any football-specific env vars would go here
}

// Create root app + routed API app
const app = new Hono<{ Bindings: Env }>();
const api = new Hono<{ Bindings: Env }>();

// =============================================================================
// MIDDLEWARE
// =============================================================================

// CORS middleware - runs on all routes
api.use('*', async (c, next) => {
  // Handle preflight
  if (isCorsPreflightRequest(c.req.raw)) {
    return new Response(null, {
      status: 200,
      headers: createMcpCorsHeaders(c.req.raw),
    });
  }
  await next();
  // Add CORS headers to all responses
  const corsHeaders = createMcpCorsHeaders(c.req.raw);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    if (!c.res.headers.has(key)) {
      c.res.headers.set(key, value);
    }
  });
  return undefined;
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

// ESPN sport to game ID mapping
function getEspnGameId(sport: string): string {
  const sportMap: Record<string, string> = {
    'football': 'ffl',  // Fantasy Football League
    'basketball': 'fba', // Fantasy Basketball
    'hockey': 'fhl',     // Fantasy Hockey League
    'baseball': 'flb',   // Fantasy Baseball
    'soccer': 'fs'       // Fantasy Soccer
  };
  return sportMap[sport.toLowerCase()] || 'ffl';
}

/**
 * Fetch ESPN credentials from auth-worker
 */
async function getCredentials(
  env: Env,
  authHeader?: string | null
): Promise<EspnCredentials | null> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    const response = await authWorkerFetch(env, '/credentials/espn?raw=true', {
      method: 'GET',
      headers
    });

    if (response.status === 404) {
      return null;
    }

    if (response.status === 401) {
      const errorBody = await response.text().catch(() => 'unknown');
      console.error(`❌ [football] Auth failed (401): ${errorBody}`);
      throw new Error(`Auth-worker authentication failed: ${errorBody}`);
    }

    if (!response.ok) {
      console.error(`❌ [football] Auth-worker error: ${response.status} ${response.statusText}`);
      const errorData = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(`Auth-worker error: ${errorData.error || response.statusText}`);
    }

    const data = await response.json() as { success?: boolean; credentials?: EspnCredentials };

    if (!data.success || !data.credentials) {
      console.error('❌ [football] Invalid response from auth-worker:', JSON.stringify(data));
      throw new Error('Invalid credentials response from auth-worker');
    }

    return data.credentials;

  } catch (error) {
    console.error('❌ [football] Failed to fetch credentials from auth-worker:', error);
    throw error;
  }
}

/**
 * Fetch user's leagues from auth-worker
 */
async function getUserLeagues(
  env: Env,
  authHeader?: string | null
): Promise<Array<{ leagueId: string; sport: string; teamId?: string; seasonYear?: number }>> {
  try {
    const response = await authWorkerFetch(env, '/leagues', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { 'Authorization': authHeader } : {})
      }
    });

    if (response.status === 404) {
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

    return data.leagues || [];

  } catch (error) {
    console.error('❌ Failed to fetch leagues from auth-worker:', error);
    throw error;
  }
}

// =============================================================================
// ROUTES
// =============================================================================

// Health check endpoint
api.get('/health', async (c) => {
  const env = c.env;
  const healthData: Record<string, unknown> = {
    status: 'healthy',
    service: 'football-espn-mcp',
    version: '2.0.0',
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
  return c.json(healthData, statusCode);
});

// OAuth Protected Resource Metadata (RFC 9728)
api.get('/.well-known/oauth-protected-resource', (c) => {
  const metadata = {
    resource: 'https://api.flaim.app/football/mcp',
    authorization_servers: ['https://api.flaim.app'],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp:read', 'mcp:write']
  };
  return c.json(metadata, 200, {
    'Cache-Control': 'public, max-age=3600'
  });
});

// Onboarding initialize endpoint
api.post('/onboarding/initialize', async (c) => {
  return handleOnboardingInitialize(c);
});

async function handleOnboardingInitialize(c: any) {
  const env = c.env;
  try {
    const authHeader = c.req.header('Authorization');

    if (!authHeader) {
      return c.json({
        error: 'Authentication required'
      }, 401);
    }

    const body = await c.req.json() as { sport?: string; leagueId?: string; seasonYear?: number };
    const { sport, leagueId, seasonYear } = body;

    const targetSport = sport || 'football';

    // Get credentials from auth-worker
    const credentials = await getCredentials(env, authHeader);
    if (!credentials) {
      return c.json({
        error: 'ESPN credentials not found. Please add your ESPN credentials first.',
        code: 'CREDENTIALS_MISSING'
      }, 404);
    }

    // If leagueId is provided, use discovery mode
    let targetLeagues: Array<{ leagueId: string; sport: string; teamId?: string; seasonYear?: number }> = [];

    if (leagueId) {
      targetLeagues = [{ leagueId, sport: targetSport, seasonYear }];
    } else {
      const leagues = await getUserLeagues(env, authHeader);
      targetLeagues = leagues.filter(league => league.sport === targetSport);

      if (targetLeagues.length === 0) {
        return c.json({
          error: `No ${targetSport} leagues found. Please add ${targetSport} leagues first.`,
          code: 'LEAGUES_MISSING'
        }, 404);
      }
    }

    const leagueResults = [];
    for (const league of targetLeagues) {
      try {
        const leagueSeasonYear = league.seasonYear ?? seasonYear;
        const gameId = getEspnGameId(league.sport);
        const basicInfo = await getBasicLeagueInfo({
          leagueId: league.leagueId,
          sport: league.sport,
          gameId,
          credentials,
          seasonYear: leagueSeasonYear
        });

        leagueResults.push({
          leagueId: league.leagueId,
          sport: league.sport,
          teamId: league.teamId,
          seasonYear: leagueSeasonYear,
          gameId,
          ...basicInfo
        });
      } catch (error) {
        console.error(`❌ Failed to get info for league ${league.leagueId}:`, error);
        leagueResults.push({
          leagueId: league.leagueId,
          sport: league.sport,
          teamId: league.teamId,
          gameId: getEspnGameId(league.sport),
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return c.json({
      success: true,
      message: 'Onboarding initialized successfully',
      sport: targetSport,
      totalLeagues: targetLeagues.length,
      leagues: leagueResults
    });

  } catch (error) {
    console.error('❌ Onboarding initialize error:', error);
    return c.json({
      error: 'Failed to initialize onboarding',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

// Discover seasons endpoint
api.post('/onboarding/discover-seasons', async (c) => {
  return handleDiscoverSeasons(c);
});

async function handleDiscoverSeasons(c: any) {
  const env = c.env;
  try {
    const authHeader = c.req.header('Authorization');

    console.log(`🔍 [football] /onboarding/discover-seasons - auth header: ${authHeader ? 'present' : 'missing'}`);

    if (!authHeader) {
      return c.json({
        error: 'Authentication required',
        code: 'AUTH_MISSING'
      }, 401);
    }

    const body = await c.req.json() as { leagueId?: string };
    const { leagueId } = body;

    if (!leagueId) {
      return c.json({
        error: 'leagueId is required'
      }, 400);
    }

    // Get credentials
    const credentials = await getCredentials(env, authHeader);
    if (!credentials) {
      return c.json({
        error: 'ESPN credentials not found',
        code: 'CREDENTIALS_MISSING'
      }, 404);
    }

    // Fetch existing leagues to skip already-stored seasons
    const leaguesResponse = await authWorkerFetch(env, '/leagues', {
      method: 'GET',
      headers: {
        ...(authHeader ? { 'Authorization': authHeader } : {})
      }
    });
    const leaguesData = await leaguesResponse.json() as { leagues?: Array<{ leagueId: string; sport: string; seasonYear?: number; teamId?: string }> };
    const matchingLeagues = (leaguesData.leagues || []).filter(
      (league) => league.leagueId === leagueId && league.sport === 'football'
    );
    const baseTeamId = matchingLeagues.find((league) => league.teamId)?.teamId;

    if (!baseTeamId) {
      return c.json({
        error: 'Team selection required before discovering seasons',
        code: 'TEAM_ID_MISSING'
      }, 400);
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
      if (year === MIN_YEAR) {
        minYearReached = true;
      }

      if (existingSeasons.has(year)) {
        console.log(`📋 [discover] Year ${year} already stored, skipping`);
        skippedCount++;
        continue;
      }

      const mustProbe = year >= currentYear - 1;

      if (!mustProbe && consecutiveMisses >= MAX_CONSECUTIVE_MISSES) {
        console.log(`📋 [discover] Stopping at ${year} after ${MAX_CONSECUTIVE_MISSES} consecutive misses`);
        break;
      }

      if (discovered.length > 0 || consecutiveMisses > 0) {
        await new Promise(resolve => setTimeout(resolve, PROBE_DELAY_MS));
      }

      const info = await getBasicLeagueInfo({
        leagueId,
        sport: 'football',
        gameId: 'ffl',
        credentials,
        seasonYear: year
      });

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
          leagueName: info.leagueName || `Football League ${leagueId}`,
          teamCount: info.teams?.length || 0,
          teamId: baseTeamId,
          teamName: seasonTeamName
        });
        consecutiveMisses = 0;

        // Auto-save this season
        try {
          const addResponse = await authWorkerFetch(env, '/leagues/add', {
            method: 'POST',
            headers: {
              ...(authHeader ? { 'Authorization': authHeader } : {}),
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              leagueId,
              sport: 'football',
              seasonYear: year,
              leagueName: info.leagueName,
              teamId: baseTeamId,
              teamName: seasonTeamName
            })
          });

          if (addResponse.status === 409) {
            console.log(`📋 [discover] Season ${year} already exists (409), attempting team backfill`);
            try {
              const patchResponse = await authWorkerFetch(env, `/leagues/${leagueId}/team`, {
                method: 'PATCH',
                headers: {
                  ...(authHeader ? { 'Authorization': authHeader } : {}),
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  teamId: baseTeamId,
                  sport: 'football',
                  teamName: seasonTeamName,
                  leagueName: info.leagueName,
                  seasonYear: year
                })
              });

              if (!patchResponse.ok) {
                const patchError = await patchResponse.json().catch(() => ({})) as { error?: string };
                console.warn(`⚠️ [discover] Failed to backfill team for season ${year}: ${patchResponse.status} ${patchError.error || ''}`);
              }
            } catch (patchError) {
              console.warn(`⚠️ [discover] Error backfilling team for season ${year}:`, patchError);
            }
          } else if (addResponse.status === 400) {
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
          return c.json({
            error: 'ESPN credentials expired or invalid',
            code: 'AUTH_FAILED'
          }, 401);
        }
      } else {
        // Other error - retry once
        await new Promise(resolve => setTimeout(resolve, 1000));
        const retry = await getBasicLeagueInfo({
          leagueId,
          sport: 'football',
          gameId: 'ffl',
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
            leagueName: retry.leagueName || `Football League ${leagueId}`,
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
              ...(authHeader ? { 'Authorization': authHeader } : {}),
              'Content-Type': 'application/json'
            },
              body: JSON.stringify({
                leagueId,
                sport: 'football',
                seasonYear: year,
                leagueName: retry.leagueName,
                teamId: baseTeamId,
                teamName: seasonTeamName
              })
            });
            if (addResponse.status === 409) {
              try {
                const patchResponse = await authWorkerFetch(env, `/leagues/${leagueId}/team`, {
                method: 'PATCH',
                headers: {
                  ...(authHeader ? { 'Authorization': authHeader } : {}),
                  'Content-Type': 'application/json'
                },
                  body: JSON.stringify({
                    teamId: baseTeamId,
                    sport: 'football',
                    teamName: seasonTeamName,
                    leagueName: retry.leagueName,
                    seasonYear: year
                  })
                });
                if (!patchResponse.ok) {
                  const patchError = await patchResponse.json().catch(() => ({})) as { error?: string };
                  console.warn(`⚠️ [discover] Failed to backfill team for season ${year} on retry: ${patchResponse.status} ${patchError.error || ''}`);
                }
              } catch (patchError) {
                console.warn(`⚠️ [discover] Error backfilling team for season ${year} on retry:`, patchError);
              }
            } else if (addResponse.status === 400) {
              const addData = await addResponse.json().catch(() => ({})) as { code?: string };
              if (addData.code === 'LIMIT_EXCEEDED') {
                limitExceeded = true;
                break;
              }
            }
          } catch { /* ignore save errors */ }
        } else if (retry.httpStatus === 404) {
          consecutiveMisses++;
        } else if (retry.httpStatus === 401 || retry.httpStatus === 403) {
          const hasKnownSeason = discovered.length > 0 || existingSeasons.size > 0;
          if (hasKnownSeason) {
            console.log(`📋 [discover] Year ${year} unauthorized on retry, treating as miss`);
            consecutiveMisses++;
          } else {
            return c.json({
              error: 'ESPN credentials expired or invalid',
              code: 'AUTH_FAILED'
            }, 401);
          }
        } else {
          return c.json({
            error: `ESPN API error: ${retry.error}`,
            code: 'ESPN_ERROR'
          }, 502);
        }
      }
    }

    return c.json({
      success: true,
      leagueId,
      sport: 'football',
      startYear: currentYear,
      minYearReached,
      rateLimited,
      limitExceeded,
      discovered,
      skipped: skippedCount,
      ...(limitExceeded ? { error: 'League limit reached - some seasons may not have been saved' } : {})
    });

  } catch (error) {
    console.error('❌ Discover seasons error:', error);
    return c.json({
      error: 'Failed to discover seasons',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
}

// =============================================================================
// MCP ENDPOINTS - SDK-based with custom OAuth 401
// =============================================================================

const OAUTH_RESOURCE_METADATA = 'https://api.flaim.app/football/.well-known/oauth-protected-resource';

function buildMcpAuthErrorResponse(request: Request, message: string, errorType: 'unauthorized' | 'invalid_token'): Response {
  return new Response(JSON.stringify({
    jsonrpc: '2.0',
    error: {
      code: -32001,
      message,
      _meta: {
        'mcp/www_authenticate': [
          `Bearer resource_metadata="${OAUTH_RESOURCE_METADATA}", error="${errorType}", error_description="${message}"`
        ]
      }
    },
    id: null
  }), {
    status: 401,
    headers: {
      'Content-Type': 'application/json',
      'WWW-Authenticate': `Bearer resource_metadata="${OAUTH_RESOURCE_METADATA}"${errorType === 'invalid_token' ? ', error="invalid_token"' : ''}`,
      ...createMcpCorsHeaders(request)
    }
  });
}

function responseHasInvalidAuth(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const data = payload as { error?: { message?: string }; result?: { content?: Array<{ text?: string }> } };
  const errorMessage = data.error?.message || '';
  const contentText = (data.result?.content || [])
    .map((item) => item.text || '')
    .join(' ');
  const combined = `${errorMessage} ${contentText}`.toUpperCase();
  return combined.includes('AUTH_TOKEN_INVALID') || combined.includes('AUTH_FAILED');
}

async function executeMcpRequest(c: any, requestOverride?: Request): Promise<Response> {
  const authHeader = c.req.header('Authorization');

  // Determine user ID for context
  const clerkUserId = authHeader ? 'oauth-user' : 'anonymous';
  console.log(`[MCP SDK] Auth header: ${authHeader ? 'present' : 'MISSING'}, Resolved userId: ${clerkUserId}`);

  // Custom auth check - return 401 with _meta BEFORE SDK processes request
  // This preserves ChatGPT OAuth compatibility
  if (!authHeader) {
    return buildMcpAuthErrorResponse(c.req.raw, 'Authentication required. Please authorize via OAuth.', 'unauthorized');
  }

  // Create MCP server with context (env, authHeader, clerkUserId captured via closure)
  const server = createFootballMcpServer({
    env: c.env,
    authHeader,
    clerkUserId
  });

  const handler = createMcpHandler(server, {
    route: '/mcp',
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  });

  const response = await handler(requestOverride ?? c.req.raw, c.env, c.executionCtx);

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return response;
  }

  const cloned = response.clone();
  const payload = await cloned.json().catch(() => null);
  if (!payload || !responseHasInvalidAuth(payload)) {
    return response;
  }

  return buildMcpAuthErrorResponse(c.req.raw, 'Authentication failed. Please re-authorize via OAuth.', 'invalid_token');
}

/**
 * Handle MCP requests using the official SDK.
 * Custom auth runs BEFORE SDK to return proper 401 with _meta for ChatGPT OAuth.
 */
async function handleMcpRequest(c: any): Promise<Response> {
  return executeMcpRequest(c);
}

async function handleLegacyToolsList(c: any): Promise<Response> {
  const authHeader = c.req.header('Authorization');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (authHeader) headers['Authorization'] = authHeader;

  const rpcRequest = {
    jsonrpc: '2.0',
    method: 'tools/list',
    id: 1,
  };

  const rpcUrl = new URL('/mcp', c.req.url).toString();
  const rpcResponse = await executeMcpRequest(
    c,
    new Request(rpcUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(rpcRequest),
    })
  );

  if (!rpcResponse.ok) {
    return rpcResponse;
  }

  const payload = await rpcResponse.json().catch(() => null) as { result?: { tools?: unknown } } | null;
  if (!payload?.result?.tools) {
    return new Response(JSON.stringify({ tools: [] }), {
      headers: {
        'Content-Type': 'application/json',
        ...createMcpCorsHeaders(c.req.raw)
      }
    });
  }

  return new Response(JSON.stringify({ tools: payload.result.tools }), {
    headers: {
      'Content-Type': 'application/json',
      ...createMcpCorsHeaders(c.req.raw)
    }
  });
}

async function handleLegacyToolsCall(c: any): Promise<Response> {
  const authHeader = c.req.header('Authorization');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
  };
  if (authHeader) headers['Authorization'] = authHeader;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ content: 'Invalid JSON in request body', isError: true }, 400);
  }

  if (typeof body !== 'object' || body === null || typeof (body as any).tool !== 'string') {
    return c.json({ content: 'Invalid request body: missing or invalid "tool" field', isError: true }, 400);
  }

  const { tool, arguments: args } = body as { tool: string; arguments?: Record<string, unknown> };
  if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
    return c.json({ content: 'Invalid arguments: must be an object', isError: true }, 400);
  }

  const rpcRequest = {
    jsonrpc: '2.0',
    method: 'tools/call',
    params: {
      name: tool,
      arguments: args || {},
    },
    id: 1,
  };

  const rpcUrl = new URL('/mcp', c.req.url).toString();
  const rpcResponse = await executeMcpRequest(
    c,
    new Request(rpcUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(rpcRequest),
    })
  );

  if (!rpcResponse.ok) {
    return rpcResponse;
  }

  const payload = await rpcResponse.json().catch(() => null) as { result?: { content?: unknown; isError?: boolean }; error?: { message?: string } } | null;
  if (payload?.error) {
    return c.json({ content: payload.error.message || 'Tool execution failed', isError: true }, 500);
  }

  return c.json({
    content: payload?.result?.content ?? null,
    isError: payload?.result?.isError ?? false,
  });
}

api.all('/mcp/tools/list', handleLegacyToolsList);
api.all('/mcp/tools/call', handleLegacyToolsCall);
api.all('/mcp', handleMcpRequest);
api.all('/mcp/*', handleMcpRequest);

// 404 handler
api.notFound((c) => {
  return c.json({
    error: 'Endpoint not found',
    message: 'Available endpoints',
    endpoints: {
      '/health': 'GET - Health check with auth-worker connectivity test',
      '/onboarding/initialize': 'POST - Initialize onboarding with league data fetching (requires Authorization header)',
      '/onboarding/discover-seasons': 'POST - Discover and save historical seasons for a league (requires Authorization header)',
      '/mcp': 'POST - MCP protocol endpoints for Claude integration'
    },
    version: '2.0.0'
  }, 404);
});

// Global error handler
api.onError((err, c) => {
  console.error('Worker error:', err);
  const response = c.json({
    error: 'Internal server error',
    details: err instanceof Error ? err.message : 'Unknown error'
  }, 500);
  const corsHeaders = createMcpCorsHeaders(c.req.raw);
  Object.entries(corsHeaders).forEach(([key, value]) => {
    if (!response.headers.has(key)) {
      response.headers.set(key, value);
    }
  });
  return response;
});

// Mount API on both root and /football to match legacy routing behavior
app.route('/', api);
app.route('/football', api);

export default app;
