import type { HandlerFn } from './types';
import type { SleeperLeague } from '../../types';
import { sleeperFetch, handleSleeperError } from '../sleeper-api';
import { toExecuteErrorResponse } from './utils';

export function createGetLeagueInfoHandler(): HandlerFn {
  return async (_env, params) => {
    const { league_id } = params;

    try {
      const response = await sleeperFetch(`/league/${league_id}`);
      if (!response.ok) handleSleeperError(response);

      const league: SleeperLeague = await response.json();

      return {
        success: true,
        data: {
          leagueId: league.league_id,
          name: league.name,
          sport: league.sport,
          season: league.season,
          status: league.status,
          totalRosters: league.total_rosters,
          rosterPositions: league.roster_positions,
          scoringSettings: league.scoring_settings,
          previousLeagueId: league.previous_league_id,
          draftId: league.draft_id,
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
