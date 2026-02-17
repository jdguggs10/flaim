// workers/fantasy-mcp/src/types.ts
import type { BaseEnvWithAuth } from '@flaim/worker-shared';

export interface Env extends BaseEnvWithAuth {
  ESPN: Fetcher;        // Service binding to espn-client
  YAHOO: Fetcher;       // Service binding to yahoo-client
  AUTH_WORKER: Fetcher; // Service binding to auth-worker
  OPENAI_APPS_VERIFICATION_TOKEN?: string; // Wrangler secret for OpenAI domain verification
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
