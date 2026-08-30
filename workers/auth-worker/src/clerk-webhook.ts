import { createClient } from '@supabase/supabase-js';

/**
 * Manual Web Crypto verification of Clerk's `user.deleted` webhook, which
 * uses the Svix signing scheme. No worker in this repo depends on the
 * `svix` or `@clerk/backend` packages today, and this endpoint doesn't
 * need to be the first -- auth-worker already verifies Clerk session JWTs
 * by hand via raw JWKS + `crypto.subtle`, so one more hand-rolled HMAC
 * check keeps the pattern consistent and avoids a new dependency (the
 * `svix` package alone is roughly 1MB) for a single verification routine.
 *
 * This deliberately does not reuse oauth-client-auth.ts's
 * hmacSha256Base64Url: that helper treats its key as UTF-8 text and emits
 * base64url, but Svix's scheme requires the signing secret's payload
 * (after stripping its `whsec_` prefix) to be base64-decoded into raw
 * bytes before use as the HMAC key, and the resulting signature to be
 * compared as standard base64 (with padding), not base64url -- reusing
 * that helper as-is would silently verify against the wrong bytes.
 */

export interface ClerkWebhookEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  CLERK_ACCOUNT_DELETION_WEBHOOK_SIGNING_SECRET?: string;
}

const SVIX_TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;
const PURGE_RPC_TIMEOUT_MS = 8000;
const SVIX_SECRET_PREFIX = 'whsec_';
// Cloudflare allows request bodies up to 100 MB; this is a public,
// pre-authentication endpoint, so cap buffering well below that. 64 KB is
// far above any real Clerk webhook payload.
const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;

export interface SvixHeaders {
  svixId: string;
  svixTimestamp: string;
  svixSignature: string;
}

export function getSvixHeaders(request: Request): SvixHeaders | null {
  const svixId = request.headers.get('svix-id');
  const svixTimestamp = request.headers.get('svix-timestamp');
  const svixSignature = request.headers.get('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature) return null;
  return { svixId, svixTimestamp, svixSignature };
}

function isTimestampFresh(svixTimestamp: string): boolean {
  const timestampSeconds = Number(svixTimestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  const nowSeconds = Date.now() / 1000;
  return Math.abs(nowSeconds - timestampSeconds) <= SVIX_TIMESTAMP_TOLERANCE_SECONDS;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a[i] ^ b[i];
  return result === 0;
}

/**
 * Decodes CLERK_ACCOUNT_DELETION_WEBHOOK_SIGNING_SECRET into raw HMAC key
 * bytes. Throws only on a malformed CONFIGURED secret (misconfiguration --
 * the caller should treat that as a 500, not a signature failure).
 */
export function decodeSvixSigningSecret(signingSecret: string): Uint8Array {
  if (!signingSecret.startsWith(SVIX_SECRET_PREFIX)) {
    throw new Error('Signing secret is missing the whsec_ prefix');
  }
  return base64ToBytes(signingSecret.slice(SVIX_SECRET_PREFIX.length));
}

async function computeSvixSignature(secretBytes: Uint8Array, signedContent: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent));
  return bytesToBase64(new Uint8Array(signature));
}

/**
 * Verifies a Svix-format webhook signature against the RAW request body.
 * Returns false for any attacker-controlled malformation (missing/garbled
 * headers, stale timestamp, wrong signature) rather than throwing --
 * only a misconfigured (not-yet-base64) secret throws, via
 * decodeSvixSigningSecret above, before this function is ever called.
 */
export async function verifyClerkWebhookSignature(
  rawBody: string,
  headers: SvixHeaders,
  secretBytes: Uint8Array
): Promise<boolean> {
  if (!isTimestampFresh(headers.svixTimestamp)) return false;

  const signedContent = `${headers.svixId}.${headers.svixTimestamp}.${rawBody}`;
  const expectedSignature = await computeSvixSignature(secretBytes, signedContent);
  const expectedBytes = base64ToBytes(expectedSignature);

  for (const candidate of headers.svixSignature.split(' ')) {
    const commaIndex = candidate.indexOf(',');
    if (commaIndex === -1) continue;
    const scheme = candidate.slice(0, commaIndex);
    const signature = candidate.slice(commaIndex + 1);
    if (scheme !== 'v1' || !signature) continue;
    let candidateBytes: Uint8Array;
    try {
      candidateBytes = base64ToBytes(signature);
    } catch {
      continue;
    }
    if (constantTimeEqualBytes(candidateBytes, expectedBytes)) return true;
  }
  return false;
}

