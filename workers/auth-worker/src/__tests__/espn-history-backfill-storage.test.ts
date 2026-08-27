import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockSupabase = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabase),
}));

import { EspnHistoryJobStorage, type EspnHistoryJob } from '../espn-history';

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_KEY: 'test-key',
};

function scheduledJob(): EspnHistoryJob {
  return {
    id: 'job-123',
    clerk_user_id: 'user-123',
    status: 'queued',
    workflow_instance_id: null,
    credential_updated_at: '2026-08-27T12:00:00.000Z',
    scan_version: 1,
    mode: 'full',
    trigger_source: 'scheduled_backfill',
    current_leagues: [{
      gameId: 'flb',
      leagueId: '123',
      leagueName: 'Baseball',
      seasonId: 2026,
      teamId: 4,
      teamName: 'Team',
    }],
    plan: [],
    cursor: 0,
    planned_count: 0,
    completed_count: 0,
    skipped_count: 0,
    failed_count: 0,
    failures: [],
    last_error_code: null,
    last_error_message: null,
    started_at: null,
    finished_at: null,
    created_at: '2026-08-27T12:00:00.000Z',
    updated_at: '2026-08-27T12:00:00.000Z',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EspnHistoryJobStorage.claimNextBackfill', () => {
  it('preserves only the claim RPC diagnostic code and message', async () => {
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find claim_next_espn_history_backfill_job',
        details: '{"clerk_user_id":"user_private"}',
        hint: 'Reload the schema cache',
      },
    });
    const storage = EspnHistoryJobStorage.fromEnvironment(env);

    await expect(storage.claimNextBackfill(
      '2026-08-27T12:00:00.000Z',
      null
    )).rejects.toMatchObject({
      code: 'PGRST202',
      message: 'Could not find claim_next_espn_history_backfill_job',
    });

    try {
      await storage.claimNextBackfill('2026-08-27T12:00:00.000Z', null);
    } catch (error) {
      expect(error).not.toHaveProperty('details');
      expect(error).not.toHaveProperty('hint');
    }
  });

  it.each(['none', 'busy', 'lease_busy'])('treats %s as an idle claim', async (outcome) => {
    mockSupabase.rpc.mockResolvedValue({ data: [{ outcome, job_id: null }], error: null });
    const storage = EspnHistoryJobStorage.fromEnvironment(env);

    await expect(storage.claimNextBackfill(
      '2026-08-27T12:00:00.000Z',
      ['user-123']
    )).resolves.toBeNull();
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('validates the exact scheduled job identity returned atomically by a claim', async () => {
    const job = scheduledJob();
    mockSupabase.rpc.mockResolvedValue({
      data: [{
        outcome: 'claimed',
        job_id: job.id,
        clerk_user_id: job.clerk_user_id,
        current_leagues: job.current_leagues,
      }],
      error: null,
    });
    const storage = EspnHistoryJobStorage.fromEnvironment(env);

    await expect(storage.claimNextBackfill(
      '2026-08-27T12:00:00.000Z',
      null
    )).resolves.toEqual({
      id: job.id,
      clerk_user_id: job.clerk_user_id,
      workflow_instance_id: null,
    });
    expect(mockSupabase.rpc).toHaveBeenCalledWith('claim_next_espn_history_backfill_job', {
      p_scan_version: 1,
      p_legacy_cutoff: '2026-08-27T12:00:00.000Z',
      p_allowed_users: null,
    });
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });

  it('fails closed for an invalid claim response or empty job roots', async () => {
    const storage = EspnHistoryJobStorage.fromEnvironment(env);
    mockSupabase.rpc.mockResolvedValue({ data: [{ outcome: 'claimed', job_id: null }], error: null });
    await expect(storage.claimNextBackfill(
      '2026-08-27T12:00:00.000Z',
      null
    )).rejects.toThrow('claim refused');

    const empty = { ...scheduledJob(), current_leagues: [] };
    mockSupabase.rpc.mockResolvedValue({
      data: [{
        outcome: 'claimed',
        job_id: empty.id,
        clerk_user_id: empty.clerk_user_id,
        current_leagues: empty.current_leagues,
      }],
      error: null,
    });
    await expect(storage.claimNextBackfill(
      '2026-08-27T12:00:00.000Z',
      null
    )).rejects.toThrow('claim refused');
  });
});
