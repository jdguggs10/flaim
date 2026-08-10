// FLA-177: fixture-based runtime validation for the declared tool outputSchemas.
//
// The MCP SDK validates every non-error structuredContent against the declared
// outputSchema at runtime and throws on mismatch — a too-tight schema is a
// production tool outage. These fixtures mirror the real success envelopes each
// platform worker assembles (shapes mined from workers/espn-client,
// workers/yahoo-client, and workers/sleeper-client handlers and test fixtures)
// and assert that every one of them passes the declared schema.
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { getUnifiedTools } from '../mcp/tools';
import { normalizeFreeAgentsResult } from '../mcp/free-agent-normalizer';
import type { ToolParams } from '../types';

function outputSchemaFor(name: string): z.ZodTypeAny {
  const tool = getUnifiedTools().find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`unknown tool: ${name}`);
  return tool.outputSchema as z.ZodTypeAny;
}

function expectValid(toolName: string, structuredContent: Record<string, unknown>): void {
  const result = outputSchemaFor(toolName).safeParse(structuredContent);
  if (!result.success) {
    throw new Error(
      `outputSchema for ${toolName} rejected a realistic payload:\n${JSON.stringify(result.error.issues, null, 2)}`
    );
  }
  expect(result.success).toBe(true);
}

/** Wrap a platform envelope the way routeResultToMcp emits structuredContent. */
function routed(data: Record<string, unknown>): Record<string, unknown> {
  return { success: true, data };
}

describe('output schema declarations', () => {
  it('every tool declares an outputSchema', () => {
    for (const tool of getUnifiedTools()) {
      expect(tool.outputSchema, tool.name).toBeDefined();
    }
  });

  it('root schemas tolerate unknown keys (never strict)', () => {
    // A future envelope field must never become a runtime validation outage.
    expectValid('get_standings', {
      success: true,
      data: { leagueId: '1', standings: [], some_future_field: { nested: true } },
      future_root_field: 'ok',
    });
  });
});

