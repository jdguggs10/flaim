import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createYahooParseStats, logYahooDiscoveryDropIfAny, type YahooParseStats } from '../yahoo-connect-handlers';

/**
 * Resilience follow-up to FLA-365: the customer-hitting failure mode (Yahoo
 * returns a real league under a sport code Flaim doesn't recognize, and the
 * parser correctly but silently drops it) had zero visibility on the normal
 * persisted discovery/reconciliation paths — only the FLA-360 support tool's
 * `diagnose` action could see it, and only when an operator went looking.
 * `logYahooDiscoveryDropIfAny` closes that gap: one structured warning, on
 * the same signals `diagnose` already classifies, findable in Cloudflare
 * Logs the moment it happens to any account, not just the one someone
 * complains about.
 */

const USER_ID = 'user_3Ie4m68lUbzxyv22NsMUWnQ0I6S';
const MASKED_USER_ID = 'user_3Ie...';

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
});

function loggedEvent(): Record<string, unknown> {
  expect(warnSpy).toHaveBeenCalledTimes(1);
  return JSON.parse(warnSpy.mock.calls[0][0] as string);
}

describe('logYahooDiscoveryDropIfAny', () => {
  it('stays silent on a clean discovery with real accepted leagues', () => {
    const stats = createYahooParseStats();
    stats.declared = { users: 1, games: 1, leagues: 3 };
    stats.indexed = { users: 1, games: 1, leagues: 3 };
    stats.accepted = 3;

    logYahooDiscoveryDropIfAny(USER_ID, stats, 'discovery');

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('stays silent on a genuinely empty account (nothing declared, nothing indexed)', () => {
    const stats = createYahooParseStats();

    logYahooDiscoveryDropIfAny(USER_ID, stats, 'discovery');

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns on an unrecognized sport code — the exact FLA-365 failure mode', () => {
    const stats = createYahooParseStats();
    stats.declared = { users: 1, games: 1, leagues: 2 };
    stats.indexed = { users: 1, games: 1, leagues: 2 };
    stats.skipped.unsupportedSportCode = 1;
    stats.unsupportedGameCodes = ['cfb'];
    stats.accepted = 0;

    logYahooDiscoveryDropIfAny(USER_ID, stats, 'discovery');

    const event = loggedEvent();
    expect(event).toMatchObject({
      event: 'yahoo_discovery_drop',
      service: 'auth-worker',
      source: 'discovery',
      user_id: MASKED_USER_ID,
      declared_leagues: 2,
      accepted_leagues: 0,
      unsupported_sport_codes: ['cfb'],
      unsupported_sport_code_count: 1,
    });
  });

  it('warns on a declared-zero-but-indexed-populated level (the count||0 swallow case)', () => {
    const stats = createYahooParseStats();
    stats.declared = { users: 1, games: 1, leagues: 0 };
    stats.indexed = { users: 1, games: 1, leagues: 3 };
    stats.accepted = 0;

    logYahooDiscoveryDropIfAny(USER_ID, stats, 'discovery');

    const event = loggedEvent();
    expect(event.declared_leagues).toBe(0);
    expect(event.indexed_leagues).toBe(3);
  });

  it('warns when the parser threw, even though it still returned partial results', () => {
    const stats = createYahooParseStats();
    stats.threw = true;
    stats.thrownErrorName = 'TypeError';
    stats.accepted = 1;

    logYahooDiscoveryDropIfAny(USER_ID, stats, 'reconciliation');

    const event = loggedEvent();
    expect(event).toMatchObject({ source: 'reconciliation', threw: true, thrown_error_name: 'TypeError' });
  });

  it('never logs the unmasked user id', () => {
    const stats = createYahooParseStats();
    stats.skipped.unsupportedSportCode = 1;
    stats.unsupportedGameCodes = ['pickem'];

    logYahooDiscoveryDropIfAny(USER_ID, stats, 'discovery');

    const raw = warnSpy.mock.calls[0][0] as string;
    expect(raw).not.toContain(USER_ID);
    expect(raw).toContain(MASKED_USER_ID);
  });

  it('logs only Yahoo-global sport codes and counts, never a league key, league name, or team name', () => {
    const stats: YahooParseStats = {
      ...createYahooParseStats(),
      declared: { users: 1, games: 2, leagues: 5 },
      indexed: { users: 1, games: 2, leagues: 5 },
      skipped: { ...createYahooParseStats().skipped, unsupportedSportCode: 2 },
      unsupportedGameCodes: ['cfb', 'pickem'],
      accepted: 0,
    };

    // A rich fixture standing in for what a real (but forbidden-to-log)
    // discovery response would carry alongside these stats.
    const forbiddenStrings = [
      'nfl.l.999999', // league key
      'Dynasty Warriors', // league name
      'Team Awesome', // team name
    ];

    logYahooDiscoveryDropIfAny(USER_ID, stats, 'discovery');

    const raw = warnSpy.mock.calls[0][0] as string;
    for (const forbidden of forbiddenStrings) {
      expect(raw).not.toContain(forbidden);
    }
    // The only strings this event may ever carry are Yahoo-global game
    // codes, which are not customer data.
    expect(JSON.parse(raw).unsupported_sport_codes).toEqual(['cfb', 'pickem']);
  });
});
