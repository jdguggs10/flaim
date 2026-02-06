interface TraceLogEvent {
  service: 'fantasy-mcp';
  phase: 'request_start' | 'request_end' | 'tool_start' | 'tool_end' | 'tool_error';
  correlation_id?: string;
  run_id?: string;
  trace_id?: string;
  tool?: string;
  platform?: string;
  sport?: string;
  league_id?: string;
  status?: string;
  duration_ms?: number;
  message?: string;
  error?: string;
}

/**
 * Structured eval logging for Cloudflare Observability filtering.
 */
export function logEvalEvent(event: TraceLogEvent): void {
  if (!event.trace_id && !event.run_id) {
    return;
  }
  console.log(JSON.stringify(event));
}
