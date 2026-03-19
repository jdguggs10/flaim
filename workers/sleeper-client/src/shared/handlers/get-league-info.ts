import type { HandlerFn } from './types';
import type { SleeperLeague, SleeperLeagueUser, SleeperRoster } from '../../types';
import { ErrorCode } from '@flaim/worker-shared';
import { sleeperFetch, handleSleeperError } from '../sleeper-api';
import { toExecuteErrorResponse } from './utils';

export function createGetLeagueInfoHandler(): HandlerFn {
  return async (_env, params) => {
    const { league_id } = params;
    if (!league_id) {
      return { success: false, error: 'league_id is required for get_league_info', code: ErrorCode.MISSING_PARAM };
    }

    try {
      const [leagueRes, rostersRes, usersRes] = await Promise.all([
        sleeperFetch(`/league/${league_id}`),
        sleeperFetch(`/league/${league_id}/rosters`),
        sleeperFetch(`/league/${league_id}/users`),
      ]);

      if (!leagueRes.ok) handleSleeperError(leagueRes);
      if (!rostersRes.ok) handleSleeperError(rostersRes);
      if (!usersRes.ok) handleSleeperError(usersRes);

      const league: SleeperLeague = await leagueRes.json();
      const rosters: SleeperRoster[] = await rostersRes.json();
      const users: SleeperLeagueUser[] = await usersRes.json();

      const userMap = new Map<string, string>();
      for (const user of users) {
        userMap.set(user.user_id, user.display_name);
      }

      const teams = rosters.map((roster) => ({
        rosterId: roster.roster_id,
        ownerId: roster.owner_id,
        ownerName: userMap.get(roster.owner_id) || undefined,
      }));

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
          teams,
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
