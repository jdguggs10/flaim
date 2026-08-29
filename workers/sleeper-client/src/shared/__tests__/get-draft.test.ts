import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { footballHandlers } from '../../sports/football/handlers';
import { basketballHandlers } from '../../sports/basketball/handlers';
import type { Env, ToolParams } from '../../types';

const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
global.fetch = mockFetch;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

const scenarios = [
  { label: 'football', sport: 'football', sleeperSport: 'nfl', handlers: footballHandlers },
  { label: 'basketball', sport: 'basketball', sleeperSport: 'nba', handlers: basketballHandlers },
] as const;

function league(sport: string, season = '2026', draftId = 'draft-1') {
  return { league_id: 'league-1', season, sport, draft_id: draftId };
}

function candidate(sport: string, id = 'draft-1', season = '2026') {
  return { draft_id: id, league_id: 'league-1', season, sport, type: 'snake', status: 'complete' };
}

function rosterAndUsers() {
  return [
    jsonResponse([
      { roster_id: 1, owner_id: 'u1', players: [], starters: [], reserve: [], settings: {} },
      { roster_id: 2, owner_id: 'u2', players: [], starters: [], reserve: [], settings: {} },
      ...Array.from({ length: 14 }, (_, index) => ({ roster_id: index + 3, owner_id: `u${index + 3}`, players: [], starters: [], reserve: [], settings: {} })),
    ]),
    jsonResponse(Array.from({ length: 16 }, (_, index) => ({
      user_id: `u${index + 1}`,
      display_name: index === 1 ? 'Derek' : `Manager ${index + 1}`,
      avatar: null,
    }))),
  ];
}

function detail(sport: string, options: { type?: string; reversalRound?: number; rounds?: number } = {}) {
  return {
    ...candidate(sport),
    type: options.type ?? 'snake',
    settings: {
      teams: 16,
      rounds: options.rounds ?? 15,
      ...(options.reversalRound === undefined ? {} : { reversal_round: options.reversalRound }),
    },
    slot_to_roster_id: Object.fromEntries(Array.from({ length: 16 }, (_, index) => [String(index + 1), index + 1])),
  };
}

function queueSelectedDraft(sport: string, draftDetail: unknown, picks: unknown, trades: unknown = []) {
  const [rosters, users] = rosterAndUsers();
  mockFetch
    .mockResolvedValueOnce(jsonResponse(league(sport)))
    .mockResolvedValueOnce(jsonResponse([candidate(sport)]))
    .mockResolvedValueOnce(rosters)
    .mockResolvedValueOnce(users)
    .mockResolvedValueOnce(jsonResponse(trades))
    .mockResolvedValueOnce(jsonResponse(draftDetail))
    .mockResolvedValueOnce(jsonResponse(picks));
}

