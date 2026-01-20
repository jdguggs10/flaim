// workers/fantasy-mcp/src/types.ts
import type { BaseEnvWithAuth } from '@flaim/worker-shared';

export interface Env extends BaseEnvWithAuth {
  ESPN: Fetcher;      // Service binding to espn-client
  AUTH: Fetcher;      // Service binding to auth-worker
  // YAHOO: Fetcher;  // Future: Yahoo client binding
}

export type Platform = 'espn' | 'yahoo';
export type Sport = 'football' | 'baseball' | 'basketball' | 'hockey';

export interface ToolParams {
  platform: Platform;
  sport: Sport;
  league_id: string;
  season_year: number;
  team_id?: string;
  week?: number;
  position?: string;
  count?: number;
}
