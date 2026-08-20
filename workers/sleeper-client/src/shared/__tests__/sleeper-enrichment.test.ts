import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import {
  buildUserDirectory,
  loadSleeperPlayersIndexForEnrichment,
  resolveSleeperPlayerEntries,
  SLEEPER_PLAYER_ENRICHMENT_WARNING,
} from '../sleeper-enrichment';
import { getSleeperPlayersIndex, type SleeperPlayerRecord } from '../sleeper-players-cache';
import type { Env, SleeperLeagueUser } from '../../types';

vi.mock('../sleeper-players-cache', async () => {
  const actual = await vi.importActual<typeof import('../sleeper-players-cache')>('../sleeper-players-cache');
  return {
    ...actual,
    getSleeperPlayersIndex: vi.fn(),
  };
});

function player(overrides: Partial<SleeperPlayerRecord> & { player_id: string; full_name: string }): SleeperPlayerRecord {
  return { active: true, ...overrides };
}

describe('buildUserDirectory', () => {
  it('maps display name and manager-set team name', () => {
    const users: SleeperLeagueUser[] = [
      { user_id: 'u1', display_name: 'Alice', avatar: null, metadata: { team_name: 'The Waiver Wire Wizards' } },
    ];

    const directory = buildUserDirectory(users);

    expect(directory.get('u1')).toEqual({ displayName: 'Alice', teamName: 'The Waiver Wire Wizards' });
  });

  it("falls back to Sleeper's default 'Team <display name>' when metadata is absent", () => {
    const users: SleeperLeagueUser[] = [{ user_id: 'u1', display_name: 'ProGunn', avatar: null }];

    const directory = buildUserDirectory(users);

    // This is exactly what Sleeper's own app shows league members for an unset team name.
    expect(directory.get('u1')).toEqual({ displayName: 'ProGunn', teamName: 'Team ProGunn' });
  });

  it("falls back to Sleeper's default for an empty or whitespace-only team_name", () => {
    const users: SleeperLeagueUser[] = [
      { user_id: 'u1', display_name: 'Alice', avatar: null, metadata: { team_name: '' } },
      { user_id: 'u2', display_name: 'Bob', avatar: null, metadata: { team_name: '   ' } },
    ];

    const directory = buildUserDirectory(users);

    expect(directory.get('u1')?.teamName).toBe('Team Alice');
    expect(directory.get('u2')?.teamName).toBe('Team Bob');
  });

  it("falls back to Sleeper's default for a non-string metadata.team_name", () => {
    const users: SleeperLeagueUser[] = [
      { user_id: 'u1', display_name: 'Alice', avatar: null, metadata: { team_name: 12345 as unknown as string } },
    ];

    const directory = buildUserDirectory(users);

    expect(directory.get('u1')?.teamName).toBe('Team Alice');
  });

  it('trims a padded manager-set team name instead of falling back', () => {
    const users: SleeperLeagueUser[] = [
      { user_id: 'u1', display_name: 'Alice', avatar: null, metadata: { team_name: '  Padded Wizards  ' } },
    ];

    const directory = buildUserDirectory(users);

    expect(directory.get('u1')).toEqual({ displayName: 'Alice', teamName: 'Padded Wizards' });
  });
});

