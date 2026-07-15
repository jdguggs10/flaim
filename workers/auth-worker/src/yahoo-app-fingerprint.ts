/**
 * Yahoo OAuth App Fingerprint
 * ---------------------------------------------------------------------------
 *
 * Yahoo tokens are minted under a specific Yahoo Developer app. Refreshing a
 * stored token with a different app's client credentials always fails with an
 * opaque Yahoo error. The fingerprint — the first 12 hex chars of
 * SHA-256(YAHOO_CLIENT_ID) — is a non-secret identifier for the app that
 * minted a credential row's tokens, persisted on `yahoo_credentials` so
 * app/secret mismatches are detectable before calling Yahoo (FLA-133).
 *
 * The raw client id, client secret, and tokens are never stored or logged.
 */

export type YahooAppFingerprintStatus = 'match' | 'mismatch' | 'legacy_null' | 'unknown';

const fingerprintCache = new Map<string, string>();

/**
 * Derive the non-secret app fingerprint from a Yahoo client id.
 * Returns undefined when the client id is not configured.
 */
export async function computeYahooAppFingerprint(clientId: string | undefined): Promise<string | undefined> {
  if (!clientId) {
    return undefined;
  }

  const cached = fingerprintCache.get(clientId);
  if (cached) {
    return cached;
  }

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(clientId));
  const fingerprint = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12);

  fingerprintCache.set(clientId, fingerprint);
  return fingerprint;
}

/**
 * Compare a credential row's stored fingerprint against the runtime one.
 *
 * - 'legacy_null': row predates fingerprint stamping — must proceed as before
 *   (it gets backfilled on its next successful refresh)
 * - 'unknown': runtime client id is not configured, so no comparison is possible
 */
export function yahooAppFingerprintStatus(
  stored: string | undefined | null,
  runtime: string | undefined
): YahooAppFingerprintStatus {
  if (!runtime) {
    return 'unknown';
  }
  if (!stored) {
    return 'legacy_null';
  }
  return stored === runtime ? 'match' : 'mismatch';
}
