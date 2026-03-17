import type { HandlerFn } from './types';
import type { SleeperLeagueUser, SleeperRoster } from '../../types';
import { ErrorCode } from '@flaim/worker-shared';
import { sleeperFetch, handleSleeperError } from '../sleeper-api';
import { toExecuteErrorResponse } from './utils';

export function createGetStandingsHandler(): HandlerFn {
  return async (_env, params) => {
    const { league_id } = params;
    if (!league_id) {
      return { success: false, error: 'league_id is required for get_standings', code: ErrorCode.MISSING_PARAM };
    }

    try {
      const [rostersRes, usersRes] = await Promise.all([
        sleeperFetch(`/league/${league_id}/rosters`),
        sleeperFetch(`/league/${league_id}/users`),
      ]);

      if (!rostersRes.ok) handleSleeperError(rostersRes);
      if (!usersRes.ok) handleSleeperError(usersRes);

      const rosters: SleeperRoster[] = await rostersRes.json();
      const users: SleeperLeagueUser[] = await usersRes.json();

      const userMap = new Map<string, string>();
      for (const user of users) {
        userMap.set(user.user_id, user.display_name);
      }

      const standings = rosters
        .map((roster) => {
          const settings = roster.settings;
          const wins = settings?.wins ?? 0;
          const losses = settings?.losses ?? 0;
          const ties = settings?.ties ?? 0;
          const fpts = settings?.fpts ?? 0;
          const fpts_decimal = settings?.fpts_decimal ?? 0;
          const fpts_against = settings?.fpts_against ?? 0;
          const fpts_against_decimal = settings?.fpts_against_decimal ?? 0;
          const pointsFor = fpts + (fpts_decimal ?? 0) / 100;
          const pointsAgainst = (fpts_against ?? 0) + (fpts_against_decimal ?? 0) / 100;
          const totalGames = wins + losses + ties;
          const winPct = totalGames > 0 ? wins / totalGames : 0;

          return {
            rosterId: roster.roster_id,
            ownerId: roster.owner_id,
            ownerName: userMap.get(roster.owner_id) ?? 'Unknown',
            wins,
            losses,
            ties,
            winPercentage: Math.round(winPct * 1000) / 1000,
            pointsFor: Math.round(pointsFor * 100) / 100,
            pointsAgainst: Math.round(pointsAgainst * 100) / 100,
          };
        })
        .sort((a, b) => {
          if (b.wins !== a.wins) return b.wins - a.wins;
          return b.pointsFor - a.pointsFor;
        })
        .map((entry, index) => ({ ...entry, rank: index + 1 }));

      return {
        success: true,
        data: {
          leagueId: league_id,
          standings,
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