describe('gateway-owned output schemas', () => {
  it('get_user_session accepts a fully populated session payload', () => {
    const league = {
      leagueId: '449.l.1000',
      sport: 'football',
      platform: 'yahoo',
      teamId: 't1',
      seasonYear: 2025,
      leagueName: 'Touchdown League',
      teamName: 'My Team',
    };
    expectValid('get_user_session', {
      success: true,
      currentDate: '2026-03-05T17:00:00.000Z',
      currentSeasons: {
        football: { year: 2025, label: '2025' },
        baseball: { year: 2026, label: '2026' },
        basketball: { year: 2025, label: '2025-26' },
        hockey: { year: 2025, label: '2025-26' },
      },
      timezone: 'America/New_York',
      totalLeaguesFound: 2,
      leaguesBySport: { football: 1, baseball: 1 },
      defaultSport: 'football',
      defaultLeague: {
        platform: 'yahoo',
        sport: 'football',
        leagueId: '449.l.1000',
        teamId: 't1',
        seasonYear: 2025,
        season: '2025',
        leagueName: 'Touchdown League',
        teamName: 'My Team',
      },
      defaultLeagues: {
        football: {
          platform: 'yahoo',
          leagueId: '449.l.1000',
          leagueName: 'Touchdown League',
          sport: 'football',
          seasonYear: 2025,
          season: '2025',
          teamId: 't1',
          teamName: 'My Team',
        },
      },
      allLeagues: [
        league,
        {
          leagueId: 'sleeper-2025',
          sport: 'football',
          platform: 'sleeper',
          teamId: '7',
          seasonYear: 2025,
          leagueName: 'Dynasty Squad',
          recurringLeagueId: 'sleeper-root',
        },
      ],
      warnings: ['Yahoo: Yahoo leagues fetch failed: 502'],
      instructions: 'Use platform="yahoo" ... for all tool calls.',
    });
  });

  it('get_user_session accepts a sparse league entry (no sport, null metadata)', () => {
    // Defensive shape (audit m3): sport absent and nullable metadata null.
    // Gateway assembly guards absent sport (l.sport?.toLowerCase()) and the
    // registry column's NOT NULL could not be proven from migrations, so a
    // sparse row must never become a runtime validation outage.
    expectValid('get_user_session', {
      success: true,
      currentDate: '2026-03-05T17:00:00.000Z',
      currentSeasons: {
        football: { year: 2025, label: '2025' },
        baseball: { year: 2026, label: '2026' },
        basketball: { year: 2025, label: '2025-26' },
        hockey: { year: 2025, label: '2025-26' },
      },
      timezone: 'America/New_York',
      totalLeaguesFound: 1,
      leaguesBySport: {},
      defaultSport: null,
      defaultLeague: null,
      defaultLeagues: {},
      allLeagues: [
        {
          leagueId: '123456',
          platform: 'espn',
          seasonYear: null,
          leagueName: null,
          teamName: null,
        },
      ],
      instructions: 'Use platform="espn" ... for all tool calls.',
    });
  });

  it('get_user_session accepts the empty-leagues payload (nullable defaults, undefined warnings)', () => {
    expectValid('get_user_session', {
      success: true,
      currentDate: '2026-03-05T17:00:00.000Z',
      currentSeasons: {
        football: { year: 2025, label: '2025' },
        baseball: { year: 2026, label: '2026' },
        basketball: { year: 2025, label: '2025-26' },
        hockey: { year: 2025, label: '2025-26' },
      },
      timezone: 'America/New_York',
      totalLeaguesFound: 0,
      leaguesBySport: {},
      defaultSport: null,
      defaultLeague: null,
      defaultLeagues: {},
      allLeagues: [],
      warnings: undefined,
      instructions: 'No leagues configured. Ask the user to open https://flaim.app/leagues ...',
    });
  });

  it('refresh_leagues accepts the auth-worker batch response', () => {
    expectValid('refresh_leagues', {
      success: true,
      requestedPlatforms: ['espn', 'yahoo', 'sleeper'],
      results: {
        espn: {
          platform: 'espn',
          status: 'success',
          httpStatus: 200,
          details: { currentSeason: { found: 1, added: 0, alreadySaved: 1, refreshed: 0 } },
        },
        yahoo: {
          platform: 'yahoo',
          status: 'error',
          httpStatus: 429,
          error: 'rate_limited',
          error_description: 'Try again later',
          retryAfter: '30',
        },
        sleeper: { platform: 'sleeper', status: 'skipped', error: 'not_connected' },
      },
    });
  });

  it('refresh_leagues accepts the non-JSON fallback envelope (success + error only)', () => {
    // refreshUserLeagues builds {success: response.ok, error: text} when the
    // auth-worker responds without a JSON content type — requestedPlatforms and
    // results must therefore stay optional.
    expectValid('refresh_leagues', { success: true, error: 'plain-text body' });
  });

  it('get_ancient_history accepts old leagues and grouped old seasons', () => {
    const oldLeague = {
      leagueId: '331.l.777',
      sport: 'football',
      platform: 'yahoo',
      teamId: 't9',
      seasonYear: 2014,
      leagueName: 'Retired League',
    };
    expectValid('get_ancient_history', {
      success: true,
      thresholdYear: 2024,
      oldLeagues: [oldLeague],
      oldSeasonsFromActiveLeagues: {
        'sleeper:football:sleeper-root': [
          {
            leagueId: 'sleeper-2024',
            sport: 'football',
            platform: 'sleeper',
            teamId: '7',
            seasonYear: 2024,
            leagueName: 'Dynasty Squad',
            recurringLeagueId: 'sleeper-root',
          },
        ],
      },
      totalOldLeagues: 1,
      totalOldSeasons: 1,
      warnings: ['Sleeper leagues fetch timed out'],
    });
  });
});

