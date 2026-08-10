// FLA-216: the gateway free-agent normalizer must be total — every fixture
// here either gains the full canonical envelope or passes through untouched,
// and no input shape may throw. Malformed provider values map to null or are
// omitted, never guessed.
import { describe, expect, it } from 'vitest';
import { normalizeFreeAgentsResult } from '../mcp/free-agent-normalizer';
import type { RouteResult } from '../router';
import type { ToolParams } from '../types';

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

function dataOf(result: RouteResult): Record<string, unknown> {
  return result.data as Record<string, unknown>;
}

describe('normalizeFreeAgentsResult — canonical envelope', () => {
  it('adds the full envelope for each platform with the right capability matrix', () => {
    const espn = dataOf(normalizeFreeAgentsResult(ok({ leagueId: '336777', freeAgents: [] }), params('espn')));
    expect(espn.ordering).toBe('platform_rostered_rate_desc');
    expect(espn.capabilities).toEqual({ acquisitionState: true, rosteredRate: true, startedRate: true });
    expect(espn.ownershipScope).toBe('platform_global');

    const yahoo = dataOf(normalizeFreeAgentsResult(ok({ leagueKey: '449.l.123', freeAgents: [] }), params('yahoo', { league_id: '449.l.123' })));
    expect(yahoo.ordering).toBe('platform_rostered_rate_desc');
    expect(yahoo.capabilities).toEqual({ acquisitionState: false, rosteredRate: true, startedRate: false });
    expect(yahoo.ownershipScope).toBe('platform_global');
    expect(yahoo.leagueId).toBe('449.l.123');
    expect(yahoo.seasonYear).toBe(2025);

    const sleeper = dataOf(normalizeFreeAgentsResult(ok({ league_id: 'slp-1', players: [] }), params('sleeper', { league_id: 'slp-1' })));
    expect(sleeper.ordering).toBe('alphabetical');
    expect(sleeper.capabilities).toEqual({ acquisitionState: false, rosteredRate: false, startedRate: false });
    expect(sleeper.ownershipScope).toBe('unavailable');
    expect(sleeper.leagueId).toBe('slp-1');
  });

  it('echoes position from params when the provider omits it, preserving a provider echo when present', () => {
    const fromParams = dataOf(normalizeFreeAgentsResult(ok({ players: [] }), params('sleeper', { position: 'qb' })));
    expect(fromParams.position).toBe('QB');

    const defaulted = dataOf(normalizeFreeAgentsResult(ok({ players: [] }), params('sleeper')));
    expect(defaulted.position).toBe('ALL');

    const providerEcho = dataOf(normalizeFreeAgentsResult(ok({ position: 'RB', freeAgents: [] }), params('espn')));
    expect(providerEcho.position).toBe('RB');
  });

  it('falls back to entry length for count and params for league identity', () => {
    const data = dataOf(normalizeFreeAgentsResult(
      ok({ freeAgents: [{ name: 'A' }, { name: 'B' }] }),
      params('espn')
    ));
    expect(data.count).toBe(2);
    expect(data.leagueId).toBe('336777');
    expect(data.seasonYear).toBe(2025);
  });

  it('stringifies a numeric provider league id', () => {
    const data = dataOf(normalizeFreeAgentsResult(ok({ leagueId: 336777, freeAgents: [] }), params('espn')));
    expect(data.leagueId).toBe('336777');
  });
});

