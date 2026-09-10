import { describe, expect, it } from 'vitest';
import {
  parseYahooSupportLeagueRequest,
  parseYahooSupportRequest,
} from '../yahoo-support-diagnostics';

const VALID_USER_ID = 'user_3Ie4m68lUbzxyv22NsMU';
const VALID_LEAGUE_ID = '153104';

function makeRequest(body: string, headers: HeadersInit = {}): Request {
  return new Request('https://auth.example.com/internal/support/yahoo/inspect', {
    method: 'POST',
    headers,
    body,
  });
}

function parse(body: unknown, headers: HeadersInit = {}) {
  return parseYahooSupportRequest(makeRequest(JSON.stringify(body), headers));
}

function parseLeague(body: unknown, headers: HeadersInit = {}) {
  return parseYahooSupportLeagueRequest(makeRequest(JSON.stringify(body), headers));
}

describe('parseYahooSupportRequest', () => {
  it('rejects a declared body larger than the byte cap before reading it', async () => {
    const result = await parse({ userId: VALID_USER_ID }, { 'Content-Length': '1025' });

    expect(result).toMatchObject({ error: { status: 413, body: { error: 'request_too_large' } } });
  });

  it('rejects a body that actually exceeds the byte cap', async () => {
    const result = await parse({ userId: VALID_USER_ID, padding: 'x'.repeat(1100) });

    expect(result).toMatchObject({ error: { status: 413, body: { error: 'request_too_large' } } });
  });

  it('rejects a non-JSON body', async () => {
    const result = await parseYahooSupportRequest(makeRequest('not-json'));

    expect(result).toMatchObject({ error: { status: 400, body: { error: 'invalid_request' } } });
  });

  it.each([
    ['an array', [VALID_USER_ID]],
    ['a string', VALID_USER_ID],
    ['a number', 42],
    ['null', null],
  ])('rejects %s body that is not a JSON object', async (_label, body) => {
    const result = await parse(body);

    expect(result).toMatchObject({ error: { status: 400, body: { error: 'invalid_request' } } });
  });

  it('rejects an unknown request field', async () => {
    const result = await parse({ userId: VALID_USER_ID, dryRun: true });

    expect(result).toMatchObject({ error: { status: 400, body: { error: 'invalid_request' } } });
  });

  it.each([
    ['too short', 'user_short'],
    ['not prefixed', 'admin'],
    ['too long', `user_${'a'.repeat(65)}`],
    ['SQL-injection shaped', "user_00000000000000000000'; DROP TABLE yahoo_credentials;--"],
    ['invalid characters after the prefix', 'user_0000000000000000000-'],
  ])('rejects a %s userId', async (_label, userId) => {
    const result = await parse({ userId });

    expect(result).toMatchObject({ error: { status: 400, body: { error: 'invalid_user_id' } } });
  });

  it('rejects a non-string userId', async () => {
    const result = await parse({ userId: 12345 });

    expect(result).toMatchObject({ error: { status: 400, body: { error: 'invalid_user_id' } } });
  });

  it('accepts a well-formed Clerk user ID', async () => {
    const result = await parse({ userId: VALID_USER_ID });

    expect(result).toEqual({ request: { userId: VALID_USER_ID } });
  });

  it('rejects a leagueId, which only the probe-league route accepts', async () => {
    const result = await parse({ userId: VALID_USER_ID, leagueId: VALID_LEAGUE_ID });

    expect(result).toMatchObject({ error: { status: 400, body: { error: 'invalid_request' } } });
  });
});

describe('parseYahooSupportLeagueRequest', () => {
  it('rejects a declared body larger than the byte cap before reading it', async () => {
    const result = await parseLeague(
      { userId: VALID_USER_ID, leagueId: VALID_LEAGUE_ID },
      { 'Content-Length': '1025' }
    );

    expect(result).toMatchObject({ error: { status: 413, body: { error: 'request_too_large' } } });
  });

  it('rejects a body that actually exceeds the byte cap', async () => {
    const result = await parseLeague({
      userId: VALID_USER_ID,
      leagueId: `${VALID_LEAGUE_ID}${'0'.repeat(1100)}`,
    });

    expect(result).toMatchObject({ error: { status: 413, body: { error: 'request_too_large' } } });
  });

  it('rejects a non-JSON body', async () => {
    const result = await parseYahooSupportLeagueRequest(makeRequest('not-json'));

    expect(result).toMatchObject({ error: { status: 400, body: { error: 'invalid_request' } } });
  });

  it.each([
    ['an array', [VALID_USER_ID]],
    ['a string', VALID_USER_ID],
    ['a number', 42],
    ['null', null],
  ])('rejects %s body that is not a JSON object', async (_label, body) => {
    const result = await parseLeague(body);

    expect(result).toMatchObject({ error: { status: 400, body: { error: 'invalid_request' } } });
  });

  it('rejects an unknown request field', async () => {
    const result = await parseLeague({ userId: VALID_USER_ID, leagueId: VALID_LEAGUE_ID, dryRun: true });

    expect(result).toMatchObject({ error: { status: 400, body: { error: 'invalid_request' } } });
  });

  // userId is checked before leagueId, so a request with both wrong names the
  // account problem first — the one an operator is likelier to have made.
  it('rejects a malformed userId ahead of a malformed leagueId', async () => {
    const result = await parseLeague({ userId: 'admin', leagueId: '../../users' });

    expect(result).toMatchObject({ error: { status: 400, body: { error: 'invalid_user_id' } } });
  });

  it('rejects a missing leagueId', async () => {
    const result = await parseLeague({ userId: VALID_USER_ID });

    expect(result).toMatchObject({ error: { status: 400, body: { error: 'invalid_league_id' } } });
  });

  it.each([
    ['a non-string', 153104],
    ['empty', ''],
    ['a path traversal', '../../users'],
    ['a slash', '461/l/153104'],
    ['a query parameter', '153104?format=xml'],
    ['a space', '153104 153105'],
    ['a percent escape', '%2e%2e'],
    ['SQL-injection shaped', "153104'; DROP TABLE yahoo_leagues;--"],
    ['longer than 64 characters', 'a'.repeat(65)],
  ])('rejects %s leagueId', async (_label, leagueId) => {
    const result = await parseLeague({ userId: VALID_USER_ID, leagueId });

    expect(result).toMatchObject({ error: { status: 400, body: { error: 'invalid_league_id' } } });
  });

  // Both real forms an operator may be handed by a customer.
  it.each([
    ['a bare numeric id', '153104'],
    ['a full league key', '461.l.153104'],
    ['a hyphenated id', 'abc-123'],
    ['an underscored id', 'abc_123'],
    ['exactly 64 characters', 'a'.repeat(64)],
  ])('accepts %s', async (_label, leagueId) => {
    const result = await parseLeague({ userId: VALID_USER_ID, leagueId });

    expect(result).toEqual({ request: { userId: VALID_USER_ID, leagueId } });
  });
});