describe('get_league_info output schema', () => {
  it('accepts the ESPN envelope', () => {
    expectValid('get_league_info', routed({
      id: 336777,
      name: 'Gridiron League',
      size: 10,
      // ESPN emits a status OBJECT (caught live on preview, 2026-07-26); only
      // Yahoo/Sleeper use status strings.
      status: { currentMatchupPeriod: 5, isActive: true, latestScoringPeriod: 5 },
      scoringPeriodId: 5,
      currentMatchupPeriod: 5,
      seasonId: 2025,
      segmentId: 0,
      teams: [
        { id: 1, name: 'Team One', abbrev: 'ONE', ownerName: 'Alice', owners: ['Alice'] },
        { id: 2, name: 'Team Two', abbrev: 'TWO', ownerName: undefined, owners: undefined },
      ],
      scoringSettings: { type: 'H2H_POINTS', matchupPeriods: {}, playoffTeamCount: 4 },
      roster: { lineupSlotCounts: { '0': 1 }, positionLimits: {} },
      schedule: { playoffSeedingRule: 'TOTAL_POINTS_SCORED', playoffMatchupPeriodLength: 1 },
    }));
  });

  it('accepts the Yahoo envelope', () => {
    expectValid('get_league_info', routed({
      leagueKey: '449.l.123',
      leagueId: '123',
      name: 'Car Ramrod',
      url: 'https://football.fantasysports.yahoo.com/f1/123',
      numTeams: 12,
      scoringType: 'head',
      currentWeek: '5',
      startWeek: '1',
      endWeek: '17',
      isFinished: false,
      draftStatus: 'postdraft',
      teams: [{ teamKey: '449.l.123.t.1', name: 'Yahoo Team', ownerName: 'Gerry' }],
    }));
  });

  it('accepts the Sleeper envelope', () => {
    expectValid('get_league_info', routed({
      leagueId: 'sleeper-2025',
      name: 'Dynasty Squad',
      sport: 'nfl',
      season: '2025',
      status: 'in_season',
      totalRosters: 12,
      rosterPositions: ['QB', 'RB', 'RB', 'WR', 'FLEX', 'BN'],
      scoringSettings: { rec: 1, pass_td: 4 },
      previousLeagueId: null,
      draftId: 'draft-1',
      teams: [{ rosterId: 7, ownerId: 'user-1', ownerName: 'Gerry' }],
    }));
  });
});

describe('get_standings output schema', () => {
  it('accepts ESPN standings with derived outcome fields', () => {
    expectValid('get_standings', routed({
      leagueId: '336777',
      seasonYear: 2024,
      seasonPhase: 'season_complete',
      seasonComplete: true,
      standings: [
        {
          teamId: 1,
          name: 'Champs',
          rank: 1,
          wins: 11,
          losses: 3,
          playoffSeed: 1,
          finalRank: 1,
          championshipWon: true,
          playoffOutcome: 'champion',
          outcomeConfidence: 'derived',
          madePlayoffs: true,
        },
      ],
    }));
  });

  it('accepts Yahoo standings where every outcome field is null', () => {
    expectValid('get_standings', routed({
      leagueKey: '449.l.123',
      leagueName: 'Car Ramrod',
      seasonPhase: 'regular_season',
      seasonComplete: false,
      standings: [
        {
          rank: '1',
          teamKey: '449.l.123.t.1',
          teamId: '1',
          name: 'Yahoo Team',
          wins: '4',
          losses: '1',
          ties: '0',
          percentage: '.800',
          pointsFor: '612.5',
          pointsAgainst: '540.1',
          playoffSeed: null,
          madePlayoffs: null,
          finalRank: null,
          championshipWon: null,
          playoffOutcome: null,
          outcomeConfidence: null,
        },
      ],
    }));
  });

  it('accepts Sleeper standings with in-progress playoffs', () => {
    expectValid('get_standings', routed({
      leagueId: 'sleeper-2025',
      seasonPhase: 'playoffs_in_progress',
      seasonComplete: false,
      standings: [
        {
          rosterId: 7,
          ownerName: 'Gerry',
          rank: 2,
          wins: 9,
          losses: 5,
          playoffSeed: 2,
          finalRank: null,
          championshipWon: null,
          playoffOutcome: 'in_progress',
          outcomeConfidence: null,
          madePlayoffs: true,
        },
      ],
    }));
  });
});

