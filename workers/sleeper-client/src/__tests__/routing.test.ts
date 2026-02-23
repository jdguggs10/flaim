import { describe, expect, it, vi } from 'vitest';
import app from '../index';
import type { Env } from '../types';

function mockExecutionContext(): ExecutionContext {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  } as unknown as ExecutionContext;
}

async function executeRequest(sport: string, tool = 'get_league_info'): Promise<{ success: boolean; code?: string }> {
  const req = new Request('https://internal/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool, params: { sport, league_id: 'lg1', season_year: 2025 } }),
  });
  const res = await app.fetch(req, {} as Env, mockExecutionContext());
  return res.json() as Promise<{ success: boolean; code?: string }>;
}

describe('sleeper-client sport routing', () => {
  it('returns SPORT_NOT_SUPPORTED for baseball', async () => {
    const body = await executeRequest('baseball');
    expect(body.success).toBe(false);
    expect(body.code).toBe('SPORT_NOT_SUPPORTED');
  });

  it('returns SPORT_NOT_SUPPORTED for hockey', async () => {
    const body = await executeRequest('hockey');
    expect(body.success).toBe(false);
    expect(body.code).toBe('SPORT_NOT_SUPPORTED');
  });
});
