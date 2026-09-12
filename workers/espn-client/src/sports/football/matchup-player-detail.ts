import type { EspnLeagueResponse, EspnMatchup } from '../../types';
import { getLineupSlotName, STARTER_LINEUP_SLOT_IDS } from './mappings';

export interface MatchupDetailPlayer {
  playerId: string;
  name: string | null;
  lineupSlot: string;
  started: boolean | null;
  points: number | null;
}

export interface MatchupDetailSide {
  teamId: number;
  teamName?: string;
  totalPoints: number;
  totalProjectedPoints?: number;
  pointsByScoringPeriod?: Record<string, number>;
  players: MatchupDetailPlayer[];
}

export interface MatchupDetailMatchup {
  matchupPeriodId: number;
  home: MatchupDetailSide | null;
  away: MatchupDetailSide | null;
  winner?: string;
  playoffTierType?: string;
}

const INACTIVE_SLOT_IDS = new Set([20, 21]);

function unavailable(message: string): never {
  throw new Error(`MATCHUP_PLAYER_DETAIL_UNAVAILABLE: ${message}`);
}

function malformed(message: string): never {
  throw new Error(`MATCHUP_DETAIL_MALFORMED: ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Resolve a football scoring week to ESPN's owning matchup period. This is
 * normally identical during the regular season, but multi-week playoff rounds
 * retain one matchupPeriodId across multiple scoring weeks.
 */
export function resolveEspnFootballMatchupPeriod(
  data: EspnLeagueResponse,
  scoringWeek: number,
): number {
  if (!isPositiveInteger(scoringWeek)) {
    malformed('scoringWeek must be a positive integer');
  }

  const settings = data.settings;
  const rawMatchupPeriods = settings?.scheduleSettings?.matchupPeriods;
  if (rawMatchupPeriods !== undefined && rawMatchupPeriods !== null) {
    if (!isRecord(rawMatchupPeriods)) {
      unavailable('ESPN returned malformed matchup-period settings');
    }

    const owners: number[] = [];
    for (const [rawMatchupPeriod, rawScoringWeeks] of Object.entries(rawMatchupPeriods)) {
      const matchupPeriod = Number(rawMatchupPeriod);
      if (!isPositiveInteger(matchupPeriod) || !Array.isArray(rawScoringWeeks)) {
        unavailable('ESPN returned malformed matchup-period settings');
      }
      if (!rawScoringWeeks.every(isPositiveInteger)) {
        unavailable('ESPN returned malformed matchup-period settings');
      }
      if (rawScoringWeeks.includes(scoringWeek)) owners.push(matchupPeriod);
    }

    if (owners.length === 1) return owners[0]!;
    if (owners.length > 1) {
      unavailable('ESPN assigned the requested scoring week to multiple matchup periods');
    }
  }

  const regularSeasonMatchupPeriods = settings?.regularSeasonMatchupPeriods;
  if (isPositiveInteger(regularSeasonMatchupPeriods)) {
    if (scoringWeek <= regularSeasonMatchupPeriods) return scoringWeek;

    const playoffLength = settings?.scheduleSettings?.playoffMatchupPeriodLength;
    if (isPositiveInteger(playoffLength)) {
      return regularSeasonMatchupPeriods
        + 1
        + Math.floor((scoringWeek - regularSeasonMatchupPeriods - 1) / playoffLength);
    }
  }

  unavailable('ESPN did not identify the matchup period for the requested scoring week');
}

function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    malformed(`${field} must be a finite number`);
  }
  return value;
}

function optionalFiniteNumber(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  return requireFiniteNumber(value, field);
}

function normalizePointsByScoringPeriod(value: unknown): Record<string, number> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    malformed('pointsByScoringPeriod must be an object when present');
  }

  return Object.fromEntries(
    Object.entries(value).map(([period, points]) => [
      period,
      requireFiniteNumber(points, `pointsByScoringPeriod.${period}`),
    ]),
  );
}

function normalizeOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') malformed(`${field} must be a string when present`);
  return value;
}

function classifyStarted(lineupSlotId: number): boolean | null {
  if (STARTER_LINEUP_SLOT_IDS.has(lineupSlotId)) return true;
  if (INACTIVE_SLOT_IDS.has(lineupSlotId)) return false;
  return null;
}

function normalizePlayers(value: unknown): MatchupDetailPlayer[] {
  if (!isRecord(value)) {
    unavailable('ESPN did not return rosterForCurrentScoringPeriod for a matchup side');
  }

  const entries = value.entries;
  if (!Array.isArray(entries)) {
    unavailable('ESPN did not return rosterForCurrentScoringPeriod.entries for a matchup side');
  }

  return entries.map((entry, index) => {
    if (!isRecord(entry)) malformed(`roster entry ${index} must be an object`);

    const playerId = requireFiniteNumber(entry.playerId, `roster entry ${index}.playerId`);
    const lineupSlotId = requireFiniteNumber(entry.lineupSlotId, `roster entry ${index}.lineupSlotId`);
    if (!Number.isInteger(playerId) || !Number.isInteger(lineupSlotId)) {
      malformed(`roster entry ${index} has a non-integer player or lineup slot id`);
    }

    if (!isRecord(entry.playerPoolEntry)) {
      malformed(`roster entry ${index}.playerPoolEntry must be an object`);
    }
    if (!isRecord(entry.playerPoolEntry.player)) {
      malformed(`roster entry ${index}.playerPoolEntry.player must be an object`);
    }

    const providerPlayerId = requireFiniteNumber(
      entry.playerPoolEntry.player.id,
      `roster entry ${index}.playerPoolEntry.player.id`,
    );
    if (!Number.isInteger(providerPlayerId) || providerPlayerId !== playerId) {
      malformed(`roster entry ${index} has contradictory player ids`);
    }

    const fullName = entry.playerPoolEntry.player.fullName;
    if (fullName !== undefined && fullName !== null && typeof fullName !== 'string') {
      malformed(`roster entry ${index}.playerPoolEntry.player.fullName must be a string or null`);
    }

    const appliedStatTotal = entry.playerPoolEntry.appliedStatTotal;
    const points = appliedStatTotal === undefined || appliedStatTotal === null
      ? null
      : requireFiniteNumber(appliedStatTotal, `roster entry ${index}.playerPoolEntry.appliedStatTotal`);

    return {
      playerId: String(playerId),
      name: fullName ?? null,
      lineupSlot: getLineupSlotName(lineupSlotId),
      started: classifyStarted(lineupSlotId),
      points,
    };
  });
}

function normalizeSide(
  value: unknown,
  teamNames: Record<string, string>,
): MatchupDetailSide | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) malformed('matchup side must be an object or null');

  const teamId = requireFiniteNumber(value.teamId, 'matchup side teamId');
  if (!Number.isInteger(teamId)) malformed('matchup side teamId must be an integer');

  const totalPoints = requireFiniteNumber(value.totalPoints, 'matchup side totalPoints');
  const liveProjected = optionalFiniteNumber(value.totalProjectedPointsLive, 'matchup side totalProjectedPointsLive');
  const projected = liveProjected ?? optionalFiniteNumber(value.totalProjectedPoints, 'matchup side totalProjectedPoints');
  const teamName = normalizeOptionalString(value.teamName, 'matchup side teamName') ?? teamNames[String(teamId)];
  const pointsByScoringPeriod = normalizePointsByScoringPeriod(value.pointsByScoringPeriod);

  return {
    teamId,
    ...(teamName ? { teamName } : {}),
    totalPoints,
    ...(projected !== undefined ? { totalProjectedPoints: projected } : {}),
    ...(pointsByScoringPeriod ? {
      pointsByScoringPeriod,
    } : {}),
    players: normalizePlayers(value.rosterForCurrentScoringPeriod),
  };
}

function sideHasTeamId(value: unknown, teamId: string): boolean {
  return isRecord(value) && String(value.teamId) === teamId;
}

function normalizeTeamNames(teams: unknown): Record<string, string> {
  if (teams === undefined || teams === null) return {};
  if (!Array.isArray(teams)) malformed('teams must be an array when present');

  return Object.fromEntries(
    teams.flatMap((team) => {
      if (!isRecord(team) || typeof team.id !== 'number') return [];
      const teamName = typeof team.location === 'string' && typeof team.nickname === 'string'
        ? `${team.location} ${team.nickname}`
        : team.name;
      return typeof teamName === 'string' ? [[String(team.id), teamName]] : [];
    }),
  );
}

/**
 * Converts ESPN's mBoxscore response into the bounded player-detail contract.
 * Only rosterForCurrentScoringPeriod is accepted because it is the observed
 * roster shape whose lineup slots correspond to the requested scoring period.
 */
export function normalizeEspnFootballMatchupPlayerDetail(
  data: EspnLeagueResponse,
  matchupPeriod: number,
  requestedTeamId: string,
): MatchupDetailMatchup {
  if (!Array.isArray(data.schedule)) {
    unavailable('ESPN did not return a matchup schedule for player detail');
  }

  const matchup = data.schedule.find((candidate) => {
    if (!isRecord(candidate)) return false;
    const value = candidate as EspnMatchup;
    return value.matchupPeriodId === matchupPeriod
      && (sideHasTeamId(value.home, requestedTeamId) || sideHasTeamId(value.away, requestedTeamId));
  });

  if (!matchup) {
    throw new Error('MATCHUP_TEAM_NOT_FOUND: The requested team is not in that matchup week');
  }

  const matchupPeriodId = requireFiniteNumber(matchup.matchupPeriodId, 'matchupPeriodId');
  if (!Number.isInteger(matchupPeriodId)) malformed('matchupPeriodId must be an integer');

  const winner = normalizeOptionalString(matchup.winner, 'winner');
  const playoffTierType = normalizeOptionalString(matchup.playoffTierType, 'playoffTierType');
  const teamNames = normalizeTeamNames(data.teams);

  return {
    matchupPeriodId,
    home: normalizeSide(matchup.home, teamNames),
    away: normalizeSide(matchup.away, teamNames),
    ...(winner !== undefined ? { winner } : {}),
    ...(playoffTierType !== undefined ? { playoffTierType } : {}),
  };
}
