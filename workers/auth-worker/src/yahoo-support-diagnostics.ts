/**
 * Operator support diagnostics for a single Yahoo-connected account (FLA-360).
 *
 * These routes are the only ones that take their target user id from the request
 * body, so the request shape is validated strictly: a fixed key set, a hard byte
 * cap, and a Clerk user-id pattern. Business logic (inspect/diagnose/refresh)
 * lands in later changes; this module currently owns request validation only.
 */

export const CLERK_USER_ID_PATTERN = /^user_[A-Za-z0-9]{20,64}$/;
const MAX_REQUEST_BYTES = 1024;
/**
 * Hard ceiling on Yahoo round trips a single diagnose call may make. Exported
 * now so the diagnostic implementation and its tests share one budget constant.
 */
export const MAX_YAHOO_DIAGNOSTIC_REQUESTS = 2;

export interface YahooSupportRequest {
  userId: string;
}

export type YahooSupportValidation =
  | { request: YahooSupportRequest }
  | { error: { status: 400 | 413; body: { error: string; error_description: string } } };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidRequest(
  error: string,
  errorDescription: string,
  status: 400 | 413 = 400
): YahooSupportValidation {
  return { error: { status, body: { error, error_description: errorDescription } } };
}

export async function parseYahooSupportRequest(request: Request): Promise<YahooSupportValidation> {
  const contentLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return invalidRequest('request_too_large', `Request body exceeds ${MAX_REQUEST_BYTES} bytes`, 413);
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
    return invalidRequest('request_too_large', `Request body exceeds ${MAX_REQUEST_BYTES} bytes`, 413);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return invalidRequest('invalid_request', 'Request body must be valid JSON');
  }
  if (!isRecord(body)) return invalidRequest('invalid_request', 'Request body must be a JSON object');

  const allowedKeys = new Set(['userId']);
  const unknownKey = Object.keys(body).find((key) => !allowedKeys.has(key));
  if (unknownKey) return invalidRequest('invalid_request', `Unknown request field: ${unknownKey}`);

  if (typeof body.userId !== 'string' || !CLERK_USER_ID_PATTERN.test(body.userId)) {
    return invalidRequest('invalid_user_id', 'userId must be a valid user ID');
  }

  return { request: { userId: body.userId } };
}
