import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { footballHandlers } from '../handlers';
import type { ToolParams } from '../../../types';
import { getYahooCredentials } from '../../../shared/auth';
import { yahooFetch } from '../../../shared/yahoo-api';
import { buildYahooTransactionsFixture } from '../test-fixtures/transactions-fixture';

vi.mock('../../../shared/auth', () => ({
  getYahooCredentials: vi.fn(),
}));

vi.mock('../../../shared/yahoo-api', async () => {
  const actual = await vi.importActual('../../../shared/yahoo-api') as Record<string, unknown>;
  return {
    ...actual,
    yahooFetch: vi.fn(),
  };
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('yahoo football get_transactions fixture integration', () => {
  const getCredsMock = getYahooCredentials as MockedFunction<typeof getYahooCredentials>;
  const fetchMock = yahooFetch as MockedFunction<typeof yahooFetch>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('normalizes fixture payload and reports excluded invalid-timestamp rows', async () => {
    const now = Date.UTC(2026, 1, 23, 12, 0, 0);
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

    getCredsMock.mockResolvedValue({ accessToken: 'token' });
    fetchMock.mockResolvedValue(jsonResponse(buildYahooTransactionsFixture(now)));

    const params: ToolParams = {
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
      week: 7,
      type: 'add',
      count: 10,
    };

    const result = await footballHandlers.get_transactions({} as never, params, 'Bearer x', 'cid-fixture');

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    if (!result.success) return;
    const data = result.data as {
      count: number;
      warning?: string;
      dropped_invalid_timestamp_count?: number;
      window: { mode: string; weeks: number[]; start_timestamp_ms: number; end_timestamp_ms: number };
      transactions: Array<{ transaction_id: string; faab_bid?: number | null; timestamp: number }>;
    };

    expect(data.window.mode).toBe('recent_two_weeks_timestamp');
    expect(data.window.weeks).toEqual([]);
    expect(data.window.start_timestamp_ms).toBe(now - (14 * 24 * 60 * 60 * 1000));
    expect(data.window.end_timestamp_ms).toBe(now);
    expect(data.warning).toContain('ignored week');
    expect(data.warning).toContain('excluded because Yahoo did not provide a valid timestamp');
    expect(data.dropped_invalid_timestamp_count).toBe(1);
    expect(data.count).toBe(1);
    expect(data.transactions[0]?.transaction_id).toBe('449.l.123.tr.recent-add');
    expect(data.transactions[0]?.faab_bid).toBe(12);
    expect(data.transactions[0]?.timestamp).toBeGreaterThan(0);

    nowSpy.mockRestore();
  });
});
