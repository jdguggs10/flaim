import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createYahooParseStats, logYahooDiscoveryDropIfAny } from '../yahoo-connect-handlers';

/**
 * Resilience follow-up to FLA-365: the customer-hitting failure mode (Yahoo
 * returns a real league under a sport code Flaim doesn't recognize, and the
 * parser correctly but silently drops it) had zero visibility on the normal
 * persisted discovery/reconciliation paths — only the FLA-360 support tool's
 * `diagnose` action could see it, and only when an operator went looking.
 * `logYahooDiscoveryDropIfAny` closes that gap: one structured warning,
 * findable in Cloudflare Logs the moment it happens to any account, not just
 * the one someone complains about.
 *
 * `createYahooParseStats()` defaults `envelope` to `'missing_fantasy_content'`
 * — that's the parser's own pre-navigation default, not what a real response
 * looks like. Every fixture below that means to represent an actual Yahoo
 * response (valid or otherwise fully navigated) sets `envelope: 'valid'`
 * explicitly, the same way the real parser does once it confirms `users` is
 * present — otherwise every fixture would trip the envelope check by
 * omission, defeating the point of isolating one signal per test.
 */

const USER_ID = 'user_3Ie4m68lUbzxyv22NsMUWnQ0I6S';
const MASKED_USER_ID = 'user_3Ie...';

