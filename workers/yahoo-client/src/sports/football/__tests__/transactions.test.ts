import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { footballHandlers } from '../handlers';
import type { ToolParams } from '../../../types';
import { getYahooCredentials } from '../../../shared/auth';
import { yahooFetch } from '../../../shared/yahoo-api';
import { buildYahooTransactionsPath, normalizeYahooTransactions } from '../../../shared/yahoo-transactions';

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

vi.mock('../../../shared/yahoo-transactions', () => ({
  buildYahooTransactionsPath: vi.fn(),
  normalizeYahooTransactions: vi.fn(),
}));

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('yahoo football get_transactions handler', () => {
  const getCredsMock = getYahooCredentials as MockedFunction<typeof getYahooCredentials>;
  const fetchMock = yahooFetch as MockedFunction<typeof yahooFetch>;
  const buildPathMock = buildYahooTransactionsPath as MockedFunction<typeof buildYahooTransactionsPath>;
  const normalizeMock = normalizeYahooTransactions as MockedFunction<typeof normalizeYahooTransactions>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('ignores explicit week with warning and applies 2-week cutoff + filters', async () => {
    const now = Date.UTC(2026, 1, 23, 12, 0, 0);
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

    getCredsMock.mockResolvedValue({ accessToken: 'token' });
    buildPathMock.mockReturnValue('/league/449.l.123/transactions;types=add,drop,trade;count=25');
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    normalizeMock.mockReturnValue([
      { transaction_id: 'invalid-ts', type: 'trade', status: 'complete', timestamp: 0, week: null },
      { transaction_id: 'old', type: 'trade', status: 'complete', timestamp: now - (20 * 24 * 60 * 60 * 1000), week: null },
      { transaction_id: 'new-add', type: 'add', status: 'complete', timestamp: now - (2 * 24 * 60 * 60 * 1000), week: null },
      { transaction_id: 'new-trade', type: 'trade', status: 'complete', timestamp: now - (1 * 24 * 60 * 60 * 1000), week: null },
    ] as never);

    const params: ToolParams = {
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
      week: 7,
      type: 'trade',
      count: 25,
    };

    const result = await footballHandlers.get_transactions({} as never, params, 'Bearer x', 'cid-1');

    expect(result.success).toBe(true);
    expect(buildPathMock).toHaveBeenCalledWith('449.l.123', 25);

    if (!result.success) return;
    const data = result.data as {
      count: number;
      warning?: string;
      dropped_invalid_timestamp_count?: number;
      window: { mode: string; weeks: number[]; start_timestamp_ms: number; end_timestamp_ms: number };
      transactions: Array<{ transaction_id: string }>;
    };
    expect(data.window.mode).toBe('recent_two_weeks_timestamp');
    expect(data.window.weeks).toEqual([]);
    expect(data.window.start_timestamp_ms).toBe(now - (14 * 24 * 60 * 60 * 1000));
    expect(data.window.end_timestamp_ms).toBe(now);
    expect(data.warning).toContain('ignored week');
    expect(data.warning).toContain('excluded because Yahoo did not provide a valid timestamp');
    expect(data.dropped_invalid_timestamp_count).toBe(1);
    expect(data.count).toBe(1);
    expect(data.transactions[0]?.transaction_id).toBe('new-trade');
    nowSpy.mockRestore();
  });

  it('returns explicit unsupported error for type=waiver', async () => {
    const params: ToolParams = {
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
      type: 'waiver',
    };

    const result = await footballHandlers.get_transactions({} as never, params, 'Bearer x', 'cid-waiver');

    expect(result.success).toBe(false);
    expect(result.code).toBe('YAHOO_FILTER_UNSUPPORTED');
    expect(getCredsMock).not.toHaveBeenCalled();
  });

  it('returns not-connected error when credentials are missing', async () => {
    getCredsMock.mockResolvedValue(null);

    const params: ToolParams = {
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
    };

    const result = await footballHandlers.get_transactions({} as never, params, 'Bearer x', 'cid-2');

    expect(result.success).toBe(false);
    expect(result.code).toBe('YAHOO_NOT_CONNECTED');
  });
});
