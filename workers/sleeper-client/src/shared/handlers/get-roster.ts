import type { HandlerFn } from './types';
import type { Env, SleeperLeague, SleeperLeagueUser, SleeperMatchup, SleeperRoster, ToolParams } from '../../types';
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
import { buildUserDirectory, loadSleeperPlayersIndexForEnrichment, resolveSleeperPlayerEntries } from '../sleeper-enrichment';

// team_id matches either the roster ID or the owner's user ID.
function findRoster(rosters: SleeperRoster[], teamId: string): SleeperRoster | undefined {
  return rosters.find((r) => String(r.roster_id) === teamId || r.owner_id === teamId);
}

export const LEAGUE_STATUS_UNAVAILABLE_WARNING =
  'LEAGUE_STATUS_UNAVAILABLE: Sleeper league status unavailable; snapshot.leagueStatus omitted.';

interface LeagueStatusResult {
  status?: string;
  warning?: string;
}

/**
 * Fetches the league's status ("pre_draft" | "drafting" | "in_season" |
 * "complete") for snapshot.leagueStatus, so a caller hitting an empty
 * mid-draft roster (drafting: no starters/bench/record yet) can see why.
 * Kicked off alongside — but never awaited inside — the required rosters/users
 * Promise.all for both the roster-summary and single-team branches, so a
 * black-holed /league/{id} call can never delay a prompt rosters/users error
 * (e.g. a 404) by its own fetch timeout. Never throws: a failed fetch, a
 * non-OK status, or a 200 body without a usable status string all degrade to
 * an omitted leagueStatus plus a warning, mirroring get-league-info.ts's
 * TRADED_PICKS_UNAVAILABLE degradation. Not used by the historical week
 * branch: a past week always has a played, non-drafting league.
 */
async function loadLeagueStatus(league_id: string): Promise<LeagueStatusResult> {
  try {
    const res = await sleeperFetch(`/league/${league_id}`);
    if (!res.ok) {
      console.error(`[get-roster] league fetch failed for league ${league_id} (status ${res.status})`);
      return { warning: LEAGUE_STATUS_UNAVAILABLE_WARNING };
    }
    const league: SleeperLeague = await res.json();
    if (typeof league?.status === 'string' && league.status.length > 0) {
      return { status: league.status };
    }
    console.error(`[get-roster] league response for league ${league_id} had no usable status`);
    return { warning: LEAGUE_STATUS_UNAVAILABLE_WARNING };
  } catch (error) {
    console.error(`[get-roster] league fetch threw for league ${league_id}:`, error);
    return { warning: LEAGUE_STATUS_UNAVAILABLE_WARNING };
  }
}

/**
 * Historical weekly roster from the matchups endpoint. Sleeper freezes
 * players/starters/points per week for NFL and NBA (leg). The rosters/users
 * fetches resolve identity only — nothing from current league state (record,
 * reserve/taxi assignments, membership) is copied into the response.
 */
async function getHistoricalRoster(
  env: Env,
  params: ToolParams,
  snapshot: Extract<RosterSnapshot, { type: 'week' }>
) {
  const { league_id, team_id, sport } = params;

  if (!team_id) {
    return {
      success: false as const,
      error: 'team_id is required for a historical Sleeper roster. Pass the roster ID or owner ID from get_league_info.',
      code: ErrorCode.MISSING_PARAM,
    };
  }

  // Kick off the player-index load in parallel with the roster/matchup
  // fetches (team_id is already validated above, so this path always needs it).
  // Best-effort by design: on the not-found early returns below the promise is
  // simply discarded (the loader never rejects, and the isolate drops any
  // in-flight KV read once the response is sent), so a bad week/team_id costs
  // at most one wasted lookup — accepted in exchange for the happy-path overlap.
  const playersIndexPromise = loadSleeperPlayersIndexForEnrichment(env, sport, 'get-roster:historical');

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

  const ownerEntry = buildUserDirectory(users).get(identity.owner_id);
  const starters = matchup.starters ?? [];
  const players = matchup.players ?? [];
  const bench = players.filter((p) => !starters.includes(p));

  const { index: playersIndex, warnings } = await playersIndexPromise;

  return {
    success: true as const,
    data: {
      leagueId: league_id,
      rosterId: identity.roster_id,
      ownerId: identity.owner_id,
      ownerName: ownerEntry?.displayName ?? 'Unknown',
      teamName: ownerEntry?.teamName,
      snapshot: toSnapshotMetadata(snapshot),
      // includeTeam: false — the player index only tracks each player's CURRENT
      // club, so a past-week roster must not show a club they joined later.
      starters: resolveSleeperPlayerEntries(starters, playersIndex, { includeTeam: false }),
      bench: resolveSleeperPlayerEntries(bench, playersIndex, { includeTeam: false }),
      points: matchup.points,
      playersPoints: matchup.players_points ?? undefined,
      limitations: { reserveAndTaxiClassificationAvailable: false, playerProTeamAvailable: false },
      ...(warnings.length ? { warnings } : {}),
    },
  };
}

