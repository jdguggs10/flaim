// workers/fantasy-mcp/src/types.ts
import type { BaseEnvWithAuth, RosterSnapshot } from '@flaim/worker-shared';

interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env extends BaseEnvWithAuth {
  ESPN: Fetcher;        // Service binding to espn-client
  YAHOO: Fetcher;       // Service binding to yahoo-client
  SLEEPER: Fetcher;     // Service binding to sleeper-client
  AUTH_WORKER: Fetcher; // Service binding to auth-worker
  OPENAI_APPS_VERIFICATION_TOKEN?: string; // Wrangler secret for OpenAI domain verification
  MCP_RATE_LIMITER: RateLimit;
}

export type Platform = 'espn' | 'yahoo' | 'sleeper';
export type Sport = 'football' | 'baseball' | 'basketball' | 'hockey';

export interface ToolParams {
  platform: Platform;
  sport: Sport;
  league_id: string;
  season_year: number;
  team_id?: string;
  week?: number;
  as_of_date?: string;
  /** Normalized get_roster snapshot, injected after capability validation. */
  snapshot?: RosterSnapshot;
  type?: 'add' | 'drop' | 'trade' | 'waiver' | 'pending_trade' | 'trade_proposal' | 'trade_decline' | 'trade_veto' | 'trade_uphold' | 'failed_bid';
  position?: string;
  count?: number;
  query?: string;
}
