import type { BaseEnvWithAuth, RosterSnapshot } from '@flaim/worker-shared';

export interface Env extends BaseEnvWithAuth {
  SLEEPER_PLAYERS_CACHE: KVNamespace;
}

export type Sport = 'football' | 'basketball';

export interface ExecuteRequest {
  tool: string;
  params: ToolParams;
}

export interface ToolParams {
  sport: Sport;
  league_id: string;      // Sleeper league_id (numeric string, e.g., "289646328504385536")
  season_year: number;
  team_id?: string;        // roster_id as string (e.g., "1")
  /** Optional explicit Sleeper draft id for get_draft. */
  draft_id?: string;
  week?: number;
  /** Normalized get_roster snapshot request injected by the gateway. */
  snapshot?: RosterSnapshot;
  /** Defensively re-derived snapshot, attached at /execute for get_roster only. */
  rosterSnapshot?: RosterSnapshot;
  type?: 'add' | 'drop' | 'trade' | 'waiver';
  position?: string;
  count?: number;
  query?: string;
}

export type { ExecuteResponse } from '@flaim/worker-shared';

// --- Sleeper API response shapes ---

export interface SleeperUser {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
}

/**
 * League settings. draft_rounds is the round count to assume for future
 * drafts (used alongside traded-pick data to derive pick ownership). `type`
 * (0/1/2 = redraft/keeper/dynasty) is undocumented community convention —
 * an unexpected `3` has been observed live (confirmed to mean "guillotine"
 * by the league's own owner), so callers must not gate behavior on it. The
 * remaining fields below back get_league_info's `leagueFormat` block
 * (keeper/trade/taxi settings) — kept as an index signature since Sleeper
 * returns many more settings fields than Flaim currently models.
 */
export interface SleeperLeagueSettings {
  draft_rounds?: number;
  type?: number;
  max_keepers?: number;
  trade_deadline?: number;       // week number
  disable_trades?: number;       // 0/1
  pick_trading?: number;         // 0/1, undocumented
  taxi_slots?: number;
  taxi_years?: number;
  taxi_allow_vets?: number;      // 0/1
  taxi_deadline?: number;
  reserve_slots?: number;
  [key: string]: unknown;
}

export interface SleeperLeague {
  league_id: string;
  name: string;
  sport: string;               // "nfl" or "nba"
  season: string;              // e.g., "2025"
  status: string;              // "pre_draft" | "drafting" | "in_season" | "complete"
  total_rosters: number;
  roster_positions: string[];
  scoring_settings: Record<string, number>;
  settings: SleeperLeagueSettings;
  previous_league_id: string | null;
  draft_id: string;
  avatar: string | null;
}

/**
 * A single net traded-pick ownership record from
 * GET /league/{league_id}/traded_picks. Untraded picks are not listed.
 * roster_id is the ORIGINAL owner's roster; previous_owner_id is the roster
 * it most recently came from; owner_id is the CURRENT owner's roster. All
 * roster ids are numbers.
 */
export interface SleeperTradedPick {
  season: string;
  round: number;
  roster_id: number;
  previous_owner_id: number;
  owner_id: number;
}

/**
 * Public Sleeper draft summary/detail shape.  The list endpoint omits some
 * detail-only fields (notably slot_to_roster_id), so every field beyond the
 * identity tuple is deliberately optional until the detail response is
 * validated.
 */
export interface SleeperDraft {
  draft_id: string;
  league_id: string;
  season: string;
  sport: string;
  type?: string;
  status?: string;
  start_time?: number;
  settings?: {
    teams?: number;
    rounds?: number;
    reversal_round?: number;
    [key: string]: unknown;
  };
  slot_to_roster_id?: Record<string, number>;
  [key: string]: unknown;
}

export interface SleeperDraftPick {
  draft_id?: string;
  player_id?: string;
  roster_id?: string | number;
  round?: number;
  draft_slot?: number;
  pick_no?: number;
  is_keeper?: boolean | null;
  metadata?: {
    first_name?: string;
    last_name?: string;
    full_name?: string;
    position?: string;
    team?: string;
    amount?: number | string;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
  taxi: string[] | null;
  /**
   * Designated keeper player_ids for the upcoming draft. Populated only
   * during Sleeper's pre-draft keeper-selection window; `null` or `[]`
   * otherwise (both observed live — `[]` pre-draft in a first-season
   * league, `null` in an archived/past-season league).
   */
  keepers?: string[] | null;
  settings: {
    wins: number;
    losses: number;
    ties: number;
    fpts: number;
    fpts_decimal?: number;
    fpts_against?: number;
    fpts_against_decimal?: number;
    waiver_position?: number;
    waiver_budget_used?: number;
    total_moves?: number;
  };
}

export interface SleeperMatchup {
  roster_id: number;
  matchup_id: number;
  points: number;
  custom_points: number | null;
  players: string[] | null;
  starters: string[] | null;
  players_points: Record<string, number> | null;
  starters_points: number[] | null;
}

export interface SleeperLeagueUser {
  user_id: string;
  display_name: string;
  avatar: string | null;
  metadata?: Record<string, unknown>;
}

export interface SleeperState {
  week: number;
  season_type: string;
  season: string;
  display_week: number;
  league_season: string;
}

export interface SleeperBracketMatch {
  r: number;          // round
  m: number;          // matchup id
  t1: number | null;  // roster_id team 1
  t2: number | null;  // roster_id team 2
  w: number | null;   // winner roster_id
  l: number | null;   // loser roster_id
  p?: number;         // placement
}
