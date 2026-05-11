import { describe, expect, it } from 'vitest';
import app from '../index';
import type { Env } from '../types';
import { INTERNAL_SERVICE_TOKEN_HEADER } from '@flaim/worker-shared';

describe('yahoo-client app', () => {
  it('returns HTTP 500 for failed execute responses without a classified status', async () => {
    const response = await app.fetch(
      new Request('https://internal/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          [INTERNAL_SERVICE_TOKEN_HEADER]: 'internal-secret',
        },
        body: JSON.stringify({
          tool: 'get_standings',
          params: {
            sport: 'soccer',
            league_id: 'league-1',
            season_year: 2026,
          },
        }),
      }),
      { INTERNAL_SERVICE_TOKEN: 'internal-secret' } as Env
    );

    expect(response.status).toBe(500);
    const body = await response.json() as { success: boolean; code: string };
    expect(body.success).toBe(false);
    expect(body.code).toBe('INVALID_SPORT');
  });
});
