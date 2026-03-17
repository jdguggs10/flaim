import type { HandlerFn, SleeperSportConfig } from './types';
import type { SleeperLeagueUser, SleeperMatchup, SleeperRoster } from '../../types';
import { sleeperFetch, handleSleeperError } from '../sleeper-api';
import { toExecuteErrorResponse } from './utils';

export function createGetMatchupsHandler(config: SleeperSportConfig): HandlerFn {
  return async (_env, params) => {
    const { league_id, week } = params;

    try {
      let matchupWeek = week;
      if (!matchupWeek) {
        const stateRes = await sleeperFetch(config.statePath);
        if (stateRes.ok) {
          const state = await stateRes.json() as { week: number };
          matchupWeek = state.week ?? 1;
        } else {
          matchupWeek = 1;
        }
      }

      const [matchupsRes, rostersRes, usersRes] = await Promise.all([
        sleeperFetch(`/league/${league_id}/matchups/${matchupWeek}`),
        sleeperFetch(`/league/${league_id}/rosters`),
        sleeperFetch(`/league/${league_id}/users`),
      ]);

      if (!matchupsRes.ok) handleSleeperError(matchupsRes);
      if (!rostersRes.ok) handleSleeperError(rostersRes);
      if (!usersRes.ok) handleSleeperError(usersRes);

      const matchups: SleeperMatchup[] = await matchupsRes.json();
      const rosters: SleeperRoster[] = await rostersRes.json();
      const users: SleeperLeagueUser[] = await usersRes.json();

      const rosterOwnerMap = new Map<number, string>();
      const userMap = new Map<string, string>();
      for (const user of users) {
        userMap.set(user.user_id, user.display_name);
      }
      for (const roster of rosters) {
        rosterOwnerMap.set(roster.roster_id, userMap.get(roster.owner_id) ?? 'Unknown');
      }

      const matchupGroups = new Map<number, SleeperMatchup[]>();
      for (const m of matchups) {
        if (!matchupGroups.has(m.matchup_id)) {
          matchupGroups.set(m.matchup_id, []);
        }
        matchupGroups.get(m.matchup_id)!.push(m);
      }

      const pairedMatchups = Array.from(matchupGroups.entries()).map(([matchupId, pair]) => {
        const formatTeam = (m: SleeperMatchup) => ({
          rosterId: m.roster_id,
          ownerName: rosterOwnerMap.get(m.roster_id) ?? 'Unknown',
          points: m.points ?? 0,
          starters: m.starters ?? [],
        });

        const home = pair[0] ? formatTeam(pair[0]) : null;
        const away = pair[1] ? formatTeam(pair[1]) : null;

        let winner: string | undefined;
        if (home && away && (home.points > 0 || away.points > 0)) {
          if (home.points > away.points) winner = 'home';
          else if (away.points > home.points) winner = 'away';
          else winner = 'tie';
        }

        return { matchupId, home, away, winner };
      });

      return {
        success: true,
        data: {
          leagueId: league_id,
          week: matchupWeek,
          matchups: pairedMatchups,
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
