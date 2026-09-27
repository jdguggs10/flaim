import { ErrorCode, extractErrorCode, type ExecuteResponse } from '@flaim/worker-shared';
import type { Env, SleeperRoster, Sport, ToolParams } from '../types';
import { flaimSportToSleeper, handleSleeperError, sleeperFetch } from './sleeper-api';
import { buildSleeperFreeAgents } from './sleeper-free-agents';
import { getSleeperPlayersIndex } from './sleeper-players-cache';

function clampCount(value: unknown): number {
  const rawCount = Number.isFinite(Number(value)) ? Number(value) : 25;
  return Math.max(1, Math.min(100, Math.trunc(rawCount)));
}

const TRENDING_LOOKBACK_HOURS = 24;
const TRENDING_LIMIT = 200;
// Trending is an optional ranking signal fetched alongside rosters; cap it well
// below sleeperFetch's 10s default so a slow trending endpoint can't add
// seconds to every call before degrading to search_rank-only ranking.
const TRENDING_TIMEOUT_MS = 3000;

interface SleeperTrendingEntry {
  player_id?: unknown;
  count?: unknown;
}

/**
 * Sleeper's public "most added in the last 24h" leaderboard, used as the
 * primary free-agent ranking signal (FLA-422). Never throws: a non-OK
 * response, a network error, or an unexpected payload shape all degrade to
 * an empty map (logged, not surfaced to the caller) so a trending outage
 * never fails get_free_agents — ranking simply falls back to search_rank.
 */
export async function fetchSleeperTrendingAdds(cacheSport: Sport): Promise<Map<string, number>> {
  try {
    const sleeperSport = flaimSportToSleeper(cacheSport);
    const response = await sleeperFetch(
      `/players/${sleeperSport}/trending/add?lookback_hours=${TRENDING_LOOKBACK_HOURS}&limit=${TRENDING_LIMIT}`,
      { timeout: TRENDING_TIMEOUT_MS },
    );
    if (!response.ok) {
      console.warn('[fetchSleeperTrendingAdds] Non-OK response, ranking by search_rank only:', {
        sport: cacheSport,
        status: response.status,
      });
      return new Map();
    }

    const payload: unknown = await response.json();
    if (!Array.isArray(payload)) {
      console.warn('[fetchSleeperTrendingAdds] Unexpected payload shape, ranking by search_rank only:', {
        sport: cacheSport,
      });
      return new Map();
    }

    const trending = new Map<string, number>();
    for (const entry of payload as SleeperTrendingEntry[]) {
      const playerId = entry?.player_id;
      const count = entry?.count;
      if (typeof playerId === 'string' && playerId.length > 0 && typeof count === 'number' && Number.isFinite(count)) {
        trending.set(playerId, count);
      }
    }
    return trending;
  } catch (error) {
    console.warn('[fetchSleeperTrendingAdds] Fetch failed, ranking by search_rank only:', {
      sport: cacheSport,
      error: error instanceof Error ? error.message : String(error),
    });
    return new Map();
  }
}

export function createSleeperGetFreeAgentsHandler(cacheSport: Sport) {
  return async function handleGetFreeAgents(
    env: Env,
    params: ToolParams,
  ): Promise<ExecuteResponse> {
    const { league_id } = params;
    if (!league_id) {
      return { success: false, error: 'league_id is required for get_free_agents', code: ErrorCode.MISSING_PARAM };
    }

    try {
      // Start both; check rosters first so a roster error doesn't wait on trending.
      // fetchSleeperTrendingAdds never rejects, so leaving it pending is safe.
      const rostersPromise = sleeperFetch(`/league/${league_id}/rosters`);
      const trendingPromise = fetchSleeperTrendingAdds(cacheSport);
      const rostersRes = await rostersPromise;
      if (!rostersRes.ok) handleSleeperError(rostersRes);
      const trendingAdds = await trendingPromise;

      const rosters: SleeperRoster[] = await rostersRes.json();
      const rostered = new Set<string>();
      for (const roster of rosters) {
        for (const playerId of roster.players ?? []) {
          rostered.add(String(playerId));
        }
      }

      const requestedCount = clampCount(params.count);
      let freeAgents: ReturnType<typeof buildSleeperFreeAgents> = [];
      let warning: string | undefined;

      try {
        const playersIndex = await getSleeperPlayersIndex(env, cacheSport);
        freeAgents = buildSleeperFreeAgents(playersIndex, rostered, params.position, requestedCount, trendingAdds);
      } catch (error) {
        console.error('[handleGetFreeAgents] Failed to get player index:', error);
        warning = 'PLAYER_ENRICHMENT_UNAVAILABLE: free-agent player index unavailable; returning empty list';
      }

      return {
        success: true,
        data: {
          platform: 'sleeper',
          sport: params.sport,
          league_id,
          season_year: params.season_year,
          count: freeAgents.length,
          players: freeAgents,
          // `warning` is the legacy singular field (kept for published
          // clients); `warnings` is the array form other Sleeper tools use
          // (get_roster/get_matchups/get_transactions) so callers can rely on
          // one shape across Sleeper tools without special-casing this one.
          ...(warning ? { warning, warnings: [warning] } : {}),
        },
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        code: extractErrorCode(error),
      };
    }
  };
}
