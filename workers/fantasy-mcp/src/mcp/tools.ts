// workers/fantasy-mcp/src/mcp/tools.ts
import { z } from 'zod';
import type { Env, Platform, Sport, ToolParams } from '../types';
import { routeToClient, type RouteResult } from '../router';
import { withCorrelationId, withEvalHeaders } from '@flaim/worker-shared';
import { logEvalEvent } from '../logging';

// TODO: Revisit this workaround. Casting to 'any' is used due to type compatibility issues
// between Zod v3/v4 and @modelcontextprotocol/sdk's registerTool().
// See: https://github.com/modelcontextprotocol/typescript-sdk/issues/906
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ZodShape = Record<string, any>;

// =============================================================================
// MCP RESPONSE TYPES
// =============================================================================

export interface McpToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
  // Index signature to satisfy MCP SDK types
  [key: string]: unknown;
}

export type ToolSecuritySchemes = Array<{
  type: 'oauth2';
  scopes: string[];
}>;

export interface UnifiedTool {
  name: string;
  title: string;
  description: string;
  inputSchema: ZodShape;
  requiredScope: 'mcp:read' | 'mcp:write';
  securitySchemes: ToolSecuritySchemes;
  openaiMeta?: {
    invoking: string;
    invoked: string;
  };
  handler: (
    args: Record<string, unknown>,
    env: Env,
    authHeader?: string,
    correlationId?: string,
    evalRunId?: string,
    evalTraceId?: string
  ) => Promise<McpToolResponse>;
}

/**
 * Check whether a granted OAuth scope string includes the required scope.
 * Fail-closed: returns false if grantedScope is missing or empty.
 */
export function hasRequiredScope(grantedScope: string | undefined, requiredScope: 'mcp:read' | 'mcp:write'): boolean {
  if (!grantedScope) return false;
  const granted = new Set(grantedScope.split(/\s+/).filter(Boolean));
  return granted.has(requiredScope);
}

function buildSecuritySchemes(scope: 'mcp:read' | 'mcp:write'): ToolSecuritySchemes {
  return [{ type: 'oauth2', scopes: [scope] }];
}

// =============================================================================
// HELPER: Active league threshold
// =============================================================================

/**
 * Get the threshold year for "active" leagues.
 * A league is active if it has a season >= this year.
 */
function getActiveThresholdYear(): number {
  return new Date().getFullYear() - 2;
}

// =============================================================================
// HELPER: Fetch user leagues from auth-worker
// =============================================================================

interface UserLeague {
  leagueId: string;
  sport: string;
  platform: string;
  teamId?: string;
  seasonYear?: number;
  leagueName?: string;
  teamName?: string;
}

