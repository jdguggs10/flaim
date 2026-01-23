/**
 * Lightweight correlation ID helpers for request tracing.
 */

export const CORRELATION_ID_HEADER = 'X-Correlation-ID';

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
