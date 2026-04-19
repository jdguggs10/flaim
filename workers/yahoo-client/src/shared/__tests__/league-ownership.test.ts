import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { enrichPlayerWithOwnership, fetchLeagueOwnershipMap } from '../handlers/league-ownership';
import { yahooFetch } from '../yahoo-api';
import type { YahooCredentials } from '../auth';

vi.mock('../yahoo-api', async () => {
  const actual = (await vi.importActual('../yahoo-api')) as Record<string, unknown>;
  return {
    ...actual,
    yahooFetch: vi.fn(),
  };
});

const mockYahooFetch = yahooFetch as MockedFunction<typeof yahooFetch>;

const credentials: YahooCredentials = {
  accessToken: 'test-access-token',
};

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function teamsListPayload(teamKeys: string[]): unknown {
  const teamsObj: Record<string, unknown> = { count: teamKeys.length };
  teamKeys.forEach((teamKey, idx) => {
    teamsObj[String(idx)] = {
      team: [
        [
          { team_key: teamKey },
          { name: `Team ${teamKey}` },
          {
            managers: [
              { manager: { nickname: `Manager ${teamKey}` } },
            ],
          },
        ],
      ],
    };
  });

  return {
    fantasy_content: {
      league: [
        { league_key: '449.l.123' },
        { teams: teamsObj },
      ],
    },
  };
}

function rosterPayload(teamKey: string, playerIds: string[]): unknown {
  const playersObj: Record<string, unknown> = { count: playerIds.length };
  playerIds.forEach((playerId, idx) => {
    playersObj[String(idx)] = {
      player: [
        [{ player_id: playerId, name: { full: `Player ${playerId}` } }],
      ],
    };
  });

  return {
    fantasy_content: {
      team: [
        [
          { team_key: teamKey },
          { name: `Team ${teamKey}` },
          {
            managers: [
              { manager: { nickname: `Manager ${teamKey}` } },
            ],
          },
        ],
        { roster: { 0: { players: playersObj } } },
      ],
    },
  };
}

describe('fetchLeagueOwnershipMap', () => {
  beforeEach(() => {
    mockYahooFetch.mockReset();
  });

  it('preserves ownership entries from succeeding teams when one roster fetch fails and marks the result incomplete', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockYahooFetch.mockImplementation(async (path: string) => {
      if (path === '/league/449.l.123/teams') {
        return jsonResponse(teamsListPayload(['449.l.123.t.1', '449.l.123.t.2', '449.l.123.t.3']));
      }
      if (path === '/team/449.l.123.t.1/roster') {
        return jsonResponse(rosterPayload('449.l.123.t.1', ['p1a', 'p1b']));
      }
      if (path === '/team/449.l.123.t.2/roster') {
        return jsonResponse({ error: 'boom' }, { status: 500 });
      }
      if (path === '/team/449.l.123.t.3/roster') {
        return jsonResponse(rosterPayload('449.l.123.t.3', ['p3a']));
      }
      throw new Error(`unexpected path ${path}`);
    });

    const ownership = await fetchLeagueOwnershipMap(credentials, '449.l.123');

    expect(ownership).not.toBeNull();
    expect(ownership?.complete).toBe(false);
    expect(ownership?.map.size).toBe(3);
    expect(ownership?.map.get('p1a')?.teamKey).toBe('449.l.123.t.1');
    expect(ownership?.map.get('p1b')?.teamKey).toBe('449.l.123.t.1');
    expect(ownership?.map.get('p3a')?.teamKey).toBe('449.l.123.t.3');

    const loggedForFailedTeam = warnSpy.mock.calls.some((call) =>
      call.some((arg) => typeof arg === 'string' && arg.includes('449.l.123.t.2')),
    );
    expect(loggedForFailedTeam).toBe(true);

    // Critical: a player that *would* have been on the failed team must not be
    // labeled FREE_AGENT just because the map doesn't contain them. When the
    // result is incomplete, map misses surface as unknown (null status).
    const enriched = enrichPlayerWithOwnership('p2a', ownership);
    expect(enriched.league_status).toBeNull();
    expect(enriched.league_team_name).toBeNull();
    expect(enriched.league_owner_name).toBeNull();

    // Players we *did* fetch should still be labeled ROSTERED.
    const enrichedRostered = enrichPlayerWithOwnership('p1a', ownership);
    expect(enrichedRostered.league_status).toBe('ROSTERED');
    expect(enrichedRostered.league_team_name).toBe('Team 449.l.123.t.1');

    warnSpy.mockRestore();
  });

  it('returns a complete result when every roster fetch succeeds so misses resolve to FREE_AGENT', async () => {
    mockYahooFetch.mockImplementation(async (path: string) => {
      if (path === '/league/449.l.123/teams') {
        return jsonResponse(teamsListPayload(['449.l.123.t.1', '449.l.123.t.2']));
      }
      if (path === '/team/449.l.123.t.1/roster') {
        return jsonResponse(rosterPayload('449.l.123.t.1', ['p1a']));
      }
      if (path === '/team/449.l.123.t.2/roster') {
        return jsonResponse(rosterPayload('449.l.123.t.2', ['p2a']));
      }
      throw new Error(`unexpected path ${path}`);
    });

    const ownership = await fetchLeagueOwnershipMap(credentials, '449.l.123');

    expect(ownership).not.toBeNull();
    expect(ownership?.complete).toBe(true);
    expect(ownership?.map.size).toBe(2);

    // With a complete map, anyone not in it is a genuine free agent.
    const enriched = enrichPlayerWithOwnership('unrostered-player', ownership);
    expect(enriched.league_status).toBe('FREE_AGENT');
  });

  it('returns null when the teams-list fetch itself fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockYahooFetch.mockImplementation(async () => jsonResponse({ error: 'nope' }, { status: 500 }));

    const ownership = await fetchLeagueOwnershipMap(credentials, '449.l.123');
    expect(ownership).toBeNull();

    // And enrichPlayerWithOwnership must return null status (not FREE_AGENT)
    // when ownership data is entirely unavailable.
    const enriched = enrichPlayerWithOwnership('some-player', ownership);
    expect(enriched.league_status).toBeNull();

    warnSpy.mockRestore();
  });
});
