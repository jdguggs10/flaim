import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { EspnSupabaseStorage } from '../supabase-storage';

const mockFrom = vi.fn();
const mockDelete = vi.fn();
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockMaybeSingle = vi.fn();
const mockUpsert = vi.fn();

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: mockFrom,
  }),
}));

describe('EspnSupabaseStorage', () => {
  let storage: EspnSupabaseStorage;

  beforeEach(() => {
    storage = new EspnSupabaseStorage({
      supabaseUrl: 'https://example.supabase.co',
      supabaseKey: 'test-key',
    });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('removeLeague clears only the deleted sport default when league ids collide across sports', async () => {
    const mockPrefsUpsert = vi.fn().mockReturnValue({ error: null });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'espn_leagues') {
        const eqFn = vi.fn();
        const selectFn = vi.fn().mockResolvedValue({
          data: [{ id: 'row-1', league_id: '123', sport: 'football', season_year: 2025 }],
          error: null,
        });
        eqFn.mockReturnValue({ eq: eqFn, select: selectFn });
        return { delete: mockDelete.mockReturnValue({ eq: eqFn }) };
      }

      if (table === 'user_preferences') {
        const prefEq = vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              default_football: { platform: 'espn', leagueId: '123', seasonYear: 2025 },
              default_baseball: { platform: 'espn', leagueId: '123', seasonYear: 2026 },
              default_basketball: null,
              default_hockey: null,
            },
            error: null,
          }),
        });
        return {
          select: mockSelect.mockReturnValue({ eq: prefEq }),
          upsert: mockPrefsUpsert,
        };
      }

      return {};
    });

    const result = await storage.removeLeague('user_123', '123', 'football');

    expect(result).toBe(true);
    expect(mockPrefsUpsert).toHaveBeenCalledOnce();
    const upsertArg = mockPrefsUpsert.mock.calls[0][0];
    expect(upsertArg.default_football).toBeNull();
    expect(upsertArg).not.toHaveProperty('default_baseball');
  });
});
