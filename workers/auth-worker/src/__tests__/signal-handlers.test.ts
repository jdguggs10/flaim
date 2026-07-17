import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleWebSetupSignal } from '../signal-handlers';

const CORS = { 'Access-Control-Allow-Origin': 'https://flaim.app' };

function makeRequest(body: unknown): Request {
  return new Request('https://auth.example/signals/web', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('handleWebSetupSignal', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs an allowlisted event with device and connected fields', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const response = await handleWebSetupSignal(
      makeRequest({ event: 'espn_connect_ui_view', device: 'mobile', connected: false }),
      'prod',
      CORS
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(spy.mock.calls[0][0])) as Record<string, unknown>;
    expect(payload).toMatchObject({
      service: 'web',
      component: 'leagues_page',
      event: 'espn_connect_ui_view',
      platform: 'espn',
      device: 'mobile',
      connected: false,
      environment: 'prod',
    });
  });

  it('rejects unknown event names without logging', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const response = await handleWebSetupSignal(
      makeRequest({ event: 'made_up_event', device: 'mobile' }),
      'prod',
      CORS
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'unknown_event' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON bodies', async () => {
    const response = await handleWebSetupSignal(makeRequest('not json'), 'prod', CORS);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'invalid_json' });
  });

  it('rejects non-object JSON bodies like null without crashing', async () => {
    for (const raw of ['null', '[]', '"event"']) {
      const response = await handleWebSetupSignal(makeRequest(raw), 'prod', CORS);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: 'invalid_json' });
    }
  });

  it('drops out-of-allowlist device values but still logs the event', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const response = await handleWebSetupSignal(
      makeRequest({ event: 'espn_connect_ui_view', device: 'smart-fridge', connected: 'yes' }),
      'prod',
      CORS
    );

    expect(response.status).toBe(200);
    const payload = JSON.parse(String(spy.mock.calls[0][0])) as Record<string, unknown>;
    expect(payload.device).toBeUndefined();
    expect(payload.connected).toBeUndefined();
  });
});
