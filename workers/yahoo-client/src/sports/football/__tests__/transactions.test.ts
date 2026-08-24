import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { footballHandlers } from '../handlers';
import type { ToolParams } from '../../../types';
import { getYahooCredentials, resolveUserTeamKey } from '../../../shared/auth';
import { yahooFetch } from '../../../shared/yahoo-api';
import { buildYahooTransactionsPath, buildYahooPendingTransactionsPath, clampYahooTransactionCount, normalizeYahooTransactions } from '../../../shared/yahoo-transactions';

vi.mock('../../../shared/auth', () => ({
  getYahooCredentials: vi.fn(),
  resolveUserTeamKey: vi.fn(),
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
  buildYahooPendingTransactionsPath: vi.fn(),
  clampYahooTransactionCount: (count: number) => Math.max(1, Math.min(100, count)),
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
  const resolveTeamKeyMock = resolveUserTeamKey as MockedFunction<typeof resolveUserTeamKey>;
  const fetchMock = yahooFetch as MockedFunction<typeof yahooFetch>;
  const buildPathMock = buildYahooTransactionsPath as MockedFunction<typeof buildYahooTransactionsPath>;
  const buildPendingPathMock = buildYahooPendingTransactionsPath as MockedFunction<typeof buildYahooPendingTransactionsPath>;
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

  it('type=waiver resolves team key and uses pending path', async () => {
    getCredsMock.mockResolvedValue({ accessToken: 'token' });
    resolveTeamKeyMock.mockResolvedValue('449.l.123.t.3');
    buildPendingPathMock.mockReturnValue('/league/449.l.123/transactions;types=waiver;team_key=449.l.123.t.3;count=25');
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    normalizeMock.mockReturnValue([]);

    const params: ToolParams = {
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
      type: 'waiver',
    };

    const result = await footballHandlers.get_transactions({} as never, params, 'Bearer x', 'cid-waiver');

    expect(result.success).toBe(true);
    expect(resolveTeamKeyMock).toHaveBeenCalledWith({}, '449.l.123', 'Bearer x', 'cid-waiver');
    expect(buildPendingPathMock).toHaveBeenCalledWith('449.l.123', '449.l.123.t.3', ['waiver'], 25);
    expect(buildPathMock).not.toHaveBeenCalled();
  });

  it('type=waiver returns TEAM_KEY_MISSING when team key not found', async () => {
    getCredsMock.mockResolvedValue({ accessToken: 'token' });
    resolveTeamKeyMock.mockResolvedValue(null);

    const params: ToolParams = {
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
      type: 'waiver',
    };

    const result = await footballHandlers.get_transactions({} as never, params, 'Bearer x', 'cid-waiver');

    expect(result.success).toBe(false);
    expect(result.code).toBe('TEAM_KEY_MISSING');
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

  it('flags possibly_truncated and reports returned_rows when matching rows exceed count', async () => {
    const now = Date.UTC(2026, 1, 23, 12, 0, 0);
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

    getCredsMock.mockResolvedValue({ accessToken: 'token' });
    buildPathMock.mockReturnValue('/league/449.l.123/transactions;count=2');
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    normalizeMock.mockReturnValue(Array.from({ length: 5 }, (_, i) => ({
      transaction_id: `add-${i}`,
      type: 'add',
      status: 'complete',
      timestamp: now - (i * 60 * 60 * 1000),
      week: null,
    })) as never);

    const params: ToolParams = {
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
      count: 2,
    };

    const result = await footballHandlers.get_transactions({} as never, params, 'Bearer x', 'cid-3');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as {
      count: number;
      window: { returned_rows: number };
      limitations?: { possibly_truncated?: boolean };
    };
    expect(data.count).toBe(2);
    expect(data.window.returned_rows).toBe(2);
    expect(data.limitations).toEqual({ possibly_truncated: true });
    nowSpy.mockRestore();
  });

  it('flags possibly_truncated when a full upstream page hides matches the client-side type filter excluded (active league)', async () => {
    // Regression guard for the type-filter false negative: Yahoo's general
    // (non-pending) path applies no server-side type filter, so a full
    // upstream page (parsed.length reaching the requested clamp) can hide
    // additional matching rows beyond what was fetched even though the
    // post-filter count looks tiny. Every row here sits well inside the
    // 14-day window (all within the last 24 hours), so the page never proves
    // it reached back past the window start -- the refined suppression rule
    // must NOT kick in and possibly_truncated must still fire.
    const now = Date.UTC(2026, 1, 23, 12, 0, 0);
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

    getCredsMock.mockResolvedValue({ accessToken: 'token' });
    buildPathMock.mockReturnValue('/league/449.l.123/transactions;count=25');
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const requestedUpstreamCount = clampYahooTransactionCount(25);
    normalizeMock.mockReturnValue(Array.from({ length: requestedUpstreamCount }, (_, i) => ({
      transaction_id: `t-${i}`,
      type: i < 2 ? 'trade' : 'add',
      status: 'complete',
      timestamp: now - (i * 60 * 60 * 1000), // spans the last 24h, well inside the 14-day window
      week: null,
    })) as never);

    const params: ToolParams = {
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
      type: 'trade',
    };

    const result = await footballHandlers.get_transactions({} as never, params, 'Bearer x', 'cid-4');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as {
      count: number;
      limitations?: { possibly_truncated?: boolean };
    };
    expect(data.count).toBe(2);
    expect(data.limitations).toEqual({ possibly_truncated: true });
    nowSpy.mockRestore();
  });

  it('omits possibly_truncated when a full upstream page already reaches back past the window start (quiet league)', async () => {
    // A long-lived league can have >= requestedUpstreamCount lifetime
    // transactions while having been quiet for the requested 14-day window.
    // Yahoo returns rows newest-first, so once the oldest valid-timestamp row
    // in a full page is older than cutoff, every row inside the window was
    // necessarily already fetched -- window coverage is complete and this
    // must NOT be flagged as possibly_truncated, even though the page was
    // full and even repeatedly across calls.
    const now = Date.UTC(2026, 1, 23, 12, 0, 0);
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

    getCredsMock.mockResolvedValue({ accessToken: 'token' });
    buildPathMock.mockReturnValue('/league/449.l.123/transactions;count=25');
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    const requestedUpstreamCount = clampYahooTransactionCount(25);
    normalizeMock.mockReturnValue(Array.from({ length: requestedUpstreamCount }, (_, i) => ({
      transaction_id: `old-${i}`,
      type: 'add',
      status: 'complete',
      // i=0..3 fall inside the 14-day window; the rest reach back to 75 days,
      // well past cutoff -- the page provably covers the whole window.
      timestamp: now - ((i + 1) * 3 * 24 * 60 * 60 * 1000),
      week: null,
    })) as never);

    const params: ToolParams = {
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
    };

    const result = await footballHandlers.get_transactions({} as never, params, 'Bearer x', 'cid-quiet');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as {
      count: number;
      window: { returned_rows: number };
      limitations?: { possibly_truncated?: boolean };
    };
    expect(data.count).toBe(4);
    expect(data.window.returned_rows).toBe(4);
    expect(data.limitations).toBeUndefined();
    nowSpy.mockRestore();
  });

  it('omits limitations when the page is partial and matching rows fit within count', async () => {
    const now = Date.UTC(2026, 1, 23, 12, 0, 0);
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(now);

    getCredsMock.mockResolvedValue({ accessToken: 'token' });
    buildPathMock.mockReturnValue('/league/449.l.123/transactions;count=25');
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));
    normalizeMock.mockReturnValue([
      { transaction_id: 'add-1', type: 'add', status: 'complete', timestamp: now - (60 * 60 * 1000), week: null },
    ] as never);

    const params: ToolParams = {
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
    };

    const result = await footballHandlers.get_transactions({} as never, params, 'Bearer x', 'cid-5');

    expect(result.success).toBe(true);
    if (!result.success) return;
    const data = result.data as { limitations?: unknown };
    expect(data.limitations).toBeUndefined();
    nowSpy.mockRestore();
  });
});
