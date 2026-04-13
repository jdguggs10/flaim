import { describe, expect, it, vi } from 'vitest';
import { clearDefaultsForLeague, clearDefaultsForPlatform } from '../preference-defaults';

function createSupabaseMock(preferences: Record<string, unknown> | null) {
  const mockUpsert = vi.fn().mockReturnValue({ error: null });
  const maybeSingle = vi.fn().mockResolvedValue({ data: preferences, error: null });
  const eq = vi.fn();
  eq.mockReturnValue({ maybeSingle });

  const supabase = {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({ eq }),
      upsert: mockUpsert,
    }),
  };

  return { supabase, mockUpsert };
}

describe('preference-defaults', () => {
  it('clearDefaultsForLeague clears only the requested sport column when sport is provided', async () => {
    const { supabase, mockUpsert } = createSupabaseMock({
      default_football: { platform: 'espn', leagueId: '123', seasonYear: 2025 },
      default_baseball: { platform: 'espn', leagueId: '123', seasonYear: 2026 },
      default_basketball: null,
      default_hockey: null,
    });

    const result = await clearDefaultsForLeague(supabase as any, 'user_123', 'espn', '123', undefined, 'football');

    expect(result).toEqual({ skipped: false });
    expect(mockUpsert).toHaveBeenCalledOnce();
    const upsertArg = mockUpsert.mock.calls[0][0];
    expect(upsertArg.default_football).toBeNull();
    expect(upsertArg).not.toHaveProperty('default_baseball');
  });

  it('clearDefaultsForPlatform clears every matching platform default and preserves other platforms', async () => {
    const { supabase, mockUpsert } = createSupabaseMock({
      default_football: { platform: 'yahoo', leagueId: 'nfl.l.1', seasonYear: 2025 },
      default_baseball: { platform: 'yahoo', leagueId: 'mlb.l.2', seasonYear: 2025 },
      default_basketball: { platform: 'espn', leagueId: '999', seasonYear: 2025 },
      default_hockey: null,
    });

    const result = await clearDefaultsForPlatform(supabase as any, 'user_123', 'yahoo');

    expect(result).toEqual({ skipped: false });
    expect(mockUpsert).toHaveBeenCalledOnce();
    const upsertArg = mockUpsert.mock.calls[0][0];
    expect(upsertArg.default_football).toBeNull();
    expect(upsertArg.default_baseball).toBeNull();
    expect(upsertArg).not.toHaveProperty('default_basketball');
  });
});
