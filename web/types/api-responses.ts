/**
 * API Response Type Definitions
 * Reusable DTO interfaces for JSON response casting
 */

export interface TurnResponseRequest {
  messages?: any[];
  tools?: any[];
  previous_response_id?: string;
}

export interface WorkerErrorResponse {
  error?: string;
}

export interface WorkerLeaguesResponse extends WorkerErrorResponse {
  leagues?: Array<{
    leagueId: string;
    sport: string;
    leagueName?: string;
    teamId?: string;
    seasonYear?: number;
  }>;
  deleted?: boolean;
}
