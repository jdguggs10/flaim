import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import {
  loadSleeperLeagueOwnership,
  resolveSleeperPlayerLeagueAvailability,
} from '../sleeper-league-ownership';

const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
global.fetch = mockFetch;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('loadSleeperLeagueOwnership / resolveSleeperPlayerLeagueAvailability', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('resolves a rostered player with team and owner names', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([
        { roster_id: 5, owner_id: 'owner_5', players: ['101', '102'], starters: [], reserve: null, taxi: null, settings: {} },
      ]))
      .mockResolvedValueOnce(jsonResponse([
        { user_id: 'owner_5', display_name: 'Gerry', avatar: null, metadata: { team_name: 'The Flaimers' } },
      ]));

    const context = await loadSleeperLeagueOwnership('league_1');
    const result = resolveSleeperPlayerLeagueAvailability('101', context);

    expect(result).toEqual({
      league_status: 'ROSTERED',
      league_team_id: '5',
      league_team_name: 'The Flaimers',
      league_owner_name: 'Gerry',
    });
  });

  it('resolves an unrostered player as AVAILABLE/FREE_AGENT with null league fields', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([
        { roster_id: 5, owner_id: 'owner_5', players: ['101'], starters: [], reserve: null, taxi: null, settings: {} },
      ]))
      .mockResolvedValueOnce(jsonResponse([
        { user_id: 'owner_5', display_name: 'Gerry', avatar: null },
      ]));

    const context = await loadSleeperLeagueOwnership('league_1');
    const result = resolveSleeperPlayerLeagueAvailability('999-not-rostered', context);

    expect(result).toEqual({
      league_status: 'FREE_AGENT',
      league_team_id: null,
      league_team_name: null,
      league_owner_name: null,
    });
  });

  it('keeps two leagues fully isolated — the same player_id rostered in one is absent in the other', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([
        { roster_id: 1, owner_id: 'owner_a', players: ['shared_player'], starters: [], reserve: null, taxi: null, settings: {} },
      ]))
      .mockResolvedValueOnce(jsonResponse([
        { user_id: 'owner_a', display_name: 'Alpha', avatar: null },
      ]));
    const leagueA = await loadSleeperLeagueOwnership('league_a');

    mockFetch
      .mockResolvedValueOnce(jsonResponse([
        { roster_id: 1, owner_id: 'owner_b', players: [], starters: [], reserve: null, taxi: null, settings: {} },
      ]))
      .mockResolvedValueOnce(jsonResponse([
        { user_id: 'owner_b', display_name: 'Bravo', avatar: null },
      ]));
    const leagueB = await loadSleeperLeagueOwnership('league_b');

    expect(resolveSleeperPlayerLeagueAvailability('shared_player', leagueA).league_status).toBe('ROSTERED');
    expect(resolveSleeperPlayerLeagueAvailability('shared_player', leagueB).league_status).toBe('FREE_AGENT');
  });

  it('resolves a rostered player with null team/owner names when owner_id has no matching user (deliberate, not a bug)', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([
        { roster_id: 7, owner_id: 'orphan_owner', players: ['201'], starters: [], reserve: null, taxi: null, settings: {} },
      ]))
      .mockResolvedValueOnce(jsonResponse([
        { user_id: 'someone_else', display_name: 'Someone Else', avatar: null },
      ]));

    const context = await loadSleeperLeagueOwnership('league_1');
    const result = resolveSleeperPlayerLeagueAvailability('201', context);

    expect(result.league_status).toBe('ROSTERED');
    expect(result.league_team_id).toBe('7');
    expect(result.league_team_name).toBeNull();
    expect(result.league_owner_name).toBeNull();
  });

  it('lets the first roster win deterministically when a player_id appears on more than one roster', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([
        { roster_id: 1, owner_id: 'owner_first', players: ['dupe'], starters: [], reserve: null, taxi: null, settings: {} },
        { roster_id: 2, owner_id: 'owner_second', players: ['dupe'], starters: [], reserve: null, taxi: null, settings: {} },
      ]))
      .mockResolvedValueOnce(jsonResponse([
        { user_id: 'owner_first', display_name: 'First', avatar: null },
        { user_id: 'owner_second', display_name: 'Second', avatar: null },
      ]));

    const context = await loadSleeperLeagueOwnership('league_1');
    const result = resolveSleeperPlayerLeagueAvailability('dupe', context);

    expect(result.league_team_id).toBe('1');
    expect(result.league_owner_name).toBe('First');
  });

  it('propagates a Sleeper error when the rosters fetch fails', async () => {
    mockFetch.mockResolvedValueOnce(new Response(null, { status: 429 }));

    await expect(loadSleeperLeagueOwnership('league_1')).rejects.toThrow('SLEEPER_RATE_LIMIT');
  });

  it('fails closed when a 200 rosters response body is an empty array (the exact fail-open trap)', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]));

    await expect(loadSleeperLeagueOwnership('league_1')).rejects.toThrow('SLEEPER_API_ERROR');
  });

  it('fails closed when the users response body is not an array', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([
        { roster_id: 5, owner_id: 'owner_5', players: ['101'], starters: [], reserve: null, taxi: null, settings: {} },
      ]))
      .mockResolvedValueOnce(jsonResponse({ not: 'an array' }));

    await expect(loadSleeperLeagueOwnership('league_1')).rejects.toThrow('SLEEPER_API_ERROR');
  });

  it('resolves a genuine pre-draft league (non-empty rosters, every players field null) as FREE_AGENT rather than erroring', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([
        { roster_id: 1, owner_id: 'owner_1', players: null, starters: null, reserve: null, taxi: null, settings: {} },
        { roster_id: 2, owner_id: 'owner_2', players: null, starters: null, reserve: null, taxi: null, settings: {} },
      ]))
      .mockResolvedValueOnce(jsonResponse([
        { user_id: 'owner_1', display_name: 'One', avatar: null },
        { user_id: 'owner_2', display_name: 'Two', avatar: null },
      ]));

    const context = await loadSleeperLeagueOwnership('league_1');
    const result = resolveSleeperPlayerLeagueAvailability('101', context);

    expect(result.league_status).toBe('FREE_AGENT');
  });

  it('resolves a populated roster correctly when it coexists with a roster whose players is null', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([
        { roster_id: 1, owner_id: 'owner_1', players: null, starters: null, reserve: null, taxi: null, settings: {} },
        { roster_id: 2, owner_id: 'owner_2', players: ['101'], starters: [], reserve: null, taxi: null, settings: {} },
      ]))
      .mockResolvedValueOnce(jsonResponse([
        { user_id: 'owner_1', display_name: 'One', avatar: null },
        { user_id: 'owner_2', display_name: 'Two', avatar: null },
      ]));

    const context = await loadSleeperLeagueOwnership('league_1');

    const rostered = resolveSleeperPlayerLeagueAvailability('101', context);
    expect(rostered.league_status).toBe('ROSTERED');
    expect(rostered.league_team_id).toBe('2');

    const stillFree = resolveSleeperPlayerLeagueAvailability('999', context);
    expect(stillFree.league_status).toBe('FREE_AGENT');
  });

  it('normalizes player ids on both the write and read side (numeric or whitespace-padded ids still match)', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([
        { roster_id: 5, owner_id: 'owner_5', players: [101, ' 202 '], starters: [], reserve: null, taxi: null, settings: {} },
      ]))
      .mockResolvedValueOnce(jsonResponse([
        { user_id: 'owner_5', display_name: 'Gerry', avatar: null },
      ]));

    const context = await loadSleeperLeagueOwnership('league_1');

    expect(resolveSleeperPlayerLeagueAvailability('101', context).league_status).toBe('ROSTERED');
    expect(resolveSleeperPlayerLeagueAvailability(' 101 ', context).league_status).toBe('ROSTERED');
    expect(resolveSleeperPlayerLeagueAvailability('202', context).league_status).toBe('ROSTERED');
  });
});
