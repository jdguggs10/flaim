import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { baseballHandlers } from '../baseball/handlers';
import { basketballHandlers } from '../basketball/handlers';
import { footballHandlers } from '../football/handlers';
import { hockeyHandlers } from '../hockey/handlers';
import type { HandlerToolParams, Sport, ToolParams } from '../../types';
import { getCredentials } from '../../shared/auth';
import { espnFetch } from '../../shared/espn-api';
import { clearScoringPeriodAnchorCache } from '../../shared/scoring-period';
import { withSeasonContext } from '../../shared/season';

vi.mock('../../shared/auth', () => ({
  getCredentials: vi.fn(),
}));

vi.mock('../../shared/espn-api', async () => {
  const actual = await vi.importActual('../../shared/espn-api') as Record<string, unknown>;
  return {
    ...actual,
    espnFetch: vi.fn(),
  };
});

const dailyScenarios = [
  { label: 'baseball', sport: 'baseball', handlers: baseballHandlers },
  { label: 'basketball', sport: 'basketball', handlers: basketballHandlers },
  { label: 'hockey', sport: 'hockey', handlers: hockeyHandlers },
] as const;

function makeParams(sport: Sport, overrides: Partial<ToolParams> = {}): HandlerToolParams {
  return withSeasonContext({
    sport,
    league_id: '123',
    season_year: 2024,
    ...overrides,
  });
}

function rosterResponse(entries: unknown[] = []): Response {
  return new Response(JSON.stringify({
    teams: [{
      id: 6,
      name: 'Team 6',
      owners: [{ displayName: 'Mike' }],
      roster: { entries },
    }],
  }), { status: 200 });
}

// Constant-offset calendar: period n corresponds to 2024-04-(n+9) ET.
function calendarResponse(): Response {
  const periods: Record<string, Array<{ date: number }>> = {};
  for (let period = 1; period <= 20; period += 1) {
    const day = String(period + 9).padStart(2, '0');
    periods[String(period)] = [{ date: Date.parse(`2024-04-${day}T23:00:00Z`) }];
  }
  return new Response(JSON.stringify({
    settings: { proTeams: [{ proGamesByScoringPeriod: periods }] },
  }), { status: 200 });
}

const getCredentialsMock = getCredentials as MockedFunction<typeof getCredentials>;
const espnFetchMock = espnFetch as MockedFunction<typeof espnFetch>;