describe('Sleeper get_draft', () => {
  beforeEach(() => mockFetch.mockReset());

  it.each(scenarios)('$label returns a confirmed completed pick without loading the current player index', async ({ sport, sleeperSport, handlers }) => {
    queueSelectedDraft(sleeperSport, detail(sleeperSport, { reversalRound: 0 }), [
      {
        player_id: 'derek-player',
        draft_id: 'draft-1',
        roster_id: '2',
        round: 12,
        draft_slot: 2,
        // Round 12, column 2 in a 16-team standard snake is selection 15.
        pick_no: 191,
        metadata: { first_name: 'Derek', last_name: 'Receiver', position: 'WR', team: 'DET' },
        is_keeper: false,
      },
    ]);

    const result = await handlers.get_draft({} as Env, { sport, league_id: 'league-1', season_year: 2026 } as ToolParams);

    expect(result.success).toBe(true);
    const data = result.data as Record<string, any>;
    expect(data).toMatchObject({ platform: 'sleeper', sport, leagueId: 'league-1', seasonYear: 2026 });
    expect(data.picks).toEqual([expect.objectContaining({
      round: 12,
      overallPick: 191,
      selectionInRound: 15,
      draftColumn: 2,
      selectionTeamId: 2,
      originalTeamId: 2,
      placement: { status: 'confirmed', source: 'provider_pick' },
      playerId: 'derek-player',
      playerName: 'Derek Receiver',
      playerPosition: 'WR',
      playerProTeam: 'DET',
    })]);
    expect(data.ownership.scope).toBe('complete');
    expect(data.ownership.picks).toContainEqual(expect.objectContaining({
      round: 12,
      originalTeamId: 2,
      currentOwnerTeamId: 2,
      seasonYear: 2026,
      selectionInRound: 15,
      overallPick: 191,
      placement: { status: 'confirmed', source: 'provider_pick' },
    }));
    expect(mockFetch).not.toHaveBeenCalledWith(expect.stringContaining('/players/'), expect.anything());
  });

  it.each(scenarios)('$label drops a provider pick without a valid positive round', async ({ sport, sleeperSport, handlers }) => {
    queueSelectedDraft(sleeperSport, detail(sleeperSport, { reversalRound: 0 }), [
      { draft_id: 'draft-1', player_id: 'bad-round', roster_id: '1', round: 0, draft_slot: 1, pick_no: 1, metadata: {} },
    ]);

    const result = await handlers.get_draft({} as Env, { sport, league_id: 'league-1', season_year: 2026 } as ToolParams);

    expect(result.success).toBe(true);
    const data = result.data as Record<string, any>;
    expect(data.picks).toEqual([]);
    expect(data.warnings).toEqual(expect.arrayContaining([expect.stringContaining('DRAFT_PICKS_PARTIAL') ]));
  });

  it.each(scenarios)('$label projects 3RR but does not assume standard snake when reversal_round is absent', async ({ sport, sleeperSport, handlers }) => {
    queueSelectedDraft(sleeperSport, detail(sleeperSport, { reversalRound: 3 }), []);
    const result = await handlers.get_draft({} as Env, { sport, league_id: 'league-1', season_year: 2026 } as ToolParams);
    const data = result.data as Record<string, any>;
    const thirdRoundFirstColumn = data.ownership.picks.find((pick: Record<string, unknown>) => pick.round === 3 && pick.originalTeamId === 1);
    expect(thirdRoundFirstColumn).toMatchObject({
      draftColumn: 1,
      selectionInRound: 16,
      placement: { status: 'projected', source: 'provider_order_derived' },
    });

    queueSelectedDraft(sleeperSport, detail(sleeperSport), []);
    const noReversal = await handlers.get_draft({} as Env, { sport, league_id: 'league-1', season_year: 2026 } as ToolParams);
    const noReversalData = noReversal.data as Record<string, any>;
    const unverified = noReversalData.ownership.picks.find((pick: Record<string, unknown>) => pick.round === 3 && pick.originalTeamId === 1);
    expect(unverified).toMatchObject({ draftColumn: 1, placement: { status: 'unavailable', source: 'no_provider_order' } });

    queueSelectedDraft(sleeperSport, detail(sleeperSport, { reversalRound: 0 }), []);
    const standardSnake = await handlers.get_draft({} as Env, { sport, league_id: 'league-1', season_year: 2026 } as ToolParams);
    const standardSnakeData = standardSnake.data as Record<string, any>;
    const derekStyleProjection = standardSnakeData.ownership.picks.find((pick: Record<string, unknown>) => pick.round === 12 && pick.originalTeamId === 2);
    expect(derekStyleProjection).toMatchObject({
      draftColumn: 2,
      selectionInRound: 15,
      overallPick: 191,
      placement: { status: 'projected', source: 'provider_order_derived' },
    });
  });

  it.each(scenarios)('$label projects linear order and keeps auction price separate from placement', async ({ sport, sleeperSport, handlers }) => {
    queueSelectedDraft(sleeperSport, detail(sleeperSport, { type: 'linear' }), []);
    const linear = await handlers.get_draft({} as Env, { sport, league_id: 'league-1', season_year: 2026 } as ToolParams);
    const linearData = linear.data as Record<string, any>;
    const linearRoundTwo = linearData.ownership.picks.find((pick: Record<string, unknown>) => pick.round === 2 && pick.originalTeamId === 3);
    expect(linearRoundTwo).toMatchObject({
      draftColumn: 3,
      selectionInRound: 3,
      placement: { status: 'projected', source: 'provider_order_derived' },
    });

    queueSelectedDraft(sleeperSport, detail(sleeperSport, { type: 'auction' }), [
      {
        draft_id: 'draft-1', player_id: 'auction-player', roster_id: '1', round: 1, draft_slot: 1, pick_no: 1,
        metadata: { first_name: 'Auction', last_name: 'Winner', amount: '42' },
      },
      {
        draft_id: 'draft-1', player_id: 'invalid-auction-cost', roster_id: '3', round: 1, draft_slot: 3, pick_no: 2,
        metadata: { first_name: 'Invalid', last_name: 'Cost', amount: '-1' },
      },
    ]);
    const auction = await handlers.get_draft({} as Env, { sport, league_id: 'league-1', season_year: 2026 } as ToolParams);
    const auctionData = auction.data as Record<string, any>;
    expect(auctionData.picks[0]).toMatchObject({
      cost: { amount: 42, unit: 'auction_dollars' },
      placement: { status: 'confirmed', source: 'provider_pick' },
    });
    expect(auctionData.picks[1]).not.toHaveProperty('cost');
    const unmadeAuctionPick = auctionData.ownership.picks.find((pick: Record<string, unknown>) => pick.round === 1 && pick.originalTeamId === 2);
    expect(unmadeAuctionPick.placement).toEqual({ status: 'unavailable', source: 'no_provider_order' });
  });

  it.each(scenarios)('$label returns a future changed-picks-only ledger when no season draft exists', async ({ sport, sleeperSport, handlers }) => {
    const [rosters, users] = rosterAndUsers();
    mockFetch
      .mockResolvedValueOnce(jsonResponse(league(sleeperSport, '2026')))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(rosters)
      .mockResolvedValueOnce(users)
      .mockResolvedValueOnce(jsonResponse([
        { season: '2027', round: 1, roster_id: 1, previous_owner_id: 1, owner_id: 2 },
      ]));

    const result = await handlers.get_draft({} as Env, { sport, league_id: 'league-1', season_year: 2027 } as ToolParams);

    expect(result.success).toBe(true);
    const data = result.data as Record<string, any>;
    expect(data.draft).toEqual({ type: 'unknown', status: 'unavailable', source: 'traded_picks_only' });
    expect(data.picks).toEqual([]);
    expect(data.ownership).toEqual(expect.objectContaining({
      scope: 'changed_picks_only',
      picks: [expect.objectContaining({ seasonYear: 2027, originalTeamId: 1, currentOwnerTeamId: 2, placement: { status: 'unavailable', source: 'no_provider_order' } })],
    }));
  });

  it.each(scenarios)('$label returns a current-season changed-picks-only ledger before a draft exists', async ({ sport, sleeperSport, handlers }) => {
    const [rosters, users] = rosterAndUsers();
    mockFetch
      .mockResolvedValueOnce(jsonResponse(league(sleeperSport, '2026')))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(rosters)
      .mockResolvedValueOnce(users)
      .mockResolvedValueOnce(jsonResponse([
        { season: '2026', round: 2, roster_id: 3, previous_owner_id: 3, owner_id: 4 },
      ]));

    const result = await handlers.get_draft({} as Env, { sport, league_id: 'league-1', season_year: 2026 } as ToolParams);

    expect(result).toMatchObject({
      success: true,
      data: {
        draft: { type: 'unknown', status: 'unavailable', source: 'traded_picks_only' },
        picks: [],
        ownership: {
          scope: 'changed_picks_only',
          picks: [expect.objectContaining({
            seasonYear: 2026,
            round: 2,
            originalTeamId: 3,
            currentOwnerTeamId: 4,
            placement: { status: 'unavailable', source: 'no_provider_order' },
          })],
        },
      },
    });
  });

  it.each(scenarios)('$label refuses ambiguous same-season candidates instead of taking the newest draft', async ({ sport, sleeperSport, handlers }) => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(league(sleeperSport, '2026', 'not-on-list')))
      .mockResolvedValueOnce(jsonResponse([candidate(sleeperSport, 'newest'), candidate(sleeperSport, 'older')]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]));

    const result = await handlers.get_draft({} as Env, { sport, league_id: 'league-1', season_year: 2026 } as ToolParams);

    expect(result).toMatchObject({ success: false, code: 'SLEEPER_DRAFT_AMBIGUOUS' });
    expect(mockFetch).not.toHaveBeenCalledWith('https://api.sleeper.app/v1/draft/newest', expect.anything());
  });

  it.each(scenarios)('$label keeps IDs when roster/user and traded-pick enrichment fail', async ({ sport, sleeperSport, handlers }) => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(league(sleeperSport)))
      .mockResolvedValueOnce(jsonResponse([candidate(sleeperSport)]))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockRejectedValueOnce(new Error('users unavailable'))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(jsonResponse(detail(sleeperSport, { reversalRound: 0 })))
      .mockResolvedValueOnce(jsonResponse([{ draft_id: 'draft-1', player_id: 'p1', roster_id: '1', round: 1, draft_slot: 1, pick_no: 1, metadata: {} }]));

    const result = await handlers.get_draft({} as Env, { sport, league_id: 'league-1', season_year: 2026 } as ToolParams);

    expect(result.success).toBe(true);
    const data = result.data as Record<string, any>;
    expect(data.picks[0]).toMatchObject({ selectionTeamId: 1, originalTeamId: 1 });
    expect(data.picks[0].selectionTeamName).toBeUndefined();
    expect(data.ownership).toEqual({ scope: 'unavailable', picks: [] });
    expect(data.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('DRAFT_TEAMS_UNAVAILABLE'),
      expect.stringContaining('TRADED_PICKS_UNAVAILABLE'),
    ]));
  });
});
