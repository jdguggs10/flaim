import type { HandlerFn, SleeperSportConfig } from './types';
import type { SleeperLeagueUser, SleeperMatchup, SleeperRoster } from '../../types';
import { ErrorCode } from '@flaim/worker-shared';
import { sleeperFetch, handleSleeperError } from '../sleeper-api';
import { toExecuteErrorResponse } from './utils';
import { attachSleeperPlayerPoints, buildUserDirectory, loadSleeperPlayersIndexForEnrichment, resolveSleeperPlayerEntries } from '../sleeper-enrichment';

export function createGetMatchupsHandler(config: SleeperSportConfig): HandlerFn {
  return async (env, params) => {
    const { league_id, week } = params;
    if (!league_id) {
      return { success: false, error: 'league_id is required for get_matchups', code: ErrorCode.MISSING_PARAM };
    }

    try {
      // Temporal purity (same rule as historical get_roster): the player index
      // only knows each player's CURRENT club, so a starter's `team` is only
      // trustworthy for the current week. When the caller names a week
      // explicitly we cannot cheaply prove it is the current one, so `team` is
      // omitted and the limitation is flagged; omitting `week` resolves to the
      // live week and keeps `team`.
      const explicitWeek = typeof week === 'number';
      let matchupWeek = week;
      if (!matchupWeek) {
        const stateRes = await sleeperFetch(config.statePath);
        if (stateRes.ok) {
          const state = await stateRes.json() as { week?: number };
          const stateWeek = state.week;
          matchupWeek = typeof stateWeek === 'number' && Number.isFinite(stateWeek) && stateWeek > 0 ? stateWeek : 1;
        } else {
          matchupWeek = 1;
        }
      }

      // Kick off the player-index load in parallel with the matchup/roster/user
      // fetches — get_matchups always enriches starters for both sides.
      const playersIndexPromise = loadSleeperPlayersIndexForEnrichment(env, config.sport, 'get-matchups');

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

      const userDirectory = buildUserDirectory(users);
      const rosterOwnerMap = new Map<number, { ownerName: string; teamName?: string }>();
      for (const roster of rosters) {
        const entry = userDirectory.get(roster.owner_id);
        rosterOwnerMap.set(roster.roster_id, {
          ownerName: entry?.displayName ?? 'Unknown',
          teamName: entry?.teamName,
        });
      }

      const { index: playersIndex, warnings } = await playersIndexPromise;

      const formatTeam = (m: SleeperMatchup) => {
        const owner = rosterOwnerMap.get(m.roster_id);
        return {
          rosterId: m.roster_id,
          ownerName: owner?.ownerName ?? 'Unknown',
          teamName: owner?.teamName,
          points: m.points ?? 0,
          starters: attachSleeperPlayerPoints(
            resolveSleeperPlayerEntries(m.starters ?? [], playersIndex, { includeTeam: !explicitWeek }),
            m.players_points,
          ),
        };
      };

      const matchupGroups = new Map<number, SleeperMatchup[]>();
      const unpublishedEntries: SleeperMatchup[] = [];
      for (const m of matchups) {
        if (typeof m.matchup_id !== 'number' || !Number.isFinite(m.matchup_id)) {
          unpublishedEntries.push(m);
          continue;
        }
        if (!matchupGroups.has(m.matchup_id)) {
          matchupGroups.set(m.matchup_id, []);
        }
        matchupGroups.get(m.matchup_id)!.push(m);
      }

      const pairedMatchups: Array<{
        matchupId: number | null;
        home: ReturnType<typeof formatTeam>;
        away: ReturnType<typeof formatTeam> | null;
        winner?: 'home' | 'away' | 'tie';
      }> = [];
      let unpairedRosterCount = 0;

      for (const [matchupId, group] of matchupGroups) {
        if (group.length !== 2) {
          // A numeric id alone does not establish an H2H pair. Preserve each
          // record as a singleton rather than dropping rows or calling it a bye.
          for (const matchup of group) {
            pairedMatchups.push({ matchupId, home: formatTeam(matchup), away: null });
            unpairedRosterCount += 1;
          }
          continue;
        }

        const home = formatTeam(group[0]!);
        const away = formatTeam(group[1]!);

        let winner: 'home' | 'away' | 'tie' | undefined;
        if (home.points > 0 || away.points > 0) {
          if (home.points > away.points) winner = 'home';
          else if (away.points > home.points) winner = 'away';
          else winner = 'tie';
        }

        pairedMatchups.push({ matchupId, home, away, ...(winner ? { winner } : {}) });
      }

      for (const matchup of unpublishedEntries) {
        pairedMatchups.push({ matchupId: null, home: formatTeam(matchup), away: null });
        unpairedRosterCount += 1;
      }

      const pairedMatchupCount = pairedMatchups.length - unpairedRosterCount;
      const hasUsableNumericGroups = matchupGroups.size > 0;
      const scheduleShape = pairedMatchupCount === 0
        ? hasUsableNumericGroups
          ? {
            // Numeric groups were published, but none formed an H2H pair.
            // Their meaning is still unknown: do not call them byes.
            status: 'no_h2h_pairings' as const,
            h2hPairingsReturned: false,
            unpairedRosterCount,
            reason: 'unknown' as const,
          }
          : {
            status: 'unpublished_or_unavailable' as const,
            h2hPairingsReturned: false,
            unpairedRosterCount,
            reason: 'unknown' as const,
          }
        : unpairedRosterCount > 0
          ? {
            status: 'partially_paired' as const,
            h2hPairingsReturned: true,
            unpairedRosterCount,
            reason: 'unknown' as const,
          }
          : {
            status: 'paired' as const,
            h2hPairingsReturned: true,
            unpairedRosterCount: 0,
          };

      return {
        success: true,
        data: {
          leagueId: league_id,
          week: matchupWeek,
          matchups: pairedMatchups,
          scheduleShape,
          ...(explicitWeek ? { limitations: { playerProTeamAvailable: false } } : {}),
          ...(warnings.length ? { warnings } : {}),
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