describe('espn get_roster snapshot contract', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearScoringPeriodAnchorCache();
    getCredentialsMock.mockResolvedValue({ s2: 'token', swid: '{swid}' });
  });

  describe('football (weekly)', () => {
    it('maps week to scoringPeriodId and reports snapshot metadata', async () => {
      espnFetchMock.mockResolvedValue(rosterResponse());
      const params = makeParams('football', { team_id: '6', week: 5 });
      const result = await footballHandlers.get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      expect(espnFetchMock.mock.calls[0][0]).toContain('scoringPeriodId=5');
      const data = result.data as { snapshot: Record<string, unknown> };
      expect(data.snapshot).toEqual({ type: 'week', week: 5, providerScoringPeriodId: 5 });
    });

    it('rejects an injected date snapshot with a corrective error', async () => {
      const params = makeParams('football', { team_id: '6', snapshot: { type: 'date', date: '2024-10-06' } });
      const result = await footballHandlers.get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_ROSTER_SNAPSHOT_SELECTOR');
      expect(result.error).toContain('week');
      expect(espnFetchMock).not.toHaveBeenCalled();
    });

    it('returns a current snapshot block when no selector is passed', async () => {
      espnFetchMock.mockResolvedValue(rosterResponse());
      const params = makeParams('football', { team_id: '6' });
      const result = await footballHandlers.get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      expect(espnFetchMock.mock.calls[0][0]).not.toContain('scoringPeriodId');
      const data = result.data as { snapshot: Record<string, unknown>; limitations?: unknown };
      expect(data.snapshot).toEqual({ type: 'current' });
      expect(data.limitations).toBeUndefined();
    });

    it('rejects a malformed injected snapshot without degrading to current', async () => {
      const params = makeParams('football', { team_id: '6', snapshot: { type: 'date', date: '2024-02-30' } });
      const result = await footballHandlers.get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_ROSTER_SNAPSHOT_SELECTOR');
      expect(espnFetchMock).not.toHaveBeenCalled();
    });

    it('omits proTeam/injuryStatus on a historical week snapshot and flags playerProTeamAvailable (FLA-278)', async () => {
      espnFetchMock.mockResolvedValue(rosterResponse([{
        playerPoolEntry: { player: { id: 1, fullName: 'Player One', proTeamId: 2, injuryStatus: 'QUESTIONABLE' } },
        lineupSlotId: 0,
      }]));
      const params = makeParams('football', { team_id: '6', week: 5 });
      const result = await footballHandlers.get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      const data = result.data as { roster: Array<Record<string, unknown>>; limitations?: Record<string, unknown> };
      expect(data.roster[0]).not.toHaveProperty('proTeam');
      expect(data.roster[0]).not.toHaveProperty('injuryStatus');
      // this fixture entry also carries no acquisitionType/acquisitionDate
      expect(data.limitations).toEqual({ acquisitionMetadataAvailable: false, playerProTeamAvailable: false, keeperValueFutureAvailable: false });
    });

    it('keeps proTeam/injuryStatus on the current roster', async () => {
      espnFetchMock.mockResolvedValue(rosterResponse([{
        playerPoolEntry: { player: { id: 1, fullName: 'Player One', proTeamId: 2, injuryStatus: 'QUESTIONABLE' } },
        lineupSlotId: 0,
      }]));
      const params = makeParams('football', { team_id: '6' });
      const result = await footballHandlers.get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      const data = result.data as { roster: Array<Record<string, unknown>>; limitations?: unknown };
      expect(data.roster[0].proTeam).toBe('BUF');
      expect(data.roster[0].injuryStatus).toBe('Questionable');
      expect(data.limitations).toBeUndefined();
    });
  });

  describe.each(dailyScenarios)('$label (daily)', ({ sport, handlers }) => {
    it('rejects legacy week with a corrective error instead of a stale snapshot', async () => {
      const params = makeParams(sport, { team_id: '6', week: 15 });
      const result = await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_ROSTER_SNAPSHOT_SELECTOR');
      expect(result.error).toContain('as_of_date');
      expect(espnFetchMock).not.toHaveBeenCalled();
    });

    it('rejects an injected week snapshot the same way', async () => {
      const params = makeParams(sport, { team_id: '6', snapshot: { type: 'week', week: 15 } });
      const result = await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_ROSTER_SNAPSHOT_SELECTOR');
    });

    // FLA-209 published-client compatibility, contrasted with FLA-278 temporal
    // purity: a raw `week` on a daily sport is rejected above (the gateway is
    // the only place a legacy `week` gets normalized to `{ type: 'current',
    // requestedWeek }` — see validateRosterSnapshotInput in
    // workers/shared/src/roster-snapshot.ts). This test injects that
    // already-normalized shape, as the gateway would send it, to prove the
    // resulting response is genuinely a CURRENT roster: no provider selector,
    // proTeam/injuryStatus still present, and no `limitations` block — the
    // FLA-278 historical-omission rule must not fire on this compat path.
    it('FLA-209: an ignored-week compat snapshot serves current roster with proTeam/injuryStatus intact and no limitations', async () => {
      espnFetchMock.mockResolvedValue(rosterResponse([{
        playerPoolEntry: { player: { id: 1, fullName: 'Player One', proTeamId: 2, injuryStatus: 'OUT' } },
        lineupSlotId: 0,
      }]));

      const params = makeParams(sport, { team_id: '6', snapshot: { type: 'current', requestedWeek: 15 } });
      const result = await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      const rosterCall = espnFetchMock.mock.calls[0][0] as string;
      expect(rosterCall).not.toContain('scoringPeriodId');
      expect(rosterCall).not.toContain('week=');
      expect(rosterCall).not.toContain('date=');

      const data = result.data as {
        snapshot: Record<string, unknown>;
        roster: Array<Record<string, unknown>>;
        limitations?: unknown;
      };
      expect(data.snapshot.type).toBe('current');
      expect(data.snapshot.requested_week).toBe(15);
      expect(data.snapshot.note).toBeTruthy();
      expect(data.roster[0].proTeam).toBeDefined();
      expect(data.roster[0].injuryStatus).toBeDefined();
      expect(data.limitations).toBeUndefined();
    });

    it('resolves as_of_date through the season calendar to a scoringPeriodId', async () => {
      espnFetchMock.mockImplementation(async (path: string) => {
        if (path.includes('proTeamSchedules_wl')) return calendarResponse();
        return rosterResponse([{
          playerPoolEntry: { player: { id: 1, fullName: 'Player One' } },
          lineupSlotId: 0,
        }]);
      });

      const params = makeParams(sport, { team_id: '6', snapshot: { type: 'date', date: '2024-04-15' } });
      const result = await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      const rosterCall = espnFetchMock.mock.calls.find(([p]) => (p as string).includes('mRoster'));
      expect(rosterCall?.[0]).toContain('scoringPeriodId=6');
      const data = result.data as { snapshot: Record<string, unknown>; limitations?: Record<string, unknown> };
      expect(data.snapshot).toEqual({ type: 'date', date: '2024-04-15', providerScoringPeriodId: 6 });
      // historical entries without acquisition fields flag the limitation,
      // alongside the always-on historical playerProTeamAvailable flag (FLA-278)
      expect(data.limitations).toEqual({ acquisitionMetadataAvailable: false, playerProTeamAvailable: false, keeperValueFutureAvailable: false });
    });

    it('omits the acquisition limitation but keeps playerProTeamAvailable when every historical entry carries acquisition data', async () => {
      espnFetchMock.mockImplementation(async (path: string) => {
        if (path.includes('proTeamSchedules_wl')) return calendarResponse();
        return rosterResponse([{
          playerPoolEntry: { player: { id: 1, fullName: 'Player One' } },
          lineupSlotId: 0,
          acquisitionType: 'DRAFT',
          acquisitionDate: 1710000000000,
        }]);
      });

      const params = makeParams(sport, { team_id: '6', snapshot: { type: 'date', date: '2024-04-15' } });
      const result = await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      const data = result.data as { limitations?: unknown };
      // acquisition metadata is present, but the snapshot is still historical, so
      // playerProTeamAvailable: false remains — ESPN's mRoster payload never
      // carries historical pro-team/injury data regardless of acquisition detail.
      expect(data.limitations).toEqual({ playerProTeamAvailable: false, keeperValueFutureAvailable: false });
    });

    const partialAcquisitionEntries: Array<[string, Record<string, unknown>]> = [
      ['both fields missing', {}],
      ['type only', { acquisitionType: 'DRAFT' }],
      ['date only', { acquisitionDate: 1710000000000 }],
    ];

    it.each(partialAcquisitionEntries)('flags incomplete acquisition metadata (%s) conservatively', async (_label, partialFields) => {
      espnFetchMock.mockImplementation(async (path: string) => {
        if (path.includes('proTeamSchedules_wl')) return calendarResponse();
        return rosterResponse([
          {
            playerPoolEntry: { player: { id: 1, fullName: 'Player One' } },
            lineupSlotId: 0,
            acquisitionType: 'DRAFT',
            acquisitionDate: 1710000000000,
          },
          {
            playerPoolEntry: { player: { id: 2, fullName: 'Player Two' } },
            lineupSlotId: 1,
            ...partialFields,
          },
        ]);
      });

      const params = makeParams(sport, { team_id: '6', snapshot: { type: 'date', date: '2024-04-15' } });
      const result = await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      const data = result.data as { limitations?: Record<string, unknown> };
      expect(data.limitations).toEqual({ acquisitionMetadataAvailable: false, playerProTeamAvailable: false, keeperValueFutureAvailable: false });
    });

    it('rejects a malformed injected snapshot without degrading to current', async () => {
      const params = makeParams(sport, { team_id: '6', snapshot: { type: 'date', date: '2024-02-30' } });
      const result = await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_ROSTER_SNAPSHOT_SELECTOR');
      expect(espnFetchMock).not.toHaveBeenCalled();
    });

    it('surfaces out-of-season dates as corrective errors', async () => {
      espnFetchMock.mockImplementation(async (path: string) => {
        if (path.includes('proTeamSchedules_wl')) return calendarResponse();
        return rosterResponse();
      });

      const params = makeParams(sport, { team_id: '6', snapshot: { type: 'date', date: '2024-09-01' } });
      const result = await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_ROSTER_SNAPSHOT_SELECTOR');
      expect(result.error).toContain('outside this season');
    });

    it('keeps the current path to a single roster fetch', async () => {
      espnFetchMock.mockResolvedValue(rosterResponse());
      const params = makeParams(sport, { team_id: '6' });
      const result = await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      expect(espnFetchMock).toHaveBeenCalledTimes(1);
      const data = result.data as { snapshot: Record<string, unknown> };
      expect(data.snapshot).toEqual({ type: 'current' });
    });

    it('omits proTeam/injuryStatus on a historical as_of_date snapshot and flags playerProTeamAvailable (FLA-278)', async () => {
      espnFetchMock.mockImplementation(async (path: string) => {
        if (path.includes('proTeamSchedules_wl')) return calendarResponse();
        return rosterResponse([{
          playerPoolEntry: { player: { id: 1, fullName: 'Player One', proTeamId: 2, injuryStatus: 'OUT' } },
          lineupSlotId: 0,
          acquisitionType: 'DRAFT',
          acquisitionDate: 1710000000000,
        }]);
      });

      const params = makeParams(sport, { team_id: '6', snapshot: { type: 'date', date: '2024-04-15' } });
      const result = await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      const data = result.data as { roster: Array<Record<string, unknown>>; limitations?: Record<string, unknown> };
      expect(data.roster[0]).not.toHaveProperty('proTeam');
      expect(data.roster[0]).not.toHaveProperty('injuryStatus');
      // acquisition metadata is complete here, so only the pro-team flag is set
      expect(data.limitations).toEqual({ playerProTeamAvailable: false, keeperValueFutureAvailable: false });
    });

    it('keeps proTeam/injuryStatus on the current roster', async () => {
      espnFetchMock.mockResolvedValue(rosterResponse([{
        playerPoolEntry: { player: { id: 1, fullName: 'Player One', proTeamId: 2, injuryStatus: 'OUT' } },
        lineupSlotId: 0,
      }]));
      const params = makeParams(sport, { team_id: '6' });
      const result = await handlers.get_roster({} as never, params, 'Bearer x', 'cid');

      expect(result.success).toBe(true);
      const data = result.data as { roster: Array<Record<string, unknown>>; limitations?: unknown };
      expect(data.roster[0].proTeam).toBeDefined();
      expect(data.roster[0].injuryStatus).toBeDefined();
      expect(data.limitations).toBeUndefined();
    });
  });
});
