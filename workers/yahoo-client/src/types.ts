import type { BaseEnvWithAuth } from '@flaim/worker-shared';

export interface Env extends BaseEnvWithAuth {
  // Yahoo-client uses AUTH_WORKER from BaseEnvWithAuth
}

export type Sport = 'football' | 'baseball' | 'basketball' | 'hockey';

export interface ExecuteRequest {
  tool: string;
  params: ToolParams;
  authHeader?: string;
}

export interface ToolParams {
  sport: Sport;
  league_id: string;      // Yahoo league_key (e.g., "449.l.12345")
  season_year: number;
  team_id?: string;       // Yahoo team_key (e.g., "449.l.12345.t.3")
  week?: number;
  type?: 'add' | 'drop' | 'trade' | 'waiver';
  position?: string;
  count?: number;
  query?: string;
}

export type { ExecuteResponse } from '@flaim/worker-shared';