describe('get_matchups output schema', () => {
  it('accepts the ESPN envelope with a null matchupPeriod', () => {
    expectValid('get_matchups', routed({
      leagueId: '336777',
      seasonYear: 2025,
      currentScoringPeriod: 5,
      matchupPeriod: null,
      matchups: [
        {
          home: { teamId: 1, totalPoints: 101.2 },
          away: { teamId: 2, totalPoints: 98.7 },
          winner: 'home',
        },
      ],
    }));
  });

  it('accepts the Yahoo envelope with string week fields', () => {
    expectValid('get_matchups', routed({
      leagueKey: '449.l.123',
      leagueName: 'Car Ramrod',
      currentWeek: '5',
      matchupWeek: 5,
      matchups: [{ week: '5', teams: [] }],
    }));
  });

  it('accepts the Sleeper envelope with a bye (null away side)', () => {
    expectValid('get_matchups', routed({
      leagueId: 'sleeper-2025',
      week: 15,
      matchups: [
        {
          matchupId: 1,
          home: { rosterId: 7, ownerName: 'Gerry', points: 110.4, starters: ['4034'] },
          away: null,
          winner: undefined,
        },
      ],
    }));
  });
});

describe('get_roster output schema', () => {
  it('accepts the ESPN roster envelope', () => {
    expectValid('get_roster', routed({
      leagueId: '336777',
      teamId: 1,
      teamName: 'Team One',
      ownerName: 'Alice',
      snapshot: { type: 'current' },
      roster: [{ playerId: 3139477, name: 'Patrick Mahomes', lineupSlot: 'QB', percentOwned: 99.9 }],
    }));
  });

  it('accepts the ESPN historical roster with limitations', () => {
    expectValid('get_roster', routed({
      leagueId: '336777',
      teamId: 1,
      teamName: 'Team One',
      ownerName: 'Alice',
      snapshot: { type: 'week', week: 5, providerScoringPeriodId: 5 },
      limitations: { acquisitionMetadataAvailable: false },
      roster: [],
    }));
  });

  it('accepts the Yahoo roster envelope (no leagueId)', () => {
    expectValid('get_roster', routed({
      teamKey: '449.l.123.t.1',
      teamName: 'Yahoo Team',
      ownerName: 'Gerry',
      snapshot: { type: 'date', date: '2026-07-10' },
      players: [{ playerId: '201', name: 'Aaron Judge', position: 'OF' }],
    }));
  });

  it('accepts the Sleeper current roster for a selected team', () => {
    expectValid('get_roster', routed({
      leagueId: 'sleeper-2025',
      rosterId: 7,
      ownerId: 'user-1',
      ownerName: 'Gerry',
      snapshot: { type: 'current' },
      starters: ['4034', '4035'],
      bench: ['5001'],
      reserve: [],
      taxi: ['6002'],
      record: { wins: 9, losses: 5, ties: 0 },
    }));
  });

  it('accepts the Sleeper current league-wide roster list', () => {
    expectValid('get_roster', routed({
      leagueId: 'sleeper-2025',
      snapshot: { type: 'current' },
      rosters: [
        { rosterId: 7, ownerId: 'user-1', ownerName: 'Gerry', playerCount: 15, starterCount: 9 },
        { rosterId: 8, ownerId: 'user-2', ownerName: 'Unknown', playerCount: 15, starterCount: 9 },
      ],
    }));
  });

  it('accepts the Sleeper historical week roster', () => {
    expectValid('get_roster', routed({
      leagueId: 'sleeper-2025',
      rosterId: 7,
      ownerId: 'user-1',
      ownerName: 'Gerry',
      snapshot: { type: 'week', week: 3 },
      starters: ['4034'],
      bench: ['5001'],
      points: 121.34,
      playersPoints: { '4034': 24.7, '5001': 0 },
      limitations: { reserveAndTaxiClassificationAvailable: false },
    }));
  });
});

