import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsageStorage, type UsageEvent } from '../usage-storage';

const insertPayloads: Record<string, unknown>[] = [];
const mockInsert = vi.fn((payload: Record<string, unknown>) => {
  insertPayloads.push(payload);
  return Promise.resolve({ data: null, error: null });
});
const mockFrom = vi.fn(() => ({ insert: mockInsert }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: mockFrom }),
}));

const baseEvent: UsageEvent = {
  env: 'prod',
  user_id: 'user_123',
  auth_type: 'oauth',
  client_name: 'ChatGPT',
  tool_name: 'get_players',
  platform: 'espn',
  sport: 'baseball',
  status: 'ok',
  error_code: null,
  latency_ms: 123,
  league_hash: 'abc123',
  correlation_id: 'corr-xyz',
};

describe('UsageStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertPayloads.length = 0;
  });

  it('inserts into mcp_tool_events with the event fields', async () => {
    const storage = UsageStorage.fromEnvironment({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_KEY: 'test-key',
    });
    const { error } = await storage.insertEvent(baseEvent);

    expect(error).toBeNull();
    expect(mockFrom).toHaveBeenCalledWith('mcp_tool_events');
    expect(insertPayloads).toHaveLength(1);
    expect(insertPayloads[0]).toMatchObject({
      env: 'prod',
      user_id: 'user_123',
      auth_type: 'oauth',
      client_name: 'ChatGPT',
      tool_name: 'get_players',
      platform: 'espn',
      sport: 'baseball',
      status: 'ok',
      error_code: null,
      latency_ms: 123,
      league_hash: 'abc123',
    });
  });

  it('does NOT insert correlation_id (no column on the table)', async () => {
    const storage = UsageStorage.fromEnvironment({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_KEY: 'test-key',
    });
    await storage.insertEvent(baseEvent);

    expect(insertPayloads[0]).not.toHaveProperty('correlation_id');
  });

  it('does NOT insert ts (let DB default it)', async () => {
    const storage = UsageStorage.fromEnvironment({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_KEY: 'test-key',
    });
    await storage.insertEvent(baseEvent);

    expect(insertPayloads[0]).not.toHaveProperty('ts');
  });

  it('defaults nullable fields to null when omitted', async () => {
    const storage = UsageStorage.fromEnvironment({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_KEY: 'test-key',
    });
    await storage.insertEvent({
      env: 'prod',
      user_id: 'user_123',
      auth_type: 'clerk',
      tool_name: 'get_players',
      status: 'ok',
    });

    expect(insertPayloads[0]).toMatchObject({
      client_name: null,
      platform: null,
      sport: null,
      error_code: null,
      latency_ms: null,
      league_hash: null,
    });
  });

  it('returns the storage error without throwing', async () => {
    const dbError = { message: 'insert failed' };
    mockInsert.mockResolvedValueOnce({ data: null, error: dbError } as never);

    const storage = UsageStorage.fromEnvironment({
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_KEY: 'test-key',
    });
    const { error } = await storage.insertEvent(baseEvent);

    expect(error).toBe(dbError);
  });
});
