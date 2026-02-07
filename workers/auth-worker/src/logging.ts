interface TraceLogEvent {
  service: 'auth-worker';
  phase: 'request_start' | 'request_end' | 'request_error';
  correlation_id?: string;
  run_id?: string;
  trace_id?: string;
  path?: string;
  method?: string;
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
