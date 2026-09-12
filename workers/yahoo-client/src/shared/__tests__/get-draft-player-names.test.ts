import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { getYahooCredentials } from '../auth';
import { createGetDraftHandler } from '../handlers/get-draft';
import { yahooFetch } from '../yahoo-api';

vi.mock('../auth', () => ({
  getYahooCredentials: vi.fn(),
}));

vi.mock('../yahoo-api', async () => {
  const actual = await vi.importActual('../yahoo-api') as Record<string, unknown>;
  return {
    ...actual,
    yahooFetch: vi.fn(),
  };
});

interface DraftRow {
  round?: string;
  team_key?: string;
  player_id?: string;
  player_key?: string;
  player_name?: string;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function draftResponse(rows: DraftRow[], declaredCount = rows.length, status = 'postdraft'): unknown {
  const draftResults: Record<string, unknown> = { count: declaredCount };
  rows.forEach((row, index) => {
    draftResults[String(index)] = {
      draft_result: {
        round: '1',
        team_key: `449.l.123.t.${(index % 10) + 1}`,
        ...row,
      },
    };
  });

  return {
    fantasy_content: {
      league: [
        { league_key: '449.l.123', draft_status: status, draft_type: 'live' },
        { draft_results: draftResults },
      ],
    },
  };
}

function playersResponse(players: Array<{ key: string; id?: string; name: string }>): unknown {
  const collection: Record<string, unknown> = { count: players.length };
  players.forEach((player, index) => {
    collection[String(index)] = {
      player: [[
        { player_key: player.key },
        { player_id: player.id ?? player.key.split('.p.')[1] },
        { name: { full: player.name } },
      ]],
    };
  });
  return { fantasy_content: { players: collection } };
}

const handler = createGetDraftHandler({ sport: 'football', getPositionFilter: () => '' });
const params = { sport: 'football', league_id: '449.l.123', season_year: 2026 } as const;

describe('Yahoo get_draft player-name enrichment', () => {
  const getCredsMock = getYahooCredentials as MockedFunction<typeof getYahooCredentials>;
  const fetchMock = yahooFetch as MockedFunction<typeof yahooFetch>;

  beforeEach(() => {
    vi.clearAllMocks();
    getCredsMock.mockResolvedValue({ accessToken: 'token' });
  });

  it('deduplicates full player keys, batches more than 25, and preserves numeric player IDs', async () => {
    const rows = Array.from({ length: 27 }, (_, index): DraftRow => ({
      player_id: index < 2 ? '100' : String(99 + index),
      player_key: index < 2 ? '449.p.100' : `449.p.${99 + index}`,
    }));
    fetchMock.mockImplementation(async (path) => {
      if (path.includes('/draftresults')) return jsonResponse(draftResponse(rows));

      const keys = path.split('player_keys=')[1]?.split(',') ?? [];
      return jsonResponse(playersResponse([
        // A same-numeric-ID player from another season must never be used.
        ...(keys.includes('449.p.100') ? [{ key: '448.p.100', id: '100', name: 'Wrong Season' }] : []),
        ...keys.map((key) => ({ key, name: `Name ${key}` })),
      ]));
    });

    const result = await handler({} as never, params, 'Bearer x');

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const firstBatchPath = fetchMock.mock.calls[1]?.[0] as string;
    const secondBatchPath = fetchMock.mock.calls[2]?.[0] as string;
    expect(firstBatchPath.split('player_keys=')[1]?.split(',')).toHaveLength(25);
    expect(firstBatchPath.match(/449\.p\.100/g)).toHaveLength(1);
    expect(secondBatchPath.split('player_keys=')[1]?.split(',')).toHaveLength(1);
    expect(result).toMatchObject({
      success: true,
      data: {
        picks: expect.arrayContaining([
          expect.objectContaining({ playerId: '100', playerName: 'Name 449.p.100' }),
          expect.objectContaining({ playerId: '101', playerName: 'Name 449.p.101' }),
        ]),
      },
    });
  });

  it('keeps unresolved picks and appends a partial-name warning to draft parse warnings', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(draftResponse([
        { player_key: '449.p.101' },
        { player_key: '449.p.102' },
      ], 3)))
      .mockResolvedValueOnce(jsonResponse(playersResponse([
        { key: '449.p.101', name: 'Player One' },
      ])));

    const result = await handler({} as never, params, 'Bearer x');

    expect(result).toMatchObject({
      success: true,
      data: {
        picks: [
          { playerId: '449.p.101', playerName: 'Player One' },
          { playerId: '449.p.102' },
        ],
        warnings: [
          'DRAFT_PICKS_PARTIAL: Yahoo reported 3 draft rows, but 1 were missing, malformed, or incomplete.',
          'DRAFT_PLAYER_NAMES_PARTIAL: Yahoo did not resolve names for 1 draft pick(s); player IDs remain available.',
        ],
      },
    });
  });

  it('stops after a malformed player collection and returns confirmed picks with a warning', async () => {
    const rows = Array.from({ length: 26 }, (_, index): DraftRow => ({
      player_key: `449.p.${index + 1}`,
    }));
    fetchMock
      .mockResolvedValueOnce(jsonResponse(draftResponse(rows)))
      .mockResolvedValueOnce(jsonResponse({ fantasy_content: {} }));

    const result = await handler({} as never, params, 'Bearer x');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      success: true,
      data: {
        picks: expect.arrayContaining([expect.objectContaining({ playerId: '449.p.1' })]),
        warnings: [
          'DRAFT_PLAYER_NAMES_UNAVAILABLE: Yahoo player-name lookup failed; 26 draft pick name(s) remain unresolved while player IDs remain available.',
        ],
      },
    });
  });

  it('stops after the first failed lookup without discarding draft results', async () => {
    const rows = Array.from({ length: 26 }, (_, index): DraftRow => ({
      player_key: `449.p.${index + 1}`,
    }));
    fetchMock
      .mockResolvedValueOnce(jsonResponse(draftResponse(rows)))
      .mockResolvedValueOnce(new Response('Unavailable', { status: 503 }));

    const result = await handler({} as never, params, 'Bearer x');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      success: true,
      data: {
        picks: expect.arrayContaining([expect.objectContaining({ playerId: '449.p.1' })]),
        warnings: [
          'DRAFT_PLAYER_NAMES_UNAVAILABLE: Yahoo player-name lookup failed; 26 draft pick name(s) remain unresolved while player IDs remain available.',
        ],
      },
    });
  });

  it('keeps inline names without making a redundant player lookup', async () => {
    fetchMock.mockResolvedValue(jsonResponse(draftResponse([
      { player_key: '449.p.101', player_name: 'Already Named' },
    ])));

    const result = await handler({} as never, params, 'Bearer x');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      success: true,
      data: { picks: [{ playerId: '449.p.101', playerName: 'Already Named' }] },
    });
  });

  it('does not make a player lookup for an empty pre-draft response', async () => {
    fetchMock.mockResolvedValue(jsonResponse(draftResponse([], 0, 'predraft')));

    const result = await handler({} as never, params, 'Bearer x');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      success: true,
      data: { draft: { status: 'pre_draft' }, picks: [] },
    });
  });
});