describe('resolveSleeperPlayerEntries', () => {
  it('marks Sleeper\'s "0" empty-lineup-slot sentinel without a lookup', () => {
    const index = new Map<string, SleeperPlayerRecord>([
      ['0', player({ player_id: '0', full_name: 'Should never be used' })],
    ]);

    const entries = resolveSleeperPlayerEntries(['0'], index);

    expect(entries).toEqual([{ id: '0', empty: true }]);
  });

  it('enriches an index hit with name, position, and team', () => {
    const index = new Map<string, SleeperPlayerRecord>([
      ['p1', player({ player_id: 'p1', full_name: 'Player One', position: 'RB', team: 'BUF' })],
    ]);

    const entries = resolveSleeperPlayerEntries(['p1'], index);

    expect(entries).toEqual([{ id: 'p1', name: 'Player One', position: 'RB', team: 'BUF' }]);
  });

  it('enriches a DEF entry keyed by team abbreviation', () => {
    const index = new Map<string, SleeperPlayerRecord>([
      ['SF', player({ player_id: 'SF', full_name: 'San Francisco 49ers', position: 'DEF', team: 'SF' })],
    ]);

    const entries = resolveSleeperPlayerEntries(['SF'], index);

    expect(entries).toEqual([{ id: 'SF', name: 'San Francisco 49ers', position: 'DEF', team: 'SF' }]);
  });

  it('omits team when the record has none', () => {
    const index = new Map<string, SleeperPlayerRecord>([
      ['p1', player({ player_id: 'p1', full_name: 'Free Agent Guy', position: 'QB' })],
    ]);

    const entries = resolveSleeperPlayerEntries(['p1'], index);

    expect(entries).toEqual([{ id: 'p1', name: 'Free Agent Guy', position: 'QB', team: undefined }]);
    expect(entries[0].team).toBeUndefined();
  });

  it('omits team entirely when includeTeam is false, even for an index hit with a team', () => {
    // Historical/past-week snapshots must not show a player's CURRENT club —
    // the player index only tracks current team, not team-as-of-that-week.
    const index = new Map<string, SleeperPlayerRecord>([
      ['p1', player({ player_id: 'p1', full_name: 'Player One', position: 'RB', team: 'BUF' })],
    ]);

    const entries = resolveSleeperPlayerEntries(['p1'], index, { includeTeam: false });

    expect(entries).toEqual([{ id: 'p1', name: 'Player One', position: 'RB' }]);
    expect(entries[0]).not.toHaveProperty('team');
  });

  it('includeTeam: false does not affect the "0" sentinel or unknown-id entries', () => {
    const index = new Map<string, SleeperPlayerRecord>([
      ['p1', player({ player_id: 'p1', full_name: 'Player One', team: 'BUF' })],
    ]);

    const entries = resolveSleeperPlayerEntries(['0', 'p1', 'unknown'], index, { includeTeam: false });

    expect(entries[0]).toEqual({ id: '0', empty: true });
    expect(entries[1]).toEqual({ id: 'p1', name: 'Player One', position: undefined });
    expect(entries[2]).toEqual({ id: 'unknown' });
  });

  it('returns an id-only entry for an unknown id without throwing', () => {
    const entries = resolveSleeperPlayerEntries(['ghost123'], new Map());

    expect(entries).toEqual([{ id: 'ghost123' }]);
  });

  it('preserves order and length across a mixed list', () => {
    const index = new Map<string, SleeperPlayerRecord>([
      ['p1', player({ player_id: 'p1', full_name: 'Player One', position: 'RB', team: 'BUF' })],
    ]);

    const entries = resolveSleeperPlayerEntries(['0', 'p1', 'unknown'], index);

    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.id)).toEqual(['0', 'p1', 'unknown']);
    expect(entries[0]).toEqual({ id: '0', empty: true });
    expect(entries[1]).toMatchObject({ id: 'p1', name: 'Player One' });
    expect(entries[2]).toEqual({ id: 'unknown' });
  });

  it('returns an empty array for an empty id list', () => {
    expect(resolveSleeperPlayerEntries([], new Map())).toEqual([]);
  });
});

describe('loadSleeperPlayersIndexForEnrichment', () => {
  const getPlayersIndexMock = getSleeperPlayersIndex as MockedFunction<typeof getSleeperPlayersIndex>;

  beforeEach(() => {
    getPlayersIndexMock.mockReset();
  });

  it('returns the index with no warnings on success', async () => {
    const index = new Map<string, SleeperPlayerRecord>([
      ['p1', player({ player_id: 'p1', full_name: 'Player One' })],
    ]);
    getPlayersIndexMock.mockResolvedValueOnce(index);

    const env = { SLEEPER_PLAYERS_CACHE: {} } as unknown as Env;
    const result = await loadSleeperPlayersIndexForEnrichment(env, 'football', 'test-context');

    expect(result.index).toBe(index);
    expect(result.warnings).toEqual([]);
    expect(getPlayersIndexMock).toHaveBeenCalledWith(env, 'football');
  });

  it('degrades to an empty index plus a warning when the index throws', async () => {
    getPlayersIndexMock.mockRejectedValueOnce(new Error('cache unavailable'));
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const env = {} as unknown as Env;
    const result = await loadSleeperPlayersIndexForEnrichment(env, 'basketball', 'test-context');

    expect(result.index.size).toBe(0);
    expect(result.warnings).toEqual([SLEEPER_PLAYER_ENRICHMENT_WARNING]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('[test-context]'),
      expect.any(Error),
    );

    consoleErrorSpy.mockRestore();
  });

  it('treats a resolved-but-empty index as degraded (adds the warning instead of silently enriching nothing)', async () => {
    getPlayersIndexMock.mockResolvedValueOnce(new Map());
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const env = {} as unknown as Env;
    const result = await loadSleeperPlayersIndexForEnrichment(env, 'football', 'test-context');

    expect(result.index.size).toBe(0);
    expect(result.warnings).toEqual([SLEEPER_PLAYER_ENRICHMENT_WARNING]);
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
