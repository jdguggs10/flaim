/**
 * ESPN Gambit Dashboard API Types
 * 
 * Based on reverse-engineering ESPN's internal dashboard endpoint:
 * https://gambit-api.fantasy.espn.com/apis/v1/dashboards/espn-en?view=allon
 */

export interface GambitLeague {
  gameId: string;        // "ffl", "flb", "fba", etc.
  leagueId: string;      // numeric string
  leagueName: string;
  seasonId: number;
  teamId: number;
  teamName: string;
}

export interface GambitDashboardResponse {
  fantasyDashboard?: {
    leagues?: unknown[];
    [key: string]: any;
  };
  [key: string]: any;
}

export interface LeagueDiscoveryResult {
  success: boolean;
  leagues: GambitLeague[];
  error?: string;
}

// Sport mappings for ESPN game IDs
export const ESPN_GAME_IDS = {
  'ffl': 'football',
  'flb': 'baseball', 
  'fba': 'basketball',
  'fho': 'hockey'
} as const;

export type EspnGameId = keyof typeof ESPN_GAME_IDS;
export type SportName = typeof ESPN_GAME_IDS[EspnGameId];