interface ClerkDeletedUserEvent {
  type?: unknown;
  data?: { id?: unknown };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads the request body up to `maxBytes`, checking the declared
 * Content-Length first (a fast-path reject that avoids touching the stream
 * at all) and then enforcing the same cap while reading the stream itself,
 * so a chunked or undeclared-length body can't exceed it either. Returns
 * the buffered bytes decoded as UTF-8 (byte-identical on re-encode for the
 * valid UTF-8 Clerk sends; a malformed-UTF-8 body would fail signature
 * verification rather than reach the JSON layer) -- verification runs
 * against what was buffered, never a truncated or re-fetched copy.
 */
async function readBodyWithLimit(
  request: Request,
  maxBytes: number
): Promise<{ ok: true; text: string } | { ok: false }> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const declaredBytes = Number(declaredLength);
    if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
      return { ok: false };
    }
  }

  if (!request.body) {
    return { ok: true, text: await request.text() };
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return { ok: false };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(combined) };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function logAccountDeletionAttempt(fields: {
  svixId: string | undefined;
  outcome: string;
  deletionStatus?: 'completed' | 'failed';
}): void {
  console.log(JSON.stringify({
    event: 'clerk_account_deletion_webhook',
    service: 'auth-worker',
    svix_id: fields.svixId,
    outcome: fields.outcome,
    deletion_status: fields.deletionStatus,
  }));
}

/**
 * POST /webhooks/clerk/account-deletion handler. The caller (index-hono.ts)
 * is responsible for per-IP rate limiting before invoking this.
 *
 * Response code contract. Svix retries any non-2xx response identically
 * regardless of status code (it does not distinguish 4xx from 5xx), so the
 * specific codes below exist for our own logs/monitoring, not to steer
 * Svix's retry behavior. What actually matters for correctness is only the
 * 2xx/non-2xx boundary: 2xx must mean "the purge committed, or this
 * payload could never succeed no matter how many times it's retried";
 * every other case must be non-2xx so Svix keeps retrying it.
 *  - 500: signing secret not configured / malformed (misconfiguration).
 *  - 413: request body exceeds MAX_WEBHOOK_BODY_BYTES (declared via
 *         Content-Length, or observed while streaming) -- rejected before
 *         signature verification, since no real Clerk payload is this large.
 *  - 400: missing/malformed Svix headers, invalid signature, or stale
 *         timestamp -- authentication failures.
 *  - 200 {received:true, skipped:true}: signature verified, but the body is
 *         unparseable JSON, its root isn't a non-null, non-array object, the
 *         event is not `user.deleted`, or `data.id` is missing/empty --
 *         permanently unprocessable, do not burn Svix retries on it.
 *  - 504: the purge RPC did not complete within the deadline -- Svix retries.
 *  - 500: the purge RPC returned an error -- Svix retries.
 *  - 200 {received:true, deleted:true}: purge RPC committed successfully.
 */
