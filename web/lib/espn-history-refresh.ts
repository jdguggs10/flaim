export function shouldProbeEspnHistoryAfterRefreshFailure(
  responseReceived: boolean,
  errorCode?: string
): boolean {
  // A network failure may happen after the proxy dispatched the request, and
  // refresh_timeout explicitly means the proxy stopped waiting for a request
  // that may already have queued durable history. Other HTTP failures are
  // definitive and must remain visible even if an older job is still active.
  return !responseReceived || errorCode === 'refresh_timeout';
}
