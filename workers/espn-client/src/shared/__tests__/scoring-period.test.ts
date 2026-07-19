import { beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';
import { clearScoringPeriodAnchorCache, resolveScoringPeriodForDate } from '../scoring-period';
import { espnFetch } from '../espn-api';

vi.mock('../espn-api', async () => {
  const actual = await vi.importActual('../espn-api') as Record<string, unknown>;
  return {
    ...actual,
    espnFetch: vi.fn(),
  };
});

const espnFetchMock = espnFetch as MockedFunction<typeof espnFetch>;

// 23:00 UTC is 18:00/19:00 ET — same ET calendar day as the date string.
function eveningGame(date: string): { date: number } {
  return { date: Date.parse(`${date}T23:00:00Z`) };
}

function calendarResponse(periods: Record<string, Array<{ date: number }>>): Response {
  return new Response(JSON.stringify({
    settings: { proTeams: [{ proGamesByScoringPeriod: periods }] },
  }), { status: 200 });
}

describe('resolveScoringPeriodForDate', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearScoringPeriodAnchorCache();
  });

  const happyCalendar = {
    '1': [eveningGame('2026-03-25')],
    '2': [eveningGame('2026-03-26')],
    // periods 3-4 are off-days with no games (e.g. All-Star break)
    '5': [eveningGame('2026-03-29')],
    '10': [eveningGame('2026-04-03')],
  };

  it('resolves a game-day date arithmetically', async () => {
    espnFetchMock.mockResolvedValue(calendarResponse(happyCalendar));
    await expect(resolveScoringPeriodForDate('flb', 2026, '2026-03-26'))
      .resolves.toEqual({ scoringPeriodId: 2 });
  });

  it('resolves off-day dates through calendar gaps', async () => {
    espnFetchMock.mockResolvedValue(calendarResponse(happyCalendar));
    await expect(resolveScoringPeriodForDate('flb', 2026, '2026-03-27'))
      .resolves.toEqual({ scoringPeriodId: 3 });
    await expect(resolveScoringPeriodForDate('flb', 2026, '2026-03-28'))
      .resolves.toEqual({ scoringPeriodId: 4 });
  });

  it('rejects dates outside the season with a corrective error naming the range', async () => {
    espnFetchMock.mockResolvedValue(calendarResponse(happyCalendar));
    await expect(resolveScoringPeriodForDate('flb', 2026, '2026-03-24'))
      .rejects.toThrow(/INVALID_ROSTER_SNAPSHOT_SELECTOR.*2026-03-25.*2026-04-03/);
    await expect(resolveScoringPeriodForDate('flb', 2026, '2026-04-04'))
      .rejects.toThrow(/INVALID_ROSTER_SNAPSHOT_SELECTOR/);
  });

  it('caches the anchor per gameId+season', async () => {
    espnFetchMock.mockResolvedValue(calendarResponse(happyCalendar));
    await resolveScoringPeriodForDate('flb', 2026, '2026-03-26');
    await resolveScoringPeriodForDate('flb', 2026, '2026-03-29');
    expect(espnFetchMock).toHaveBeenCalledTimes(1);

    espnFetchMock.mockResolvedValue(calendarResponse(happyCalendar));
    await resolveScoringPeriodForDate('fhl', 2026, '2026-03-26');
    expect(espnFetchMock).toHaveBeenCalledTimes(2);
  });

  it('counts a late-evening ET game on its ET calendar day', async () => {
    // 02:00 UTC on Mar 27 is 22:00 ET on Mar 26.
    espnFetchMock.mockResolvedValue(calendarResponse({
      '1': [eveningGame('2026-03-26'), { date: Date.parse('2026-03-27T02:00:00Z') }],
      '2': [eveningGame('2026-03-27')],
    }));
    await expect(resolveScoringPeriodForDate('flb', 2026, '2026-03-26'))
      .resolves.toEqual({ scoringPeriodId: 1 });
  });

  it('fails closed when a period spans multiple ET dates', async () => {
    espnFetchMock.mockResolvedValue(calendarResponse({
      '1': [eveningGame('2026-03-25'), eveningGame('2026-03-26')],
    }));
    await expect(resolveScoringPeriodForDate('flb', 2026, '2026-03-25'))
      .rejects.toThrow(/ESPN_INVALID_RESPONSE.*spans multiple calendar dates/);
  });

  it('fails closed when the constant day-offset invariant breaks', async () => {
    espnFetchMock.mockResolvedValue(calendarResponse({
      '1': [eveningGame('2026-03-25')],
      '2': [eveningGame('2026-03-27')], // offset jumps by one without a period jump
    }));
    await expect(resolveScoringPeriodForDate('flb', 2026, '2026-03-25'))
      .rejects.toThrow(/ESPN_INVALID_RESPONSE.*constant day-offset invariant/);
  });

  it('fails closed on an empty calendar', async () => {
    espnFetchMock.mockResolvedValue(calendarResponse({}));
    await expect(resolveScoringPeriodForDate('flb', 2026, '2026-03-25'))
      .rejects.toThrow(/ESPN_INVALID_RESPONSE.*no scoring-period games/);
  });
});
