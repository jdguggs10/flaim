import { describe, expect, it } from 'vitest';
import { extractEvalContextFromPath, getEvalContext } from '../tracing.js';

describe('tracing utilities', () => {
  it('extracts eval context from traced MCP paths', () => {
    expect(extractEvalContextFromPath('/mcp/r/run-1/t/trace-1')).toEqual({
      evalRunId: 'run-1',
      evalTraceId: 'trace-1',
    });
    expect(extractEvalContextFromPath('/fantasy/mcp/r/run-2/t/trace-2')).toEqual({
      evalRunId: 'run-2',
      evalTraceId: 'trace-2',
    });
  });

  it('returns null for non-traced or malformed paths', () => {
    expect(extractEvalContextFromPath('/mcp')).toBeNull();
    expect(extractEvalContextFromPath('/mcp/r/run-1')).toBeNull();
    expect(extractEvalContextFromPath('/mcp/r/run-1/t')).toBeNull();
    expect(extractEvalContextFromPath('/mcp/r/%E0%A4%A/t/trace-1')).toBeNull();
  });

  it('prefers traced path context over eval headers', () => {
    const request = new Request('https://api.flaim.app/mcp/r/path-run/t/path-trace', {
      headers: {
        'X-Flaim-Eval-Run': 'header-run',
        'X-Flaim-Eval-Trace': 'header-trace',
      },
    });

    expect(getEvalContext(request)).toEqual({
      evalRunId: 'path-run',
      evalTraceId: 'path-trace',
    });
  });
});