describe('get_free_agents output schema', () => {
  // FLA-216: structuredContent for this tool is the gateway-normalized payload,
  // so fixtures are handler-true provider envelopes (proTeam on ESPN, players
  // key on Sleeper) run through normalizeFreeAgentsResult — validating exactly
  // what mcpSuccess will serialize.
  function normalized(platform: ToolParams['platform'], data: Record<string, unknown>, overrides: Partial<ToolParams> = {}): Record<string, unknown> {
    const params: ToolParams = {
      platform,
      sport: 'football',
      league_id: '336777',
      season_year: 2025,
      ...overrides,
    };
    const result = normalizeFreeAgentsResult({ success: true, data }, params);
    if (!result.success) throw new Error('normalizer must preserve success');
    return routed(result.data as Record<string, unknown>);
  }

  it('accepts the normalized ESPN envelope with status and waiver metadata', () => {
    expectValid('get_free_agents', normalized('espn', {
      leagueId: '336777',
      seasonYear: 2025,
      position: 'RB',
      count: 2,
      freeAgents: [
        {
          playerId: 4429795,
          name: 'Rookie Back',
          proTeam: 'BUF',
          percentOwned: 43.1,
          percentStarted: 20.4,
          status: 'WAIVERS',
          waiverProcessDate: 1760000000000,
        },
        {
          playerId: 4429796,
          name: 'Deep Stash',
          proTeam: 'FA',
          percentOwned: undefined,
          percentStarted: undefined,
          status: 'FREEAGENT',
          waiverProcessDate: undefined,
        },
      ],
    }));
  });

  it('accepts normalized Yahoo entries with percentOwned null (FLA-132)', () => {
    expectValid('get_free_agents', normalized('yahoo', {
      leagueKey: '449.l.123',
      leagueName: 'Car Ramrod',
      position: 'ALL',
      count: 2,
      freeAgents: [
        { playerKey: '449.p.201', playerId: '201', name: 'Free Agent', team: 'BOS', percentOwned: 12.5 },
        { playerKey: '449.p.202', playerId: '202', name: 'Unowned Guy', team: 'NYY', percentOwned: null },
      ],
    }, { league_id: '449.l.123' }));
  });

  it('accepts the normalized Sleeper players-key envelope (snake_case ids, no ownership fields)', () => {
    expectValid('get_free_agents', normalized('sleeper', {
      platform: 'sleeper',
      sport: 'football',
      league_id: 'sleeper-2025',
      season_year: 2025,
      count: 1,
      players: [{ id: '4034', name: 'Sleeper FA', position: 'QB', team: 'BUF' }],
    }, { league_id: 'sleeper-2025' }));
  });

  it('accepts the normalized Sleeper degraded envelope (player-index failure warning)', () => {
    expectValid('get_free_agents', normalized('sleeper', {
      platform: 'sleeper',
      sport: 'football',
      league_id: 'sleeper-2025',
      season_year: 2025,
      count: 0,
      players: [],
      warning: 'PLAYER_ENRICHMENT_UNAVAILABLE: free-agent player index unavailable; returning empty list',
    }, { league_id: 'sleeper-2025' }));
  });
});

describe('get_players output schema', () => {
  it('accepts ESPN entries with market_percent_owned and league_status null', () => {
    expectValid('get_players', routed({
      platform: 'espn',
      sport: 'baseball',
      query: 'judge',
      count: 2,
      players: [
        {
          id: '33192',
          name: 'Aaron Judge',
          position: 'OF',
          team: 'NYY',
          market_percent_owned: 99.8,
          ownership_scope: 'platform_global',
          league_status: 'ROSTERED',
          league_team_name: 'Diamond Dogs',
          league_owner_name: 'Alice',
        },
        {
          id: '40123',
          name: 'A. Judgeson',
          position: 'SP',
          team: 'FA',
          market_percent_owned: null,
          ownership_scope: 'platform_global',
          league_status: null,
          league_team_name: null,
          league_owner_name: null,
        },
      ],
    }));
  });

  it('accepts the Yahoo envelope (leagueKey/leagueName, no platform/sport keys)', () => {
    expectValid('get_players', routed({
      leagueKey: '449.l.123',
      leagueName: 'Car Ramrod',
      query: 'judge',
      count: 1,
      players: [
        {
          id: '9877',
          name: 'Aaron Judge',
          team: 'NYY',
          position: 'OF',
          market_percent_owned: 99,
          ownership_scope: 'platform_global',
          league_status: 'FREE_AGENT',
          league_team_name: null,
          league_owner_name: null,
        },
      ],
    }));
  });

  it('accepts Sleeper identity-only entries (ownership unavailable)', () => {
    expectValid('get_players', routed({
      platform: 'sleeper',
      sport: 'football',
      query: 'allen',
      count: 1,
      players: [
        {
          id: '4034',
          name: 'Josh Allen',
          position: 'QB',
          team: null,
          market_percent_owned: null,
          ownership_scope: 'unavailable',
          league_status: null,
          league_team_name: null,
          league_owner_name: null,
        },
      ],
    }));
  });
});

