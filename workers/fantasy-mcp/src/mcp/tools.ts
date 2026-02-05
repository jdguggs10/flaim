// workers/fantasy-mcp/src/mcp/tools.ts
import { z } from 'zod';
import type { Env, Platform, Sport, ToolParams } from '../types';
import { routeToClient, type RouteResult } from '../router';
import { withCorrelationId } from '@flaim/worker-shared';

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
  // Index signature to satisfy MCP SDK types
  [key: string]: unknown;
}

export interface UnifiedTool {
  name: string;
  title: string;
  description: string;
  inputSchema: ZodShape;
  handler: (
    args: Record<string, unknown>,
    env: Env,
    authHeader?: string,
    correlationId?: string
  ) => Promise<McpToolResponse>;
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
  correlationId?: string
): Promise<{ leagues: UserLeague[]; error?: string; status?: number }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    console.log(`[fantasy-mcp] Fetching leagues from auth-worker`);

    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    };
    const headers = correlationId ? withCorrelationId(baseHeaders, correlationId) : baseHeaders;

    const response = await env.AUTH_WORKER.fetch(
      new Request('https://internal/leagues', {
        method: 'GET',
        headers,
        signal: controller.signal,
      })
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`[fantasy-mcp] Leagues fetch failed: ${response.status}`);
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
    console.log(`[fantasy-mcp] Found ${leagues.length} leagues`);
    return { leagues };
  } catch (error) {
    clearTimeout(timeoutId);
    console.error('[fantasy-mcp] Failed to fetch leagues:', error);
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
      description:
        "Returns the user's configured fantasy leagues with current season info. Use the returned platform, sport, leagueId, teamId, and seasonYear values for all subsequent tool calls. season_year always represents the start year of the season.",
      inputSchema: {},
      handler: async (_args, env, authHeader, correlationId) => {
        try {
          // Fetch ESPN leagues
          const { leagues: espnLeagues, status: fetchStatus } = await fetchUserLeagues(env, authHeader, correlationId);

          if (fetchStatus === 401 || fetchStatus === 403) {
            throw new Error('AUTH_FAILED: Authentication failed');
          }

          // Fetch Yahoo leagues
          const yahooLeagues: UserLeague[] = [];
          try {
            const baseHeaders: Record<string, string> = {
              'Content-Type': 'application/json',
              ...(authHeader ? { Authorization: authHeader } : {}),
            };
            const headers = correlationId ? withCorrelationId(baseHeaders, correlationId) : baseHeaders;

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

          // Combine all leagues
          const allLeagues = [...espnLeagues, ...yahooLeagues];

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
              .join(', ')}. For historical leagues/seasons (2+ years old), use get_ancient_history. ASK which league they want to work with if unclear.`;
          }

          // Fetch user preferences for defaults
          interface LeagueDefault {
            platform: 'espn' | 'yahoo';
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
            const headers = correlationId ? withCorrelationId(baseHeaders, correlationId) : baseHeaders;
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
          if (message.includes('AUTH_FAILED')) {
            throw error; // Re-throw auth errors to be handled by MCP handler
          }
          return mcpError(`Failed to fetch user session: ${message}`);
        }
      },
    },

    // -------------------------------------------------------------------------
    // GET ANCIENT HISTORY - Retrieve old leagues and seasons
    // -------------------------------------------------------------------------
    {
      name: 'get_ancient_history',
      title: 'Ancient History',
      description:
        'Retrieve archived leagues and old seasons beyond the 2-year window. Use when user asks about inactive leagues, past seasons, or historical performance.',
      inputSchema: {
        type: 'object',
        properties: {
          platform: {
            type: 'string',
            enum: ['espn', 'yahoo'],
            description: 'Optional: filter to specific platform',
          },
        },
      },
      handler: async (args, env, authHeader, correlationId) => {
        const { platform } = args as { platform?: 'espn' | 'yahoo' };

        try {
          // Fetch all leagues (same logic as get_user_session)
          const allLeagues: UserLeague[] = [];

          // Fetch ESPN leagues
          if (!platform || platform === 'espn') {
            const { leagues: espnLeagues } = await fetchUserLeagues(env, authHeader, correlationId);
            allLeagues.push(...espnLeagues);
          }

          // Fetch Yahoo leagues
          if (!platform || platform === 'yahoo') {
            try {
              const baseHeaders: Record<string, string> = {
                'Content-Type': 'application/json',
                ...(authHeader ? { Authorization: authHeader } : {}),
              };
              const headers = correlationId ? withCorrelationId(baseHeaders, correlationId) : baseHeaders;

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
      },
    },

    // -------------------------------------------------------------------------
    // Tool 2: get_league_info
    // -------------------------------------------------------------------------
    {
      name: 'get_league_info',
      title: 'League Information',
      description: `Get fantasy league information including settings, scoring type, roster configuration, and schedule. Use values from get_user_session. Current date is ${currentDate}.`,
      inputSchema: {
        platform: z
          .enum(['espn', 'yahoo'])
          .describe('Fantasy platform (e.g., "espn", "yahoo")'),
        sport: z
          .enum(['football', 'baseball', 'basketball', 'hockey'])
          .describe('Sport type (e.g., "football", "baseball")'),
        league_id: z.string().describe('League ID (get from get_user_session)'),
        season_year: z.number().describe('Season start year (e.g., 2025 for MLB 2025, 2024 for NBA 2024-25)'),
      } as ZodShape,
      handler: async (args, env, authHeader, correlationId) => {
        const params: ToolParams = {
          platform: args.platform as Platform,
          sport: args.sport as Sport,
          league_id: args.league_id as string,
          season_year: args.season_year as number,
        };

        const result = await routeToClient(env, 'get_league_info', params, authHeader, correlationId);
        return routeResultToMcp(result);
      },
    },

    // -------------------------------------------------------------------------
    // Tool 3: get_standings
    // -------------------------------------------------------------------------
    {
      name: 'get_standings',
      title: 'League Standings',
      description: `Get current league standings with team records, rankings, and playoff seeds. Use values from get_user_session. Current date is ${currentDate}.`,
      inputSchema: {
        platform: z
          .enum(['espn', 'yahoo'])
          .describe('Fantasy platform (e.g., "espn", "yahoo")'),
        sport: z
          .enum(['football', 'baseball', 'basketball', 'hockey'])
          .describe('Sport type (e.g., "football", "baseball")'),
        league_id: z.string().describe('League ID (get from get_user_session)'),
        season_year: z.number().describe('Season start year (e.g., 2025 for MLB 2025, 2024 for NBA 2024-25)'),
      } as ZodShape,
      handler: async (args, env, authHeader, correlationId) => {
        const params: ToolParams = {
          platform: args.platform as Platform,
          sport: args.sport as Sport,
          league_id: args.league_id as string,
          season_year: args.season_year as number,
        };

        const result = await routeToClient(env, 'get_standings', params, authHeader, correlationId);
        return routeResultToMcp(result);
      },
    },

    // -------------------------------------------------------------------------
    // Tool 4: get_matchups
    // -------------------------------------------------------------------------
    {
      name: 'get_matchups',
      title: 'League Matchups',
      description: `Get matchups/scoreboard for a specific week or the current week. Use values from get_user_session. Current date is ${currentDate}.`,
      inputSchema: {
        platform: z
          .enum(['espn', 'yahoo'])
          .describe('Fantasy platform (e.g., "espn", "yahoo")'),
        sport: z
          .enum(['football', 'baseball', 'basketball', 'hockey'])
          .describe('Sport type (e.g., "football", "baseball")'),
        league_id: z.string().describe('League ID (get from get_user_session)'),
        season_year: z.number().describe('Season start year (e.g., 2025 for MLB 2025, 2024 for NBA 2024-25)'),
        week: z.number().optional().describe('Week number (optional, defaults to current week)'),
      } as ZodShape,
      handler: async (args, env, authHeader, correlationId) => {
        const params: ToolParams = {
          platform: args.platform as Platform,
          sport: args.sport as Sport,
          league_id: args.league_id as string,
          season_year: args.season_year as number,
          week: args.week as number | undefined,
        };

        const result = await routeToClient(env, 'get_matchups', params, authHeader, correlationId);
        return routeResultToMcp(result);
      },
    },

    // -------------------------------------------------------------------------
    // Tool 5: get_roster
    // -------------------------------------------------------------------------
    {
      name: 'get_roster',
      title: 'Team Roster',
      description: `Get detailed roster for a specific team including players, positions, and stats. Requires authentication. Use values from get_user_session. Current date is ${currentDate}.`,
      inputSchema: {
        platform: z
          .enum(['espn', 'yahoo'])
          .describe('Fantasy platform (e.g., "espn", "yahoo")'),
        sport: z
          .enum(['football', 'baseball', 'basketball', 'hockey'])
          .describe('Sport type (e.g., "football", "baseball")'),
        league_id: z.string().describe('League ID (get from get_user_session)'),
        season_year: z.number().describe('Season start year (e.g., 2025 for MLB 2025, 2024 for NBA 2024-25)'),
        team_id: z.string().optional().describe('Team ID (optional, defaults to user\'s team)'),
        week: z.number().optional().describe('Week number (optional, defaults to current week)'),
      } as ZodShape,
      handler: async (args, env, authHeader, correlationId) => {
        const params: ToolParams = {
          platform: args.platform as Platform,
          sport: args.sport as Sport,
          league_id: args.league_id as string,
          season_year: args.season_year as number,
          team_id: args.team_id as string | undefined,
          week: args.week as number | undefined,
        };

        const result = await routeToClient(env, 'get_roster', params, authHeader, correlationId);
        return routeResultToMcp(result);
      },
    },

    // -------------------------------------------------------------------------
    // Tool 6: get_free_agents
    // -------------------------------------------------------------------------
    {
      name: 'get_free_agents',
      title: 'Free Agents',
      description: `Get available free agents, optionally filtered by position. Sorted by ownership percentage. Requires authentication. Use values from get_user_session. Current date is ${currentDate}.`,
      inputSchema: {
        platform: z
          .enum(['espn', 'yahoo'])
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
      handler: async (args, env, authHeader, correlationId) => {
        const params: ToolParams = {
          platform: args.platform as Platform,
          sport: args.sport as Sport,
          league_id: args.league_id as string,
          season_year: args.season_year as number,
          position: args.position as string | undefined,
          count: args.count as number | undefined,
        };

        const result = await routeToClient(env, 'get_free_agents', params, authHeader, correlationId);
        return routeResultToMcp(result);
      },
    },
  ];
}
