// FLA-216: the gateway free-agent normalizer must be protocol-safe end to end.
// Every successful output here is also validated against the declared
// outputSchema — the property that actually prevents an MCP structuredContent
// protocol outage. Malformed provider successes become explicit
// MALFORMED_PROVIDER_RESPONSE tool errors (error responses are exempt from
// schema validation); malformed provider values map to null or are omitted,
// never guessed; provider-supplied values under canonical keys are discarded.
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { normalizeFreeAgentsResult } from '../mcp/free-agent-normalizer';
import { getUnifiedTools } from '../mcp/tools';
import type { RouteResult } from '../router';
import type { ToolParams } from '../types';

const outputSchema = getUnifiedTools().find((t) => t.name === 'get_free_agents')!.outputSchema as z.ZodTypeAny;

function params(platform: ToolParams['platform'], overrides: Partial<ToolParams> = {}): ToolParams {
  return {
    platform,
    sport: 'football',
    league_id: '336777',
    season_year: 2025,
    ...overrides,
  };
}

function ok(data: unknown): RouteResult {
  return { success: true, data } as RouteResult;
}

/** Normalize, assert success, validate against the declared outputSchema, return data. */
function normalizedData(result: RouteResult, p: ToolParams): Record<string, unknown> {
  const normalized = normalizeFreeAgentsResult(result, p);
  expect(normalized.success).toBe(true);
  const wrapped = { success: true, data: normalized.data };
  const parsed = outputSchema.safeParse(wrapped);
  if (!parsed.success) {
    throw new Error(`normalized payload failed the declared outputSchema:\n${JSON.stringify(parsed.error.issues, null, 2)}`);
  }
  return normalized.data as Record<string, unknown>;
}

function expectMalformed(result: RouteResult, p: ToolParams): void {
  const normalized = normalizeFreeAgentsResult(result, p);
  expect(normalized.success).toBe(false);
  expect((normalized as { code?: string }).code).toBe('MALFORMED_PROVIDER_RESPONSE');
}

describe('normalizeFreeAgentsResult — canonical envelope', () => {
  it('adds the full schema-valid envelope for each platform with the right capability matrix', () => {
    const espn = normalizedData(ok({ leagueId: '336777', freeAgents: [] }), params('espn'));
    expect(espn.ordering).toBe('platform_rostered_rate_desc');
    expect(espn.capabilities).toEqual({ acquisitionState: true, rosteredRate: true, startedRate: true });
    expect(espn.ownershipScope).toBe('platform_global');

    const yahoo = normalizedData(ok({ leagueKey: '449.l.123', freeAgents: [] }), params('yahoo', { league_id: '449.l.123' }));
    expect(yahoo.ordering).toBe('platform_rostered_rate_desc');
    expect(yahoo.capabilities).toEqual({ acquisitionState: false, rosteredRate: true, startedRate: false });
    expect(yahoo.ownershipScope).toBe('platform_global');
    expect(yahoo.leagueId).toBe('449.l.123');
    expect(yahoo.seasonYear).toBe(2025);

    const sleeper = normalizedData(ok({ league_id: 'slp-1', players: [] }), params('sleeper', { league_id: 'slp-1' }));
    expect(sleeper.ordering).toBe('alphabetical');
    expect(sleeper.capabilities).toEqual({ acquisitionState: false, rosteredRate: false, startedRate: false });
    expect(sleeper.ownershipScope).toBe('unavailable');
    expect(sleeper.leagueId).toBe('slp-1');
  });

  it('derives request echoes from validated params, not provider claims', () => {
    const data = normalizedData(
      ok({ seasonYear: 1999, position: 'WR', count: 99, freeAgents: [{ playerId: 1 }, { playerId: 2 }] }),
      params('espn', { position: 'qb' })
    );
    expect(data.seasonYear).toBe(2025);
    expect(data.position).toBe('QB');
    expect(data.count).toBe(2);
  });

  it('defaults position to ALL and count to zero when the provider omits the array', () => {
    const data = normalizedData(ok({}), params('sleeper'));
    expect(data.position).toBe('ALL');
    expect(data.count).toBe(0);
    expect('players' in data).toBe(false);
  });

  it('stringifies a numeric provider league id', () => {
    const data = normalizedData(ok({ leagueId: 336777, freeAgents: [] }), params('espn'));
    expect(data.leagueId).toBe('336777');
  });
});

