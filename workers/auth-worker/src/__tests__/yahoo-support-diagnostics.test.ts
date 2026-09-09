import { describe, expect, it } from 'vitest';
import { parseYahooSupportRequest } from '../yahoo-support-diagnostics';

const VALID_USER_ID = 'user_3Ie4m68lUbzxyv22NsMU';

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
});