describe('normalizeFreeAgentsResult — ESPN entries', () => {
  const entry = {
    playerId: 4429795,
    name: 'Rookie Back',
    proTeam: 'BUF',
    percentOwned: 43.1,
    status: 'WAIVERS',
    waiverProcessDate: 1760000000000,
  };

  it('maps status, converts the waiver timestamp, stringifies the id, and derives team', () => {
    const data = dataOf(normalizeFreeAgentsResult(ok({ freeAgents: [entry] }), params('espn')));
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
    const data = dataOf(normalizeFreeAgentsResult(
      ok({ freeAgents: [{ playerId: 1, status: 'FREEAGENT', proTeam: 'FA' }] }),
      params('espn')
    ));
    const [normalized] = data.freeAgents as Array<Record<string, unknown>>;
    expect(normalized.acquisitionState).toBe('free_agent');
    expect(normalized.team).toBeNull();
    expect(normalized.proTeam).toBe('FA');
  });

  it('fails closed on missing or unknown status and keeps waivers without a usable timestamp', () => {
    const data = dataOf(normalizeFreeAgentsResult(
      ok({
        freeAgents: [
          { playerId: 1 },
          { playerId: 2, status: 'ONTEAM' },
          { playerId: 3, status: 'WAIVERS', waiverProcessDate: Number.NaN },
          { playerId: 4, status: 'WAIVERS', waiverProcessDate: 'tomorrow' },
          { playerId: 5, status: 'WAIVERS', waiverProcessDate: -5 },
        ],
      }),
      params('espn')
    ));
    const entries = data.freeAgents as Array<Record<string, unknown>>;
    expect(entries[0].acquisitionState).toBeNull();
    expect(entries[1].acquisitionState).toBeNull();
    for (const waivers of entries.slice(2)) {
      expect(waivers.acquisitionState).toBe('waivers');
      expect('waiverClearsAt' in waivers).toBe(false);
    }
  });

  it('omits id when the provider omitted the player id', () => {
    const data = dataOf(normalizeFreeAgentsResult(ok({ freeAgents: [{ name: 'Unknown' }] }), params('espn')));
    const [normalized] = data.freeAgents as Array<Record<string, unknown>>;
    expect('id' in normalized).toBe(false);
  });
});

describe('normalizeFreeAgentsResult — Yahoo and Sleeper entries', () => {
  it('adds id and null-team to Yahoo entries without acquisition fields', () => {
    const data = dataOf(normalizeFreeAgentsResult(
      ok({ leagueKey: '449.l.123', freeAgents: [{ playerKey: '449.p.201', playerId: '201', name: 'FA', team: '' }] }),
      params('yahoo', { league_id: '449.l.123' })
    ));
    const [normalized] = data.freeAgents as Array<Record<string, unknown>>;
    expect(normalized.id).toBe('201');
    expect(normalized.team).toBeNull();
    expect('acquisitionState' in normalized).toBe(false);
    expect('waiverClearsAt' in normalized).toBe(false);
  });

  it('normalizes Sleeper missing team to null and leaves everything else alone', () => {
    const data = dataOf(normalizeFreeAgentsResult(
      ok({ league_id: 'slp-1', players: [{ id: '4034', name: 'Sleeper FA', position: 'QB' }] }),
      params('sleeper', { league_id: 'slp-1' })
    ));
    const [normalized] = data.players as Array<Record<string, unknown>>;
    expect(normalized.team).toBeNull();
    expect(normalized.id).toBe('4034');
    expect('acquisitionState' in normalized).toBe(false);
    expect('freeAgents' in data).toBe(false);
  });
});

describe('normalizeFreeAgentsResult — totality and passthrough', () => {
  it('returns error results untouched', () => {
    const error: RouteResult = { success: false, code: 'ESPN_TIMEOUT', error: 'timeout' } as RouteResult;
    expect(normalizeFreeAgentsResult(error, params('espn'))).toBe(error);
  });

  it('returns non-object payloads untouched', () => {
    const arrayPayload = ok(['not', 'an', 'object']);
    expect(normalizeFreeAgentsResult(arrayPayload, params('espn'))).toBe(arrayPayload);
    const nullPayload = ok(null);
    expect(normalizeFreeAgentsResult(nullPayload, params('espn'))).toBe(nullPayload);
  });

  it('adds the envelope but leaves a non-array entries value untouched', () => {
    const data = dataOf(normalizeFreeAgentsResult(ok({ freeAgents: 'corrupted' }), params('espn')));
    expect(data.freeAgents).toBe('corrupted');
    expect(data.ordering).toBe('platform_rostered_rate_desc');
    expect(data.count).toBe(0);
  });

  it('passes non-object entries through inside an otherwise normalized array', () => {
    const data = dataOf(normalizeFreeAgentsResult(
      ok({ freeAgents: [{ playerId: 1, status: 'FREEAGENT' }, 'garbage', null] }),
      params('espn')
    ));
    const entries = data.freeAgents as unknown[];
    expect((entries[0] as Record<string, unknown>).acquisitionState).toBe('free_agent');
    expect(entries[1]).toBe('garbage');
    expect(entries[2]).toBeNull();
  });

  it('does not mutate the original payload or entries', () => {
    const original = { leagueId: '1', freeAgents: [{ playerId: 1, status: 'WAIVERS', proTeam: 'FA' }] };
    const snapshot = JSON.parse(JSON.stringify(original));
    normalizeFreeAgentsResult(ok(original), params('espn'));
    expect(original).toEqual(snapshot);
  });
});
