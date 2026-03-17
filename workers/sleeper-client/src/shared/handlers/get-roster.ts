import type { HandlerFn } from './types';
import type { SleeperLeagueUser, SleeperRoster } from '../../types';
import { ErrorCode } from '@flaim/worker-shared';
import { sleeperFetch, handleSleeperError } from '../sleeper-api';
import { toExecuteErrorResponse } from './utils';

export function createGetRosterHandler(): HandlerFn {
  return async (_env, params) => {
    const { league_id, team_id } = params;
    if (!league_id) {
      return { success: false, error: 'league_id is required for get_roster', code: ErrorCode.MISSING_PARAM };
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

      let roster: SleeperRoster | undefined;
      if (team_id) {
        roster = rosters.find((r) => String(r.roster_id) === team_id || r.owner_id === team_id);
      } else {
        const userMap = new Map<string, string>();
        for (const user of users) {
          userMap.set(user.user_id, user.display_name);
        }

        return {
          success: true,
          data: {
            leagueId: league_id,
            rosters: rosters.map((r) => ({
              rosterId: r.roster_id,
              ownerId: r.owner_id,
              ownerName: userMap.get(r.owner_id) ?? 'Unknown',
              playerCount: r.players?.length ?? 0,
              starterCount: r.starters?.length ?? 0,
            })),
          },
        };
      }

      if (!roster) {
        return {
          success: false,
          error: `Roster not found for team_id: ${team_id}`,
          code: ErrorCode.SLEEPER_NOT_FOUND,
        };
      }

      const owner = users.find((u) => u.user_id === roster.owner_id);
      const starters = roster.starters ?? [];
      const allPlayers = roster.players ?? [];
      const reserve = roster.reserve ?? [];
      const bench = allPlayers.filter((p) => !starters.includes(p) && !reserve.includes(p));
      const settings = roster.settings;

      return {
        success: true,
        data: {
          leagueId: league_id,
          rosterId: roster.roster_id,
          ownerId: roster.owner_id,
          ownerName: owner?.display_name ?? 'Unknown',
          starters,
          bench,
          reserve,
          record: {
            wins: settings?.wins ?? 0,
            losses: settings?.losses ?? 0,
            ties: settings?.ties ?? 0,
          },
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