export async function handleClerkAccountDeletionWebhook(
  request: Request,
  env: ClerkWebhookEnv
): Promise<Response> {
  const signingSecret = env.CLERK_ACCOUNT_DELETION_WEBHOOK_SIGNING_SECRET;
  if (!signingSecret) {
    logAccountDeletionAttempt({ svixId: undefined, outcome: 'rejected_misconfigured' });
    return jsonResponse({ error: 'server_error' }, 500);
  }

  let secretBytes: Uint8Array;
  try {
    secretBytes = decodeSvixSigningSecret(signingSecret);
  } catch {
    logAccountDeletionAttempt({ svixId: undefined, outcome: 'rejected_misconfigured' });
    return jsonResponse({ error: 'server_error' }, 500);
  }

  const svixHeaders = getSvixHeaders(request);
  if (!svixHeaders) {
    logAccountDeletionAttempt({ svixId: undefined, outcome: 'rejected_missing_headers' });
    return jsonResponse({ error: 'invalid_webhook' }, 400);
  }

  // Cap the body BEFORE buffering it -- Cloudflare allows request bodies up
  // to 100 MB, and this endpoint is reachable pre-authentication.
  const bodyResult = await readBodyWithLimit(request, MAX_WEBHOOK_BODY_BYTES);
  if (!bodyResult.ok) {
    logAccountDeletionAttempt({ svixId: svixHeaders.svixId, outcome: 'rejected_body_too_large' });
    return jsonResponse({ error: 'payload_too_large' }, 413);
  }

  // Verify against the RAW, unparsed body. Do not call request.json() first.
  const rawBody = bodyResult.text;
  const verified = await verifyClerkWebhookSignature(rawBody, svixHeaders, secretBytes);
  if (!verified) {
    logAccountDeletionAttempt({ svixId: svixHeaders.svixId, outcome: 'rejected_bad_signature' });
    return jsonResponse({ error: 'invalid_webhook' }, 400);
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    // Signature-valid but unparseable body can never succeed on retry.
    logAccountDeletionAttempt({ svixId: svixHeaders.svixId, outcome: 'skipped_invalid_json' });
    return jsonResponse({ received: true, skipped: true }, 200);
  }

  if (!isPlainObject(parsedBody)) {
    // JSON.parse("null") and JSON.parse("[...]") both succeed but leave no
    // `.type` to read -- same permanently-unprocessable lane as bad JSON,
    // not a retryable 500.
    logAccountDeletionAttempt({ svixId: svixHeaders.svixId, outcome: 'skipped_invalid_json' });
    return jsonResponse({ received: true, skipped: true }, 200);
  }
  const event = parsedBody as ClerkDeletedUserEvent;

  if (event.type !== 'user.deleted') {
    logAccountDeletionAttempt({ svixId: svixHeaders.svixId, outcome: 'skipped_wrong_event' });
    return jsonResponse({ received: true, skipped: true }, 200);
  }

  const clerkUserId = event.data?.id;
  if (typeof clerkUserId !== 'string' || clerkUserId.trim() === '') {
    logAccountDeletionAttempt({ svixId: svixHeaders.svixId, outcome: 'skipped_missing_id' });
    return jsonResponse({ received: true, skipped: true }, 200);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PURGE_RPC_TIMEOUT_MS);
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  // supabase-js defaults to shouldThrowOnError: false, so an aborted fetch
  // is expected to surface as `error`, not a rejected promise. The
  // try/catch below is defense-in-depth only, for whatever supabase-js
  // version actually ends up deployed: it never inspects the caught value,
  // so it still never guesses at an error.message/name shape -- it only
  // lets `controller.signal.aborted` (armed independently by the timeout
  // above) distinguish a timeout from any other unexpected rejection.
  let rpcError: unknown = null;
  try {
    const { error } = await supabase
      .rpc('purge_account_data', { p_clerk_user_id: clerkUserId })
      .abortSignal(controller.signal);
    rpcError = error;
  } catch (caught) {
    rpcError = caught;
  } finally {
    clearTimeout(timeoutId);
  }

  if (rpcError) {
    const timedOut = controller.signal.aborted;
    logAccountDeletionAttempt({
      svixId: svixHeaders.svixId,
      outcome: timedOut ? 'error_timeout' : 'error_rpc',
      deletionStatus: 'failed',
    });
    return jsonResponse({ error: timedOut ? 'timeout' : 'server_error' }, timedOut ? 504 : 500);
  }

  logAccountDeletionAttempt({ svixId: svixHeaders.svixId, outcome: 'purged', deletionStatus: 'completed' });
  return jsonResponse({ received: true, deleted: true }, 200);
}
