// workers/espn-client/src/types.ts
import type { BaseEnvWithAuth, ExecuteResponse as SharedExecuteResponse } from '@flaim/worker-shared';

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
  status?: EspnLeagueStatus;
  settings?: EspnLeagueSettings;
  teams?: EspnTeam[];
  schedule?: EspnMatchup[];
}

export interface EspnLeagueStatus {
  currentMatchupPeriod?: number;
  isActive?: boolean;
  previousSeasons?: number[];
  [key: string]: unknown;
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
  /** ESPN's explicit postseason final rank (1 = champion). Only present in completed historical seasons. Prefer over rankCalculatedFinal. */
  rankFinal?: number;
  /** ESPN's computed postseason rank when rankFinal is unavailable. Only present in completed historical seasons. */
  rankCalculatedFinal?: number;
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
  teamName?: string;
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
  ESPN_PLAYERS_CACHE: KVNamespace;
}

export type Sport = 'football' | 'baseball' | 'basketball' | 'hockey';

export interface ExecuteRequest {
  tool: string;
  params: ToolParams;
}

export interface ToolParams {
  sport: Sport;
  league_id: string;
  season_year: number;
  team_id?: string;
  week?: number;
  type?: 'add' | 'drop' | 'trade' | 'waiver' | 'trade_proposal' | 'trade_decline' | 'trade_veto' | 'trade_uphold' | 'failed_bid';
  position?: string;
  count?: number;
  query?: string;
}

export interface EspnSeasonContext {
  canonicalYear: number;
  espnYear: number;
}

export interface RoutedToolParams extends ToolParams {
  seasonContext: EspnSeasonContext;
}

export type HandlerToolParams = RoutedToolParams;

export type SportHandler = (
  env: Env,
  params: RoutedToolParams,
  authHeader?: string,
  correlationId?: string
) => Promise<SharedExecuteResponse>;

export type { ExecuteResponse } from '@flaim/worker-shared';
