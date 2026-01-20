// workers/espn-client/src/types.ts
//
// TODO: Add TypeScript interfaces for ESPN API responses
// Currently handlers use `as any` for ESPN API responses because the API is undocumented.
// This tech debt should be addressed by:
// 1. Creating interfaces for the specific fields we extract (not full API schema)
// 2. Using `unknown` with type guards for safer parsing
// See: handlers in sports/football/ and sports/baseball/ that use `response.json() as any`
//
import type { BaseEnvWithAuth } from '@flaim/worker-shared';

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
