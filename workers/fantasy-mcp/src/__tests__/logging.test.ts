import { afterEach, describe, expect, it, vi } from 'vitest';
import { logEvalEvent, logRequestBoundary } from '../logging';

describe('logEvalEvent', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not log when trace context is missing', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logEvalEvent({
      service: 'fantasy-mcp',
      phase: 'tool_start',
      message: 'tool start',
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it('logs structured JSON when eval run/trace is present', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logEvalEvent({
      service: 'fantasy-mcp',
      phase: 'tool_end',
      run_id: 'run_123',
      trace_id: 'trace_123',
      correlation_id: 'cid_123',
      tool: 'get_roster',
      message: 'get_roster completed',
      status: 'true',
      duration_ms: 45,
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(spy.mock.calls[0][0])) as Record<string, unknown>;
    expect(payload.service).toBe('fantasy-mcp');
    expect(payload.phase).toBe('tool_end');
    expect(payload.run_id).toBe('run_123');
    expect(payload.trace_id).toBe('trace_123');
    expect(payload.correlation_id).toBe('cid_123');
    expect(payload.message).toBe('get_roster completed');
  });
});

describe('logRequestBoundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fires even without eval context', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logRequestBoundary({ service: 'fantasy-mcp', phase: 'request_start', message: '/mcp' });

    expect(spy).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(spy.mock.calls[0][0])) as Record<string, unknown>;
    expect(payload.phase).toBe('request_start');
    expect(payload.trace_id).toBeUndefined();
  });

  it('logs run_id and trace_id fields as structured JSON', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});

    logRequestBoundary({
      service: 'fantasy-mcp',
      phase: 'request_start',
      trace_id: 'trace_abc',
      run_id: '2026-04-08T15-43-08Z',
    });

    const payload = JSON.parse(String(spy.mock.calls[0][0])) as Record<string, unknown>;
    expect(payload.trace_id).toBe('trace_abc');
    expect(payload.run_id).toBe('2026-04-08T15-43-08Z');
  });

  it('eval=<runId> in message matches the harness run-fallback regex', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const runId = '2026-04-08T15-43-08Z';

    logRequestBoundary({
      service: 'fantasy-mcp',
      phase: 'request_start',
      run_id: runId,
      message: `/mcp eval=${runId}`,
    });

    const payload = JSON.parse(String(spy.mock.calls[0][0])) as Record<string, unknown>;
    // flaim-eval parseRunIdsFromMessage regex: /eval=([A-Za-z0-9:T.-]+Z)/g
    const match = String(payload.message).match(/eval=([A-Za-z0-9:T.-]+Z)/);
    expect(match?.[1]).toBe(runId);
  });
});
