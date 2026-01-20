/**
 * SDK-based MCP Agent for ESPN Fantasy Football
 *
 * Uses the official @modelcontextprotocol/sdk with registerTool schemas.
 * All auth is handled by Hono middleware BEFORE reaching the SDK.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Env } from '../index-hono';
import { EspnFootballApiClient } from '../espn-football-client';

// TODO: Revisit this workaround. Casting to 'any' is used due to type compatibility issues
// between Zod v3/v4 and @modelcontextprotocol/sdk's registerTool().
// See: https://github.com/modelcontextprotocol/typescript-sdk/issues/906
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ZodShape = Record<string, any>;

// =============================================================================
// STRUCTURED LOGGING
// =============================================================================

interface ToolLog {
  request_id: string;
  user_id: string;
  tool_name: string;
  status: 'start' | 'success' | 'error';
  error_code?: string;
  duration_ms?: number;
  timestamp: string;
}

function logTool(log: ToolLog): void {
  console.log(JSON.stringify(log));
}

function maskUserId(userId: string | null): string {
  if (!userId || userId.length <= 8) return 'anonymous';
  return `${userId.substring(0, 8)}...`;
}

function extractErrorCode(message: string): string | undefined {
  const match = message.match(/^([A-Z_]+):/);
  return match ? match[1] : undefined;
}

/**
 * Get the default season year for football using America/New_York timezone.
 * Defaults to previous year until Jun 1, then switches to current year.
 */
function getDefaultFootballSeason(now = new Date()): number {
  const ny = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);

  const year = Number(ny.find((p) => p.type === 'year')?.value);
  const month = Number(ny.find((p) => p.type === 'month')?.value);

  // Rollover on Jun 1 (month 6)
  return month < 6 ? year - 1 : year;
}

// =============================================================================
// AUTH WORKER FETCH
// =============================================================================

function authWorkerFetch(env: Env, path: string, init?: RequestInit): Promise<Response> {
  const safePath = path.startsWith('/') ? path : `/${path}`;
  if (env.AUTH_WORKER) {
    const url = new URL(safePath, 'https://auth-worker.internal');
    return env.AUTH_WORKER.fetch(new Request(url.toString(), init));
  }
  if (env.ENVIRONMENT === 'prod') {
    console.warn('[sdk-agent/authWorkerFetch] AUTH_WORKER binding missing in prod; using URL fallback');
  }
  if (!env.AUTH_WORKER_URL) {
    throw new Error('AUTH_WORKER_URL is not configured');
  }
  return fetch(`${env.AUTH_WORKER_URL}${safePath}`, init);
}

// User league data from auth-worker
interface UserLeague {
  leagueId: string;
  sport: string;
  teamId?: string;
  seasonYear?: number;
  leagueName?: string;
  teamName?: string;
  isDefault?: boolean;
}

