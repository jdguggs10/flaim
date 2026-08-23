// workers/espn-client/src/types.ts
import type { BaseEnvWithAuth, ExecuteResponse as SharedExecuteResponse, RosterSnapshot } from '@flaim/worker-shared';

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
    matchupTieRule?: string;
    matchupTieRuleBy?: number;
    playoffMatchupTieRule?: string;
    playoffMatchupTieRuleBy?: number;
    homeTeamBonus?: number;
    playoffHomeTeamBonus?: number;
  };
  rosterSettings?: {
    lineupSlotCounts?: Record<string, number>;
    positionLimits?: Record<string, number>;
  };
  scheduleSettings?: {
    matchupPeriods?: unknown;
    playoffSeedingRule?: string;
    playoffMatchupPeriodLength?: number;
  };
  /**
   * Keeper/draft-format settings. `keeperCount`/`keeperCountFuture` are the
   * per-team keeper caps for this season / next season; `keeperCount > 0`
   * is the keeper-league signal (there is no separate `isKeeperLeague`
   * flag from ESPN). `isTradingEnabled` toggles DRAFT-PICK trading, not
   * in-season player trades (see tradeSettings for that). Verified live
   * 2026-08-23 (research brief §7) on real ESPN keeper leagues.
   */
  draftSettings?: {
    keeperCount?: number;
    keeperCountFuture?: number;
    keeperOrderType?: string; // 'TRADITIONAL' | 'END_OF_DRAFT' | 'SELECTED_ROUND'
    keeperDeadlineDate?: number; // epoch ms
    type?: string; // 'AUCTION' | 'SNAKE' | 'OFFLINE' (draft type)
    auctionBudget?: number;
    isTradingEnabled?: boolean; // draft-PICK trading toggle, not season trades
  };
  /** In-season player-trade rules (distinct from draftSettings.isTradingEnabled). */
  tradeSettings?: {
    deadlineDate?: number; // epoch ms
    revisionHours?: number;
    vetoVotesRequired?: number;
    allowOutOfUniverse?: boolean;
    max?: number;
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
  /**
   * Keeper designations. `keeperPlayerIds` = players kept from last season
   * into this season's draft (verified: equals the set of `keeper:true`
   * draft picks). `futureKeeperPlayerIds` = next-season designations,
   * observed populated only on the authenticated user's own team.
   */
  draftStrategy?: {
    keeperPlayerIds?: number[];
    futureKeeperPlayerIds?: number[];
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
    /**
     * Keeper cost for THIS season (derived from last season's acquisition).
     * 0 = no cost defined / not keeper-eligible. Unit follows
     * draftSettings.type: AUCTION -> dollars, SNAKE/AUTOPICK -> draft round.
     */
    keeperValue?: number;
    /**
     * Keeper cost for NEXT season (= this season's draft/auction price).
     * Follows the player through trades; reset to 0 when the player passes
     * through free agency/waivers (observed on real league data, see
     * research brief §7.3 — may be an ESPN default rather than universal).
     */
    keeperValueFuture?: number;
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
  cumulativeScore?: {
    wins?: number;
    losses?: number;
    ties?: number;
    scoreByStat?: Record<string, {
      ineligible?: boolean;
      rank?: number;
      result?: string | null;
      score?: number;
    }>;
  };
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
  /** Normalized get_roster snapshot request injected by the gateway. */
  snapshot?: RosterSnapshot;
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
  /** Defensively re-derived snapshot, attached at /execute for get_roster only. */
  rosterSnapshot?: RosterSnapshot;
}

export type HandlerToolParams = RoutedToolParams;

export type SportHandler = (
  env: Env,
  params: RoutedToolParams,
  authHeader?: string,
  correlationId?: string
) => Promise<SharedExecuteResponse>;

export type { ExecuteResponse } from '@flaim/worker-shared';
