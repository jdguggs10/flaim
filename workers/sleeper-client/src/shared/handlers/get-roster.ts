import type { HandlerFn } from './types';
import type { SleeperLeagueUser, SleeperMatchup, SleeperRoster, ToolParams } from '../../types';
import {
  ErrorCode,
  malformedRosterSnapshotError,
  resolveRosterSnapshotFromParams,
  rosterSnapshotUnsupportedError,
  toSnapshotMetadata,
  type RosterSnapshot,
  type SeasonSport,
} from '@flaim/worker-shared';
import { sleeperFetch, handleSleeperError } from '../sleeper-api';
import { toExecuteErrorResponse } from './utils';

// team_id matches either the roster ID or the owner's user ID.
function findRoster(rosters: SleeperRoster[], teamId: string): SleeperRoster | undefined {
  return rosters.find((r) => String(r.roster_id) === teamId || r.owner_id === teamId);
}

/**
 * Historical weekly roster from the matchups endpoint. Sleeper freezes
 * players/starters/points per week for NFL and NBA (leg). The rosters/users
 * fetches resolve identity only — nothing from current league state (record,
 * reserve/taxi assignments, membership) is copied into the response.
 */
async function getHistoricalRoster(
  params: ToolParams,
  snapshot: Extract<RosterSnapshot, { type: 'week' }>
) {
  const { league_id, team_id } = params;

  if (!team_id) {
    return {
      success: false as const,
      error: 'team_id is required for a historical Sleeper roster. Pass the roster ID or owner ID from get_league_info.',
      code: ErrorCode.MISSING_PARAM,
    };
  }

  const [matchupsRes, rostersRes, usersRes] = await Promise.all([
    sleeperFetch(`/league/${league_id}/matchups/${snapshot.week}`),
    sleeperFetch(`/league/${league_id}/rosters`),
    sleeperFetch(`/league/${league_id}/users`),
  ]);

  if (!matchupsRes.ok) handleSleeperError(matchupsRes);
  if (!rostersRes.ok) handleSleeperError(rostersRes);
  if (!usersRes.ok) handleSleeperError(usersRes);

  const matchups: SleeperMatchup[] = await matchupsRes.json();
  const rosters: SleeperRoster[] = await rostersRes.json();
  const users: SleeperLeagueUser[] = await usersRes.json();

  if (!Array.isArray(matchups) || matchups.length === 0) {
    return {
      success: false as const,
      error: `No roster data for week ${snapshot.week} in league ${league_id}. The week may be outside the league's season; pass a played week, or omit selectors for the current roster.`,
      code: ErrorCode.SLEEPER_NOT_FOUND,
    };
  }

  const identity = findRoster(rosters, team_id);
  if (!identity) {
    return {
      success: false as const,
      error: `Roster not found for team_id: ${team_id}`,
      code: ErrorCode.SLEEPER_NOT_FOUND,
    };
  }

  const matchup = matchups.find((m) => m.roster_id === identity.roster_id);
  if (!matchup) {
    return {
      success: false as const,
      error: `No week ${snapshot.week} roster data for team_id: ${team_id}`,
      code: ErrorCode.SLEEPER_NOT_FOUND,
    };
  }

  const owner = users.find((u) => u.user_id === identity.owner_id);
  const starters = matchup.starters ?? [];
  const players = matchup.players ?? [];
  const bench = players.filter((p) => !starters.includes(p));

  return {
    success: true as const,
    data: {
      leagueId: league_id,
      rosterId: identity.roster_id,
      ownerId: identity.owner_id,
      ownerName: owner?.display_name ?? 'Unknown',
      snapshot: toSnapshotMetadata(snapshot),
      starters,
      bench,
      points: matchup.points,
      playersPoints: matchup.players_points ?? undefined,
      limitations: { reserveAndTaxiClassificationAvailable: false },
    },
  };
}

export function createGetRosterHandler(): HandlerFn {
  return async (_env, params) => {
    const { league_id, team_id, sport } = params;
    if (!league_id) {
      return { success: false, error: 'league_id is required for get_roster', code: ErrorCode.MISSING_PARAM };
    }

    const snapshot = params.rosterSnapshot ?? resolveRosterSnapshotFromParams(params);
    if (!snapshot) {
      return malformedRosterSnapshotError();
    }
    if (snapshot.type === 'date') {
      return rosterSnapshotUnsupportedError('sleeper', sport as SeasonSport);
    }

    try {
      if (snapshot.type === 'week') {
        return await getHistoricalRoster(params, snapshot);
      }

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
        roster = findRoster(rosters, team_id);
      } else {
        const userMap = new Map<string, string>();
        for (const user of users) {
          userMap.set(user.user_id, user.display_name);
        }

        return {
          success: true,
          data: {
            leagueId: league_id,
            snapshot: toSnapshotMetadata(snapshot),
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
      const taxi = roster.taxi ?? [];
      const bench = allPlayers.filter(
        (p) => !starters.includes(p) && !reserve.includes(p) && !taxi.includes(p)
      );
      const settings = roster.settings;

      return {
        success: true,
        data: {
          leagueId: league_id,
          rosterId: roster.roster_id,
          ownerId: roster.owner_id,
          ownerName: owner?.display_name ?? 'Unknown',
          snapshot: toSnapshotMetadata(snapshot),
          starters,
          bench,
          reserve,
          taxi,
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
