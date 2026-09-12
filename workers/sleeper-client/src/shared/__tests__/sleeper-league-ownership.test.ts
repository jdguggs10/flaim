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

/**
 * URL-routed (not positional) so these tests can't pass "for the wrong
 * reason": each response is tied to the actual Sleeper path it belongs to,
 * regardless of what order loadSleeperLeagueOwnership's Promise.all fires
 * them in. Patterns are checked in the order given, so the more specific
 * `/rosters` and `/users` suffixes must be listed before the bare
 * `/league/{id}` league-status route — otherwise the bare route (a substring
 * of both) would swallow them. An unmocked URL rejects loudly instead of
 * silently consuming whatever response happened to be queued next.
 */
function mockLeagueFetch(
  leagueId: string,
  routes: { rosters?: () => Response; users?: () => Response; league?: () => Response },
) {
  const ordered: [string, () => Response][] = [];
  if (routes.rosters) ordered.push([`/league/${leagueId}/rosters`, routes.rosters]);
  if (routes.users) ordered.push([`/league/${leagueId}/users`, routes.users]);
  if (routes.league) ordered.push([`/league/${leagueId}`, routes.league]);
  mockFetch.mockImplementation((input) => {
    const url = String(input);
    const route = ordered.find(([pattern]) => url.includes(pattern));
    if (!route) return Promise.reject(new Error(`unmocked fetch: ${url}`));
    return Promise.resolve(route[1]());
  });
}

const inSeasonLeague = () => jsonResponse({ status: 'in_season' });

