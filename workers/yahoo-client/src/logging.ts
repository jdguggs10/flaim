interface TraceLogEvent {
  service: 'yahoo-client';
  phase: 'execute_start' | 'execute_end' | 'execute_error';
  correlation_id?: string;
  run_id?: string;
  trace_id?: string;
  tool?: string;
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
