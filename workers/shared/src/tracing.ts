/**
 * Lightweight correlation ID helpers for request tracing.
 */

export const CORRELATION_ID_HEADER = 'X-Correlation-ID';
export const EVAL_RUN_HEADER = 'X-Flaim-Eval-Run';
export const EVAL_TRACE_HEADER = 'X-Flaim-Eval-Trace';

export interface EvalContext {
  evalRunId?: string;
  evalTraceId?: string;
}

export function getCorrelationId(request: Request): string {
  return (
    request.headers.get(CORRELATION_ID_HEADER) ||
    request.headers.get('CF-Ray') ||
    crypto.randomUUID()
  );
}

export function withCorrelationId(
  headers: HeadersInit | undefined,
  correlationId: string
): Headers {
  const merged = new Headers(headers);
  if (!merged.has(CORRELATION_ID_HEADER)) {
    merged.set(CORRELATION_ID_HEADER, correlationId);
  }
  return merged;
}

export function getEvalContext(request: Request): EvalContext {
  const evalRunId = request.headers.get(EVAL_RUN_HEADER) || undefined;
  const evalTraceId = request.headers.get(EVAL_TRACE_HEADER) || undefined;
  return { evalRunId, evalTraceId };
}

export function withEvalHeaders(
  headers: HeadersInit | undefined,
  evalRunId?: string,
  evalTraceId?: string
): Headers {
  const merged = new Headers(headers);
  if (evalRunId) {
    merged.set(EVAL_RUN_HEADER, evalRunId);
  }
  if (evalTraceId) {
    merged.set(EVAL_TRACE_HEADER, evalTraceId);
  }
  return merged;
}
