import { describe, expect, it } from 'vitest';
import { isPublicMcpHandshakeRequest, normalizeMcpAcceptHeader } from '../mcp/auth-gate';

describe('mcp auth gate helpers', () => {
  it('rejects GET as not a public handshake', async () => {
    const variants = [
      new Request('https://api.flaim.app/mcp', { method: 'GET', headers: { Accept: 'text/event-stream' } }),
      new Request('https://api.flaim.app/mcp', { method: 'GET', headers: { Accept: 'application/json' } }),
      new Request('https://api.flaim.app/mcp', { method: 'GET' }),
    ];

    for (const req of variants) {
      await expect(isPublicMcpHandshakeRequest(req)).resolves.toBe(false);
    }
  });

  it('recognizes public handshake/list methods', async () => {
    const listReq = new Request('https://api.flaim.app/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    const callReq = new Request('https://api.flaim.app/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'get_user_session', arguments: {} },
      }),
    });

    await expect(isPublicMcpHandshakeRequest(listReq)).resolves.toBe(true);
    await expect(isPublicMcpHandshakeRequest(callReq)).resolves.toBe(false);
  });

  it('normalizes accept header when event stream is missing', () => {
    const request = new Request('https://api.flaim.app/mcp', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });

    const normalized = normalizeMcpAcceptHeader(request);
    expect(normalized.headers.get('Accept')).toBe('application/json, text/event-stream');
  });
});