export function createGetRosterHandler(): HandlerFn {
  return async (env, params) => {
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
        return await getHistoricalRoster(env, params, snapshot);
      }

      // Only kick off the player-index load when a team_id was passed — the
      // no-team_id roster-summary branch below never enriches player IDs.
      // Best-effort by design: if team_id turns out not to match a roster, the
      // promise is discarded (the loader never rejects); one wasted lookup on
      // an invalid team_id is accepted for the happy-path overlap.
      const playersIndexPromise = team_id
        ? loadSleeperPlayersIndexForEnrichment(env, sport, 'get-roster:current')
        : undefined;

      // League status is kicked off for both branches below (roster-summary
      // and single-team) so an empty mid-draft roster can explain itself —
      // see loadLeagueStatus. Deliberately NOT joined into the Promise.all
      // below: it never rejects, but a black-holed /league/{id} call could
      // otherwise delay a required rosters/users error (e.g. a prompt 404)
      // by its own fetch timeout. It's awaited only on the success paths
      // further down; left un-awaited on an error path, which is safe since
      // it never rejects (no unhandled rejection).
      const leagueStatusPromise = loadLeagueStatus(league_id);

      const [rostersRes, usersRes] = await Promise.all([
        sleeperFetch(`/league/${league_id}/rosters`),
        sleeperFetch(`/league/${league_id}/users`),
      ]);

      if (!rostersRes.ok) handleSleeperError(rostersRes);
      if (!usersRes.ok) handleSleeperError(usersRes);

      const rosters: SleeperRoster[] = await rostersRes.json();
      const users: SleeperLeagueUser[] = await usersRes.json();
      const userDirectory = buildUserDirectory(users);

      let roster: SleeperRoster | undefined;
      if (team_id) {
        roster = findRoster(rosters, team_id);
      } else {
        const leagueStatusResult = await leagueStatusPromise;
        return {
          success: true,
          data: {
            leagueId: league_id,
            snapshot: toSnapshotMetadata(snapshot, { leagueStatus: leagueStatusResult.status }),
            rosters: rosters.map((r) => {
              const entry = userDirectory.get(r.owner_id);
              return {
                rosterId: r.roster_id,
                ownerId: r.owner_id,
                ownerName: entry?.displayName ?? 'Unknown',
                teamName: entry?.teamName,
                playerCount: r.players?.length ?? 0,
                starterCount: r.starters?.length ?? 0,
              };
            }),
            ...(leagueStatusResult.warning ? { warnings: [leagueStatusResult.warning] } : {}),
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

      const ownerEntry = userDirectory.get(roster.owner_id);
      const starters = roster.starters ?? [];
      const allPlayers = roster.players ?? [];
      const reserve = roster.reserve ?? [];
      const taxi = roster.taxi ?? [];
      const bench = allPlayers.filter(
        (p) => !starters.includes(p) && !reserve.includes(p) && !taxi.includes(p)
      );
      const settings = roster.settings;

      // playersIndexPromise is always defined here: we only reach this point
      // when team_id was truthy (the no-team_id branch returns above).
      const { index: playersIndex, warnings } = await playersIndexPromise!;
      const leagueStatusResult = await leagueStatusPromise;
      if (leagueStatusResult.warning) warnings.push(leagueStatusResult.warning);

      return {
        success: true,
        data: {
          leagueId: league_id,
          rosterId: roster.roster_id,
          ownerId: roster.owner_id,
          ownerName: ownerEntry?.displayName ?? 'Unknown',
          teamName: ownerEntry?.teamName,
          snapshot: toSnapshotMetadata(snapshot, { leagueStatus: leagueStatusResult.status }),
          starters: resolveSleeperPlayerEntries(starters, playersIndex),
          bench: resolveSleeperPlayerEntries(bench, playersIndex),
          reserve: resolveSleeperPlayerEntries(reserve, playersIndex),
          taxi: resolveSleeperPlayerEntries(taxi, playersIndex),
          // Populated only during Sleeper's pre-draft keeper-selection window
          // (see README); null vs [] is preserved exactly as Sleeper sends it
          // rather than collapsed to one shape.
          keepers:
            roster.keepers === undefined
              ? undefined
              : roster.keepers === null
                ? null
                : resolveSleeperPlayerEntries(roster.keepers, playersIndex),
          record: {
            wins: settings?.wins ?? 0,
            losses: settings?.losses ?? 0,
            ties: settings?.ties ?? 0,
          },
          ...(warnings.length ? { warnings } : {}),
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
