import { extractErrorCode, type ExecuteResponse } from '@flaim/worker-shared';
import type { Env, SleeperRoster, Sport, ToolParams } from '../types';
import { handleSleeperError, sleeperFetch } from './sleeper-api';
import { buildSleeperFreeAgents } from './sleeper-free-agents';
import { getSleeperPlayersIndex } from './sleeper-players-cache';

function clampCount(value: unknown): number {
  const rawCount = Number.isFinite(Number(value)) ? Number(value) : 25;
  return Math.max(1, Math.min(100, Math.trunc(rawCount)));
}

export function createSleeperGetFreeAgentsHandler(cacheSport: Sport) {
  return async function handleGetFreeAgents(
    env: Env,
    params: ToolParams,
  ): Promise<ExecuteResponse> {
    const { league_id } = params;

    try {
      const rostersRes = await sleeperFetch(`/league/${league_id}/rosters`);
      if (!rostersRes.ok) handleSleeperError(rostersRes);

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
        freeAgents = buildSleeperFreeAgents(playersIndex, rostered, params.position, requestedCount);
      } catch {
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
          ...(warning ? { warning } : {}),
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