describe('normalizeFreeAgentsResult — ESPN entries', () => {
  it('maps status, converts the waiver timestamp, stringifies the id, and derives team', () => {
    const data = normalizedData(
      ok({
        freeAgents: [{
          playerId: 4429795,
          name: 'Rookie Back',
          proTeam: 'BUF',
          percentOwned: 43.1,
          status: 'WAIVERS',
          waiverProcessDate: 1760000000000,
        }],
      }),
      params('espn')
    );
    const [normalized] = data.freeAgents as Array<Record<string, unknown>>;
    expect(normalized.acquisitionState).toBe('waivers');
    expect(normalized.waiverClearsAt).toBe(new Date(1760000000000).toISOString());
    expect(normalized.id).toBe('4429795');
    expect(normalized.team).toBe('BUF');
    // Legacy fields stay untouched beside the canonical ones.
    expect(normalized.status).toBe('WAIVERS');
    expect(normalized.waiverProcessDate).toBe(1760000000000);
    expect(normalized.proTeam).toBe('BUF');
    expect(normalized.playerId).toBe(4429795);
  });

  it('maps FREEAGENT and the FA no-club sentinel', () => {
    const data = normalizedData(
      ok({ freeAgents: [{ playerId: 1, status: 'FREEAGENT', proTeam: 'FA' }] }),
      params('espn')
    );
    const [normalized] = data.freeAgents as Array<Record<string, unknown>>;
    expect(normalized.acquisitionState).toBe('free_agent');
    expect(normalized.team).toBeNull();
    expect(normalized.proTeam).toBe('FA');
  });

  it('fails closed on missing/unknown status and invalid timestamps (epoch zero and earlier included)', () => {
    const data = normalizedData(
      ok({
        freeAgents: [
          { playerId: 1 },
          { playerId: 2, status: 'ONTEAM' },
          // Finite but beyond the valid Date range (~±8.64e15) → Invalid Date;
          // NaN itself cannot occur in wire JSON, so this is the realistic bad case.
          { playerId: 3, status: 'WAIVERS', waiverProcessDate: 8.64e15 * 2 },
          { playerId: 4, status: 'WAIVERS', waiverProcessDate: 'tomorrow' },
          { playerId: 5, status: 'WAIVERS', waiverProcessDate: 0 },
          { playerId: 6, status: 'WAIVERS', waiverProcessDate: -5 },
        ],
      }),
      params('espn')
    );
    const entries = data.freeAgents as Array<Record<string, unknown>>;
    expect(entries[0].acquisitionState).toBeNull();
    expect(entries[1].acquisitionState).toBeNull();
    for (const waivers of entries.slice(2)) {
      expect(waivers.acquisitionState).toBe('waivers');
      expect('waiverClearsAt' in waivers).toBe(false);
    }
  });

  it('discards provider-supplied values under reserved canonical keys', () => {
    const data = normalizedData(
      ok({
        freeAgents: [{
          name: 'Spoofer',
          id: 'provider-junk',
          waiverClearsAt: 'provider-junk',
          acquisitionState: 'provider-junk',
          team: 'provider-junk',
        }],
      }),
      params('espn')
    );
    const [normalized] = data.freeAgents as Array<Record<string, unknown>>;
    expect('id' in normalized).toBe(false);
    expect('waiverClearsAt' in normalized).toBe(false);
    expect(normalized.acquisitionState).toBeNull();
    expect(normalized.team).toBeNull();
  });
});

describe('normalizeFreeAgentsResult — Yahoo and Sleeper entries', () => {
  it('adds id and null-team to Yahoo entries and never emits acquisition fields', () => {
    const data = normalizedData(
      ok({
        leagueKey: '449.l.123',
        freeAgents: [{
          playerKey: '449.p.201',
          playerId: '201',
          name: 'FA',
          team: '',
          acquisitionState: 'provider-junk',
          waiverClearsAt: 'provider-junk',
        }],
      }),
      params('yahoo', { league_id: '449.l.123' })
    );
    const [normalized] = data.freeAgents as Array<Record<string, unknown>>;
    expect(normalized.id).toBe('201');
    expect(normalized.team).toBeNull();
    expect('acquisitionState' in normalized).toBe(false);
    expect('waiverClearsAt' in normalized).toBe(false);
  });

  it('coerces Sleeper ids to strings and normalizes missing team to null', () => {
    const data = normalizedData(
      ok({ league_id: 'slp-1', players: [{ id: 4034, name: 'Sleeper FA', position: 'QB' }] }),
      params('sleeper', { league_id: 'slp-1' })
    );
    const [normalized] = data.players as Array<Record<string, unknown>>;
    expect(normalized.id).toBe('4034');
    expect(normalized.team).toBeNull();
    expect('acquisitionState' in normalized).toBe(false);
    expect('freeAgents' in data).toBe(false);
  });
});

describe('normalizeFreeAgentsResult — protocol safety', () => {
  it('returns error results untouched', () => {
    const error: RouteResult = { success: false, code: 'ESPN_TIMEOUT', error: 'timeout' } as RouteResult;
    expect(normalizeFreeAgentsResult(error, params('espn'))).toBe(error);
  });

  it('converts malformed provider successes into explicit tool errors', () => {
    expectMalformed(ok(null), params('espn'));
    expectMalformed(ok(['not', 'an', 'object']), params('espn'));
    expectMalformed(ok('nope'), params('espn'));
    expectMalformed(ok({ freeAgents: 'corrupted' }), params('espn'));
    expectMalformed(ok({ freeAgents: [{ playerId: 1 }, 'garbage'] }), params('espn'));
    expectMalformed(ok({ freeAgents: [null] }), params('espn'));
    expectMalformed(ok({ players: 42 }), params('sleeper'));
  });

  it('does not mutate the original payload or entries', () => {
    const original = { leagueId: '1', freeAgents: [{ playerId: 1, status: 'WAIVERS', proTeam: 'FA' }] };
    const snapshot = JSON.parse(JSON.stringify(original));
    normalizeFreeAgentsResult(ok(original), params('espn'));
    expect(original).toEqual(snapshot);
  });
});
