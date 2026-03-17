import type { Env, ToolParams, ExecuteResponse } from '../../types';

export type HandlerFn = (
  env: Env,
  params: ToolParams,
  authHeader?: string,
  correlationId?: string
) => Promise<ExecuteResponse>;

export interface YahooSportConfig {
  sport: string;
  getPositionFilter: (position?: string) => string;
  extraLeagueFields?: (league: Record<string, unknown>) => Record<string, unknown>;
  logLabelSuffix?: string;
}

export interface YahooHandlerContext {
  sport: string;
  getPositionFilter: (position?: string) => string;
  extraLeagueFields?: (league: Record<string, unknown>) => Record<string, unknown>;
  logLabelSuffix: string;
}