async function fetchUserLeagues(
  env: Env,
  clerkUserId: string,
  authHeader?: string | null
): Promise<{ leagues: UserLeague[]; error?: string; status?: number }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    console.log(`🏈 [sdk-agent] Fetching leagues for ${clerkUserId}`);

    const response = await authWorkerFetch(env, '/leagues', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`❌ [sdk-agent] Leagues fetch failed: ${response.status}`);
      const text = await response.text().catch(() => 'no body');
      return {
        leagues: [],
        error: `Auth-worker returned ${response.status}: ${text}`,
        status: response.status,
      };
    }

    const data = (await response.json()) as { success?: boolean; leagues?: UserLeague[] };
    const leagues = data.leagues || [];
    console.log(`✅ [sdk-agent] Found ${leagues.length} leagues`);
    return { leagues };
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('❌ [sdk-agent] Failed to fetch leagues:', error);
    return {
      leagues: [],
      error:
        (error as any).name === 'AbortError'
          ? 'Fetch timed out after 5 seconds'
          : `Fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

// =============================================================================
// MCP SERVER FACTORY
// =============================================================================

export interface McpContext {
  env: Env;
  authHeader: string | null;
  clerkUserId: string;
}

/**
 * Create and configure the MCP server with all football tools registered.
 * Uses closure capture to make env/authHeader available to tool handlers.
 */
export function createFootballMcpServer(ctx: McpContext): McpServer {
  const { env, authHeader, clerkUserId } = ctx;

  const server = new McpServer({
    name: 'fantasy-football-mcp',
    version: '2.0.0',
  });

  const currentYear = getDefaultFootballSeason().toString();
  const currentDate = new Date().toISOString().split('T')[0];

  // ---------------------------------------------------------------------------
  // Tool 1: get_user_session
  // ---------------------------------------------------------------------------
  server.registerTool(
    'get_user_session',
    {
      title: 'User Session',
      description:
        "IMPORTANT: Call this tool FIRST before any other tool. Returns the user's configured ESPN leagues, team IDs, current date/time, and current season. Use the returned leagueId and teamId values for all subsequent tool calls.",
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const requestId = crypto.randomUUID();
      const startTime = Date.now();
      const maskedUser = maskUserId(clerkUserId);

      logTool({
        request_id: requestId,
        user_id: maskedUser,
        tool_name: 'get_user_session',
        status: 'start',
        timestamp: new Date().toISOString(),
      });

      try {
        const { leagues: userLeagues, status: fetchStatus } = await fetchUserLeagues(env, clerkUserId, authHeader);

        if (fetchStatus === 401 || fetchStatus === 403) {
          throw new Error('AUTH_FAILED: Authentication failed');
        }

        // Filter for football leagues (case-insensitive, include 'nfl' as alias)
        const footballLeagues = userLeagues.filter(
          (l) => l.sport?.toLowerCase() === 'football' || l.sport?.toLowerCase() === 'nfl'
        );

        const hasAnyLeagues = userLeagues.length > 0;
        const hasFootballLeagues = footballLeagues.length > 0;
        const hasMultipleLeagues = footballLeagues.length > 1;
        const uniqueSeasons = [...new Set(footballLeagues.map((l) => l.seasonYear).filter(Boolean))];
        const hasMultipleSeasons = uniqueSeasons.length > 1;

        let sessionMessage: string;
        if (!hasFootballLeagues) {
          sessionMessage = hasAnyLeagues
            ? `No football leagues found, but found leagues for: ${userLeagues.map((l) => l.sport).join(', ')}. Please add a football league in settings.`
            : 'No leagues configured. Please go to flaim.app/settings/espn to add your ESPN credentials.';
        } else if (hasMultipleLeagues) {
          sessionMessage = hasMultipleSeasons
            ? `User has ${footballLeagues.length} football league entries across seasons ${uniqueSeasons.join(', ')}. ASK which league AND season they want. List by leagueName, leagueId, AND seasonYear. Use matching teamId and seasonYear together.`
            : `User has ${footballLeagues.length} football leagues configured. ASK which league they want. List by leagueName and leagueId.`;
        } else {
          const league = footballLeagues[0];
          sessionMessage = league.seasonYear
            ? `Use leagueId=${league.leagueId}, teamId=${league.teamId || 'none'}, seasonId=${league.seasonYear} for all tool calls.`
            : 'Use defaultLeague.leagueId and defaultLeague.teamId for all subsequent tool calls. Use currentSeason for seasonId parameter.';
        }

        const currentSeason = getDefaultFootballSeason();
        const currentSeasonLeague = footballLeagues.find((l) => l.teamId && l.seasonYear === currentSeason);
        const anyLeagueWithTeam = footballLeagues.find((l) => l.teamId);
        const defaultLeagueData = currentSeasonLeague || anyLeagueWithTeam || footballLeagues[0];

        logTool({
          request_id: requestId,
          user_id: maskedUser,
          tool_name: 'get_user_session',
          status: 'success',
          duration_ms: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  currentDate: new Date().toISOString(),
                  currentSeason: currentSeason.toString(),
                  timezone: 'America/New_York',
                  totalLeaguesFound: userLeagues.length,
                  footballLeaguesFound: footballLeagues.length,
                  defaultLeague: defaultLeagueData
                    ? {
                        leagueId: defaultLeagueData.leagueId,
                        teamId: defaultLeagueData.teamId,
                        seasonYear: defaultLeagueData.seasonYear,
                        leagueName: defaultLeagueData.leagueName,
                        teamName: defaultLeagueData.teamName,
                      }
                    : null,
                  allLeagues: userLeagues,
                  instructions: sessionMessage,
                  debug: {
                    clerkUserId: clerkUserId === 'oauth-user' ? 'oauth-user' : `${clerkUserId.substring(0, 8)}...`,
                    hasAuthHeader: !!authHeader,
                    fetchStatus,
                  },
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logTool({
          request_id: requestId,
          user_id: maskedUser,
          tool_name: 'get_user_session',
          status: 'error',
          error_code: extractErrorCode(errorMessage),
          duration_ms: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });
        throw error;
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 2: get_espn_football_league_info
  // ---------------------------------------------------------------------------
  server.registerTool(
    'get_espn_football_league_info',
    {
      title: 'Football League Info',
      description: `Get ESPN fantasy football league information. Use leagueId from get_user_session. Current season is ${currentYear}.`,
      inputSchema: {
        leagueId: z.string().describe('ESPN league ID (get from get_user_session)'),
        seasonId: z.string().optional().describe(`Season year (default: ${currentYear})`),
      } as ZodShape,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const requestId = crypto.randomUUID();
      const startTime = Date.now();
      const maskedUser = maskUserId(clerkUserId);

      logTool({
        request_id: requestId,
        user_id: maskedUser,
        tool_name: 'get_espn_football_league_info',
        status: 'start',
        timestamp: new Date().toISOString(),
      });

      try {
        const { leagueId, seasonId = currentYear } = args;
        const normalizedArgs = await normalizeToolArgs({ leagueId, seasonId }, env, clerkUserId, authHeader);

        const footballClient = new EspnFootballApiClient(env, { authHeader });
        const league = await footballClient.fetchLeague(
          normalizedArgs.leagueId,
          parseInt(normalizedArgs.seasonId),
          'mSettings',
          clerkUserId
        );

        logTool({
          request_id: requestId,
          user_id: maskedUser,
          tool_name: 'get_espn_football_league_info',
          status: 'success',
          duration_ms: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  data: {
                    id: league.id,
                    name: league.settings?.name || 'Unknown League',
                    size: league.settings?.size || 0,
                    sport: 'football',
                    scoringType: league.settings?.scoringSettings?.scoringType || 'Unknown',
                    currentWeek: league.status?.currentMatchupPeriod || 1,
                    season: normalizedArgs.seasonId,
                    playoffTeamCount: league.settings?.playoffTeamCount || 0,
                    regularSeasonMatchupPeriods: league.settings?.regularSeasonMatchupPeriods || 0,
                    rosterSettings: league.settings?.rosterSettings
                  },
                  leagueId: normalizedArgs.leagueId,
                  year: parseInt(normalizedArgs.seasonId),
                  sport: 'football'
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logTool({
          request_id: requestId,
          user_id: maskedUser,
          tool_name: 'get_espn_football_league_info',
          status: 'error',
          error_code: extractErrorCode(errorMessage),
          duration_ms: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });
        return {
          content: [{ type: 'text' as const, text: `Failed to fetch league info: ${errorMessage}` }],
          isError: true,
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 3: get_espn_football_team
  // ---------------------------------------------------------------------------
  server.registerTool(
    'get_espn_football_team',
    {
      title: 'Football Team',
      description: `Get detailed team information from ESPN fantasy football league. Use leagueId and teamId from get_user_session. Current season is ${currentYear}.`,
      inputSchema: {
        leagueId: z.string().describe('ESPN league ID (get from get_user_session)'),
        teamId: z.string().describe('Team ID within the league (get from get_user_session)'),
        seasonId: z.string().optional().describe(`Season year (default: ${currentYear})`),
        week: z.number().optional().describe('Week number (optional)'),
      } as ZodShape,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const requestId = crypto.randomUUID();
      const startTime = Date.now();
      const maskedUser = maskUserId(clerkUserId);

      logTool({
        request_id: requestId,
        user_id: maskedUser,
        tool_name: 'get_espn_football_team',
        status: 'start',
        timestamp: new Date().toISOString(),
      });

      try {
        const { leagueId, teamId, seasonId = currentYear, week } = args;
        const normalizedArgs = await normalizeToolArgs({ leagueId, teamId, seasonId }, env, clerkUserId, authHeader);

        const footballClient = new EspnFootballApiClient(env, { authHeader });
        const teamData = await footballClient.fetchTeam(
          normalizedArgs.leagueId,
          normalizedArgs.teamId!,
          parseInt(normalizedArgs.seasonId),
          week,
          clerkUserId
        );

        logTool({
          request_id: requestId,
          user_id: maskedUser,
          tool_name: 'get_espn_football_team',
          status: 'success',
          duration_ms: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  data: teamData,
                  leagueId: normalizedArgs.leagueId,
                  teamId: normalizedArgs.teamId,
                  year: parseInt(normalizedArgs.seasonId),
                  sport: 'football'
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logTool({
          request_id: requestId,
          user_id: maskedUser,
          tool_name: 'get_espn_football_team',
          status: 'error',
          error_code: extractErrorCode(errorMessage),
          duration_ms: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });
        return {
          content: [{ type: 'text' as const, text: `Failed to fetch team: ${errorMessage}` }],
          isError: true,
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 4: get_espn_football_matchups
  // ---------------------------------------------------------------------------
  server.registerTool(
    'get_espn_football_matchups',
    {
      title: 'Football Matchups',
      description: `Get current week matchups from ESPN fantasy football league. Use leagueId from get_user_session. Current season is ${currentYear}, current date is ${currentDate}.`,
      inputSchema: {
        leagueId: z.string().describe('ESPN league ID (get from get_user_session)'),
        week: z.number().optional().describe('Week number (optional, defaults to current week)'),
        seasonId: z.string().optional().describe(`Season year (default: ${currentYear})`),
      } as ZodShape,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const requestId = crypto.randomUUID();
      const startTime = Date.now();
      const maskedUser = maskUserId(clerkUserId);

      logTool({
        request_id: requestId,
        user_id: maskedUser,
        tool_name: 'get_espn_football_matchups',
        status: 'start',
        timestamp: new Date().toISOString(),
      });

      try {
        const { leagueId, week, seasonId = currentYear } = args;
        const normalizedArgs = await normalizeToolArgs({ leagueId, seasonId }, env, clerkUserId, authHeader);

        const footballClient = new EspnFootballApiClient(env, { authHeader });
        const matchups = await footballClient.fetchMatchups(
          normalizedArgs.leagueId,
          week,
          parseInt(normalizedArgs.seasonId),
          clerkUserId
        );

        logTool({
          request_id: requestId,
          user_id: maskedUser,
          tool_name: 'get_espn_football_matchups',
          status: 'success',
          duration_ms: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  data: matchups,
                  leagueId: normalizedArgs.leagueId,
                  week,
                  year: parseInt(normalizedArgs.seasonId),
                  sport: 'football'
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logTool({
          request_id: requestId,
          user_id: maskedUser,
          tool_name: 'get_espn_football_matchups',
          status: 'error',
          error_code: extractErrorCode(errorMessage),
          duration_ms: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });
        return {
          content: [{ type: 'text' as const, text: `Failed to fetch matchups: ${errorMessage}` }],
          isError: true,
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 5: get_espn_football_standings
  // ---------------------------------------------------------------------------
  server.registerTool(
    'get_espn_football_standings',
    {
      title: 'Football Standings',
      description: `Get league standings from ESPN fantasy football league. Use leagueId from get_user_session. Current season is ${currentYear}.`,
      inputSchema: {
        leagueId: z.string().describe('ESPN league ID (get from get_user_session)'),
        seasonId: z.string().optional().describe(`Season year (default: ${currentYear})`),
      } as ZodShape,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const requestId = crypto.randomUUID();
      const startTime = Date.now();
      const maskedUser = maskUserId(clerkUserId);

      logTool({
        request_id: requestId,
        user_id: maskedUser,
        tool_name: 'get_espn_football_standings',
        status: 'start',
        timestamp: new Date().toISOString(),
      });

      try {
        const { leagueId, seasonId = currentYear } = args;
        const normalizedArgs = await normalizeToolArgs({ leagueId, seasonId }, env, clerkUserId, authHeader);

        const footballClient = new EspnFootballApiClient(env, { authHeader });
        const standings = await footballClient.fetchStandings(
          normalizedArgs.leagueId,
          parseInt(normalizedArgs.seasonId),
          clerkUserId
        );

        logTool({
          request_id: requestId,
          user_id: maskedUser,
          tool_name: 'get_espn_football_standings',
          status: 'success',
          duration_ms: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  data: standings,
                  leagueId: normalizedArgs.leagueId,
                  year: parseInt(normalizedArgs.seasonId),
                  sport: 'football'
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        logTool({
          request_id: requestId,
          user_id: maskedUser,
          tool_name: 'get_espn_football_standings',
          status: 'error',
          error_code: extractErrorCode(errorMessage),
          duration_ms: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });
        return {
          content: [{ type: 'text' as const, text: `Failed to fetch standings: ${errorMessage}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}

