// workers/fantasy-mcp/src/mcp/tools.ts
import { z } from 'zod';
import type { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { Env, Platform, Sport, ToolParams } from '../types';
import { routeToClient, type RouteResult } from '../router';
import {
  getDefaultSeasonYear,
  getSeasonLabel,
  withCorrelationId,
  withEvalHeaders,
  withInternalServiceToken,
} from '@flaim/worker-shared';
import { logEvalEvent } from '../logging';

// =============================================================================
// MCP RESPONSE TYPES
// =============================================================================

export interface McpToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
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
  inputSchema: ZodRawShapeCompat;
  requiredScope: 'mcp:read' | 'mcp:write';
  securitySchemes: ToolSecuritySchemes;
  openaiMeta?: {
    invoking: string;
    invoked: string;
  };
  widgetUri?: string;
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
  recurringLeagueId?: string;
}

function getYahooStableLeagueId(leagueId: string): string {
  const stableId = leagueId.match(/^[^.]+\.l\.(.+)$/)?.[1];
  return stableId || leagueId;
}

function getActiveLeagueGroupKey(league: UserLeague): string {
  if (league.platform === 'yahoo') {
    return `${league.platform}:${(league.sport || '').toLowerCase()}:${getYahooStableLeagueId(league.leagueId)}`;
  }
  if (league.platform === 'sleeper') {
    return `${league.platform}:${(league.sport || '').toLowerCase()}:${league.recurringLeagueId || league.leagueId}`;
  }
  return `${league.platform}:${league.leagueId}`;
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
    const withInternal = withInternalServiceToken(withCorrelation, env, 'auth-worker /internal/leagues');
    const headers = withEvalHeaders(withInternal, evalRunId, evalTraceId);

    const response = await env.AUTH_WORKER.fetch(
      new Request('https://internal/internal/leagues', {
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

async function fetchYahooLeagues(
  env: Env,
  authHeader?: string,
  correlationId?: string,
  evalRunId?: string,
  evalTraceId?: string
): Promise<{ leagues: UserLeague[]; error?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  const cid = correlationId || 'no-cid';

  try {
    console.log(`[fantasy-mcp] ${cid} fetching Yahoo leagues from auth-worker`);

    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    };
    const withCorrelation = correlationId ? withCorrelationId(baseHeaders, correlationId) : new Headers(baseHeaders);
    const withInternal = withInternalServiceToken(withCorrelation, env, 'auth-worker /internal/leagues/yahoo');
    const headers = withEvalHeaders(withInternal, evalRunId, evalTraceId);

    const response = await env.AUTH_WORKER.fetch(
      new Request('https://internal/internal/leagues/yahoo', {
        headers,
        signal: controller.signal,
      })
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`[fantasy-mcp] ${cid} Yahoo leagues fetch failed: ${response.status}`);
      return { leagues: [], error: `Yahoo leagues fetch failed: ${response.status}` };
    }

    const data = (await response.json()) as {
      leagues?: Array<{
        sport: string;
        leagueKey: string;
        leagueName: string;
        teamId?: string;
        teamName?: string;
        seasonYear: number;
      }>;
    };

    const leagues: UserLeague[] = (data.leagues || []).map((league) => ({
      platform: 'yahoo' as const,
      sport: league.sport,
      leagueId: league.leagueKey,
      leagueName: league.leagueName,
      teamId: league.teamId || '',
      teamName: league.teamName,
      seasonYear: league.seasonYear,
    }));

    console.log(`[fantasy-mcp] ${cid} found ${leagues.length} Yahoo leagues`);
    return { leagues };
  } catch (error) {
    clearTimeout(timeoutId);
    const isTimeout = (error as Error).name === 'AbortError';
    const errorMsg = isTimeout ? 'Yahoo leagues fetch timed out' : `Yahoo leagues fetch failed: ${(error as Error).message}`;
    console.error(`[fantasy-mcp] ${cid} failed to fetch Yahoo leagues: ${errorMsg}`);
    return { leagues: [], error: errorMsg };
  }
}

async function fetchSleeperLeagues(
  env: Env,
  authHeader?: string,
  correlationId?: string,
  evalRunId?: string,
  evalTraceId?: string
): Promise<{ leagues: UserLeague[]; error?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  const cid = correlationId || 'no-cid';

  try {
    console.log(`[fantasy-mcp] ${cid} fetching Sleeper leagues from auth-worker`);

    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    };
    const withCorrelation = correlationId ? withCorrelationId(baseHeaders, correlationId) : new Headers(baseHeaders);
    const withInternal = withInternalServiceToken(withCorrelation, env, 'auth-worker /internal/leagues/sleeper');
    const headers = withEvalHeaders(withInternal, evalRunId, evalTraceId);

    const response = await env.AUTH_WORKER.fetch(
      new Request('https://internal/internal/leagues/sleeper', {
        headers,
        signal: controller.signal,
      })
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`[fantasy-mcp] ${cid} Sleeper leagues fetch failed: ${response.status}`);
      return { leagues: [], error: `Sleeper leagues fetch failed: ${response.status}` };
    }

    const data = (await response.json()) as {
      leagues?: Array<{
        sport: string;
        leagueId: string;
        leagueName: string;
        rosterId?: number;
        seasonYear: number;
        recurringLeagueId?: string;
      }>;
    };

    const leagues: UserLeague[] = (data.leagues || []).map((league) => ({
      platform: 'sleeper' as const,
      sport: league.sport,
      leagueId: league.leagueId,
      leagueName: league.leagueName,
      teamId: league.rosterId ? String(league.rosterId) : '',
      seasonYear: league.seasonYear,
      recurringLeagueId: league.recurringLeagueId,
    }));

    console.log(`[fantasy-mcp] ${cid} found ${leagues.length} Sleeper leagues`);
    return { leagues };
  } catch (error) {
    clearTimeout(timeoutId);
    const isTimeout = (error as Error).name === 'AbortError';
    const errorMsg = isTimeout ? 'Sleeper leagues fetch timed out' : `Sleeper leagues fetch failed: ${(error as Error).message}`;
    console.error(`[fantasy-mcp] ${cid} failed to fetch Sleeper leagues: ${errorMsg}`);
    return { leagues: [], error: errorMsg };
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
      widgetUri: 'ui://widget/user-session.html',
      description:
        "Call this exactly once at the start of each chat before any other Flaim tool. Returns the user's full league landscape: allLeagues (all active leagues), defaultLeagues (per-sport defaults), and defaultLeague (populated only when a single league exists or defaultSport matches). For vague singular prompts, use defaultLeague when present; otherwise use the relevant sport entry in defaultLeagues. For explicit plural or comparative prompts (each, all, compare, across leagues/platforms), enumerate every matching league in allLeagues and call the target tool once per league. In normal chat flows, do not skip this first step. After this, strongly consider calling get_league_info for the target league. season_year always represents the start year of the season. Read-only. If this call errors, do not repeat it unchanged.",
      inputSchema: {},
      handler: async (_args, env, authHeader, correlationId, evalRunId, evalTraceId) => {
        return withToolLogging(correlationId, 'get_user_session', 'session', async () => {
        try {
          // Fetch ESPN first so auth failures return immediately.
          const espnData = await fetchUserLeagues(env, authHeader, correlationId, evalRunId, evalTraceId);

          // Check ESPN auth errors
          if (espnData.status === 401 || espnData.status === 403) {
            return mcpAuthError('https://api.flaim.app/mcp');
          }

          // Fetch Yahoo + Sleeper in parallel after ESPN auth passes.
          const [yahooResult, sleeperResult] = await Promise.allSettled([
            fetchYahooLeagues(env, authHeader, correlationId, evalRunId, evalTraceId),
            fetchSleeperLeagues(env, authHeader, correlationId, evalRunId, evalTraceId),
          ]);

          const yahooData = yahooResult.status === 'fulfilled' ? yahooResult.value : { leagues: [] as UserLeague[], error: `Yahoo fetch rejected: ${yahooResult.reason}` };
          const sleeperData = sleeperResult.status === 'fulfilled' ? sleeperResult.value : { leagues: [] as UserLeague[], error: `Sleeper fetch rejected: ${sleeperResult.reason}` };

          // Collect warnings from failed fetches
          const warnings: string[] = [];
          if (espnData.error) warnings.push(`ESPN: ${espnData.error}`);
          if (yahooData.error) warnings.push(`Yahoo: ${yahooData.error}`);
          if (sleeperData.error) warnings.push(`Sleeper: ${sleeperData.error}`);

          // Combine all leagues
          const allLeagues = [...espnData.leagues, ...yahooData.leagues, ...sleeperData.leagues];

          // Track which platforms failed to fetch — used to avoid clearing valid defaults
          // when a platform was temporarily unavailable.
          const failedPlatforms = new Set<string>();
          if (espnData.error) failedPlatforms.add('espn');
          if (yahooData.error) failedPlatforms.add('yahoo');
          if (sleeperData.error) failedPlatforms.add('sleeper');

          // Group leagues by stable identity.
          // Yahoo league_key is season-scoped (`<game_key>.l.<league_id>`), so strip the
          // changing game prefix and group on the stable league_id portion instead.
          // That keeps recurring seasons together without collapsing two same-name leagues.
          const leagueGroups = new Map<string, typeof allLeagues>();
          for (const league of allLeagues) {
            const key = getActiveLeagueGroupKey(league);
            if (!leagueGroups.has(key)) {
              leagueGroups.set(key, []);
            }
            leagueGroups.get(key)!.push(league);
          }

          // Filter to active leagues. The session view is intentionally strict:
          // only the sport's current canonical season belongs here. Older seasons
          // stay discoverable through get_ancient_history.
          const leagues: typeof allLeagues = [];
          for (const [, groupSeasons] of leagueGroups) {
            // Sort by seasonYear descending
            groupSeasons.sort((a, b) => (b.seasonYear || 0) - (a.seasonYear || 0));

            // Determine current season for this league's sport
            const sport = (groupSeasons[0]?.sport || '').toLowerCase();
            const currentYear = getDefaultSeasonYear(sport as Sport);
            const currentSeason = groupSeasons.find(s => s.seasonYear === currentYear);
            if (currentSeason) {
              leagues.push(currentSeason);
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
            const sportSummary = Object.entries(sportCounts)
              .map(([sport, count]) => `${count} ${sport}`)
              .join(', ');
            sessionMessage = `User has ${leagues.length} active leagues across ${sportSummary}. Scope rules: (1) For vague singular prompts ("how's my team?", "what's my matchup?"), use the applicable default from the session response: defaultLeague when present, otherwise the relevant sport entry in defaultLeagues — no fan-out, no asking. (2) For explicit plural or comparative prompts ("each of my leagues", "compare my ESPN and Yahoo", "all my teams"), enumerate every matching league in allLeagues and call the target tool once per league before synthesizing. (3) For ambiguous prompts with no applicable default, ask which league. For past seasons or historical data, use get_ancient_history.`;
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
            const withInternal = withInternalServiceToken(withCorrelation, env, 'auth-worker /internal/user/preferences');
            const headers = withEvalHeaders(withInternal, evalRunId, evalTraceId);
            const prefsResponse = await env.AUTH_WORKER.fetch(
              new Request('https://internal/internal/user/preferences', { headers })
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
              } else {
                // Default doesn't match any active league.
                if (failedPlatforms.has(defaultInfo.platform)) {
                  // Platform fetch failed — the league may still be valid. Preserve
                  // the default and surface a transient warning instead of clearing.
                  warnings.push(`Could not verify ${sport} default: ${defaultInfo.platform} data is temporarily unavailable. Default preserved.`);
                } else if (
                  allLeagues.some(
                    (l) =>
                      l.platform === defaultInfo.platform &&
                      l.leagueId === defaultInfo.leagueId &&
                      l.seasonYear === defaultInfo.seasonYear
                  )
                ) {
                  // The default still exists in the provider payload, but is not
                  // part of the current-session view. Preserve it so season
                  // rollover/provider lag does not delete user preferences.
                  warnings.push(`Preserved non-current ${sport} default: league ${defaultInfo.leagueId} is not shown in active leagues.`);
                } else {
                  // Platform fetch succeeded but league is missing — it's genuinely stale.
                  // Fire a best-effort clear so future reads don't repeat this lookup.
                  const staleBaseHeaders: Record<string, string> = {
                    'Content-Type': 'application/json',
                    ...(authHeader ? { Authorization: authHeader } : {}),
                  };
                  const withStaleCorrelation = correlationId ? withCorrelationId(staleBaseHeaders, correlationId) : new Headers(staleBaseHeaders);
                  const withStaleInternal = withInternalServiceToken(withStaleCorrelation, env, `auth-worker /internal/leagues/default/${sport}`);
                  const staleHeaders = withEvalHeaders(withStaleInternal, evalRunId, evalTraceId);
                  const staleUrl = new URL(`https://internal/internal/leagues/default/${sport}`);
                  staleUrl.searchParams.set('platform', defaultInfo.platform);
                  staleUrl.searchParams.set('leagueId', defaultInfo.leagueId);
                  staleUrl.searchParams.set('seasonYear', String(defaultInfo.seasonYear));
                  let cleared = false;
                  try {
                    const clearResp = await env.AUTH_WORKER.fetch(
                      new Request(staleUrl.toString(), { method: 'DELETE', headers: staleHeaders })
                    );
                    cleared = clearResp.ok;
                    if (!clearResp.ok) {
                      console.error(`[get_user_session] Stale ${sport} default DELETE returned ${clearResp.status}`);
                    }
                  } catch (e) {
                    console.error(`[get_user_session] Network error clearing stale ${sport} default:`, e);
                  }
                  warnings.push(
                    cleared
                      ? `Cleared stale ${sport} default: league ${defaultInfo.leagueId} is no longer in your active leagues.`
                      : `Stale ${sport} default detected (league ${defaultInfo.leagueId} is no longer active) — automatic cleanup failed, will retry next session.`
                  );
                }
              }
            }
          }

          // Compute primary default — three deterministic branches only:
          // 1. defaultSport is set AND that sport has a validated default in defaultLeagues
          // 2. Exactly one active league (single-user shortcut, no prefs needed)
          // 3. null — no arbitrary fallback; model should fan out or ask
          const primarySport = preferences.defaultSport as string | undefined;
          const defaultLeague =
            (primarySport && defaultLeagues[primarySport]) ||
            (leagues.length === 1 ? leagues[0] : null);

          const sessionData = {
            success: true,
            currentDate: new Date().toISOString(),
            currentSeasons: {
              football: { year: getDefaultSeasonYear('football'), label: getSeasonLabel(getDefaultSeasonYear('football'), 'football') },
              baseball: { year: getDefaultSeasonYear('baseball'), label: getSeasonLabel(getDefaultSeasonYear('baseball'), 'baseball') },
              basketball: { year: getDefaultSeasonYear('basketball'), label: getSeasonLabel(getDefaultSeasonYear('basketball'), 'basketball') },
              hockey: { year: getDefaultSeasonYear('hockey'), label: getSeasonLabel(getDefaultSeasonYear('hockey'), 'hockey') },
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
                  season: getSeasonLabel(defaultLeague.seasonYear || getDefaultSeasonYear(defaultLeague.sport as Sport), defaultLeague.sport as Sport),
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
                  season: getSeasonLabel(league.seasonYear || getDefaultSeasonYear(sport as Sport), sport as Sport),
                  teamId: league.teamId,
                  teamName: league.teamName,
                },
              ])
            ),
            allLeagues: leagues,
            warnings: warnings.length > 0 ? warnings : undefined,
            instructions: sessionMessage,
          };
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(sessionData, null, 2) }],
            structuredContent: sessionData as unknown as Record<string, unknown>,
            _meta: {
              ui: {
                resourceUri: 'ui://widget/user-session.html',
              },
              'openai/outputTemplate': 'ui://widget/user-session.html',
              'openai/widgetAccessible': true,
              'openai/resultCanProduceWidget': true,
            },
          };
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
        'Use this only after get_user_session, and only when the user is clearly asking about a non-current season or an inactive league. This is the historical branch: it returns past seasons and historical leagues outside the current season view. Use for last season, older seasons, inactive leagues, or historical performance. Read-only. If this call errors, do not repeat it unchanged.',
      inputSchema: {
        platform: z
          .enum(['espn', 'yahoo', 'sleeper'])
          .optional()
          .describe('Optional: filter to specific platform'),
      },
      handler: async (args, env, authHeader, correlationId, evalRunId, evalTraceId) => {
        const { platform } = args as { platform?: 'espn' | 'yahoo' | 'sleeper' };
        return withToolLogging(correlationId, 'get_ancient_history', `ancient platform=${platform || 'all'}`, async () => {
        try {
          // Fetch platform leagues in parallel (only requested platforms)
          const fetchArgs = [env, authHeader, correlationId, evalRunId, evalTraceId] as const;
          const promises: Promise<{ leagues: UserLeague[]; error?: string }>[] = [];
          if (!platform || platform === 'espn') promises.push(fetchUserLeagues(...fetchArgs));
          if (!platform || platform === 'yahoo') promises.push(fetchYahooLeagues(...fetchArgs));
          if (!platform || platform === 'sleeper') promises.push(fetchSleeperLeagues(...fetchArgs));

          const results = await Promise.allSettled(promises);
          const allLeagues: UserLeague[] = [];
          const warnings: string[] = [];
          for (const result of results) {
            if (result.status === 'fulfilled') {
              allLeagues.push(...result.value.leagues);
              if (result.value.error) warnings.push(result.value.error);
            } else {
              warnings.push(`Fetch rejected: ${result.reason}`);
            }
          }

          const thresholdYear = getActiveThresholdYear();

          // Group by stable league identity.
          // For Yahoo, collapse recurring seasons by stripping the season-specific
          // game prefix from league_key, while still keeping distinct active leagues separate.
          const leagueGroups = new Map<string, typeof allLeagues>();
          for (const league of allLeagues) {
            const key = getActiveLeagueGroupKey(league);
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
              // Active league - include everything except the current season
              const sport = (groupSeasons[0]?.sport || '').toLowerCase();
              const currentYear = getDefaultSeasonYear(sport as Sport);
              const ancientSeasons = groupSeasons.filter(s => s.seasonYear !== currentYear);
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
            warnings: warnings.length > 0 ? warnings : undefined,
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
      title: 'League Context',
      requiredScope: 'mcp:read',
      securitySchemes: buildSecuritySchemes('mcp:read'),
      openaiMeta: { invoking: 'Fetching league info\u2026', invoked: 'League info ready' },
      description: `Strongly encouraged as the second call after get_user_session for the specified league. This provides the baseline league context for analysis: league name, settings, scoring type, roster configuration, and team/owner context, plus schedule or season-window metadata when the platform provides it. Use it liberally before standings, matchups, roster, free-agent, player, or transaction analysis so team names are resolved and the model has league-type, scoring, and roster context. When fanning out across multiple leagues, call this once per league. The exact team fields vary by platform but all include ownerName. Use values from get_user_session. Read-only. If this call errors, do not repeat it unchanged. Current date is ${currentDate}.`,
      inputSchema: {
        platform: z
          .enum(['espn', 'yahoo', 'sleeper'])
          .describe('Fantasy platform (e.g., "espn", "yahoo", "sleeper")'),
        sport: z
          .enum(['football', 'baseball', 'basketball', 'hockey'])
          .describe('Sport type (e.g., "football", "baseball")'),
        league_id: z.string().describe('League ID (get from get_user_session)'),
        season_year: z.number().describe('Season start year (e.g., 2025 for MLB 2025, 2024 for NBA 2024-25)'),
      },
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
      description: `Get season standings and outcome snapshot; includes verified season-outcome fields when available. Returns team records, rankings, and points summaries. The rank field is a standings sort position (1 = best): on ESPN and Sleeper it is computed by Flaim from win percentage; on Yahoo it is passed through from Yahoo's own standings API. It is NOT a verified postseason finish. For verified postseason outcome, use finalRank and championshipWon instead. Also returns seasonPhase (regular_season/playoffs_in_progress/season_complete), seasonComplete, and per-team outcome fields: finalRank, championshipWon, playoffOutcome, outcomeConfidence, madePlayoffs, playoffSeed. Outcome fields are null when not verifiable — do not infer championship from rank or team name. Note: playoffOutcome returns 'in_progress' on Sleeper for teams in active playoffs; ESPN and Yahoo return null for that state. ESPN may also include projected-rank fields. Best used after get_user_session and after get_league_info for the specified league so team names and league context are already established. For multi-league comparisons, call once per league. For historical finish questions, call get_ancient_history first to discover seasons, then call this tool per season for verified outcomes. Read-only. If this call errors, do not repeat it unchanged. Current date is ${currentDate}.`,
      inputSchema: {
        platform: z
          .enum(['espn', 'yahoo', 'sleeper'])
          .describe('Fantasy platform (e.g., "espn", "yahoo", "sleeper")'),
        sport: z
          .enum(['football', 'baseball', 'basketball', 'hockey'])
          .describe('Sport type (e.g., "football", "baseball")'),
        league_id: z.string().describe('League ID (get from get_user_session)'),
        season_year: z.number().describe('Season start year (e.g., 2025 for MLB 2025, 2024 for NBA 2024-25)'),
      },
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
      description: `Get matchups/scoreboard for a specific week or the current week. Best used after get_user_session and after get_league_info for the specified league so the model already knows the league's team names, owner/team mapping, and league context before interpreting the matchup. For multi-league comparisons, call once per league. Read-only. If this call errors, do not repeat it unchanged. Current date is ${currentDate}.`,
      inputSchema: {
        platform: z
          .enum(['espn', 'yahoo', 'sleeper'])
          .describe('Fantasy platform (e.g., "espn", "yahoo", "sleeper")'),
        sport: z
          .enum(['football', 'baseball', 'basketball', 'hockey'])
          .describe('Sport type (e.g., "football", "baseball")'),
        league_id: z.string().describe('League ID (get from get_user_session)'),
        season_year: z.number().describe('Season start year (e.g., 2025 for MLB 2025, 2024 for NBA 2024-25)'),
        week: z.number().int().min(1).optional().describe('Week number (optional, must be ≥ 1, defaults to current week)'),
      },
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
      description: `Get roster details for a specific team. Exact payload varies by platform: ESPN and Yahoo return player entries with lineup/position context, while Sleeper returns starters, bench, reserve, and record metadata for the selected roster. Best used after get_user_session and after get_league_info for the specified league so the model already knows the league's team names, owner/team mapping, league settings, and roster context before interpreting this roster. Requires authentication except on Sleeper's public API. Read-only. If this call errors, do not repeat it unchanged. Current date is ${currentDate}.`,
      inputSchema: {
        platform: z
          .enum(['espn', 'yahoo', 'sleeper'])
          .describe('Fantasy platform (e.g., "espn", "yahoo", "sleeper")'),
        sport: z
          .enum(['football', 'baseball', 'basketball', 'hockey'])
          .describe('Sport type (e.g., "football", "baseball")'),
        league_id: z.string().describe('League ID (get from get_user_session)'),
        season_year: z.number().describe('Season start year (e.g., 2025 for MLB 2025, 2024 for NBA 2024-25)'),
        team_id: z.string().optional().describe('Team ID for the target roster. Recommended for all platforms; required on Yahoo. If omitted, platform behavior varies and may not resolve to the user\'s team.'),
        week: z.number().int().min(1).optional().describe('Week number (optional, must be ≥ 1, defaults to current week)'),
      },
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
      description: `Get currently available players for the specified league, optionally filtered by position. Exact payload varies by platform: ESPN and Yahoo include ownership percentages and sort by ownership, while Sleeper returns available-player identities from the public player index without ownership percentages. Best used after get_user_session and usually after get_league_info for the specified league so team names, owner/team mapping, scoring context, and roster-slot context are already established before giving pickup advice. For multi-league comparisons, call once per league. Use this for player availability only. Do not use percentOwned or market ownership to infer who owns a player in the user's league; for ownership questions, use get_league_info (returns teams with ownerName) and get_roster. Requires authentication on ESPN and Yahoo; Sleeper uses the public API. Use values from get_user_session. Read-only. If this call errors, do not repeat it unchanged. Current date is ${currentDate}.`,
      inputSchema: {
        platform: z
          .enum(['espn', 'yahoo', 'sleeper'])
          .describe('Fantasy platform — "espn", "yahoo", or "sleeper"'),
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
      },
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

    // -------------------------------------------------------------------------
    // Tool 7: get_players
    // -------------------------------------------------------------------------
    {
      name: 'get_players',
      title: 'Search Players',
      requiredScope: 'mcp:read',
      securitySchemes: buildSecuritySchemes('mcp:read'),
      openaiMeta: { invoking: 'Searching players\u2026', invoked: 'Players ready' },
      description: `Search for player identity by name. Always returns identity fields, but ownership context varies by platform. ESPN and Yahoo return market/global ownership and can also populate league ownership fields when credentials and league context are available. Sleeper returns identity plus ownership_scope="unavailable" with market_percent_owned=null. Best used after get_user_session and often after get_league_info when the user cares about league-specific ownership or team-name resolution. League ownership fields: league_status ("ROSTERED" = on a team, "FREE_AGENT" = available, null = unavailable), league_team_name (fantasy team name if rostered), league_owner_name (team owner if rostered). When those league fields are absent, null, or unavailable, fall back to get_league_info + get_roster to verify manually. Use values from get_user_session. Read-only. If this call errors, do not repeat it unchanged. Current date is ${currentDate}.`,
      inputSchema: {
        query: z
          .string()
          .min(2)
          .describe('Player name search string (minimum 2 characters)'),
        platform: z
          .enum(['espn', 'yahoo', 'sleeper'])
          .describe('Fantasy platform (e.g., "espn", "yahoo", "sleeper")'),
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
          .describe('Maximum number of players to return (default: 10, max: 25)'),
      },
      handler: async (args, env, authHeader, correlationId, evalRunId, evalTraceId) => {
        const params: ToolParams = {
          platform: args.platform as Platform,
          sport: args.sport as Sport,
          league_id: args.league_id as string,
          season_year: args.season_year as number,
          query: args.query as string,
          position: args.position as string | undefined,
          count: args.count as number | undefined,
        };

        return withToolLogging(correlationId, 'get_players', `${params.platform} ${params.sport} q=${params.query} pos=${params.position || 'ALL'}`, async () => {
          const result = await routeToClient(env, 'get_players', params, authHeader, correlationId, evalRunId, evalTraceId);
          return routeResultToMcp(result);
        }, evalRunId, evalTraceId);
      },
    },

    // -------------------------------------------------------------------------
    // Tool 8: get_transactions
    // -------------------------------------------------------------------------
    {
      name: 'get_transactions',
      title: 'League Transactions',
      requiredScope: 'mcp:read',
      securitySchemes: buildSecuritySchemes('mcp:read'),
      openaiMeta: { invoking: 'Fetching transactions\u2026', invoked: 'Transactions ready' },
      description: `Get recent league transactions including adds, drops, waivers, and trades. Best used after get_user_session and usually after get_league_info so the model already knows the league's team names and owner/team mapping before summarizing activity. Each normalized transaction includes a date field (YYYY-MM-DD), type, status, week, and optional team_ids. When presenting results, organize by time period (today, yesterday, this week, older) AND by team within each period so the user can see both when moves happened and what each team did. Week handling is platform-specific: ESPN/Sleeper use week windows (default current + previous week), while Yahoo uses a recent 14-day timestamp window and ignores explicit week. Type support is also platform-specific: Sleeper supports add/drop/trade/waiver; Yahoo supports add/drop/trade plus pending waiver/pending_trade views for the authenticated user's own items; ESPN also supports failed_bid and trade lifecycle types (trade_proposal, trade_decline, trade_veto, trade_uphold). ESPN uses mTransactions2 for structured transaction data, and accepted trade player details are supplemented from the activity feed. ESPN responses include a "teams" map (team ID → display name) to resolve the numeric team_ids on each transaction, while Yahoo and Sleeper generally rely on get_league_info for team-name resolution. Use values from get_user_session. Read-only. If this call errors, do not repeat it unchanged. Current date is ${currentDate}.`,
      inputSchema: {
        platform: z
          .enum(['espn', 'yahoo', 'sleeper'])
          .describe('Fantasy platform (e.g., "espn", "yahoo", "sleeper")'),
        sport: z
          .enum(['football', 'baseball', 'basketball', 'hockey'])
          .describe('Sport type (e.g., "football", "baseball")'),
        league_id: z.string().describe('League ID (get from get_user_session)'),
        season_year: z.number().describe('Season start year (e.g., 2025 for MLB 2025, 2024 for NBA 2024-25)'),
        week: z.number().int().min(0).optional().describe('Week/scoring-period number (optional, 0 = preseason). ESPN/Sleeper support explicit week; Yahoo ignores week and uses a recent 14-day timestamp window'),
        type: z
          .enum(['add', 'drop', 'trade', 'waiver', 'pending_trade', 'trade_proposal', 'trade_decline', 'trade_veto', 'trade_uphold', 'failed_bid'])
          .optional()
          .describe('Optional transaction type filter. Platform support varies: Sleeper supports add/drop/trade/waiver; Yahoo supports add/drop/trade plus waiver/pending_trade for the authenticated user\'s own pending items; ESPN also supports trade_proposal/trade_decline/trade_veto/trade_uphold/failed_bid.'),
        count: z
          .number()
          .optional()
          .describe('Maximum transactions to return (default: 25, max: 100)'),
      },
      handler: async (args, env, authHeader, correlationId, evalRunId, evalTraceId) => {
        const requestedCount = Number(args.count ?? 25);
        const params: ToolParams = {
          platform: args.platform as Platform,
          sport: args.sport as Sport,
          league_id: args.league_id as string,
          season_year: args.season_year as number,
          week: args.week as number | undefined,
          type: args.type as 'add' | 'drop' | 'trade' | 'waiver' | 'pending_trade' | 'trade_proposal' | 'trade_decline' | 'trade_veto' | 'trade_uphold' | 'failed_bid' | undefined,
          count: Number.isFinite(requestedCount) ? Math.max(1, Math.min(100, requestedCount)) : 25,
        };

        return withToolLogging(correlationId, 'get_transactions', `${params.platform} ${params.sport} league=${params.league_id} week=${params.week || 'recent'}`, async () => {
          const result = await routeToClient(env, 'get_transactions', params, authHeader, correlationId, evalRunId, evalTraceId);
          return routeResultToMcp(result);
        }, evalRunId, evalTraceId);
      },
    },
  ];
}
