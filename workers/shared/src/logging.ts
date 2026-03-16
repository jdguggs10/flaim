export interface TraceLogEvent {
  service: string;
  phase: string;
  correlation_id?: string;
  run_id?: string;
  trace_id?: string;
  // Platform client fields
  tool?: string;
  sport?: string;
  league_id?: string;
  // Gateway fields
  platform?: string;
  // Auth-worker fields
  path?: string;
  method?: string;
  // Common fields
  status?: string;
  duration_ms?: number;
  message?: string;
  error?: string;
}

/**
 * Structured eval logging for Cloudflare Observability filtering.
 * Only emits when trace context is present (eval/observability runs).
 */
export function logEvalEvent(event: TraceLogEvent): void {
  if (!event.trace_id && !event.run_id) {
    return;
  }
  console.log(JSON.stringify(event));
}
