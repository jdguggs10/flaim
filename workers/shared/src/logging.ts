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

export interface SetupSignalEvent {
  schema_version?: 1;
  service: string;
  component: string;
  event: string;
  stage?: string;
  outcome?: string;
  failure_kind?: string;
  error_code?: string;
  /**
   * Transport response status for the failed path; redirect-to-error outcomes
   * can legitimately carry a 3xx status.
   */
  http_status?: number;
  upstream_status?: number;
  retryable?: boolean;
  retry_after?: number;
  retry_after_source?: string;
  platform?: string;
  sport?: string;
  season_year?: number;
  league_count?: number;
  current_season_found?: boolean;
  past_seasons_found?: boolean;
  auth_type?: string;
  has_auth_header?: boolean;
  correlation_id?: string;
  cf_ray?: string;
  request_path?: string;
  method?: string;
  duration_ms?: number;
  environment?: string;
}

const SETUP_SIGNAL_SCHEMA_VERSION = 1;

const SETUP_SIGNAL_STRING_FIELDS = [
  'service',
  'component',
  'event',
  'stage',
  'outcome',
  'failure_kind',
  'error_code',
  'retry_after_source',
  'platform',
  'sport',
  'auth_type',
  'correlation_id',
  'cf_ray',
  'request_path',
  'method',
  'environment',
] as const;

const SETUP_SIGNAL_NUMBER_FIELDS = [
  'http_status',
  'upstream_status',
  'retry_after',
  'season_year',
  'league_count',
  'duration_ms',
] as const;

const SETUP_SIGNAL_BOOLEAN_FIELDS = [
  'retryable',
  'current_season_found',
  'past_seasons_found',
  'has_auth_header',
] as const;

function boundedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return value.length > 512 ? `${value.slice(0, 512)}...` : value;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Logs compact live-product setup/trust-path signals for production triage.
 *
 * This helper is intentionally allowlist-only and no-throw. Unknown keys are
 * dropped so accidental secret-bearing fields never reach structured logs.
 */
export function logSetupSignal(event: SetupSignalEvent & Record<string, unknown>): void {
  try {
    const payload: Record<string, string | number | boolean> = {
      schema_version: SETUP_SIGNAL_SCHEMA_VERSION,
    };

    for (const field of SETUP_SIGNAL_STRING_FIELDS) {
      const value = boundedString(event[field]);
      if (value !== undefined) {
        payload[field] = value;
      }
    }

    for (const field of SETUP_SIGNAL_NUMBER_FIELDS) {
      const value = finiteNumber(event[field]);
      if (value !== undefined) {
        payload[field] = value;
      }
    }

    for (const field of SETUP_SIGNAL_BOOLEAN_FIELDS) {
      const value = booleanValue(event[field]);
      if (value !== undefined) {
        payload[field] = value;
      }
    }

    console.log(JSON.stringify(payload));
  } catch {
    // Logging must never affect request behavior.
  }
}