async function fetchUserLeagues(
  env: Env,
  authHeader?: string,
  correlationId?: string,
  evalRunId?: string,
  evalTraceId?: string
): Promise<{ leagues: UserLeague[]; error?: string; status?: number }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  const cid = correlationId || 'no-cid';

  try {
    console.log(`[fantasy-mcp] ${cid} fetching leagues from auth-worker`);

    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    };
    const withCorrelation = correlationId ? withCorrelationId(baseHeaders, correlationId) : new Headers(baseHeaders);
    const headers = withEvalHeaders(withCorrelation, evalRunId, evalTraceId);

    const response = await env.AUTH_WORKER.fetch(
      new Request('https://internal/leagues', {
        method: 'GET',
        headers,
        signal: controller.signal,
      })
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`[fantasy-mcp] ${cid} leagues fetch failed: ${response.status}`);
      const text = await response.text().catch(() => 'no body');
      return {
        leagues: [],
        error: `Auth-worker returned ${response.status}: ${text}`,
        status: response.status,
      };
    }

    const data = (await response.json()) as { success?: boolean; leagues?: UserLeague[] };
    const leagues = (data.leagues || []).map((l) => ({
      ...l,
      platform: l.platform || 'espn', // Default to espn for backward compatibility
    }));
    console.log(`[fantasy-mcp] ${cid} found ${leagues.length} leagues`);
    return { leagues };
  } catch (error) {
    clearTimeout(timeoutId);
    console.error(`[fantasy-mcp] ${cid} failed to fetch leagues:`, error);
    return {
      leagues: [],
      error:
        (error as Error).name === 'AbortError'
          ? 'Fetch timed out after 5 seconds'
          : `Fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

// =============================================================================
// HELPER: Format MCP response
// =============================================================================

function mcpSuccess(data: unknown): McpToolResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}

function mcpError(message: string): McpToolResponse {
  return {
    content: [{ type: 'text', text: message }],
    isError: true,
  };
}

export function mcpAuthError(resource: string): McpToolResponse {
  // Derive metadata URL from resource: strip /mcp path, add .well-known
  // e.g. https://api.flaim.app/mcp → https://api.flaim.app/.well-known/oauth-protected-resource
  //      https://api.flaim.app/fantasy/mcp → https://api.flaim.app/fantasy/.well-known/oauth-protected-resource
  const url = new URL(resource);
  const basePath = url.pathname.replace(/\/mcp$/, '');
  const resourceMetadata = `${url.origin}${basePath}/.well-known/oauth-protected-resource`;
  return {
    content: [{ type: 'text', text: 'AUTH_FAILED: Authentication required' }],
    isError: true,
    _meta: {
      'mcp/www_authenticate': [
        `Bearer resource_metadata="${resourceMetadata}", error="invalid_token", error_description="Authentication required"`,
      ],
    },
  };
}

function routeResultToMcp(result: RouteResult): McpToolResponse {
  if (result.success) {
    return mcpSuccess({
      success: true,
      data: result.data,
    });
  }
  return mcpError(`${result.code || 'ERROR'}: ${result.error}`);
}

// =============================================================================
// HELPER: Tool logging with correlation ID and timing
// =============================================================================

async function withToolLogging<T>(
  correlationId: string | undefined,
  toolName: string,
  context: string,
  fn: () => Promise<T>,
  evalRunId?: string,
  evalTraceId?: string
): Promise<T> {
  const cid = correlationId || 'no-cid';
  const evalTag = evalRunId ? ` eval=${evalRunId}` : '';
  const startTime = Date.now();
  console.log(`[fantasy-mcp] ${cid} ${toolName} ${context}${evalTag}`);
  logEvalEvent({
    service: 'fantasy-mcp',
    phase: 'tool_start',
    correlation_id: correlationId,
    run_id: evalRunId,
    trace_id: evalTraceId,
    tool: toolName,
    message: context,
  });
  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    console.log(`[fantasy-mcp] ${cid} ${toolName} completed in ${duration}ms${evalTag}`);
    logEvalEvent({
      service: 'fantasy-mcp',
      phase: 'tool_end',
      correlation_id: correlationId,
      run_id: evalRunId,
      trace_id: evalTraceId,
      tool: toolName,
      duration_ms: duration,
      status: 'success',
    });
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[fantasy-mcp] ${cid} ${toolName} failed in ${duration}ms${evalTag}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    logEvalEvent({
      service: 'fantasy-mcp',
      phase: 'tool_error',
      correlation_id: correlationId,
      run_id: evalRunId,
      trace_id: evalTraceId,
      tool: toolName,
      duration_ms: duration,
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

// =============================================================================
// HELPER: Get current season for a sport
// =============================================================================

function getCurrentSeason(sport: Sport): number {
  const now = new Date();
  const ny = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);

  const year = Number(ny.find((p) => p.type === 'year')?.value);
  const month = Number(ny.find((p) => p.type === 'month')?.value);

  // Rollover months — must match auth-worker's ROLLOVER_MONTHS.
  // Returns canonical start year for the current season.
  switch (sport) {
    case 'baseball':
      return month < 2 ? year - 1 : year;   // Feb 1
    case 'football':
      return month < 7 ? year - 1 : year;   // Jul 1
    case 'basketball':
      return month < 8 ? year - 1 : year;   // Aug 1
    case 'hockey':
      return month < 8 ? year - 1 : year;   // Aug 1
    default:
      return year;
  }
}

/**
 * Get a human-readable season label from a canonical start year.
 * Cross-year sports (basketball, hockey) → "2024-25"; others → "2025".
 */
function getSeasonLabel(canonicalYear: number, sport: string): string {
  if (sport === 'basketball' || sport === 'hockey') {
    return `${canonicalYear}-${String(canonicalYear + 1).slice(2)}`;
  }
  return String(canonicalYear);
}

// =============================================================================
// UNIFIED TOOLS
// =============================================================================

export function getUnifiedTools(): UnifiedTool[] {
  const currentDate = new Date().toISOString().split('T')[0];

  return [
    // -------------------------------------------------------------------------
    // Tool 1: get_user_session
    // -------------------------------------------------------------------------
    {
      name: 'get_user_session',
      title: 'User Session',
      requiredScope: 'mcp:read',
      securitySchemes: buildSecuritySchemes('mcp:read'),
      openaiMeta: { invoking: 'Loading your leagues\u2026', invoked: 'Leagues loaded' },
      description:
        "Returns the user's configured fantasy leagues with current season info. Use the returned platform, sport, leagueId, teamId, and seasonYear values for all subsequent tool calls. season_year always represents the start year of the season. Read-only and safe to retry.",
      inputSchema: {},
      handler: async (_args, env, authHeader, correlationId, evalRunId, evalTraceId) => {
        return withToolLogging(correlationId, 'get_user_session', 'session', async () => {
        try {
          // Fetch ESPN leagues
          const { leagues: espnLeagues, status: fetchStatus } = await fetchUserLeagues(
            env,
            authHeader,
            correlationId,
            evalRunId,
            evalTraceId
          );

          if (fetchStatus === 401 || fetchStatus === 403) {
            return mcpAuthError('https://api.flaim.app/mcp');
          }

          // Fetch Yahoo leagues
          const yahooLeagues: UserLeague[] = [];
          try {
            const baseHeaders: Record<string, string> = {
              'Content-Type': 'application/json',
              ...(authHeader ? { Authorization: authHeader } : {}),
            };
            const withCorrelation = correlationId ? withCorrelationId(baseHeaders, correlationId) : new Headers(baseHeaders);
            const headers = withEvalHeaders(withCorrelation, evalRunId, evalTraceId);

            const yahooResponse = await env.AUTH_WORKER.fetch(
              new Request('https://internal/leagues/yahoo', {
                headers,
              })
            );
            if (yahooResponse.ok) {
              const yahooData = (await yahooResponse.json()) as {
                leagues?: Array<{
                  sport: string;
                  leagueKey: string;
                  leagueName: string;
                  teamId?: string;
                  seasonYear: number;
                }>;
              };
              if (yahooData.leagues) {
                for (const league of yahooData.leagues) {
                  yahooLeagues.push({
                    platform: 'yahoo',
                    sport: league.sport,
                    leagueId: league.leagueKey,
                    leagueName: league.leagueName,
                    teamId: league.teamId || '',
                    seasonYear: league.seasonYear,
                  });
                }
              }
            }
          } catch (error) {
            console.error('[get_user_session] Failed to fetch Yahoo leagues:', error);
            // Don't fail - just return ESPN leagues
          }

          // Fetch Sleeper leagues
          const sleeperLeagues: UserLeague[] = [];
          try {
            const baseHeaders: Record<string, string> = {
              'Content-Type': 'application/json',
              ...(authHeader ? { Authorization: authHeader } : {}),
            };
            const withCorrelation = correlationId ? withCorrelationId(baseHeaders, correlationId) : new Headers(baseHeaders);
            const headers = withEvalHeaders(withCorrelation, evalRunId, evalTraceId);

            const sleeperResponse = await env.AUTH_WORKER.fetch(
              new Request('https://internal/leagues/sleeper', { headers })
            );
            if (sleeperResponse.ok) {
              const sleeperData = (await sleeperResponse.json()) as {
                leagues?: Array<{
                  sport: string;
                  leagueId: string;
                  leagueName: string;
                  rosterId?: number;
                  seasonYear: number;
                }>;
              };
              if (sleeperData.leagues) {
                for (const league of sleeperData.leagues) {
                  sleeperLeagues.push({
                    platform: 'sleeper',
                    sport: league.sport,
                    leagueId: league.leagueId,
                    leagueName: league.leagueName,
                    teamId: league.rosterId ? String(league.rosterId) : '',
                    seasonYear: league.seasonYear,
                  });
                }
              }
            }
          } catch (error) {
            console.error('[get_user_session] Failed to fetch Sleeper leagues:', error);
          }

          // Combine all leagues
          const allLeagues = [...espnLeagues, ...yahooLeagues, ...sleeperLeagues];

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
            groupSeasons.sort((a, b) => (b.seasonYear || 0) - (a.seasonYear || 0));
            const mostRecentYear = groupSeasons[0]?.seasonYear || 0;

            // Only include if most recent season is within threshold
            if (mostRecentYear >= thresholdYear) {
              // Take only the 2 most recent seasons
              leagues.push(...groupSeasons.slice(0, 2));
            }
          }

          const hasLeagues = leagues.length > 0;
          const sportCounts = leagues.reduce(
            (acc, l) => {
              const sport = l.sport?.toLowerCase() || 'unknown';
              acc[sport] = (acc[sport] || 0) + 1;
              return acc;
            },
            {} as Record<string, number>
          );

          let sessionMessage: string;
          if (!hasLeagues) {
            sessionMessage =
              'No leagues configured. Please go to flaim.app/settings to add your fantasy platform credentials.';
          } else if (leagues.length === 1) {
            const league = leagues[0];
            sessionMessage = `Use platform="${league.platform}", sport="${league.sport}", leagueId="${league.leagueId}", teamId="${league.teamId || 'none'}", seasonYear=${league.seasonYear} for all tool calls.`;
          } else {
            sessionMessage = `User has ${leagues.length} league-seasons configured across: ${Object.entries(sportCounts)
              .map(([sport, count]) => `${count} ${sport}`)
              .join(', ')}. For historical leagues/seasons (2+ years old), use get_ancient_history. Infer sport from context (e.g., "tight ends" → football) and use that sport's default league. If sport is unclear, use the default sport and its default league. Only ask when no default applies.`;
          }

          // Fetch user preferences for defaults
          interface LeagueDefault {
            platform: 'espn' | 'yahoo' | 'sleeper';
            leagueId: string;
            seasonYear: number;
          }
          interface Preferences {
            defaultSport?: string | null;
            defaultFootball?: LeagueDefault | null;
            defaultBaseball?: LeagueDefault | null;
            defaultBasketball?: LeagueDefault | null;
            defaultHockey?: LeagueDefault | null;
          }
          let preferences: Preferences = {};
          try {
            const baseHeaders: Record<string, string> = {
              'Content-Type': 'application/json',
              ...(authHeader ? { Authorization: authHeader } : {}),
            };
            const withCorrelation = correlationId ? withCorrelationId(baseHeaders, correlationId) : new Headers(baseHeaders);
            const headers = withEvalHeaders(withCorrelation, evalRunId, evalTraceId);
            const prefsResponse = await env.AUTH_WORKER.fetch(
              new Request('https://internal/user/preferences', { headers })
            );
            if (prefsResponse.ok) {
              preferences = await prefsResponse.json();
            }
          } catch (error) {
            console.error('[get_user_session] Failed to fetch preferences:', error);
          }

          // Build per-sport default leagues map from preferences
          const defaultLeagues: Record<string, (typeof leagues)[0]> = {};
          const sportDefaultMap: Record<string, LeagueDefault | null | undefined> = {
            football: preferences.defaultFootball,
            baseball: preferences.defaultBaseball,
            basketball: preferences.defaultBasketball,
            hockey: preferences.defaultHockey,
          };

          for (const [sport, defaultInfo] of Object.entries(sportDefaultMap)) {
            if (defaultInfo) {
              const matchingLeague = leagues.find(
                (l) =>
                  l.platform === defaultInfo.platform &&
                  l.leagueId === defaultInfo.leagueId &&
                  l.seasonYear === defaultInfo.seasonYear
              );
              if (matchingLeague) {
                defaultLeagues[sport] = matchingLeague;
              }
            }
          }

          // Compute primary default from preferences
          const primarySport = preferences.defaultSport as string | undefined;
          const defaultLeague =
            (primarySport && defaultLeagues[primarySport]) ||
            Object.values(defaultLeagues)[0] ||
            leagues[0];

          return mcpSuccess({
            success: true,
            currentDate: new Date().toISOString(),
            currentSeasons: {
              football: { year: getCurrentSeason('football'), label: getSeasonLabel(getCurrentSeason('football'), 'football') },
              baseball: { year: getCurrentSeason('baseball'), label: getSeasonLabel(getCurrentSeason('baseball'), 'baseball') },
              basketball: { year: getCurrentSeason('basketball'), label: getSeasonLabel(getCurrentSeason('basketball'), 'basketball') },
              hockey: { year: getCurrentSeason('hockey'), label: getSeasonLabel(getCurrentSeason('hockey'), 'hockey') },
            },
            timezone: 'America/New_York',
            totalLeaguesFound: leagues.length,
            leaguesBySport: sportCounts,
            defaultSport: preferences.defaultSport || null,
            defaultLeague: defaultLeague
              ? {
                  platform: defaultLeague.platform,
                  sport: defaultLeague.sport,
                  leagueId: defaultLeague.leagueId,
                  teamId: defaultLeague.teamId,
                  seasonYear: defaultLeague.seasonYear,
                  season: getSeasonLabel(defaultLeague.seasonYear || getCurrentSeason(defaultLeague.sport as Sport), defaultLeague.sport || ''),
                  leagueName: defaultLeague.leagueName,
                  teamName: defaultLeague.teamName,
                }
              : null,
            defaultLeagues: Object.fromEntries(
              Object.entries(defaultLeagues).map(([sport, league]) => [
                sport,
                {
                  platform: league.platform,
                  leagueId: league.leagueId,
                  leagueName: league.leagueName,
                  sport: league.sport,
                  seasonYear: league.seasonYear,
                  season: getSeasonLabel(league.seasonYear || getCurrentSeason(sport as Sport), sport),
                  teamId: league.teamId,
                  teamName: league.teamName,
                },
              ])
            ),
            allLeagues: leagues,
            instructions: sessionMessage,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          return mcpError(`Failed to fetch user session: ${message}`);
        }
        }, evalRunId, evalTraceId);
      },
    },

    // -------------------------------------------------------------------------
    // GET ANCIENT HISTORY - Retrieve old leagues and seasons
    // -------------------------------------------------------------------------
    {
      name: 'get_ancient_history',
      title: 'Ancient History',
      requiredScope: 'mcp:read',
      securitySchemes: buildSecuritySchemes('mcp:read'),
      openaiMeta: { invoking: 'Searching old seasons\u2026', invoked: 'History loaded' },
      description:
        'Retrieve archived leagues and old seasons beyond the 2-year window. Use when user asks about inactive leagues, past seasons, or historical performance. Read-only and safe to retry.',
      inputSchema: {
        type: 'object',
        properties: {
          platform: {
            type: 'string',
            enum: ['espn', 'yahoo', 'sleeper'],
            description: 'Optional: filter to specific platform',
          },
        },
      },
      handler: async (args, env, authHeader, correlationId, evalRunId, evalTraceId) => {
        const { platform } = args as { platform?: 'espn' | 'yahoo' | 'sleeper' };
        return withToolLogging(correlationId, 'get_ancient_history', `ancient platform=${platform || 'all'}`, async () => {
        try {
          // Fetch all leagues (same logic as get_user_session)
          const allLeagues: UserLeague[] = [];

          // Fetch ESPN leagues
          if (!platform || platform === 'espn') {
            const { leagues: espnLeagues } = await fetchUserLeagues(
              env,
              authHeader,
              correlationId,
              evalRunId,
              evalTraceId
            );
            allLeagues.push(...espnLeagues);
          }

          // Fetch Yahoo leagues
          if (!platform || platform === 'yahoo') {
            try {
              const baseHeaders: Record<string, string> = {
                'Content-Type': 'application/json',
                ...(authHeader ? { Authorization: authHeader } : {}),
              };
              const withCorrelation = correlationId ? withCorrelationId(baseHeaders, correlationId) : new Headers(baseHeaders);
              const headers = withEvalHeaders(withCorrelation, evalRunId, evalTraceId);

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
                    });
                  }
                }
              }
            } catch (error) {
              console.error('[get_ancient_history] Failed to fetch Yahoo leagues:', error);
            }
          }

          // Fetch Sleeper leagues
          if (!platform || platform === 'sleeper') {
            try {
              const baseHeaders: Record<string, string> = {
                'Content-Type': 'application/json',
                ...(authHeader ? { Authorization: authHeader } : {}),
              };
              const withCorrelation = correlationId ? withCorrelationId(baseHeaders, correlationId) : new Headers(baseHeaders);
              const headers = withEvalHeaders(withCorrelation, evalRunId, evalTraceId);

              const sleeperResponse = await env.AUTH_WORKER.fetch(
                new Request('https://internal/leagues/sleeper', { headers })
              );
              if (sleeperResponse.ok) {
                const sleeperData = (await sleeperResponse.json()) as {
                  leagues?: Array<{
                    sport: string;
                    leagueId: string;
                    leagueName: string;
                    rosterId?: number;
                    seasonYear: number;
                  }>;
                };
                if (sleeperData.leagues) {
                  for (const league of sleeperData.leagues) {
                    allLeagues.push({
                      platform: 'sleeper',
                      sport: league.sport,
                      leagueId: league.leagueId,
                      leagueName: league.leagueName,
                      teamId: league.rosterId ? String(league.rosterId) : '',
                      seasonYear: league.seasonYear,
                    });
                  }
                }
              }
            } catch (error) {
              console.error('[get_ancient_history] Failed to fetch Sleeper leagues:', error);
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
            groupSeasons.sort((a, b) => (b.seasonYear || 0) - (a.seasonYear || 0));
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
        }, evalRunId, evalTraceId);
      },
    },

    // -------------------------------------------------------------------------
    // Tool 2: get_league_info
    // -------------------------------------------------------------------------
    {
      name: 'get_league_info',
      title: 'League Information',
      requiredScope: 'mcp:read',
      securitySchemes: buildSecuritySchemes('mcp:read'),
      openaiMeta: { invoking: 'Fetching league info\u2026', invoked: 'League info ready' },
      description: `Get fantasy league information including settings, scoring type, roster configuration, and schedule. Use values from get_user_session. Read-only and safe to retry. Current date is ${currentDate}.`,
      inputSchema: {
        platform: z
          .enum(['espn', 'yahoo', 'sleeper'])
          .describe('Fantasy platform (e.g., "espn", "yahoo")'),
        sport: z
          .enum(['football', 'baseball', 'basketball', 'hockey'])
          .describe('Sport type (e.g., "football", "baseball")'),
        league_id: z.string().describe('League ID (get from get_user_session)'),
        season_year: z.number().describe('Season start year (e.g., 2025 for MLB 2025, 2024 for NBA 2024-25)'),
      } as ZodShape,
      handler: async (args, env, authHeader, correlationId, evalRunId, evalTraceId) => {
        const params: ToolParams = {
          platform: args.platform as Platform,
          sport: args.sport as Sport,
          league_id: args.league_id as string,
          season_year: args.season_year as number,
        };

        return withToolLogging(correlationId, 'get_league_info', `${params.platform} ${params.sport} league=${params.league_id}`, async () => {
          const result = await routeToClient(env, 'get_league_info', params, authHeader, correlationId, evalRunId, evalTraceId);
          return routeResultToMcp(result);
        }, evalRunId, evalTraceId);
      },
    },

    // -------------------------------------------------------------------------
    // Tool 3: get_standings
    // -------------------------------------------------------------------------
    {
      name: 'get_standings',
      title: 'League Standings',
      requiredScope: 'mcp:read',
      securitySchemes: buildSecuritySchemes('mcp:read'),
      openaiMeta: { invoking: 'Fetching standings\u2026', invoked: 'Standings ready' },
      description: `Get current league standings with team records, rankings, and playoff seeds. Use values from get_user_session. Read-only and safe to retry. Current date is ${currentDate}.`,
      inputSchema: {
        platform: z
          .enum(['espn', 'yahoo', 'sleeper'])
          .describe('Fantasy platform (e.g., "espn", "yahoo")'),
        sport: z
          .enum(['football', 'baseball', 'basketball', 'hockey'])
          .describe('Sport type (e.g., "football", "baseball")'),
        league_id: z.string().describe('League ID (get from get_user_session)'),
        season_year: z.number().describe('Season start year (e.g., 2025 for MLB 2025, 2024 for NBA 2024-25)'),
      } as ZodShape,
      handler: async (args, env, authHeader, correlationId, evalRunId, evalTraceId) => {
        const params: ToolParams = {
          platform: args.platform as Platform,
          sport: args.sport as Sport,
          league_id: args.league_id as string,
          season_year: args.season_year as number,
        };

        return withToolLogging(correlationId, 'get_standings', `${params.platform} ${params.sport} league=${params.league_id}`, async () => {
          const result = await routeToClient(env, 'get_standings', params, authHeader, correlationId, evalRunId, evalTraceId);
          return routeResultToMcp(result);
        }, evalRunId, evalTraceId);
      },
    },

    // -------------------------------------------------------------------------
    // Tool 4: get_matchups
    // -------------------------------------------------------------------------
    {
      name: 'get_matchups',
      title: 'League Matchups',
      requiredScope: 'mcp:read',
      securitySchemes: buildSecuritySchemes('mcp:read'),
      openaiMeta: { invoking: 'Fetching matchups\u2026', invoked: 'Matchups ready' },
      description: `Get matchups/scoreboard for a specific week or the current week. Use values from get_user_session. Read-only and safe to retry. Current date is ${currentDate}.`,
      inputSchema: {
        platform: z
          .enum(['espn', 'yahoo', 'sleeper'])
          .describe('Fantasy platform (e.g., "espn", "yahoo")'),
        sport: z
          .enum(['football', 'baseball', 'basketball', 'hockey'])
          .describe('Sport type (e.g., "football", "baseball")'),
        league_id: z.string().describe('League ID (get from get_user_session)'),
        season_year: z.number().describe('Season start year (e.g., 2025 for MLB 2025, 2024 for NBA 2024-25)'),
        week: z.number().optional().describe('Week number (optional, defaults to current week)'),
      } as ZodShape,
      handler: async (args, env, authHeader, correlationId, evalRunId, evalTraceId) => {
        const params: ToolParams = {
          platform: args.platform as Platform,
          sport: args.sport as Sport,
          league_id: args.league_id as string,
          season_year: args.season_year as number,
          week: args.week as number | undefined,
        };

        return withToolLogging(correlationId, 'get_matchups', `${params.platform} ${params.sport} league=${params.league_id} week=${params.week || 'current'}`, async () => {
          const result = await routeToClient(env, 'get_matchups', params, authHeader, correlationId, evalRunId, evalTraceId);
          return routeResultToMcp(result);
        }, evalRunId, evalTraceId);
      },
    },

    // -------------------------------------------------------------------------
    // Tool 5: get_roster
    // -------------------------------------------------------------------------
    {
      name: 'get_roster',
      title: 'Team Roster',
      requiredScope: 'mcp:read',
      securitySchemes: buildSecuritySchemes('mcp:read'),
      openaiMeta: { invoking: 'Fetching roster\u2026', invoked: 'Roster ready' },
      description: `Get detailed roster for a specific team including players, positions, and stats. Requires authentication. Use values from get_user_session. Read-only and safe to retry. Current date is ${currentDate}.`,
      inputSchema: {
        platform: z
          .enum(['espn', 'yahoo', 'sleeper'])
          .describe('Fantasy platform (e.g., "espn", "yahoo")'),
        sport: z
          .enum(['football', 'baseball', 'basketball', 'hockey'])
          .describe('Sport type (e.g., "football", "baseball")'),
        league_id: z.string().describe('League ID (get from get_user_session)'),
        season_year: z.number().describe('Season start year (e.g., 2025 for MLB 2025, 2024 for NBA 2024-25)'),
        team_id: z.string().optional().describe('Team ID (optional, defaults to user\'s team)'),
        week: z.number().optional().describe('Week number (optional, defaults to current week)'),
      } as ZodShape,
      handler: async (args, env, authHeader, correlationId, evalRunId, evalTraceId) => {
        const params: ToolParams = {
          platform: args.platform as Platform,
          sport: args.sport as Sport,
          league_id: args.league_id as string,
          season_year: args.season_year as number,
          team_id: args.team_id as string | undefined,
          week: args.week as number | undefined,
        };

        return withToolLogging(correlationId, 'get_roster', `${params.platform} ${params.sport} league=${params.league_id} team=${params.team_id || 'self'}`, async () => {
          const result = await routeToClient(env, 'get_roster', params, authHeader, correlationId, evalRunId, evalTraceId);
          return routeResultToMcp(result);
        }, evalRunId, evalTraceId);
      },
    },

    // -------------------------------------------------------------------------
    // Tool 6: get_free_agents
    // -------------------------------------------------------------------------
    {
      name: 'get_free_agents',
      title: 'Free Agents',
      requiredScope: 'mcp:read',
      securitySchemes: buildSecuritySchemes('mcp:read'),
      openaiMeta: { invoking: 'Searching free agents\u2026', invoked: 'Free agents ready' },
      description: `Get available free agents, optionally filtered by position. Sorted by ownership percentage. Requires authentication. Use values from get_user_session. Read-only and safe to retry. Current date is ${currentDate}.`,
      inputSchema: {
        platform: z
          .enum(['espn', 'yahoo', 'sleeper'])
          .describe('Fantasy platform (e.g., "espn", "yahoo")'),
        sport: z
          .enum(['football', 'baseball', 'basketball', 'hockey'])
          .describe('Sport type (e.g., "football", "baseball")'),
        league_id: z.string().describe('League ID (get from get_user_session)'),
        season_year: z.number().describe('Season start year (e.g., 2025 for MLB 2025, 2024 for NBA 2024-25)'),
        position: z
          .string()
          .optional()
          .describe('Filter by position (e.g., "QB", "RB", "SP", "C"). Default: ALL'),
        count: z
          .number()
          .optional()
          .describe('Maximum number of players to return (default: 25, max: 100)'),
      } as ZodShape,
      handler: async (args, env, authHeader, correlationId, evalRunId, evalTraceId) => {
        const params: ToolParams = {
          platform: args.platform as Platform,
          sport: args.sport as Sport,
          league_id: args.league_id as string,
          season_year: args.season_year as number,
          position: args.position as string | undefined,
          count: args.count as number | undefined,
        };

        return withToolLogging(correlationId, 'get_free_agents', `${params.platform} ${params.sport} league=${params.league_id} pos=${params.position || 'ALL'}`, async () => {
          const result = await routeToClient(env, 'get_free_agents', params, authHeader, correlationId, evalRunId, evalTraceId);
          return routeResultToMcp(result);
        }, evalRunId, evalTraceId);
      },
    },
  ];
}
