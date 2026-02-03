// workers/espn-client/src/types.ts
import type { BaseEnvWithAuth } from '@flaim/worker-shared';

// ---------------------------------------------------------------------------
// ESPN Fantasy API response types
// Only the fields we actually read are included. The API is undocumented;
// these shapes are derived from observed responses.
// ---------------------------------------------------------------------------

/** Top-level league response — shape depends on which `view` params are requested. */
export interface EspnLeagueResponse {
  id?: number;
  seasonId?: number;
  segmentId?: number;
  scoringPeriodId?: number;
  currentMatchupPeriod?: number;
  status?: unknown;
  settings?: EspnLeagueSettings;
  teams?: EspnTeam[];
  schedule?: EspnMatchup[];
}

export interface EspnLeagueSettings {
  name?: string;
  size?: number;
  playoffTeamCount?: number;
  regularSeasonMatchupPeriods?: number;
  scoringSettings?: {
    scoringType?: string;
    matchupPeriods?: unknown;
  };
  rosterSettings?: {
    lineupSlotCounts?: Record<string, number>;
    positionLimits?: Record<string, number>;
  };
  scheduleSettings?: {
    playoffSeedingRule?: string;
    playoffMatchupPeriodLength?: number;
  };
}

export interface EspnTeam {
  id: number;
  location?: string;
  nickname?: string;
  name?: string;
  abbrev?: string;
  playoffSeed?: number;
  rank?: number;
  draftDayProjectedRank?: number;
  currentProjectedRank?: number;
  owners?: Array<{
    displayName?: string;
    firstName?: string;
  }>;
  record?: {
    overall?: EspnTeamRecord;
  };
  roster?: {
    entries?: EspnRosterEntry[];
  };
}

export interface EspnTeamRecord {
  wins?: number;
  losses?: number;
  ties?: number;
  pointsFor?: number;
  pointsAgainst?: number;
}

export interface EspnRosterEntry {
  playerPoolEntry?: {
    player?: EspnPlayer;
  };
  lineupSlotId?: number;
  acquisitionType?: string;
  acquisitionDate?: number;
}

export interface EspnPlayer {
  id?: number;
  fullName?: string;
  defaultPositionId?: number;
  eligibleSlots?: number[];
  proTeamId?: number;
  injuryStatus?: string;
  ownership?: {
    percentOwned?: number;
    percentStarted?: number;
  };
  stats?: EspnPlayerStat[];
}

export interface EspnPlayerStat {
  seasonId?: number;
  statSourceId?: number;
  stats?: Record<string, number>;
}

export interface EspnMatchup {
  matchupPeriodId?: number;
  home?: EspnMatchupTeam;
  away?: EspnMatchupTeam;
  winner?: string;
  playoffTierType?: string;
}

export interface EspnMatchupTeam {
  teamId?: number;
  totalPoints?: number;
  totalProjectedPoints?: number;
  totalProjectedPointsLive?: number;
  pointsByScoringPeriod?: Record<string, number>;
}

/** Response from the kona_player_info view (free agents). */
export interface EspnPlayerPoolResponse {
  players?: EspnPlayerPoolEntry[];
}

export interface EspnPlayerPoolEntry {
  player?: EspnPlayer;
  status?: string;
  waiverProcessDate?: number;
}

export interface Env extends BaseEnvWithAuth {
  // ESPN-client specific vars if needed
}

export type Sport = 'football' | 'baseball' | 'basketball' | 'hockey';

export interface ExecuteRequest {
  tool: string;
  params: ToolParams;
  authHeader?: string;
}

export interface ToolParams {
  sport: Sport;
  league_id: string;
  season_year: number;
  team_id?: string;
  week?: number;
  position?: string;
  count?: number;
}

export interface ExecuteResponse {
  success: boolean;
  data?: unknown;
  error?: string;
  code?: string;
}
