import { ErrorCode } from './errors';

export const INTERNAL_SERVICE_TOKEN_HEADER = 'X-Flaim-Internal-Token';

async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [aHash, bHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(a)),
    crypto.subtle.digest('SHA-256', encoder.encode(b)),
  ]);
  const aArr = new Uint8Array(aHash);
  const bArr = new Uint8Array(bHash);
  let result = 0;
  for (let i = 0; i < aArr.length; i += 1) {
    result |= aArr[i] ^ bArr[i];
  }
  return result === 0;
}

export function isProductionLikeEnvironment(env?: { ENVIRONMENT?: string; NODE_ENV?: string }): boolean {
  return env?.ENVIRONMENT === 'prod' || env?.ENVIRONMENT === 'preview' || env?.NODE_ENV === 'production';
}

export function requireInternalServiceToken(env: { INTERNAL_SERVICE_TOKEN?: string }, target: string): string {
  if (!env.INTERNAL_SERVICE_TOKEN) {
    throw new Error(`INTERNAL_SERVICE_TOKEN is required for ${target}`);
  }
  return env.INTERNAL_SERVICE_TOKEN;
}

export function withInternalServiceToken(
  headersInit: HeadersInit | undefined,
  env: { INTERNAL_SERVICE_TOKEN?: string },
  target: string
): Headers {
  const headers = new Headers(headersInit);
  headers.set(INTERNAL_SERVICE_TOKEN_HEADER, requireInternalServiceToken(env, target));
  return headers;
}

export type InternalServiceResult =
  | { authorized: true }
  | {
      authorized: false;
      error: { success: false; error: string; code: string };
      status: 403 | 500;
    };

export async function validateInternalService(
  request: Request,
  env: { INTERNAL_SERVICE_TOKEN?: string },
  target: string,
): Promise<InternalServiceResult> {
  if (!env.INTERNAL_SERVICE_TOKEN) {
    return {
      authorized: false,
      error: { success: false, error: `INTERNAL_SERVICE_TOKEN is not configured for ${target}`, code: ErrorCode.INTERNAL_AUTH_NOT_CONFIGURED },
      status: 500,
    };
  }
  if (!(await hasValidInternalServiceToken(request, env))) {
    return {
      authorized: false,
      error: { success: false, error: `Missing or invalid ${INTERNAL_SERVICE_TOKEN_HEADER}`, code: ErrorCode.INTERNAL_AUTH_REQUIRED },
      status: 403,
    };
  }
  return { authorized: true };
}

export async function hasValidInternalServiceToken(
  request: Request,
  env: { INTERNAL_SERVICE_TOKEN?: string }
): Promise<boolean> {
  if (!env.INTERNAL_SERVICE_TOKEN) {
    return false;
  }
  const providedToken = request.headers.get(INTERNAL_SERVICE_TOKEN_HEADER);
  if (!providedToken) {
    return false;
  }
  return constantTimeEqual(providedToken, env.INTERNAL_SERVICE_TOKEN);
}
