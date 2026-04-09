import { logEvalEvent as sharedLogEvalEvent, type TraceLogEvent as SharedTraceLogEvent } from '@flaim/worker-shared';

export type TraceLogEvent = Omit<SharedTraceLogEvent, 'service' | 'phase'> & {
  service: 'fantasy-mcp';
  phase: 'request_start' | 'request_end' | 'tool_start' | 'tool_end' | 'tool_error';
};

export function logEvalEvent(event: TraceLogEvent): void {
  sharedLogEvalEvent(event);
}

// Unconditional request-boundary logger — no eval-context guard.
// Used at request_start/request_end in handleMcpRequest so these
// events always appear in CF Observability even when X-Flaim-Eval-Run /
// X-Flaim-Eval-Trace headers are absent (e.g. OpenAI Responses API strips
// custom headers before forwarding to the MCP endpoint).
export function logRequestBoundary(event: TraceLogEvent): void {
  console.log(JSON.stringify(event));
}
