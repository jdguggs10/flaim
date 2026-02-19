import type { BaseEnvWithAuth } from '@flaim/worker-shared';

export interface Env extends BaseEnvWithAuth {
  // Sleeper API is public — no extra bindings needed beyond auth-worker (for league storage)
}

export type Sport = 'football' | 'basketball';

export interface ExecuteRequest {
  tool: string;
  params: ToolParams;
  authHeader?: string;
}

export interface ToolParams {
  sport: Sport;
  league_id: string;      // Sleeper league_id (numeric string, e.g., "289646328504385536")
  season_year: number;
  team_id?: string;        // roster_id as string (e.g., "1")
  week?: number;
  position?: string;
  count?: number;
}

export type { ExecuteResponse } from '@flaim/worker-shared';

// --- Sleeper API response shapes ---

export interface SleeperUser {
  user_id: string;
  username: string | null;
  display_name: string | null;
  avatar: string | null;
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
  settings: Record<string, unknown>;
  previous_league_id: string | null;
  draft_id: string;
  avatar: string | null;
}

export interface SleeperRoster {
  roster_id: number;
  owner_id: string;
  players: string[] | null;
  starters: string[] | null;
  reserve: string[] | null;
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
