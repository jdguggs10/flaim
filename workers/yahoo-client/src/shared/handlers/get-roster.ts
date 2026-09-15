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
    // gating is Yahoo's own echoed coverage, and the exact rule differs by
    // snapshot type: on a `week` snapshot, a player's points are usable only
    // when Yahoo echoes `coverage.type === 'week'` AND `coverage.week` is
    // EXACTLY the requested week — any other week (Yahoo drifting to an
    // adjacent week, say) is treated as unusable for that player. On a
    // `current` snapshot there is no requested week to check against, so
    // instead every emitted player's points must share one SINGLE
    // consistent week: the coverage week of the first player with usable
    // (finite points, `type: 'week'`, positive-integer week) data is taken
    // as that response's week, and any other player whose echoed week
    // differs is treated as unusable — otherwise a season-to-date total, or
    // players scored against different weeks, could be mislabeled or mixed
    // together as "this week's score".
    const isHistoricalSnapshot = snapshot.type !== 'current';

    // Football only: this is the one case Yahoo's docs (and yfpy's
    // `get_team_roster_player_stats_by_week`) actually describe. Category/
    // roto Yahoo leagues, and the daily-sport (`date`) capability, don't
    // carry a documented `;players/stats` roster sub-resource, so points
    // stay scoped to football's `week` capability.
    const pointsSupported = capability === 'week';

    const teamKey = team_id.includes('.') ? team_id : `${league_id}.t.${team_id}`;

    // Legacy roster URL (no stats sub-resource) — used directly for
    // non-football/no-points requests, and as the fallback target if the
    // stats-augmented request below is rejected by Yahoo.
    const rosterSelector = snapshot.type === 'week'
      ? `;week=${snapshot.week}`
      : snapshot.type === 'date'
        ? `;date=${snapshot.date}`
        : '';
    const legacyUrl = `/team/${teamKey}/roster${rosterSelector}`;

    try {
      const credentials = await getYahooCredentials(env, authHeader, correlationId);
      requireCredentials(credentials, 'get_roster');

      // Whether this request actually asked Yahoo for stats and got a
      // response shaped like it: false either when points aren't supported
      // for this sport, or when the stats-augmented request failed and this
      // handler fell back to the legacy roster URL below.
      let pointsRequested = pointsSupported;
      let response: Response;

      if (pointsSupported) {
        // Verified selectors (yfpy `get_team_roster_player_stats_by_week`):
        // `/team/{team_key}/roster;week={N}/players/stats` for a week
        // snapshot, `/team/{team_key}/roster;week=current/players/stats` for
        // the current roster. No `;type=` and no second `;week=` — Yahoo
        // 400s on a bare `;type=week` with no `;week=` at all, which is what
        // broke every current-week Yahoo football roster before this fix.
        const statsWeekSelector = snapshot.type === 'week' ? String(snapshot.week) : 'current';
        const statsUrl = `/team/${teamKey}/roster;week=${statsWeekSelector}/players/stats`;
        response = await yahooFetch(statsUrl, { credentials });

        if (!response.ok) {
          // Fail safe rather than fail closed: a rejected stats-augmented
          // request (e.g. Yahoo 400ing an unexpected selector combination)
          // must not break the roster read itself. Log once for
          // diagnosability, then retry with the plain legacy roster URL and
          // continue without points.
          console.log(
            `[get-roster] Yahoo rejected the stats-augmented roster request (status ${response.status}); retrying without player stats`
          );
          pointsRequested = false;
          response = await yahooFetch(legacyUrl, { credentials });
          if (!response.ok) {
            await handleYahooError(response);
          }
        }
      } else {
        response = await yahooFetch(legacyUrl, { credentials });
        if (!response.ok) {
          await handleYahooError(response);
        }
      }

      const raw = await response.json();
      const teamArray = getPath(raw, ['fantasy_content', 'team']);
      const team = unwrapTeam(teamArray as unknown[]);

      const rosterData = team.roster as Record<string, unknown> | undefined;
      const playersObj = getPath(rosterData, ['0', 'players']) as Record<string, unknown> | undefined;
      const playersArray = asArray(playersObj);

      // First pass: parse each player's own metadata/position/weekly-points
      // independently of any other player, so the "which week is this
      // response scoped to" decision below is made once from the parsed
      // set rather than mutated player-by-player ("last player wins").
      const parsedPlayers = playersArray.map((playerWrapper: unknown) => {
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

        const weeklyPoints = pointsRequested ? extractPlayerWeeklyPoints(playerData) : {};

        return { playerMeta, position, isKeeper, weeklyPoints };
      });

      // On a `current` request, every emitted player's points must share one
      // consistent week: take the coverage week of the first player with
      // usable (finite points, coverage.type === 'week', positive-integer
      // week) data as the single resolved week, and treat any other
      // player's differing week as unusable. A `week` snapshot instead
      // requires each player's own coverage.week to exactly equal the
      // requested week — no cross-player resolution needed.
      let resolvedCurrentWeek: number | undefined;
      if (snapshot.type === 'current') {
        for (const { weeklyPoints } of parsedPlayers) {
          const week = weeklyPoints.coverage?.week;
          if (
            weeklyPoints.points !== undefined &&
            weeklyPoints.coverage?.type === 'week' &&
            week !== undefined &&
            Number.isInteger(week) &&
            week > 0
          ) {
            resolvedCurrentWeek = week;
            break;
          }
        }
      }

      let sawWeekScopedPoints = false;
      const pointsCoverageWeek = snapshot.type === 'week' ? snapshot.week : resolvedCurrentWeek;

      const players = parsedPlayers.map(({ playerMeta, position, isKeeper, weeklyPoints }) => {
        const week = weeklyPoints.coverage?.week;
        const hasUsableWeekPoints =
          weeklyPoints.points !== undefined &&
          weeklyPoints.coverage?.type === 'week' &&
          week !== undefined &&
          pointsCoverageWeek !== undefined &&
          week === pointsCoverageWeek;
        if (hasUsableWeekPoints) {
          sawWeekScopedPoints = true;
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
