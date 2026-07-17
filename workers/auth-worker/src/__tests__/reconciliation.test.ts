import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockSyncState = vi.hoisted(() => ({
  acquireLease: vi.fn(),
  settle: vi.fn(),
}));

vi.mock('../sync-state', () => ({
  SyncStateStorage: {
    fromEnvironment: vi.fn().mockReturnValue(mockSyncState),
  },
  UPSTREAM_BACKOFF_COOLDOWN_SECONDS: 300,
}));

const mockEspnStorage = vi.hoisted(() => ({
  getCredentials: vi.fn(),
}));

vi.mock('../supabase-storage', () => ({
  EspnSupabaseStorage: {
    fromEnvironment: vi.fn().mockReturnValue(mockEspnStorage),
  },
}));

vi.mock('../v3/league-discovery', () => ({
  discoverLeaguesV3: vi.fn(),
}));

vi.mock('../sleeper-connect-handlers', () => ({
  fetchSleeperLeaguesReadOnly: vi.fn(),
}));

vi.mock('../yahoo-connect-handlers', () => ({
  fetchYahooLeaguesReadOnly: vi.fn(),
}));

/**
 * Supabase stub whose league tables are select-only: reaching for any write
 * method throws. This is the no-write guarantee test for the dry-run — a
 * regression that adds a write to the scheduled path fails here.
 */
const supabaseStub = vi.hoisted(() => {
  const state: {
    rowsByTable: Record<string, Array<Record<string, unknown>>>;
    tablesQueried: string[];
    gteCalls: Array<{ table: string; column: string; value: unknown }>;
  } = { rowsByTable: {}, tablesQueried: [], gteCalls: [] };

  const writeAttempt = (table: string, method: string) => () => {
    throw new Error(`WRITE ATTEMPTED in dry-run: ${method} on ${table}`);
  };

  const client = {
    from(table: string) {
      state.tablesQueried.push(table);
      const builder = {
        select: () => builder,
        in: () => builder,
        gte: (column: string, value: unknown) => {
          state.gteCalls.push({ table, column, value });
          return builder;
        },
        order: () => builder,
        range: (from: number, to: number) =>
          Promise.resolve({ data: (state.rowsByTable[table] ?? []).slice(from, to + 1), error: null }),
        insert: writeAttempt(table, 'insert'),
        update: writeAttempt(table, 'update'),
        upsert: writeAttempt(table, 'upsert'),
        delete: writeAttempt(table, 'delete'),
      };
      return builder;
    },
  };

  return { state, client };
});

const createClientMock = vi.hoisted(() => vi.fn());

vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}));

import {
  diffDiscoveredAgainstStored,
  parseReconciliationConfig,
  runReconciliation,
  selectCandidates,
  yahooRenewToLeagueKey,
  type StoredLeagueSnapshotRow,
} from '../reconciliation';
import { AutomaticLeagueDiscoveryFailed } from '../espn-types';
import { getDefaultSeasonYear } from '../season-utils';
import { discoverLeaguesV3 } from '../v3/league-discovery';
import { fetchSleeperLeaguesReadOnly } from '../sleeper-connect-handlers';
import { fetchYahooLeaguesReadOnly } from '../yahoo-connect-handlers';

const CURRENT = getDefaultSeasonYear('football');
const PRIOR = CURRENT - 1;

const baseEnv = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
  RECONCILIATION_ENABLED: 'true',
};

