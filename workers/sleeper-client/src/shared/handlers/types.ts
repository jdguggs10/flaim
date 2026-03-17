import type { Env, ToolParams, ExecuteResponse } from '../../types';

export type HandlerFn = (
  env: Env,
  params: ToolParams,
  authHeader?: string,
  correlationId?: string
) => Promise<ExecuteResponse>;

export interface SleeperSportConfig {
  sport: 'football' | 'basketball';
  statePath: '/state/nfl' | '/state/nba';
}
