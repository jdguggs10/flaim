import { afterEach, describe, expect, it, vi } from 'vitest';
import { logEvalEvent } from '../logging';

describe('logEvalEvent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not log when trace context is missing', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logEvalEvent({
      service: 'yahoo-client',
      phase: 'execute_start',
      message: 'execute start',
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it('logs structured JSON when eval run/trace is present', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logEvalEvent({
      service: 'yahoo-client',
      phase: 'execute_end',
      run_id: 'run_123',
      trace_id: 'trace_123',
      correlation_id: 'cid_123',
      tool: 'get_standings',
      message: 'get_standings completed',
      status: 'true',
      duration_ms: 34,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(spy.mock.calls[0][0])) as Record<string, unknown>;
    expect(payload.service).toBe('yahoo-client');
    expect(payload.phase).toBe('execute_end');
    expect(payload.run_id).toBe('run_123');
    expect(payload.trace_id).toBe('trace_123');
    expect(payload.correlation_id).toBe('cid_123');
    expect(payload.message).toBe('get_standings completed');
  });
});