// =============================================================================
// HELPER: Normalize tool arguments with user's configured leagues
// =============================================================================

interface NormalizedArgs {
  leagueId: string;
  teamId?: string;
  seasonId: string;
}

async function normalizeToolArgs(
  args: { leagueId?: string; teamId?: string; seasonId?: string },
  env: Env,
  clerkUserId: string,
  authHeader: string | null
): Promise<NormalizedArgs> {
  const { leagues: userLeagues, status: fetchStatus } = await fetchUserLeagues(env, clerkUserId, authHeader);

  // Check for auth failures first - propagate as AUTH_FAILED so the MCP handler
  // can return a proper 401 with mcp/www_authenticate header
  if (fetchStatus === 401 || fetchStatus === 403) {
    throw new Error('AUTH_FAILED: Authentication failed');
  }

  // Filter for football leagues (case-insensitive, include 'nfl' as alias)
  const footballLeagues = userLeagues.filter(
    (l) => l.sport?.toLowerCase() === 'football' || l.sport?.toLowerCase() === 'nfl'
  );

  if (footballLeagues.length === 0) {
    throw new Error('No football leagues configured. Please go to flaim.app/settings/espn to add your ESPN credentials.');
  }

  const currentSeason = getDefaultFootballSeason();
  const currentSeasonLeague = footballLeagues.find((l) => l.teamId && l.seasonYear === currentSeason);
  const anyLeagueWithTeam = footballLeagues.find((l) => l.teamId);
  const defaultLeague = currentSeasonLeague || anyLeagueWithTeam || footballLeagues[0];

  const providedLeagueId = args.leagueId?.toString();
  const userHasLeague = providedLeagueId && footballLeagues.some((l) => l.leagueId === providedLeagueId);

  let leagueId: string;
  let teamId: string | undefined;
  let seasonId: string;

  if (!providedLeagueId || !userHasLeague) {
    console.log(
      `📋 [sdk-agent] Using default league ${defaultLeague.leagueId} season ${defaultLeague.seasonYear} (provided: ${providedLeagueId || 'none'}, valid: ${userHasLeague})`
    );
    leagueId = defaultLeague.leagueId;
    teamId = args.teamId || defaultLeague.teamId;
    seasonId = args.seasonId || defaultLeague.seasonYear?.toString() || currentSeason.toString();
  } else {
    leagueId = providedLeagueId;
    teamId = args.teamId;
    const matchingLeague = footballLeagues.find((l) => l.leagueId === providedLeagueId);
    seasonId = args.seasonId || matchingLeague?.seasonYear?.toString() || currentSeason.toString();
  }

  console.log(`🔧 [sdk-agent] Normalized args: leagueId=${leagueId}, teamId=${teamId}, seasonId=${seasonId}`);

  return { leagueId, teamId, seasonId };
}
