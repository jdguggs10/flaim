import type { HandlerFn, YahooHandlerContext } from './types';
import { getYahooCredentials } from '../auth';
import { yahooFetch, handleYahooError, requireCredentials } from '../yahoo-api';
import { asArray, getPath, unwrapTeam } from '../normalizers';
import {
  ErrorCode,
  getRosterSelectorCapability,
  malformedRosterSnapshotError,
  resolveRosterSnapshotFromParams,
  rosterSnapshotUnsupportedError,
  toSnapshotMetadata,
  type SeasonSport,
} from '@flaim/worker-shared';
import {
  extractManagerName,
  extractPlayerMeta,
  extractPlayerWeeklyPoints,
  findPlayerSubResource,
  normalizeIsKeeper,
  toExecuteErrorResponse,
} from './utils';

export function createGetRosterHandler(config: YahooHandlerContext): HandlerFn {
  return async (env, params, authHeader, correlationId) => {
    const { team_id, league_id } = params;
    const sport = config.sport as SeasonSport;

    const snapshot = params.rosterSnapshot ?? resolveRosterSnapshotFromParams(params);
    if (!snapshot) {
      return malformedRosterSnapshotError();
    }
    const capability = getRosterSelectorCapability('yahoo', sport);
    if (
      (snapshot.type === 'week' && capability !== 'week') ||
      (snapshot.type === 'date' && capability !== 'date')
    ) {
      return rosterSnapshotUnsupportedError('yahoo', sport);
    }

    if (!team_id) {
      return {
        success: false,
        error: 'team_id is required for get_roster',
        code: ErrorCode.MISSING_PARAM,
      };
    }

    // Yahoo's roster player object exposes editorial_team_abbr/status as the
    // player's CURRENT club and CURRENT status — there is no historical
    // pro-team/status data in this payload for a past week/date snapshot.
    // Omit both fields entirely on historical snapshots rather than relabel
    // present-day state as true-as-of-then (FLA-278: temporal purity),
    // mirroring the same rule already applied to ESPN and Sleeper rosters.
    //
    // Weekly player points are the opposite case: a `player_points` total is
    // inherently a fact about the requested week, not the player's present-day
    // state, so it is temporally pure on a historical snapshot the same way
    // isKeeper is (see normalizeIsKeeper below) — unlike editorial_team_abbr/
    // status, points don't need isHistoricalSnapshot gating. What still needs
    // gating is `current`: Yahoo's stats sub-resource can echo back a
    // season-to-date total instead of a single week depending on what was
    // requested, so a `current` roster's per-player points are only emitted
    // when Yahoo's own echoed coverage confirms `type: 'week'` with a finite
    // week — otherwise a season total could be mislabeled as this week's score.
    const isHistoricalSnapshot = snapshot.type !== 'current';

    // Football only: `;players/stats;type=week` is an unverified selector for
    // the other sports' date-scoped rosters, and category/roto Yahoo leagues
    // don't carry player_points at all even when the sport supports it, so
    // scoping this to football keeps the request shape to the one case Yahoo's
    // docs actually describe.
    const pointsSupported = capability === 'week';

    const teamKey = team_id.includes('.') ? team_id : `${league_id}.t.${team_id}`;

    try {
      const credentials = await getYahooCredentials(env, authHeader, correlationId);
      requireCredentials(credentials, 'get_roster');

      const rosterSelector = snapshot.type === 'week'
        ? `;week=${snapshot.week}`
        : snapshot.type === 'date'
          ? `;date=${snapshot.date}`
          : '';
      const statsSelector = pointsSupported
        ? `/players/stats;type=week${snapshot.type === 'week' ? `;week=${snapshot.week}` : ''}`
        : '';
      const response = await yahooFetch(`/team/${teamKey}/roster${rosterSelector}${statsSelector}`, { credentials });
      if (!response.ok) {
        await handleYahooError(response);
      }

      const raw = await response.json();
      const teamArray = getPath(raw, ['fantasy_content', 'team']);
      const team = unwrapTeam(teamArray as unknown[]);

      const rosterData = team.roster as Record<string, unknown> | undefined;
      const playersObj = getPath(rosterData, ['0', 'players']) as Record<string, unknown> | undefined;
      const playersArray = asArray(playersObj);

      let sawWeekScopedPoints = false;
      let pointsCoverageWeek: number | undefined;

      const players = playersArray.map((playerWrapper: unknown) => {
        const playerData = getPath(playerWrapper, ['player']) as unknown[];
        const playerMeta = extractPlayerMeta(playerData);

        // A superset of the old fixed-index-1 read: `selected_position` is
        // scanned the same way `player_points` is below, since either
        // sub-resource can now appear at a different index once stats are
        // requested alongside it.
        const positionData = findPlayerSubResource(playerData, 'selected_position');
        const selectedPosition = positionData?.selected_position as Record<string, unknown>[] | undefined;
        const position = selectedPosition?.[1]?.position;

        // Keeper designation (Yahoo's undocumented is_keeper field) is a
        // season-long constant set pre-draft, not a point-in-time club/status
        // fact — unlike `team`/`status` above, which are gated on
        // isHistoricalSnapshot because they describe the player's CURRENT
        // club/status and would misrepresent a past week (FLA-278 temporal
        // purity). A player's keeper eligibility for the season doesn't
        // change week to week, so isKeeper is intentionally NOT gated here.
        const isKeeper = normalizeIsKeeper(playerMeta.is_keeper);

        const weeklyPoints = pointsSupported ? extractPlayerWeeklyPoints(playerData) : {};
        const hasUsableWeekPoints =
          weeklyPoints.points !== undefined &&
          weeklyPoints.coverage?.type === 'week' &&
          weeklyPoints.coverage.week !== undefined;
        if (hasUsableWeekPoints) {
          sawWeekScopedPoints = true;
          pointsCoverageWeek = weeklyPoints.coverage!.week;
        }

        return {
          playerKey: playerMeta.player_key,
          playerId: playerMeta.player_id,
          name: (playerMeta.name as Record<string, unknown>)?.full,
          ...(isHistoricalSnapshot ? {} : { team: playerMeta.editorial_team_abbr }),
          position: playerMeta.display_position,
          selectedPosition: position,
          ...(isHistoricalSnapshot ? {} : { status: playerMeta.status }),
          ...(isKeeper ? { isKeeper } : {}),
          ...(hasUsableWeekPoints ? { points: weeklyPoints.points } : {}),
        };
      });

      const limitations: Record<string, boolean> = {};
      if (isHistoricalSnapshot) limitations.playerProTeamAvailable = false;
      if (pointsSupported && !sawWeekScopedPoints) limitations.playerPointsAvailable = false;

      return {
        success: true,
        data: {
          teamKey: team.team_key,
          teamName: team.name,
          ownerName: extractManagerName(team),
          snapshot: toSnapshotMetadata(snapshot),
          ...(Object.keys(limitations).length > 0 ? { limitations } : {}),
          ...(sawWeekScopedPoints ? { pointsCoverage: { type: 'week', week: pointsCoverageWeek } } : {}),
          players,
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
