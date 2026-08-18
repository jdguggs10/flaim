import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import {
  attachTeamNames,
  fetchSleeperRosterTeams,
  fetchSleeperTransactionsByWeeks,
  getSleeperCurrentWeek,
  type NormalizedTransaction,
} from '../sleeper-transactions';

const mockFetch = vi.fn() as MockedFunction<typeof fetch>;
global.fetch = mockFetch;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('sleeper-transactions', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('gets current week from state endpoint', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ week: 9 }));
    const week = await getSleeperCurrentWeek('/state/nfl');
    expect(week).toBe(9);
  });

  it('falls back to week 1 when state endpoint returns week 0', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ week: 0 }));
    const week = await getSleeperCurrentWeek('/state/nba');
    expect(week).toBe(1);
  });

  it('fetches and normalizes transactions across weeks', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([
        {
          transaction_id: 'a1',
          type: 'trade',
          status: 'complete',
          status_updated: 100,
          leg: 8,
          roster_ids: [1, 2],
          adds: null,
          drops: null,
          draft_picks: [],
        },
      ]))
      .mockResolvedValueOnce(jsonResponse([
        {
          transaction_id: 'b1',
          type: 'waiver',
          status: 'complete',
          status_updated: 200,
          leg: 9,
          roster_ids: [3],
          adds: { '123': 3 },
          drops: { '456': 3 },
          settings: { waiver_bid: 17 },
        },
      ]));

    const rows = await fetchSleeperTransactionsByWeeks('league', [8, 9]);
    expect(rows).toHaveLength(2);
    expect(rows[0].transaction_id).toBe('b1');
    expect(rows[0].type).toBe('waiver');
    expect(rows[0].faab_bid).toBe(17);
    expect(rows[0].players_added).toEqual([{ id: '123', name: undefined, position: undefined, team: undefined }]);
  });

  it('enriches player adds/drops when resolver provides metadata', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse([
      {
        transaction_id: 'x1',
        type: 'waiver',
        status: 'complete',
        status_updated: 200,
        leg: 9,
        adds: { '123': 3 },
        drops: { '456': 3 },
      },
    ]));

    const rows = await fetchSleeperTransactionsByWeeks('league', [9], (playerId) => {
      if (playerId === '123') return { name: 'Josh Allen', position: 'QB', team: 'BUF' };
      return undefined;
    });

    expect(rows[0].players_added).toEqual([{ id: '123', name: 'Josh Allen', position: 'QB', team: 'BUF' }]);
    expect(rows[0].players_dropped).toEqual([{ id: '456', name: undefined, position: undefined, team: undefined }]);
  });
});

describe('fetchSleeperRosterTeams', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('resolves manager-set and default team names into parallel teams/teamOwners maps, keyed by roster id', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([
        { roster_id: 1, owner_id: 'u1', players: [], starters: [], reserve: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0 } },
        { roster_id: 2, owner_id: 'u2', players: [], starters: [], reserve: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0 } },
      ]))
      .mockResolvedValueOnce(jsonResponse([
        { user_id: 'u1', display_name: 'Alice', avatar: null, metadata: { team_name: 'The Waiver Wire Wizards' } },
        { user_id: 'u2', display_name: 'Bob', avatar: null },
      ]));

    const { teams, teamOwners } = await fetchSleeperRosterTeams('league');

    // teams is ESPN-shaped (Record<string, string>) — always a non-empty
    // teamName string (manager-set, or Sleeper's "Team <name>" default).
    expect(teams).toEqual({ '1': 'The Waiver Wire Wizards', '2': 'Team Bob' });
    expect(teamOwners).toEqual({ '1': 'Alice', '2': 'Bob' });
  });

  it('omits a roster whose owner_id has no matching user from both maps', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([
        { roster_id: 1, owner_id: 'u1', players: [], starters: [], reserve: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0 } },
        { roster_id: 2, owner_id: 'orphan', players: [], starters: [], reserve: [], settings: { wins: 0, losses: 0, ties: 0, fpts: 0 } },
      ]))
      .mockResolvedValueOnce(jsonResponse([
        { user_id: 'u1', display_name: 'Alice', avatar: null },
      ]));

    const { teams, teamOwners } = await fetchSleeperRosterTeams('league');

    expect(teams).toEqual({ '1': 'Team Alice' });
    expect(teamOwners).toEqual({ '1': 'Alice' });
  });

  it('throws when the rosters fetch fails (rosters and users are fetched in parallel; the rosters .ok check runs first)', async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(jsonResponse([]));

    await expect(fetchSleeperRosterTeams('league')).rejects.toThrow();
  });

  it('throws when the users fetch fails', async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(new Response(null, { status: 500 }));

    await expect(fetchSleeperRosterTeams('league')).rejects.toThrow();
  });
});

describe('attachTeamNames', () => {
  const baseTxn: NormalizedTransaction = {
    transaction_id: 't1',
    type: 'trade',
    status: 'complete',
    timestamp: 100,
    date: '1970-01-01',
    week: 9,
    team_ids: ['1', '2'],
  };

  it('adds team_names parallel to team_ids when the map resolves both ids', () => {
    const [result] = attachTeamNames([baseTxn], { '1': 'The Waiver Wire Wizards', '2': 'Team Bob' });

    expect(result.team_names).toEqual(['The Waiver Wire Wizards', 'Team Bob']);
    expect(result.team_ids).toEqual(['1', '2']);
  });

  it('falls back to the raw id when the map is undefined', () => {
    const [result] = attachTeamNames([baseTxn], undefined);
    expect(result.team_names).toEqual(['1', '2']);
  });

  it('falls back to the raw id for a roster missing from an otherwise-present map', () => {
    const [result] = attachTeamNames([baseTxn], { '1': 'Alpha' });
    expect(result.team_names).toEqual(['Alpha', '2']);
  });

  it('leaves a row without team_ids unchanged', () => {
    const rowWithoutTeamIds: NormalizedTransaction = { ...baseTxn, team_ids: undefined };
    const [result] = attachTeamNames([rowWithoutTeamIds], { '1': 'Alpha' });
    expect(result.team_names).toBeUndefined();
  });
});