describe('loadSleeperLeagueOwnership / resolveSleeperPlayerLeagueAvailability', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('resolves a rostered player with team and owner names', async () => {
    mockLeagueFetch('league_1', {
      rosters: () => jsonResponse([
        { roster_id: 5, owner_id: 'owner_5', players: ['101', '102'], starters: [], reserve: null, taxi: null, settings: {} },
      ]),
      users: () => jsonResponse([
        { user_id: 'owner_5', display_name: 'Gerry', avatar: null, metadata: { team_name: 'The Flaimers' } },
      ]),
      league: inSeasonLeague,
    });

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
    mockLeagueFetch('league_1', {
      rosters: () => jsonResponse([
        { roster_id: 5, owner_id: 'owner_5', players: ['101'], starters: [], reserve: null, taxi: null, settings: {} },
      ]),
      users: () => jsonResponse([
        { user_id: 'owner_5', display_name: 'Gerry', avatar: null },
      ]),
      league: inSeasonLeague,
    });

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
    mockLeagueFetch('league_a', {
      rosters: () => jsonResponse([
        { roster_id: 1, owner_id: 'owner_a', players: ['shared_player'], starters: [], reserve: null, taxi: null, settings: {} },
      ]),
      users: () => jsonResponse([
        { user_id: 'owner_a', display_name: 'Alpha', avatar: null },
      ]),
      league: inSeasonLeague,
    });
    const leagueA = await loadSleeperLeagueOwnership('league_a');

    mockLeagueFetch('league_b', {
      rosters: () => jsonResponse([
        { roster_id: 1, owner_id: 'owner_b', players: [], starters: [], reserve: null, taxi: null, settings: {} },
      ]),
      users: () => jsonResponse([
        { user_id: 'owner_b', display_name: 'Bravo', avatar: null },
      ]),
      league: inSeasonLeague,
    });
    const leagueB = await loadSleeperLeagueOwnership('league_b');

    expect(resolveSleeperPlayerLeagueAvailability('shared_player', leagueA).league_status).toBe('ROSTERED');
    expect(resolveSleeperPlayerLeagueAvailability('shared_player', leagueB).league_status).toBe('FREE_AGENT');
  });

  it('resolves a rostered player with null team/owner names when owner_id has no matching user (deliberate, not a bug)', async () => {
    mockLeagueFetch('league_1', {
      rosters: () => jsonResponse([
        { roster_id: 7, owner_id: 'orphan_owner', players: ['201'], starters: [], reserve: null, taxi: null, settings: {} },
      ]),
      users: () => jsonResponse([
        { user_id: 'someone_else', display_name: 'Someone Else', avatar: null },
      ]),
      league: inSeasonLeague,
    });

    const context = await loadSleeperLeagueOwnership('league_1');
    const result = resolveSleeperPlayerLeagueAvailability('201', context);

    expect(result.league_status).toBe('ROSTERED');
    expect(result.league_team_id).toBe('7');
    expect(result.league_team_name).toBeNull();
    expect(result.league_owner_name).toBeNull();
  });

  it('resolves league_status: null with every team/owner field null when a player_id appears on two different rosters (ambiguous, not guessed)', async () => {
    mockLeagueFetch('league_1', {
      rosters: () => jsonResponse([
        { roster_id: 1, owner_id: 'owner_first', players: ['dupe'], starters: [], reserve: null, taxi: null, settings: {} },
        { roster_id: 2, owner_id: 'owner_second', players: ['dupe'], starters: [], reserve: null, taxi: null, settings: {} },
      ]),
      users: () => jsonResponse([
        { user_id: 'owner_first', display_name: 'First', avatar: null },
        { user_id: 'owner_second', display_name: 'Second', avatar: null },
      ]),
      league: inSeasonLeague,
    });

    const context = await loadSleeperLeagueOwnership('league_1');
    const result = resolveSleeperPlayerLeagueAvailability('dupe', context);

    expect(result).toEqual({
      league_status: null,
      league_team_id: null,
      league_team_name: null,
      league_owner_name: null,
    });
  });

  it('is not thrown off by a duplicate id within the SAME roster (not a conflict)', async () => {
    mockLeagueFetch('league_1', {
      rosters: () => jsonResponse([
        { roster_id: 1, owner_id: 'owner_1', players: ['101', '101'], starters: [], reserve: null, taxi: null, settings: {} },
      ]),
      users: () => jsonResponse([
        { user_id: 'owner_1', display_name: 'One', avatar: null },
      ]),
      league: inSeasonLeague,
    });

    const context = await loadSleeperLeagueOwnership('league_1');
    const result = resolveSleeperPlayerLeagueAvailability('101', context);

    expect(result.league_status).toBe('ROSTERED');
    expect(result.league_team_id).toBe('1');
  });

  it('propagates a Sleeper error when the rosters fetch fails', async () => {
    mockLeagueFetch('league_1', {
      rosters: () => new Response(null, { status: 429 }),
      users: () => jsonResponse([]),
      league: inSeasonLeague,
    });

    await expect(loadSleeperLeagueOwnership('league_1')).rejects.toThrow('SLEEPER_RATE_LIMIT');
  });

  it('fails closed when a 200 rosters response body is an empty array (the exact fail-open trap)', async () => {
    mockLeagueFetch('league_1', {
      rosters: () => jsonResponse([]),
      users: () => jsonResponse([]),
      league: inSeasonLeague,
    });

    await expect(loadSleeperLeagueOwnership('league_1')).rejects.toThrow('SLEEPER_API_ERROR');
  });

  it('fails closed when the users response body is not an array', async () => {
    mockLeagueFetch('league_1', {
      rosters: () => jsonResponse([
        { roster_id: 5, owner_id: 'owner_5', players: ['101'], starters: [], reserve: null, taxi: null, settings: {} },
      ]),
      users: () => jsonResponse({ not: 'an array' }),
      league: inSeasonLeague,
    });

    await expect(loadSleeperLeagueOwnership('league_1')).rejects.toThrow('SLEEPER_API_ERROR');
  });

  it('fails closed when a roster entry has players as a string instead of an array (would otherwise iterate it character by character)', async () => {
    mockLeagueFetch('league_1', {
      rosters: () => jsonResponse([
        { roster_id: 5, owner_id: 'owner_5', players: '4034', starters: [], reserve: null, taxi: null, settings: {} },
      ]),
      users: () => jsonResponse([
        { user_id: 'owner_5', display_name: 'Gerry', avatar: null },
      ]),
      league: inSeasonLeague,
    });

    await expect(loadSleeperLeagueOwnership('league_1')).rejects.toThrow('SLEEPER_API_ERROR');
  });

  it('fails closed when the rosters array contains non-roster objects (would otherwise pass the length guard and yield an empty map)', async () => {
    mockLeagueFetch('league_1', {
      rosters: () => jsonResponse([{}]),
      users: () => jsonResponse([]),
      league: inSeasonLeague,
    });

    await expect(loadSleeperLeagueOwnership('league_1')).rejects.toThrow('SLEEPER_API_ERROR');
  });

  it('resolves a genuine pre-draft league (non-empty rosters, every players field null) as FREE_AGENT rather than erroring', async () => {
    mockLeagueFetch('league_1', {
      rosters: () => jsonResponse([
        { roster_id: 1, owner_id: 'owner_1', players: null, starters: null, reserve: null, taxi: null, settings: {} },
        { roster_id: 2, owner_id: 'owner_2', players: null, starters: null, reserve: null, taxi: null, settings: {} },
      ]),
      users: () => jsonResponse([
        { user_id: 'owner_1', display_name: 'One', avatar: null },
        { user_id: 'owner_2', display_name: 'Two', avatar: null },
      ]),
      league: () => jsonResponse({ status: 'pre_draft' }),
    });

    const context = await loadSleeperLeagueOwnership('league_1');
    const result = resolveSleeperPlayerLeagueAvailability('101', context);

    expect(result.league_status).toBe('FREE_AGENT');
  });

  it('resolves a populated roster correctly when it coexists with a roster whose players is null', async () => {
    mockLeagueFetch('league_1', {
      rosters: () => jsonResponse([
        { roster_id: 1, owner_id: 'owner_1', players: null, starters: null, reserve: null, taxi: null, settings: {} },
        { roster_id: 2, owner_id: 'owner_2', players: ['101'], starters: [], reserve: null, taxi: null, settings: {} },
      ]),
      users: () => jsonResponse([
        { user_id: 'owner_1', display_name: 'One', avatar: null },
        { user_id: 'owner_2', display_name: 'Two', avatar: null },
      ]),
      league: inSeasonLeague,
    });

    const context = await loadSleeperLeagueOwnership('league_1');

    const rostered = resolveSleeperPlayerLeagueAvailability('101', context);
    expect(rostered.league_status).toBe('ROSTERED');
    expect(rostered.league_team_id).toBe('2');

    const stillFree = resolveSleeperPlayerLeagueAvailability('999', context);
    expect(stillFree.league_status).toBe('FREE_AGENT');
  });

  it('normalizes player ids on both the write and read side (numeric or whitespace-padded ids still match)', async () => {
    mockLeagueFetch('league_1', {
      rosters: () => jsonResponse([
        { roster_id: 5, owner_id: 'owner_5', players: [101, ' 202 '], starters: [], reserve: null, taxi: null, settings: {} },
      ]),
      users: () => jsonResponse([
        { user_id: 'owner_5', display_name: 'Gerry', avatar: null },
      ]),
      league: inSeasonLeague,
    });

    const context = await loadSleeperLeagueOwnership('league_1');

    expect(resolveSleeperPlayerLeagueAvailability('101', context).league_status).toBe('ROSTERED');
    expect(resolveSleeperPlayerLeagueAvailability(' 101 ', context).league_status).toBe('ROSTERED');
    expect(resolveSleeperPlayerLeagueAvailability('202', context).league_status).toBe('ROSTERED');
  });

  describe('draft-in-progress guard', () => {
    it('fails closed with no player payload leaking when the league is actively drafting', async () => {
      mockLeagueFetch('league_1', {
        rosters: () => jsonResponse([
          { roster_id: 1, owner_id: 'owner_1', players: [], starters: [], reserve: null, taxi: null, settings: {} },
        ]),
        users: () => jsonResponse([
          { user_id: 'owner_1', display_name: 'One', avatar: null },
        ]),
        league: () => jsonResponse({ status: 'drafting' }),
      });

      await expect(loadSleeperLeagueOwnership('league_1')).rejects.toThrow('SLEEPER_DRAFT_IN_PROGRESS');
      // The error is the ONLY thing observable — nothing about rosters/users
      // is exposed to the caller via a resolved value or a partial context.
    });

    it('leaves in_season leagues unaffected', async () => {
      mockLeagueFetch('league_1', {
        rosters: () => jsonResponse([
          { roster_id: 1, owner_id: 'owner_1', players: ['101'], starters: [], reserve: null, taxi: null, settings: {} },
        ]),
        users: () => jsonResponse([
          { user_id: 'owner_1', display_name: 'One', avatar: null },
        ]),
        league: () => jsonResponse({ status: 'in_season' }),
      });

      const context = await loadSleeperLeagueOwnership('league_1');
      expect(resolveSleeperPlayerLeagueAvailability('101', context).league_status).toBe('ROSTERED');
    });

    it('leaves complete leagues unaffected', async () => {
      mockLeagueFetch('league_1', {
        rosters: () => jsonResponse([
          { roster_id: 1, owner_id: 'owner_1', players: ['101'], starters: [], reserve: null, taxi: null, settings: {} },
        ]),
        users: () => jsonResponse([
          { user_id: 'owner_1', display_name: 'One', avatar: null },
        ]),
        league: () => jsonResponse({ status: 'complete' }),
      });

      const context = await loadSleeperLeagueOwnership('league_1');
      expect(resolveSleeperPlayerLeagueAvailability('101', context).league_status).toBe('ROSTERED');
    });

    it('does not fail closed for an unrecognized future status value — only an exact "drafting" match trips the guard', async () => {
      mockLeagueFetch('league_1', {
        rosters: () => jsonResponse([
          { roster_id: 1, owner_id: 'owner_1', players: ['101'], starters: [], reserve: null, taxi: null, settings: {} },
        ]),
        users: () => jsonResponse([
          { user_id: 'owner_1', display_name: 'One', avatar: null },
        ]),
        league: () => jsonResponse({ status: 'some_future_status_this_code_has_never_seen' }),
      });

      const context = await loadSleeperLeagueOwnership('league_1');
      expect(resolveSleeperPlayerLeagueAvailability('101', context).league_status).toBe('ROSTERED');
    });

    it('fails closed when the league fetch itself errors (consistent with the rosters/users fail-closed convention)', async () => {
      mockLeagueFetch('league_1', {
        rosters: () => jsonResponse([]),
        users: () => jsonResponse([]),
        league: () => new Response(null, { status: 404 }),
      });

      await expect(loadSleeperLeagueOwnership('league_1')).rejects.toThrow('SLEEPER_NOT_FOUND');
    });
  });
});