/** A stats object representing a real, fully-navigated Yahoo response. */
function validStats(): ReturnType<typeof createYahooParseStats> {
  const stats = createYahooParseStats();
  stats.envelope = 'valid';
  return stats;
}

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
    const stats = validStats();
    stats.declared = { users: 1, games: 1, leagues: 3 };
    stats.indexed = { users: 1, games: 1, leagues: 3 };
    stats.accepted = 3;

    logYahooDiscoveryDropIfAny(USER_ID, stats, 'discovery');

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('stays silent on a genuinely empty account (valid envelope, nothing declared or indexed)', () => {
    const stats = validStats();

    logYahooDiscoveryDropIfAny(USER_ID, stats, 'discovery');

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns on an unrecognized sport code — the exact FLA-365 failure mode', () => {
    const stats = validStats();
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
      envelope: 'valid',
      declared: { users: 1, games: 1, leagues: 2 },
      accepted_leagues: 0,
      unsupported_sport_codes: ['cfb'],
      skipped: { unsupportedSportCode: 1 },
    });
  });

  // The trigger isn't limited to the one category this was first written
  // for — any nonzero skip counter is equally anomalous (see the comment on
  // logYahooDiscoveryDropIfAny), so a *different* future Yahoo response-shape
  // surprise is just as findable as an unmapped sport code.
  it.each([
    'userMissingShape',
    'gamesCollectionMissing',
    'gameMissingShape',
    'leaguesCollectionMissing',
    'unparseableSeason',
    'leagueMissingShape',
    'leagueMissingKeyOrName',
  ] as const)('warns when %s is the only nonzero skip counter', (category) => {
    const stats = validStats();
    stats.declared = { users: 1, games: 1, leagues: 1 };
    stats.indexed = { users: 1, games: 1, leagues: 1 };
    stats.skipped[category] = 1;
    stats.accepted = 0;

    logYahooDiscoveryDropIfAny(USER_ID, stats, 'discovery');

    const event = loggedEvent();
    expect((event.skipped as Record<string, number>)[category]).toBe(1);
  });

  describe('declared-zero-but-indexed-populated (the count||0 swallow), at every level', () => {
    it.each(['users', 'games', 'leagues'] as const)('warns when only %s is swallowed', (level) => {
      const stats = validStats();
      stats.declared = { users: 1, games: 1, leagues: 1, [level]: 0 };
      stats.indexed = { users: 1, games: 1, leagues: 1, [level]: 3 };
      stats.accepted = level === 'leagues' ? 0 : 1;

      logYahooDiscoveryDropIfAny(USER_ID, stats, 'discovery');

      const event = loggedEvent();
      expect((event.declared as Record<string, number>)[level]).toBe(0);
      expect((event.indexed as Record<string, number>)[level]).toBe(3);
    });
  });

  // Cross-model review caught this: a swallow one level up from leagues
  // (games or users) means the per-game loop never runs at all, so nothing
  // beneath it — including league counts — ever gets a chance to disagree
  // either. Checking only the leagues level would have missed exactly this.
  it('warns on a games-level swallow even though leagues-level counts agree (both zero)', () => {
    const stats = validStats();
    stats.declared = { users: 1, games: 0, leagues: 0 };
    stats.indexed = { users: 1, games: 2, leagues: 0 };
    stats.accepted = 0;

    logYahooDiscoveryDropIfAny(USER_ID, stats, 'discovery');

    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  // Known, pre-existing, accepted limitation (flagged in cross-model review):
  // declared/indexed are account-level running totals across every game in
  // the account, so a swallow in one game can be masked by another game
  // that parsed fine. The other signals (any nonzero skip counter, `threw`,
  // and the invalid-envelope check) don't share this blind spot — this is
  // specific to the literal declared-vs-indexed comparison at a shared
  // level. Documented here, not fixed: a real fix needs per-game stats, a
  // bigger change than this PR's scope.
  it('KNOWN GAP: a count-swallow in one game can be masked by another game in the same account', () => {
    const stats = validStats();
    // Game A: declared 2, indexed 2 (parsed fine). Game B: declared 0,
    // indexed 3 (swallowed). Aggregated: declared=2 > 0, so the literal
    // declared-vs-indexed check alone does not fire for this account.
    stats.declared = { users: 1, games: 2, leagues: 2 };
    stats.indexed = { users: 1, games: 2, leagues: 5 };
    stats.accepted = 2;

    logYahooDiscoveryDropIfAny(USER_ID, stats, 'discovery');

    // This assertion exists to make the gap explicit rather than silently
    // relying on no test covering it — nothing here currently notices that
    // indexed (5) exceeds accepted (2) when no skip counter also fired.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns when the parser threw, even though it still returned partial results', () => {
    const stats = validStats();
    stats.threw = true;
    stats.thrownErrorName = 'TypeError';
    stats.accepted = 1;

    logYahooDiscoveryDropIfAny(USER_ID, stats, 'reconciliation');

    const event = loggedEvent();
    expect(event).toMatchObject({ source: 'reconciliation', threw: true, thrown_error_name: 'TypeError' });
  });

  // The second, most severe version of "the next surprise isn't an unmapped
  // sport code" the review named: a full envelope-shape change from Yahoo
  // (fantasy_content or users missing entirely) never touches any skip
  // counter or declared/indexed field — it returns before any of that
  // bookkeeping runs — so it needs its own explicit check.
  it.each(['missing_fantasy_content', 'missing_users'] as const)(
    'warns when the envelope itself is %s, with no other signal present',
    (envelope) => {
      const stats = createYahooParseStats();
      stats.envelope = envelope;

      logYahooDiscoveryDropIfAny(USER_ID, stats, 'discovery');

      const event = loggedEvent();
      expect(event.envelope).toBe(envelope);
    }
  );

  // Logging must never affect request behavior: both call sites sit inside a
  // try/catch that turns a thrown error into a 500 for the client, so this
  // function must never let an internal failure propagate — even one it
  // can't anticipate today, like a future YahooParseStats field that
  // JSON.stringify can't serialize.
  it('never throws, even if JSON.stringify itself fails', () => {
    const stats = validStats();
    stats.skipped.unsupportedSportCode = 1;
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    // Force a real JSON.stringify failure via a field JSON can't represent,
    // without needing YahooParseStats to actually declare one yet.
    (stats as unknown as { unsupportedGameCodes: unknown }).unsupportedGameCodes = circular;

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => logYahooDiscoveryDropIfAny(USER_ID, stats, 'discovery')).not.toThrow();
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0].join(' ')).not.toContain(USER_ID);

    errorSpy.mockRestore();
  });

  it('never logs the unmasked user id', () => {
    const stats = validStats();
    stats.skipped.unsupportedSportCode = 1;
    stats.unsupportedGameCodes = ['pickem'];

    logYahooDiscoveryDropIfAny(USER_ID, stats, 'discovery');

    const raw = warnSpy.mock.calls[0][0] as string;
    expect(raw).not.toContain(USER_ID);
    expect(raw).toContain(MASKED_USER_ID);
  });

  it('logs only Yahoo-global sport codes and counts, never a league key, league name, or team name', () => {
    const stats = validStats();
    stats.declared = { users: 1, games: 2, leagues: 5 };
    stats.indexed = { users: 1, games: 2, leagues: 5 };
    stats.skipped.unsupportedSportCode = 2;
    stats.unsupportedGameCodes = ['cfb', 'pickem'];
    stats.accepted = 0;

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