describe('get_transactions output schema', () => {
  it('accepts the ESPN matchup-window envelope and limitations', () => {
    expectValid('get_transactions', routed({
      platform: 'espn',
      sport: 'baseball',
      league_id: '336777',
      season_year: 2025,
      window: {
        mode: 'explicit_week',
        unit: 'matchup_period',
        requested_week: 4,
        normalization: 'none',
        weeks: [4],
        provider_scoring_period_ids: [22, 23, 24, 25, 26],
        start_date: '2026-04-20',
        end_date: '2026-04-24',
        date_bounds_kind: 'exact_contiguous',
        timezone: 'America/New_York',
      },
      source: 'activity_feed',
      limitations: {
        structured_details_incomplete: true,
        omitted_unscoped_rows: 2,
        omitted_conflicting_rows: 1,
        window_coverage_incomplete: true,
      },
      count: 2,
      truncated: true,
      transactions: [
        {
          transaction_id: 'tx-1',
          date: '2026-07-20',
          type: 'trade',
          status: 'EXECUTED',
          timestamp: 1784563200000,
          week: 4,
          provider_scoring_period_id: 25,
          team_ids: [1, 2],
          trade_sides: [
            { team_id: '1', acquired: [{ id: 'a', name: 'Player A' }], gave_up: [{ id: 'b' }] },
            { team_id: '2', acquired: [{ id: 'b' }], gave_up: [{ id: 'a' }] },
          ],
          faab_bid: null,
        },
        { transaction_id: 'tx-2', date: '2026-07-19', type: 'add', status: 'complete', week: 4, team_ids: [3] },
      ],
      teams: { '1': 'Team One', '2': 'Team Two', '3': 'Team Three' },
    }));
  });

  it('accepts the Yahoo envelope with waiver metadata and timestamp window', () => {
    expectValid('get_transactions', routed({
      platform: 'yahoo',
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
      window: {
        mode: 'recent_two_weeks_timestamp',
        weeks: [],
        start_timestamp_ms: 1760000000000,
        end_timestamp_ms: 1761209600000,
      },
      warning: 'Some transactions were missing timestamps and were dropped.',
      dropped_invalid_timestamp_count: 1,
      count: 1,
      transactions: [
        {
          transaction_id: '449.l.123.tr.10',
          date: '2026-07-20',
          type: 'waiver',
          status: 'pending',
          week: null,
          team_ids: ['449.l.123.t.1'],
          waiver_priority: 3,
          draft_picks: null,
        },
      ],
    }));
  });

  it('accepts the Yahoo pending-window envelope for own-team waiver views', () => {
    expectValid('get_transactions', routed({
      platform: 'yahoo',
      sport: 'football',
      league_id: '449.l.123',
      season_year: 2025,
      window: {
        mode: 'pending',
        weeks: [],
        start_timestamp_ms: undefined,
        end_timestamp_ms: undefined,
      },
      count: 1,
      transactions: [
        {
          transaction_id: '449.l.123.tr.11',
          date: '2026-07-21',
          type: 'pending_trade',
          status: 'pending',
          week: null,
          team_ids: ['449.l.123.t.1'],
          draft_picks: null,
        },
      ],
    }));
  });

  it('accepts the minimal Sleeper envelope', () => {
    expectValid('get_transactions', routed({
      platform: 'sleeper',
      sport: 'football',
      league_id: 'sleeper-2025',
      season_year: 2025,
      window: { mode: 'explicit_week', weeks: [15] },
      count: 1,
      transactions: [
        { transaction_id: '9990', date: '2026-07-18', type: 'add', status: 'complete', week: 15, team_ids: [7] },
      ],
    }));
  });
});
