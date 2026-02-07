import { afterEach, describe, expect, it, vi } from 'vitest';
import { logEvalEvent } from '../logging';

describe('logEvalEvent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not log when trace context is missing', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logEvalEvent({
      service: 'auth-worker',
      phase: 'request_start',
      message: 'request start',
      path: '/auth/introspect',
      method: 'GET',
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it('logs structured JSON when eval run/trace is present', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logEvalEvent({
      service: 'auth-worker',
      phase: 'request_end',
      run_id: 'run_123',
      trace_id: 'trace_123',
      correlation_id: 'cid_123',
      path: '/auth/introspect',
      method: 'GET',
      message: 'GET /auth/introspect status=200',
      status: '200',
      duration_ms: 12,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(spy.mock.calls[0][0])) as Record<string, unknown>;
    expect(payload.service).toBe('auth-worker');
    expect(payload.phase).toBe('request_end');
    expect(payload.run_id).toBe('run_123');
    expect(payload.trace_id).toBe('trace_123');
    expect(payload.correlation_id).toBe('cid_123');
    expect(payload.message).toBe('GET /auth/introspect status=200');
  });
});
