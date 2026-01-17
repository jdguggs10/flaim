/**
 * SDK-based MCP Agent for ESPN Fantasy Baseball
 *
 * Uses the official @modelcontextprotocol/sdk with registerTool schemas.
 * All auth is handled by Hono middleware BEFORE reaching the SDK.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Env } from '../index-hono';

// TODO: Revisit this workaround. Casting to 'any' is used due to type compatibility issues
// between Zod v3/v4 and @modelcontextprotocol/sdk's registerTool().
// See: https://github.com/modelcontextprotocol/typescript-sdk/issues/906
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ZodShape = Record<string, any>;

// =============================================================================
// STRUCTURED LOGGING (same as agent.ts)
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
 * Get the default season year for baseball using America/New_York timezone.
 * Defaults to previous year until Feb 1, then switches to current year.
 */
function getDefaultBaseballSeason(now = new Date()): number {
  const ny = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);

  const year = Number(ny.find((p) => p.type === 'year')?.value);
  const month = Number(ny.find((p) => p.type === 'month')?.value);

  // Rollover on Feb 1 (month 2)
  return month < 2 ? year - 1 : year;
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
    console.log(`⚾️ [sdk-agent] Fetching leagues for ${clerkUserId}`);

    const response = await authWorkerFetch(env, '/leagues', {
      method: 'GET',
      headers: {
        'X-Clerk-User-ID': clerkUserId,
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
 * Create and configure the MCP server with all baseball tools registered.
 * Uses closure capture to make env/authHeader available to tool handlers.
 */
export function createBaseballMcpServer(ctx: McpContext): McpServer {
  const { env, authHeader, clerkUserId } = ctx;

  const server = new McpServer({
    name: 'fantasy-baseball-mcp',
    version: '4.0.0',
  });

  const currentYear = getDefaultBaseballSeason().toString();
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

        // Note: Auth errors (401/403) should have been caught by Hono middleware already
        // But we still handle them here for safety
        if (fetchStatus === 401 || fetchStatus === 403) {
          throw new Error('AUTH_FAILED: Authentication failed');
        }

        const baseballLeagues = userLeagues.filter(
          (l) => l.sport?.toLowerCase() === 'baseball' || l.sport?.toLowerCase() === 'mlb'
        );

        const hasAnyLeagues = userLeagues.length > 0;
        const hasBaseballLeagues = baseballLeagues.length > 0;
        const hasMultipleLeagues = baseballLeagues.length > 1;
        const uniqueSeasons = [...new Set(baseballLeagues.map((l) => l.seasonYear).filter(Boolean))];
        const hasMultipleSeasons = uniqueSeasons.length > 1;

        let sessionMessage: string;
        if (!hasBaseballLeagues) {
          sessionMessage = hasAnyLeagues
            ? `No baseball leagues found, but found leagues for: ${userLeagues.map((l) => l.sport).join(', ')}. Please add a baseball league in settings.`
            : 'No leagues configured. Please go to flaim.app/settings/espn to add your ESPN credentials.';
        } else if (hasMultipleLeagues) {
          sessionMessage = hasMultipleSeasons
            ? `User has ${baseballLeagues.length} baseball league entries across seasons ${uniqueSeasons.join(', ')}. ASK which league AND season they want. List by leagueName, leagueId, AND seasonYear. Use matching teamId and seasonYear together.`
            : `User has ${baseballLeagues.length} baseball leagues configured. ASK which league they want. List by leagueName and leagueId.`;
        } else {
          const league = baseballLeagues[0];
          sessionMessage = league.seasonYear
            ? `Use leagueId=${league.leagueId}, teamId=${league.teamId || 'none'}, seasonId=${league.seasonYear} for all tool calls.`
            : 'Use defaultLeague.leagueId and defaultLeague.teamId for all subsequent tool calls. Use currentSeason for seasonId parameter.';
        }

        const currentSeason = getDefaultBaseballSeason();
        const currentSeasonLeague = baseballLeagues.find((l) => l.teamId && l.seasonYear === currentSeason);
        const anyLeagueWithTeam = baseballLeagues.find((l) => l.teamId);
        const defaultLeagueData = currentSeasonLeague || anyLeagueWithTeam || baseballLeagues[0];

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
                  baseballLeaguesFound: baseballLeagues.length,
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
  // Tool 2: get_espn_baseball_league_info
  // ---------------------------------------------------------------------------
  server.registerTool(
    'get_espn_baseball_league_info',
    {
      title: 'Baseball League Info',
      description: `Get ESPN fantasy baseball league information. Use leagueId from get_user_session. Current season is ${currentYear}.`,
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
        tool_name: 'get_espn_baseball_league_info',
        status: 'start',
        timestamp: new Date().toISOString(),
      });

      try {
        const { leagueId, seasonId = currentYear } = args;
        const normalizedArgs = await normalizeToolArgs({ leagueId, seasonId }, env, clerkUserId, authHeader);

        const { EspnApiClient } = await import('../espn');
        const espnClient = new EspnApiClient(env, { authHeader });

        const league = await espnClient.fetchLeague(
          normalizedArgs.leagueId,
          parseInt(normalizedArgs.seasonId),
          'mSettings',
          clerkUserId
        );

        const { getLeagueMeta } = await import('../tools/getLeagueMeta');
        const metadata = await getLeagueMeta({ leagueId: league.id.toString(), year: league.seasonId }, env);

        logTool({
          request_id: requestId,
          user_id: maskedUser,
          tool_name: 'get_espn_baseball_league_info',
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
                  data: metadata,
                  leagueId: normalizedArgs.leagueId,
                  year: parseInt(normalizedArgs.seasonId),
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
          tool_name: 'get_espn_baseball_league_info',
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
  // Tool 3: get_espn_baseball_team_roster
  // ---------------------------------------------------------------------------
  server.registerTool(
    'get_espn_baseball_team_roster',
    {
      title: 'Baseball Team Roster',
      description: `Get detailed team roster from ESPN fantasy baseball league. Use leagueId and teamId from get_user_session. Current season is ${currentYear}.`,
      inputSchema: {
        leagueId: z.string().describe('ESPN league ID (get from get_user_session)'),
        teamId: z.string().describe('Team ID within the league (get from get_user_session)'),
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
        tool_name: 'get_espn_baseball_team_roster',
        status: 'start',
        timestamp: new Date().toISOString(),
      });

      try {
        const { leagueId, teamId, seasonId = currentYear } = args;
        const normalizedArgs = await normalizeToolArgs({ leagueId, teamId, seasonId }, env, clerkUserId, authHeader);

        const { EspnApiClient } = await import('../espn');
        const espnClient = new EspnApiClient(env, { authHeader });

        const roster = await espnClient.fetchRoster(
          normalizedArgs.leagueId,
          normalizedArgs.teamId,
          parseInt(normalizedArgs.seasonId, 10),
          undefined,
          clerkUserId
        );

        const rosterEntries = roster?.roster?.entries ?? [];
        const rosterPlayers = rosterEntries
          .map((entry) => {
            const player = entry?.playerPoolEntry?.player ?? entry?.player;
            if (!player || (!player.id && !player.fullName && !player.name)) {
              return null;
            }
            return {
              playerId: player.id,
              name: player.fullName ?? player.name,
              proTeamId: player.proTeamId,
              proTeamAbbrev: player.proTeamAbbreviation,
              primaryPositionId: player.defaultPositionId,
              lineupSlotId: entry?.lineupSlotId,
              lineupSlot: entry?.lineupSlot,
              injuryStatus: player.injuryStatus,
              status: player.status,
            };
          })
          .filter((player): player is NonNullable<typeof player> => player !== null);
        const resolvedTeamId = normalizedArgs.teamId ?? roster?.id?.toString();
        const rosterSummary = roster
          ? {
              id: roster.id,
              abbrev: roster.abbrev,
              location: roster.location,
              nickname: roster.nickname,
            }
          : null;

        logTool({
          request_id: requestId,
          user_id: maskedUser,
          tool_name: 'get_espn_baseball_team_roster',
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
                  data: rosterSummary,
                  roster: rosterPlayers,
                  leagueId: normalizedArgs.leagueId,
                  teamId: resolvedTeamId,
                  year: parseInt(normalizedArgs.seasonId, 10),
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
          tool_name: 'get_espn_baseball_team_roster',
          status: 'error',
          error_code: extractErrorCode(errorMessage),
          duration_ms: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });
        return {
          content: [{ type: 'text' as const, text: `Failed to fetch team roster: ${errorMessage}` }],
          isError: true,
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 4: get_espn_baseball_matchups
  // ---------------------------------------------------------------------------
  server.registerTool(
    'get_espn_baseball_matchups',
    {
      title: 'Baseball Matchups',
      description: `Get current week matchups from ESPN fantasy baseball league. Use leagueId from get_user_session. Current season is ${currentYear}, current date is ${currentDate}.`,
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
        tool_name: 'get_espn_baseball_matchups',
        status: 'start',
        timestamp: new Date().toISOString(),
      });

      try {
        const { leagueId, week, seasonId = currentYear } = args;
        const normalizedArgs = await normalizeToolArgs({ leagueId, seasonId }, env, clerkUserId, authHeader);

        const { EspnApiClient } = await import('../espn');
        const espnClient = new EspnApiClient(env, { authHeader });

        const league = await espnClient.fetchLeague(
          normalizedArgs.leagueId,
          parseInt(normalizedArgs.seasonId),
          'mMatchup',
          clerkUserId
        );

        logTool({
          request_id: requestId,
          user_id: maskedUser,
          tool_name: 'get_espn_baseball_matchups',
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
                  data: league,
                  leagueId: normalizedArgs.leagueId,
                  week,
                  year: parseInt(normalizedArgs.seasonId),
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
          tool_name: 'get_espn_baseball_matchups',
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
  // Tool 5: get_espn_baseball_standings
  // ---------------------------------------------------------------------------
  server.registerTool(
    'get_espn_baseball_standings',
    {
      title: 'Baseball Standings',
      description: `Get league standings from ESPN fantasy baseball league. Use leagueId from get_user_session. Current season is ${currentYear}.`,
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
        tool_name: 'get_espn_baseball_standings',
        status: 'start',
        timestamp: new Date().toISOString(),
      });

      try {
        const { leagueId, seasonId = currentYear } = args;
        const normalizedArgs = await normalizeToolArgs({ leagueId, seasonId }, env, clerkUserId, authHeader);

        const { EspnApiClient } = await import('../espn');
        const espnClient = new EspnApiClient(env, { authHeader });

        const standings = await espnClient.fetchStandings(
          normalizedArgs.leagueId,
          parseInt(normalizedArgs.seasonId),
          clerkUserId
        );

        logTool({
          request_id: requestId,
          user_id: maskedUser,
          tool_name: 'get_espn_baseball_standings',
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
          tool_name: 'get_espn_baseball_standings',
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

  // ---------------------------------------------------------------------------
  // Tool 6: get_espn_baseball_free_agents
  // ---------------------------------------------------------------------------
  server.registerTool(
    'get_espn_baseball_free_agents',
    {
      title: 'Baseball Free Agents',
      description: `Get available free agents from ESPN fantasy baseball league. Filter by position. Sorted by ownership percentage. Use leagueId from get_user_session. Current season is ${currentYear}.`,
      inputSchema: {
        leagueId: z.string().describe('ESPN league ID (get from get_user_session)'),
        seasonId: z.string().optional().describe(`Season year (default: ${currentYear})`),
        position: z
          .enum(['C', '1B', '2B', '3B', 'SS', 'OF', 'SP', 'RP', 'P', 'DH', 'UTIL', 'ALL'])
          .optional()
          .describe('Filter by position (default: ALL)'),
        limit: z.number().optional().describe('Maximum number of players to return (default: 25, max: 100)'),
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
        tool_name: 'get_espn_baseball_free_agents',
        status: 'start',
        timestamp: new Date().toISOString(),
      });

      try {
        const { leagueId, seasonId = currentYear, position, limit } = args;
        const normalizedArgs = await normalizeToolArgs({ leagueId, seasonId }, env, clerkUserId, authHeader);

        const { EspnApiClient } = await import('../espn');
        const espnClient = new EspnApiClient(env, { authHeader });

        const freeAgents = await espnClient.fetchFreeAgents(
          normalizedArgs.leagueId,
          parseInt(normalizedArgs.seasonId),
          { position, limit },
          clerkUserId
        );

        logTool({
          request_id: requestId,
          user_id: maskedUser,
          tool_name: 'get_espn_baseball_free_agents',
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
                  data: freeAgents,
                  leagueId: normalizedArgs.leagueId,
                  year: parseInt(normalizedArgs.seasonId),
                  position: position || 'ALL',
                  limit: limit || 25,
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
          tool_name: 'get_espn_baseball_free_agents',
          status: 'error',
          error_code: extractErrorCode(errorMessage),
          duration_ms: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });
        return {
          content: [{ type: 'text' as const, text: `Failed to fetch free agents: ${errorMessage}` }],
          isError: true,
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 7: get_espn_baseball_box_scores
  // ---------------------------------------------------------------------------
  server.registerTool(
    'get_espn_baseball_box_scores',
    {
      title: 'Baseball Box Scores',
      description: `Get detailed box scores with player-by-player statistics for matchups. Use leagueId from get_user_session. Current season is ${currentYear}, current date is ${currentDate}.`,
      inputSchema: {
        leagueId: z.string().describe('ESPN league ID (get from get_user_session)'),
        seasonId: z.string().optional().describe(`Season year (default: ${currentYear})`),
        matchupPeriod: z.number().optional().describe('Matchup period/week number (optional)'),
        scoringPeriod: z.number().optional().describe('Specific scoring day for daily stats (optional)'),
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
        tool_name: 'get_espn_baseball_box_scores',
        status: 'start',
        timestamp: new Date().toISOString(),
      });

      try {
        const { leagueId, seasonId = currentYear, matchupPeriod, scoringPeriod } = args;
        const normalizedArgs = await normalizeToolArgs({ leagueId, seasonId }, env, clerkUserId, authHeader);

        const { EspnApiClient } = await import('../espn');
        const espnClient = new EspnApiClient(env, { authHeader });

        const boxScores = await espnClient.fetchBoxScores(
          normalizedArgs.leagueId,
          parseInt(normalizedArgs.seasonId),
          { matchupPeriod, scoringPeriod },
          clerkUserId
        );

        logTool({
          request_id: requestId,
          user_id: maskedUser,
          tool_name: 'get_espn_baseball_box_scores',
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
                  data: boxScores,
                  leagueId: normalizedArgs.leagueId,
                  year: parseInt(normalizedArgs.seasonId),
                  matchupPeriod,
                  scoringPeriod,
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
          tool_name: 'get_espn_baseball_box_scores',
          status: 'error',
          error_code: extractErrorCode(errorMessage),
          duration_ms: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });
        return {
          content: [{ type: 'text' as const, text: `Failed to fetch box scores: ${errorMessage}` }],
          isError: true,
        };
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Tool 8: get_espn_baseball_recent_activity
  // ---------------------------------------------------------------------------
  server.registerTool(
    'get_espn_baseball_recent_activity',
    {
      title: 'Baseball Recent Activity',
      description: `Get recent league activity including trades, free agent pickups, drops, and waiver claims. Use leagueId from get_user_session. Current season is ${currentYear}.`,
      inputSchema: {
        leagueId: z.string().describe('ESPN league ID (get from get_user_session)'),
        seasonId: z.string().optional().describe(`Season year (default: ${currentYear})`),
        limit: z.number().optional().describe('Number of activities to return (default: 25)'),
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
        tool_name: 'get_espn_baseball_recent_activity',
        status: 'start',
        timestamp: new Date().toISOString(),
      });

      try {
        const { leagueId, seasonId = currentYear, limit } = args;
        const normalizedArgs = await normalizeToolArgs({ leagueId, seasonId }, env, clerkUserId, authHeader);

        const { EspnApiClient } = await import('../espn');
        const espnClient = new EspnApiClient(env, { authHeader });

        const activity = await espnClient.fetchRecentActivity(
          normalizedArgs.leagueId,
          parseInt(normalizedArgs.seasonId),
          { limit },
          clerkUserId
        );

        logTool({
          request_id: requestId,
          user_id: maskedUser,
          tool_name: 'get_espn_baseball_recent_activity',
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
                  data: activity,
                  leagueId: normalizedArgs.leagueId,
                  year: parseInt(normalizedArgs.seasonId),
                  limit: limit || 25,
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
          tool_name: 'get_espn_baseball_recent_activity',
          status: 'error',
          error_code: extractErrorCode(errorMessage),
          duration_ms: Date.now() - startTime,
          timestamp: new Date().toISOString(),
        });
        return {
          content: [{ type: 'text' as const, text: `Failed to fetch recent activity: ${errorMessage}` }],
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

  const baseballLeagues = userLeagues.filter(
    (l) => l.sport?.toLowerCase() === 'baseball' || l.sport?.toLowerCase() === 'mlb'
  );

  if (baseballLeagues.length === 0) {
    throw new Error('No baseball leagues configured. Please go to flaim.app/settings/espn to add your ESPN credentials.');
  }

  const currentSeason = getDefaultBaseballSeason();
  const currentSeasonLeague = baseballLeagues.find((l) => l.teamId && l.seasonYear === currentSeason);
  const anyLeagueWithTeam = baseballLeagues.find((l) => l.teamId);
  const defaultLeague = currentSeasonLeague || anyLeagueWithTeam || baseballLeagues[0];

  const providedLeagueId = args.leagueId?.toString();
  const userHasLeague = providedLeagueId && baseballLeagues.some((l) => l.leagueId === providedLeagueId);

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
    const matchingLeague = baseballLeagues.find((l) => l.leagueId === providedLeagueId);
    seasonId = args.seasonId || matchingLeague?.seasonYear?.toString() || currentSeason.toString();
  }

  console.log(`🔧 [sdk-agent] Normalized args: leagueId=${leagueId}, teamId=${teamId}, seasonId=${seasonId}`);

  return { leagueId, teamId, seasonId };
}