function snapshotRow(overrides: Partial<StoredLeagueSnapshotRow> = {}): StoredLeagueSnapshotRow {
  return {
    userId: 'user_a',
    sport: 'football',
    seasonYear: PRIOR,
    leagueId: '123',
    recurringLeagueId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseStub.state.rowsByTable = {};
  supabaseStub.state.tablesQueried = [];
  supabaseStub.state.gteCalls = [];
  createClientMock.mockReturnValue(supabaseStub.client);
  mockSyncState.acquireLease.mockResolvedValue({ acquired: true });
  mockSyncState.settle.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('parseReconciliationConfig', () => {
  it('defaults to disabled, dry-run, tiny cohort, espn+sleeper, football', () => {
    const config = parseReconciliationConfig({ SUPABASE_URL: 'u', SUPABASE_SERVICE_KEY: 'k' });
    expect(config).toEqual({
      enabled: false,
      dryRun: true,
      maxUsersPerRun: 5,
      batchSize: 2,
      providers: ['espn', 'sleeper'],
      sports: ['football'],
      timeoutBudgetMs: 45_000,
    });
  });

  it('parses overrides and drops unknown allowlist entries', () => {
    const config = parseReconciliationConfig({
      ...baseEnv,
      RECONCILIATION_MAX_USERS_PER_RUN: '10',
      RECONCILIATION_BATCH_SIZE: '3',
      RECONCILIATION_PROVIDERS: 'espn, yahoo, nonsense',
      RECONCILIATION_SPORTS: 'football,basketball,cricket',
      RECONCILIATION_TIMEOUT_BUDGET_MS: '60000',
    });
    expect(config.enabled).toBe(true);
    expect(config.maxUsersPerRun).toBe(10);
    expect(config.batchSize).toBe(3);
    expect(config.providers).toEqual(['espn', 'yahoo']);
    expect(config.sports).toEqual(['football', 'basketball']);
    expect(config.timeoutBudgetMs).toBe(60_000);
  });

  it('clamps out-of-range numbers and falls back on garbage', () => {
    const config = parseReconciliationConfig({
      ...baseEnv,
      RECONCILIATION_MAX_USERS_PER_RUN: '9999',
      RECONCILIATION_BATCH_SIZE: '0',
      RECONCILIATION_TIMEOUT_BUDGET_MS: 'soon',
      RECONCILIATION_PROVIDERS: 'nonsense-only',
    });
    expect(config.maxUsersPerRun).toBe(50);
    expect(config.batchSize).toBe(1);
    expect(config.timeoutBudgetMs).toBe(45_000);
    expect(config.providers).toEqual(['espn', 'sleeper']);
  });
});

describe('selectCandidates', () => {
  const currentYears = { football: CURRENT };

  it('selects users with prior-season rows and no current-season row', () => {
    const selection = selectCandidates(
      {
        espn: [
          snapshotRow({ userId: 'user_stale' }),
          snapshotRow({ userId: 'user_fresh', seasonYear: PRIOR }),
          snapshotRow({ userId: 'user_fresh', seasonYear: CURRENT }),
          snapshotRow({ userId: 'user_new_only', seasonYear: CURRENT }),
        ],
      },
      ['football'],
      currentYears,
      5
    );
    expect(selection.candidates).toHaveLength(1);
    expect(selection.candidates[0]).toMatchObject({
      userId: 'user_stale',
      provider: 'espn',
      sports: ['football'],
    });
    expect(selection.eligibleUsers).toBe(1);
  });

  it('ignores sports outside the allowlist', () => {
    const selection = selectCandidates(
      { espn: [snapshotRow({ sport: 'baseball' })] },
      ['football'],
      currentYears,
      5
    );
    expect(selection.candidates).toHaveLength(0);
  });

  it('caps distinct users but keeps all providers for an included user', () => {
    const selection = selectCandidates(
      {
        espn: [snapshotRow({ userId: 'user_a' }), snapshotRow({ userId: 'user_b', leagueId: '9' })],
        sleeper: [snapshotRow({ userId: 'user_a', leagueId: 'sl1' })],
      },
      ['football'],
      currentYears,
      1
    );
    expect(selection.selectedUsers).toBe(1);
    expect(selection.eligibleUsers).toBe(2);
    expect(selection.candidates.map((c) => `${c.userId}:${c.provider}`)).toEqual([
      'user_a:espn',
      'user_a:sleeper',
    ]);
  });

  it('orders deterministically by user then provider', () => {
    const selection = selectCandidates(
      {
        sleeper: [snapshotRow({ userId: 'user_b', leagueId: 'sl1' })],
        espn: [snapshotRow({ userId: 'user_b' }), snapshotRow({ userId: 'user_a' })],
      },
      ['football'],
      currentYears,
      5
    );
    expect(selection.candidates.map((c) => `${c.userId}:${c.provider}`)).toEqual([
      'user_a:espn',
      'user_b:espn',
      'user_b:sleeper',
    ]);
  });
});

describe('diffDiscoveredAgainstStored', () => {
  it('counts stored current-season leagues as already present', () => {
    const diff = diffDiscoveredAgainstStored(
      'espn',
      [{ sport: 'football', seasonYear: CURRENT, leagueId: '123' }],
      [snapshotRow({ seasonYear: CURRENT })]
    );
    expect(diff.wouldInsert).toHaveLength(0);
    expect(diff.alreadyPresent).toBe(1);
  });

  it('matches ESPN prior seasons by stable league id', () => {
    const diff = diffDiscoveredAgainstStored(
      'espn',
      [{ sport: 'football', seasonYear: CURRENT, leagueId: '123' }],
      [snapshotRow()]
    );
    expect(diff.wouldInsert).toEqual([
      {
        sport: 'football',
        seasonYear: CURRENT,
        leagueId: '123',
        priorMatch: { leagueId: '123', seasonYear: PRIOR, basis: 'same_league_id' },
      },
    ]);
  });

  it('matches Sleeper via previous_league_id hint and Yahoo via renew chain', () => {
    const sleeperDiff = diffDiscoveredAgainstStored(
      'sleeper',
      [{ sport: 'football', seasonYear: CURRENT, leagueId: 'new1', priorLeagueHint: 'old1' }],
      [snapshotRow({ leagueId: 'old1' })]
    );
    expect(sleeperDiff.wouldInsert[0].priorMatch).toEqual({
      leagueId: 'old1',
      seasonYear: PRIOR,
      basis: 'previous_league_id',
    });

    const yahooDiff = diffDiscoveredAgainstStored(
      'yahoo',
      [{ sport: 'football', seasonYear: CURRENT, leagueId: '461.l.999', priorLeagueHint: '449.l.888' }],
      [snapshotRow({ leagueId: '449.l.888' })]
    );
    expect(yahooDiff.wouldInsert[0].priorMatch).toEqual({
      leagueId: '449.l.888',
      seasonYear: PRIOR,
      basis: 'renew_chain',
    });
  });

  it('falls back to recurring_league_id evidence, then none', () => {
    const recurringDiff = diffDiscoveredAgainstStored(
      'sleeper',
      [{ sport: 'football', seasonYear: CURRENT, leagueId: 'new1', priorLeagueHint: 'root1' }],
      [snapshotRow({ leagueId: 'other', recurringLeagueId: 'root1' })]
    );
    expect(recurringDiff.wouldInsert[0].priorMatch?.basis).toBe('recurring_league_id');

    const noneDiff = diffDiscoveredAgainstStored(
      'sleeper',
      [{ sport: 'football', seasonYear: CURRENT, leagueId: 'new1' }],
      [snapshotRow({ leagueId: 'unrelated' })]
    );
    expect(noneDiff.wouldInsert[0].priorMatch).toBeNull();
  });
});

describe('yahooRenewToLeagueKey', () => {
  it('converts renew pointers and rejects malformed ones', () => {
    expect(yahooRenewToLeagueKey('449_888')).toBe('449.l.888');
    expect(yahooRenewToLeagueKey('')).toBeUndefined();
    expect(yahooRenewToLeagueKey(undefined)).toBeUndefined();
    expect(yahooRenewToLeagueKey('not-a-renew')).toBeUndefined();
  });
});

describe('runReconciliation', () => {
  it('no-ops when disabled without touching storage', async () => {
    const summary = await runReconciliation(
      { ...baseEnv, RECONCILIATION_ENABLED: 'false' },
      'cron'
    );
    expect(summary.outcome).toBe('disabled');
    expect(createClientMock).not.toHaveBeenCalled();
    expect(mockSyncState.acquireLease).not.toHaveBeenCalled();
  });

  it('refuses to run when dry-run is disabled (writes do not exist)', async () => {
    const summary = await runReconciliation(
      { ...baseEnv, RECONCILIATION_DRY_RUN: 'false' },
      'manual'
    );
    expect(summary.outcome).toBe('refused_not_dry_run');
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('probes stale ESPN users read-only and reports would-insert with evidence', async () => {
    supabaseStub.state.rowsByTable = {
      espn_leagues: [
        { clerk_user_id: 'user_stale_1', sport: 'football', season_year: PRIOR, league_id: '123' },
        { clerk_user_id: 'user_fresh_2', sport: 'football', season_year: CURRENT, league_id: '456' },
      ],
      sleeper_leagues: [],
    };
    mockEspnStorage.getCredentials.mockResolvedValue({ swid: '{swid}', s2: 's2' });
    vi.mocked(discoverLeaguesV3).mockResolvedValue([
      { gameId: 'ffl', leagueId: '123', leagueName: 'League', seasonId: CURRENT, teamId: 1, teamName: 'Team' },
    ]);

    const summary = await runReconciliation(baseEnv, 'manual');

    expect(summary.outcome).toBe('completed');
    expect(summary.selectedUsers).toBe(1);
    expect(summary.probes.probed).toBe(1);
    expect(summary.wouldInsertTotal).toBe(1);
    expect(summary.alreadyPresentTotal).toBe(0);

    // Lease taken and settled as an attempt-only probe, tagged 'scheduled'.
    expect(mockSyncState.acquireLease).toHaveBeenCalledWith('user_stale_1', 'espn', expect.any(String));
    expect(mockSyncState.settle).toHaveBeenCalledWith(
      'user_stale_1',
      'espn',
      expect.any(String),
      expect.objectContaining({ status: 'skipped', cooldownSeconds: 1, syncSource: 'scheduled' })
    );

    // Only league snapshot tables were read; the stub throws on any write.
    expect(new Set(supabaseStub.state.tablesQueried)).toEqual(new Set(['espn_leagues', 'sleeper_leagues']));

    // Snapshot scan is bounded to last + current season, not full history.
    expect(supabaseStub.state.gteCalls).toContainEqual({
      table: 'espn_leagues',
      column: 'season_year',
      value: PRIOR,
    });
  });

  it('skips a user whose provider lease is held and does not settle it', async () => {
    supabaseStub.state.rowsByTable = {
      espn_leagues: [
        { clerk_user_id: 'user_stale_1', sport: 'football', season_year: PRIOR, league_id: '123' },
      ],
      sleeper_leagues: [],
    };
    mockSyncState.acquireLease.mockResolvedValue({ acquired: false, state: 'in_progress', retryAfterSeconds: 30 });

    const summary = await runReconciliation(baseEnv, 'cron');

    expect(summary.probes.skippedLease).toBe(1);
    expect(summary.probes.probed).toBe(0);
    expect(mockSyncState.settle).not.toHaveBeenCalled();
    expect(discoverLeaguesV3).not.toHaveBeenCalled();
  });

  it('treats missing credentials as not_connected and isolates provider errors', async () => {
    supabaseStub.state.rowsByTable = {
      espn_leagues: [
        { clerk_user_id: 'user_stale_1', sport: 'football', season_year: PRIOR, league_id: '123' },
      ],
      sleeper_leagues: [
        { clerk_user_id: 'user_stale_1', sport: 'football', season_year: PRIOR, league_id: 'sl_old', recurring_league_id: null },
      ],
    };
    mockEspnStorage.getCredentials.mockResolvedValue(null);
    vi.mocked(fetchSleeperLeaguesReadOnly).mockResolvedValue({ status: 'error', errorCode: 'sleeper_unavailable' });

    const summary = await runReconciliation(baseEnv, 'cron');

    expect(summary.probes.notConnected).toBe(1);
    expect(summary.probes.errors).toBe(1);
    expect(summary.outcome).toBe('completed');
    // Both leases settled (released) despite neither probe succeeding.
    expect(mockSyncState.settle).toHaveBeenCalledTimes(2);
  });

  it('applies the upstream backoff cooldown when a provider rate-limits the probe', async () => {
    supabaseStub.state.rowsByTable = {
      espn_leagues: [],
      sleeper_leagues: [],
      yahoo_leagues: [
        { clerk_user_id: 'user_stale_1', sport: 'football', season_year: PRIOR, league_key: '449.l.888', recurring_league_id: null },
      ],
    };
    vi.mocked(fetchYahooLeaguesReadOnly).mockResolvedValue({
      status: 'error',
      errorCode: 'yahoo_api_temporarily_unavailable',
      httpStatus: 429,
      retryable: true,
      retryAfterSeconds: 600,
    });

    const summary = await runReconciliation(
      { ...baseEnv, RECONCILIATION_PROVIDERS: 'espn,yahoo,sleeper' },
      'cron'
    );

    expect(summary.probes.errors).toBe(1);
    expect(mockSyncState.settle).toHaveBeenCalledWith(
      'user_stale_1',
      'yahoo',
      expect.any(String),
      expect.objectContaining({ status: 'skipped', cooldownSeconds: 600, syncSource: 'scheduled' })
    );
  });

  it('applies the upstream backoff when ESPN or Sleeper rate-limit a probe', async () => {
    supabaseStub.state.rowsByTable = {
      espn_leagues: [
        { clerk_user_id: 'user_stale_1', sport: 'football', season_year: PRIOR, league_id: '123' },
      ],
      sleeper_leagues: [
        { clerk_user_id: 'user_stale_1', sport: 'football', season_year: PRIOR, league_id: 'sl_old', recurring_league_id: null },
      ],
    };
    mockEspnStorage.getCredentials.mockResolvedValue({ swid: '{swid}', s2: 's2' });
    vi.mocked(discoverLeaguesV3).mockRejectedValue(
      new AutomaticLeagueDiscoveryFailed('Fan API returned 429: Too Many Requests')
    );
    vi.mocked(fetchSleeperLeaguesReadOnly).mockResolvedValue({
      status: 'error',
      errorCode: 'sleeper_unavailable',
      httpStatus: 429,
    });

    const summary = await runReconciliation(baseEnv, 'cron');

    expect(summary.probes.errors).toBe(2);
    expect(mockSyncState.settle).toHaveBeenCalledWith(
      'user_stale_1',
      'espn',
      expect.any(String),
      expect.objectContaining({ status: 'skipped', cooldownSeconds: 300 })
    );
    expect(mockSyncState.settle).toHaveBeenCalledWith(
      'user_stale_1',
      'sleeper',
      expect.any(String),
      expect.objectContaining({ status: 'skipped', cooldownSeconds: 300 })
    );
  });

  it('isolates an unexpectedly throwing candidate without abandoning the batch', async () => {
    supabaseStub.state.rowsByTable = {
      espn_leagues: [
        { clerk_user_id: 'user_stale_1', sport: 'football', season_year: PRIOR, league_id: '1' },
        { clerk_user_id: 'user_stale_2', sport: 'football', season_year: PRIOR, league_id: '2' },
      ],
      sleeper_leagues: [],
    };
    mockEspnStorage.getCredentials.mockResolvedValue({ swid: '{swid}', s2: 's2' });
    vi.mocked(discoverLeaguesV3).mockResolvedValue([]);
    // settle throwing is outside the probe's own error handling.
    mockSyncState.settle
      .mockRejectedValueOnce(new Error('storage exploded'))
      .mockResolvedValue(undefined);

    const summary = await runReconciliation(
      { ...baseEnv, RECONCILIATION_BATCH_SIZE: '1' },
      'cron'
    );

    expect(summary.outcome).toBe('completed');
    expect(summary.probes.errors).toBe(1);
    expect(summary.probes.probed).toBe(1);
  });

  it('surfaces Sleeper partial per-sport failures in the probe log', async () => {
    const B_CURRENT = getDefaultSeasonYear('basketball');
    supabaseStub.state.rowsByTable = {
      sleeper_leagues: [
        { clerk_user_id: 'user_stale_1', sport: 'football', season_year: PRIOR, league_id: 'sl_f', recurring_league_id: null },
        { clerk_user_id: 'user_stale_1', sport: 'basketball', season_year: B_CURRENT - 1, league_id: 'sl_b', recurring_league_id: null },
      ],
    };
    vi.mocked(fetchSleeperLeaguesReadOnly).mockResolvedValue({
      status: 'ok',
      leagues: [],
      failedSports: ['nba'],
    });
    const logSpy = vi.spyOn(console, 'log');

    const summary = await runReconciliation(
      { ...baseEnv, RECONCILIATION_PROVIDERS: 'sleeper', RECONCILIATION_SPORTS: 'football,basketball' },
      'cron'
    );

    expect(summary.probes.probed).toBe(1);
    const probeLine = logSpy.mock.calls
      .map((call) => String(call[0]))
      .find((line) => line.includes('"status":"probed"'));
    expect(probeLine).toContain('"partial_failure_sports":["basketball"]');
  });

  it('marks remaining candidates skipped_budget once the time budget is spent', async () => {
    vi.useFakeTimers();
    supabaseStub.state.rowsByTable = {
      espn_leagues: [
        { clerk_user_id: 'user_stale_1', sport: 'football', season_year: PRIOR, league_id: '1' },
        { clerk_user_id: 'user_stale_2', sport: 'football', season_year: PRIOR, league_id: '2' },
      ],
      sleeper_leagues: [],
    };
    mockEspnStorage.getCredentials.mockResolvedValue({ swid: '{swid}', s2: 's2' });
    vi.mocked(discoverLeaguesV3).mockImplementation(async () => {
      vi.advanceTimersByTime(10_000);
      return [];
    });

    const summary = await runReconciliation(
      { ...baseEnv, RECONCILIATION_TIMEOUT_BUDGET_MS: '5000', RECONCILIATION_BATCH_SIZE: '1' },
      'cron'
    );

    expect(summary.probes.probed).toBe(1);
    expect(summary.probes.skippedBudget).toBe(1);
    expect(summary.outcome).toBe('budget_exhausted');
  });
});
