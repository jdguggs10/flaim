/**
 * OAuth 2.0 CLIENT — Flaim obtains tokens FROM Yahoo
 * ---------------------------------------------------------------------------
 *
 * Flaim acts as an OAuth 2.0 client to Yahoo Fantasy Sports. Users authorize
 * Flaim to access their Yahoo Fantasy data, and Flaim stores/refreshes the
 * resulting tokens.
 *
 * Handlers:
 * - Authorization: Redirect users to Yahoo's OAuth consent page
 * - Callback: Handle Yahoo's redirect with auth code, exchange for tokens
 * - Credentials: Provide access tokens (with auto-refresh) for API calls
 * - Disconnect: Remove Yahoo connection and stored data
 * - Status: Check if user is connected to Yahoo
 *
 * This is the CLIENT side of OAuth — Flaim consumes tokens from Yahoo here.
 * For the PROVIDER side (issuing tokens TO AI clients), see oauth-handlers.ts.
 */

import {
  REFRESH_COOLDOWN_OWNER_PREFIX,
  YahooStorage,
  type YahooCredentialHealth,
  type YahooCredentials,
  type YahooLeague,
} from './yahoo-storage';
import { getFrontendUrl, resolvePreviewOrigin } from './preview-url';
import {
  computeYahooAppFingerprint,
  yahooAppFingerprintStatus,
  type YahooAppFingerprintStatus,
} from './yahoo-app-fingerprint';
import {
  YAHOO_DEFAULT_TRANSIENT_RETRY_AFTER_SECONDS,
  YAHOO_REFRESH_IN_PROGRESS_RETRY_AFTER_SECONDS,
  classifyYahooApiFailure,
  defaultYahooRetryAfterSeconds,
  isYahooRateLimitStatus,
  isYahooTransientHttpStatus,
  parseRetryAfterSeconds,
  logSetupSignal,
  YahooAuthWorkerErrorCode,
  type SetupSignalEvent,
  type YahooPublicCredentialHealth,
  type YahooPublicRefreshState,
} from '@flaim/worker-shared';

// =============================================================================
// TYPES
// =============================================================================

export interface YahooConnectEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  YAHOO_CLIENT_ID: string;
  YAHOO_CLIENT_SECRET: string;
  ENVIRONMENT?: string;
  NODE_ENV?: string;
  FRONTEND_URL?: string;
}

// Yahoo's token endpoint returns success and error bodies through the same
// parser. Error bodies are normalized with inert placeholders for the required
// token fields; use isUsableTokenResponse before treating a parsed body as a
// usable token.
interface YahooTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  xoauth_yahoo_guid?: string;
  status?: number;
  error?: string;
  error_description?: string;
  upstream_error_text?: string;
  upstream_body_excerpt?: string;
  response_content_type?: string;
  www_authenticate?: string;
  yahoo_response_headers?: Record<string, string>;
  yahoo_numeric_code?: string;
  retry_after?: number;
  retry_after_source?: YahooRetryAfterSource;
}

type YahooCredentialRefreshState = 'none' | 'in_progress' | 'cooldown' | 'expired';
type YahooTokenGrantType = 'authorization_code' | 'refresh_token';
type YahooRetryAfterSource = 'upstream_header' | 'fallback_default' | 'cooldown_remaining';
type YahooTokenBodyClass =
  | 'empty'
  | 'json_error'
  | 'plain_text'
  | 'invalid_success_shape'
  | 'usable_success';
type YahooTokenFailureDiagnosticKind =
  | 'transient_http'
  | 'transient_text'
  | 'permanent'
  | 'unexpected';
type YahooRefreshDiagnosticPhase =
  | 'lease'
  | 'token_exchange'
  | 'refresh_request'
  | 'refresh_response'
  | 'cooldown'
  | 'credential_update';
type YahooRefreshDiagnosticOutcome =
  | 'attempt_started'
  | 'success'
  | 'retryable_failure'
  | 'permanent_failure'
  | 'rate_limited'
  | 'timeout'
  | 'fetch_error'
  | 'cooldown_active'
  | 'cooldown_bypassed';
type YahooRefreshDiagnosticClass =
  | 'yahoo_rate_limit'
  | 'yahoo_transient_http'
  | 'yahoo_transient_text'
  | 'yahoo_permanent'
  | 'yahoo_unexpected_response'
  | 'fetch_error'
  | 'timeout'
  | 'cooldown_active'
  | 'lease_not_acquired'
  | 'lease_window_too_short'
  | 'app_fingerprint_mismatch';

interface YahooRefreshDiagnosticFields {
  correlationId?: string;
  userId?: string;
  phase?: YahooRefreshDiagnosticPhase;
  outcome?: YahooRefreshDiagnosticOutcome;
  diagnosticClass?: YahooRefreshDiagnosticClass;
  reason?: string;
  refreshState?: YahooCredentialRefreshState;
  accessTokenExpiresInSeconds?: number;
  accessTokenLifetimeSeconds?: number;
  leaseRemainingSeconds?: number;
  requestTimeoutMs?: number;
  retryAfter?: number;
  retryAfterSource?: YahooRetryAfterSource;
  upstreamStatus?: number;
  tokenError?: string;
  failureKind?: YahooTokenFailureDiagnosticKind;
  bodyClass?: YahooTokenBodyClass;
  upstreamErrorText?: string;
  upstreamBodyExcerpt?: string;
  responseContentType?: string;
  wwwAuthenticate?: string;
  yahooResponseHeaders?: Record<string, string>;
  yahooNumericCode?: string;
  // True only when Yahoo sent a parseable Retry-After header. Fallback/default
  // retry hints are identified separately with retryAfterSource. Kept as the
  // original field name for existing log queries; prefer hasUpstreamRetryAfter.
  hasRetryAfter?: boolean;
  hasUpstreamRetryAfter?: boolean;
  hasUpstreamErrorText?: boolean;
  secondsSinceCredentialUpdate?: number;
  tokenGrantType?: YahooTokenGrantType;
  callbackUrl?: string;
  callbackHost?: string;
  callbackPath?: string;
  requestHasRedirectUri?: boolean;
  yahooClientIdPresent?: boolean;
  yahooClientSecretPresent?: boolean;
  authType?: string;
  refreshTokenReturned?: boolean;
  refreshTokenChanged?: boolean;
  recoveryAttempted?: boolean;
  recoverySucceeded?: boolean;
  // App fingerprints are non-secret (SHA-256 prefix of the client id); the
  // client id itself is never logged.
  appFingerprintStatus?: YahooAppFingerprintStatus;
  storedAppFingerprint?: string;
  runtimeAppFingerprint?: string;
}

// Internal annotation from the Yahoo token endpoint parser. This is consumed by
// diagnostics only and is never serialized to external callers.
type YahooTokenDiagnosticResponse = YahooTokenResponse & {
  upstream_body_class?: YahooTokenBodyClass;
};

// =============================================================================
// CONFIGURATION
// =============================================================================

const YAHOO_AUTH_URL = 'https://api.login.yahoo.com/oauth2/request_auth';
const YAHOO_TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';
const YAHOO_SCOPE = 'fspt-r'; // Fantasy Sports read access

const LEASE_TTL_MS       = 30_000;
// Used for both OAuth exchange and refresh token requests; must stay below LEASE_TTL_MS.
const YAHOO_TOKEN_REQUEST_TIMEOUT_MS = 20_000;
const YAHOO_REQUEST_LEASE_SAFETY_MS = 1_000;
// Yahoo token refresh 429s often omit Retry-After. Keep our own no-Yahoo
// window modest so interactive users are not blocked for 15 minutes while
// still preventing rapid retry pile-ons.
const YAHOO_REFRESH_RATE_LIMIT_FALLBACK_COOLDOWN_SECONDS = 60;

/**
 * Get the OAuth callback URL based on environment
 */
function getCallbackUrl(env: YahooConnectEnv): string {
  if (env.ENVIRONMENT === 'dev' || env.NODE_ENV === 'development') {
    return 'http://localhost:8786/connect/yahoo/callback';
  }
  if (env.ENVIRONMENT === 'preview') {
    return 'https://api.flaim.app/auth-preview/connect/yahoo/callback';
  }
  return 'https://api.flaim.app/auth/connect/yahoo/callback';
}

// getFrontendUrl imported from ./preview-url

/**
 * Generate a random nonce for CSRF protection
 */
function generateNonce(): string {
  return crypto.randomUUID();
}

/**
 * Mask user ID for logging
 */
function maskUserId(userId: string): string {
  if (!userId || userId.length <= 8) return '***';
  return `${userId.substring(0, 8)}...`;
}

function secondsUntil(date?: Date, nowMs = Date.now()): number | undefined {
  if (!date) {
    return undefined;
  }
  return Math.ceil((date.getTime() - nowMs) / 1000);
}

function secondsSince(date?: Date, nowMs = Date.now()): number | undefined {
  if (!date) {
    return undefined;
  }
  return Math.max(0, Math.floor((nowMs - date.getTime()) / 1000));
}

function nonNegativeSecondsUntil(date?: Date, nowMs = Date.now()): number | undefined {
  const seconds = secondsUntil(date, nowMs);
  return seconds !== undefined ? Math.max(seconds, 0) : undefined;
}

function boundedPositiveSecondsUntil(date?: Date, nowMs = Date.now()): number | undefined {
  const seconds = secondsUntil(date, nowMs);
  return seconds !== undefined && seconds > 0 ? seconds : undefined;
}

function yahooRefreshState(
  credentials: { refreshLeaseOwner?: string; refreshLeaseExpiresAt?: Date } | null,
  nowMs = Date.now()
): YahooCredentialRefreshState {
  if (!credentials?.refreshLeaseOwner) {
    return 'none';
  }
  if (leaseExpired(credentials, nowMs)) {
    return 'expired';
  }
  return credentials.refreshLeaseOwner.startsWith(REFRESH_COOLDOWN_OWNER_PREFIX)
    ? 'cooldown'
    : 'in_progress';
}

function publicYahooRefreshState(refreshState: YahooCredentialRefreshState): YahooPublicRefreshState {
  return refreshState === 'none' ? 'idle' : refreshState;
}

function buildPublicYahooHealth(
  credentials: YahooCredentialHealth,
  nowMs = Date.now()
): YahooPublicCredentialHealth {
  const refreshState = yahooRefreshState(credentials, nowMs);
  const health: YahooPublicCredentialHealth = {
    accessTokenState: credentials.needsRefresh ? 'needs_refresh' : 'fresh',
    refreshState: publicYahooRefreshState(refreshState),
  };
  const retryAfterSeconds = boundedPositiveSecondsUntil(credentials.refreshLeaseExpiresAt, nowMs);
  if ((refreshState === 'cooldown' || refreshState === 'in_progress') && retryAfterSeconds !== undefined) {
    health.retryAfterSeconds = retryAfterSeconds;
  }
  return health;
}

function logYahooRefreshDiagnostic(event: string, fields: YahooRefreshDiagnosticFields = {}): void {
  const payload: Record<string, unknown> = {
    service: 'auth-worker',
    component: 'yahoo-connect',
    event,
  };

  if (fields.userId) payload.user_id = maskUserId(fields.userId);
  if (fields.correlationId) payload.correlation_id = fields.correlationId;
  if (fields.phase !== undefined) payload.phase = fields.phase;
  if (fields.outcome !== undefined) payload.outcome = fields.outcome;
  if (fields.diagnosticClass !== undefined) payload.diagnostic_class = fields.diagnosticClass;
  if (fields.reason !== undefined) payload.reason = fields.reason;
  if (fields.refreshState !== undefined) payload.refresh_state = fields.refreshState;
  if (fields.accessTokenExpiresInSeconds !== undefined) payload.access_token_expires_in_seconds = fields.accessTokenExpiresInSeconds;
  if (fields.accessTokenLifetimeSeconds !== undefined) payload.access_token_lifetime_seconds = fields.accessTokenLifetimeSeconds;
  if (fields.leaseRemainingSeconds !== undefined) payload.lease_remaining_seconds = fields.leaseRemainingSeconds;
  if (fields.requestTimeoutMs !== undefined) payload.request_timeout_ms = fields.requestTimeoutMs;
  if (fields.retryAfter !== undefined) payload.retry_after = fields.retryAfter;
  if (fields.retryAfterSource !== undefined) payload.retry_after_source = fields.retryAfterSource;
  if (fields.upstreamStatus !== undefined) payload.upstream_status = fields.upstreamStatus;
  if (fields.tokenError !== undefined) payload.token_error = fields.tokenError;
  if (fields.failureKind !== undefined) payload.failure_kind = fields.failureKind;
  if (fields.bodyClass !== undefined) payload.body_class = fields.bodyClass;
  if (fields.upstreamErrorText !== undefined) payload.upstream_error_text = fields.upstreamErrorText;
  if (fields.upstreamBodyExcerpt !== undefined) payload.upstream_body_excerpt = fields.upstreamBodyExcerpt;
  if (fields.responseContentType !== undefined) payload.response_content_type = fields.responseContentType;
  if (fields.wwwAuthenticate !== undefined) payload.www_authenticate = fields.wwwAuthenticate;
  if (fields.yahooResponseHeaders !== undefined) payload.yahoo_response_headers = fields.yahooResponseHeaders;
  if (fields.yahooNumericCode !== undefined) payload.yahoo_numeric_code = fields.yahooNumericCode;
  if (fields.hasRetryAfter !== undefined) payload.has_retry_after = fields.hasRetryAfter;
  if (fields.hasUpstreamRetryAfter !== undefined) payload.has_upstream_retry_after = fields.hasUpstreamRetryAfter;
  if (fields.hasUpstreamErrorText !== undefined) payload.has_upstream_error_text = fields.hasUpstreamErrorText;
  if (fields.secondsSinceCredentialUpdate !== undefined) payload.seconds_since_credential_update = fields.secondsSinceCredentialUpdate;
  if (fields.tokenGrantType !== undefined) payload.token_grant_type = fields.tokenGrantType;
  if (fields.callbackUrl !== undefined) payload.callback_url = fields.callbackUrl;
  if (fields.callbackHost !== undefined) payload.callback_host = fields.callbackHost;
  if (fields.callbackPath !== undefined) payload.callback_path = fields.callbackPath;
  if (fields.requestHasRedirectUri !== undefined) payload.request_has_redirect_uri = fields.requestHasRedirectUri;
  if (fields.yahooClientIdPresent !== undefined) payload.yahoo_client_id_present = fields.yahooClientIdPresent;
  if (fields.yahooClientSecretPresent !== undefined) payload.yahoo_client_secret_present = fields.yahooClientSecretPresent;
  if (fields.authType !== undefined) payload.auth_type = fields.authType;
  if (fields.refreshTokenReturned !== undefined) payload.refresh_token_returned = fields.refreshTokenReturned;
  if (fields.refreshTokenChanged !== undefined) payload.refresh_token_changed = fields.refreshTokenChanged;
  if (fields.recoveryAttempted !== undefined) payload.recovery_attempted = fields.recoveryAttempted;
  if (fields.recoverySucceeded !== undefined) payload.recovery_succeeded = fields.recoverySucceeded;
  if (fields.appFingerprintStatus !== undefined) payload.app_fingerprint_status = fields.appFingerprintStatus;
  if (fields.storedAppFingerprint !== undefined) payload.stored_app_fingerprint = fields.storedAppFingerprint;
  if (fields.runtimeAppFingerprint !== undefined) payload.runtime_app_fingerprint = fields.runtimeAppFingerprint;

  console.log(JSON.stringify(payload));
}

function logYahooSetupFailure(
  env: YahooConnectEnv,
  event: string,
  fields: Omit<SetupSignalEvent, 'service' | 'component' | 'event' | 'outcome' | 'platform'>,
  request?: Request
): void {
  const url = request ? new URL(request.url) : undefined;
  logSetupSignal({
    service: 'auth-worker',
    component: 'yahoo-connect',
    event,
    platform: 'yahoo',
    request_path: url?.pathname,
    method: request?.method,
    has_auth_header: request?.headers.has('Authorization'),
    correlation_id: fields.correlation_id || request?.headers.get('X-Correlation-ID') || undefined,
    cf_ray: request?.headers.get('CF-Ray') || undefined,
    environment: env.ENVIRONMENT || env.NODE_ENV,
    ...fields,
    outcome: 'failure',
  } as SetupSignalEvent & Record<string, unknown>);
}

type UsableYahooTokenResponse =
  YahooTokenResponse & {
    access_token: string;
    expires_in: number;
  };

function hasUsableTokenFields(response: Partial<YahooTokenResponse>): boolean {
  return typeof response.access_token === 'string'
    && response.access_token.length > 0
    && typeof response.expires_in === 'number'
    && Number.isFinite(response.expires_in)
    && response.expires_in > 0;
}

function isUsableTokenResponse(response: Partial<YahooTokenResponse>): response is UsableYahooTokenResponse {
  return hasUsableTokenFields(response);
}

function toYahooTokenResponse(response: UsableYahooTokenResponse): YahooTokenResponse {
  return {
    ...response,
    token_type: typeof response.token_type === 'string' && response.token_type.length > 0
      ? response.token_type
      : 'bearer',
  };
}

function isTransientYahooTokenError(status?: number): boolean {
  return isYahooTransientHttpStatus(status);
}

function normalizeYahooTokenText(...values: Array<string | undefined>): string {
  return values
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();
}

const PERMANENT_YAHOO_TOKEN_ERROR_CODES = [
  'invalid_grant',
  'invalid_request',
  'invalid_client',
  'unauthorized_client',
  'unsupported_grant_type',
  'redirect_uri_mismatch',
  'malformed_request',
];

const PERMANENT_YAHOO_TOKEN_TEXT_SIGNALS = [
  'refresh token expired',
  'expired refresh token',
  'refresh token revoked',
  'token revoked',
  'permanent failure',
  'permanently',
  'malformed',
  'redirect_uri',
  'already used',
];

function hasPermanentYahooTokenFailureSignal(
  response: Pick<YahooTokenResponse, 'error' | 'error_description' | 'upstream_error_text'>
): boolean {
  // Evaluated before transient signals so mixed messages like "temporarily unavailable, token revoked" stay permanent.
  const errorCode = typeof response.error === 'string' ? response.error.toLowerCase() : '';
  if (PERMANENT_YAHOO_TOKEN_ERROR_CODES.includes(errorCode)) {
    return true;
  }

  const text = normalizeYahooTokenText(response.error_description, response.upstream_error_text);
  return PERMANENT_YAHOO_TOKEN_TEXT_SIGNALS.some(signal => text.includes(signal));
}

function classifyYahooTokenFailure(
  response: Pick<YahooTokenResponse, 'status' | 'error' | 'error_description' | 'upstream_error_text' | 'retry_after_source'>
): YahooTokenFailureDiagnosticKind {
  // Permanent signals win over transient-looking text so revoked/expired tokens still trigger reconnect.
  if (hasPermanentYahooTokenFailureSignal(response)) {
    return 'permanent';
  }

  if (isTransientYahooTokenError(response.status)) {
    return 'transient_http';
  }

  // Yahoo-provided Retry-After is an explicit upstream backoff signal even
  // when Yahoo uses a non-standard token endpoint status. Permanent OAuth
  // failures are already filtered above so malformed requests do not get masked.
  if (response.retry_after_source === 'upstream_header') {
    return 'transient_text';
  }

  return 'unexpected';
}

function isTransientYahooTokenFailure(
  response: Pick<YahooTokenResponse, 'status' | 'error' | 'error_description' | 'upstream_error_text' | 'retry_after_source'>
): boolean {
  const failureKind = classifyYahooTokenFailure(response);
  return failureKind === 'transient_http' || failureKind === 'transient_text';
}

const YAHOO_TOKEN_BODY_LOG_LIMIT = 2000;
const YAHOO_TOKEN_HEADER_LOG_LIMIT = 500;

function truncateDiagnosticValue(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function sanitizeYahooTokenBodyForLog(text: string): string {
  return text
    .replace(/("access_token"\s*:\s*")(?:\\.|[^"\\])*(")/gi, '$1[redacted]$2')
    .replace(/("refresh_token"\s*:\s*")(?:\\.|[^"\\])*(")/gi, '$1[redacted]$2')
    .replace(/(access_token=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(refresh_token=)[^&\s]+/gi, '$1[redacted]');
}

// Empty token error bodies carry no useful diagnostic detail for logs or callers.
function trimYahooTokenBody(text: string, limit = 300): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  return truncateDiagnosticValue(trimmed, limit);
}

function yahooTokenBodyExcerptForLog(text: string): string | undefined {
  return trimYahooTokenBody(sanitizeYahooTokenBodyForLog(text), YAHOO_TOKEN_BODY_LOG_LIMIT);
}

function collectYahooTokenResponseHeaders(headers: Headers): Record<string, string> | undefined {
  const yahooHeaders: Record<string, string> = {};
  headers.forEach((value, key) => {
    const normalizedKey = key.toLowerCase();
    if (normalizedKey.startsWith('x-yahoo-')) {
      yahooHeaders[normalizedKey] = truncateDiagnosticValue(value, YAHOO_TOKEN_HEADER_LOG_LIMIT);
    }
  });
  return Object.keys(yahooHeaders).length > 0 ? yahooHeaders : undefined;
}

function extractYahooNumericCode(...values: Array<string | undefined>): string | undefined {
  for (const value of values) {
    const match = value?.match(/\[(\d{4,6})\]/);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

function parseYahooTokenBody(text: string): Partial<YahooTokenResponse> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Partial<YahooTokenResponse>
      : null;
  } catch {
    return null;
  }
}

async function readYahooTokenResponse(
  response: Response,
  fallbackError: string,
  fallbackErrorDescription: string
): Promise<YahooTokenDiagnosticResponse> {
  const text = await response.text();
  const data = parseYahooTokenBody(text);
  const nonJsonDescription = data ? undefined : trimYahooTokenBody(sanitizeYahooTokenBodyForLog(text));
  const upstreamBodyExcerpt = yahooTokenBodyExcerptForLog(text);
  const responseContentType = response.headers.get('Content-Type') ?? undefined;
  const wwwAuthenticate = response.headers.get('WWW-Authenticate') ?? undefined;
  const yahooResponseHeaders = collectYahooTokenResponseHeaders(response.headers);
  const bodyClassForErrorPaths: YahooTokenBodyClass = data
    ? 'json_error'
    : text.trim().length === 0
      ? 'empty'
      : 'plain_text';
  const errorDescription = typeof data?.error_description === 'string'
    ? data.error_description
    : fallbackErrorDescription;
  const yahooNumericCode = extractYahooNumericCode(errorDescription, nonJsonDescription, upstreamBodyExcerpt);
  const upstreamRetryAfter = parseRetryAfterSeconds(response.headers.get('Retry-After'));
  const fallbackRetryAfter = defaultYahooRetryAfterSeconds(response.status);
  const retryAfter = upstreamRetryAfter ?? fallbackRetryAfter;
  // Preserve whether retry_after came from Yahoo's explicit Retry-After header
  // or from Flaim's status-based defaults; classification relies on that split.
  const retryAfterSource: YahooRetryAfterSource | undefined = upstreamRetryAfter !== undefined
    ? 'upstream_header'
    : fallbackRetryAfter !== undefined
      ? 'fallback_default'
      : undefined;

  if (!response.ok) {
    return {
      access_token: '',
      expires_in: 0,
      token_type: 'bearer',
      error: typeof data?.error === 'string' ? data.error : fallbackError,
      error_description: errorDescription,
      upstream_error_text: nonJsonDescription,
      upstream_body_excerpt: upstreamBodyExcerpt,
      response_content_type: responseContentType,
      www_authenticate: wwwAuthenticate ? truncateDiagnosticValue(wwwAuthenticate, YAHOO_TOKEN_HEADER_LOG_LIMIT) : undefined,
      yahoo_response_headers: yahooResponseHeaders,
      yahoo_numeric_code: yahooNumericCode,
      status: response.status,
      retry_after: retryAfter,
      retry_after_source: retryAfterSource,
      upstream_body_class: bodyClassForErrorPaths,
    };
  }

  if (!data) {
    return {
      access_token: '',
      expires_in: 0,
      token_type: 'bearer',
      error: fallbackError,
      error_description: fallbackErrorDescription,
      upstream_error_text: nonJsonDescription,
      upstream_body_excerpt: upstreamBodyExcerpt,
      response_content_type: responseContentType,
      www_authenticate: wwwAuthenticate ? truncateDiagnosticValue(wwwAuthenticate, YAHOO_TOKEN_HEADER_LOG_LIMIT) : undefined,
      yahoo_response_headers: yahooResponseHeaders,
      yahoo_numeric_code: yahooNumericCode,
      status: response.status,
      retry_after: retryAfter,
      retry_after_source: retryAfterSource,
      upstream_body_class: bodyClassForErrorPaths,
    };
  }

  if (!isUsableTokenResponse(data)) {
    return {
      access_token: '',
      expires_in: 0,
      token_type: 'bearer',
      error: fallbackError,
      error_description: fallbackErrorDescription,
      upstream_error_text: nonJsonDescription,
      upstream_body_excerpt: upstreamBodyExcerpt,
      status: response.status,
      retry_after: retryAfter,
      retry_after_source: retryAfterSource,
      response_content_type: responseContentType,
      www_authenticate: wwwAuthenticate ? truncateDiagnosticValue(wwwAuthenticate, YAHOO_TOKEN_HEADER_LOG_LIMIT) : undefined,
      yahoo_response_headers: yahooResponseHeaders,
      yahoo_numeric_code: yahooNumericCode,
      upstream_body_class: 'invalid_success_shape',
    };
  }

  return {
    ...toYahooTokenResponse(data),
    upstream_body_class: 'usable_success',
  };
}

function yahooTokenResponseDiagnosticFields(
  result: YahooTokenDiagnosticResponse
): Pick<
  YahooRefreshDiagnosticFields,
  | 'upstreamStatus'
  | 'tokenError'
  | 'bodyClass'
  | 'upstreamErrorText'
  | 'upstreamBodyExcerpt'
  | 'responseContentType'
  | 'wwwAuthenticate'
  | 'yahooResponseHeaders'
  | 'yahooNumericCode'
  | 'hasRetryAfter'
  | 'hasUpstreamRetryAfter'
  | 'retryAfterSource'
  | 'hasUpstreamErrorText'
> {
  const hasYahooRetryAfter = result.retry_after_source === 'upstream_header';
  return {
    upstreamStatus: result.status,
    tokenError: result.error,
    bodyClass: result.upstream_body_class,
    upstreamErrorText: result.upstream_error_text,
    upstreamBodyExcerpt: result.upstream_body_excerpt,
    responseContentType: result.response_content_type,
    wwwAuthenticate: result.www_authenticate,
    yahooResponseHeaders: result.yahoo_response_headers,
    yahooNumericCode: result.yahoo_numeric_code,
    // Keep both field names during the diagnostics transition: has_retry_after
    // is the legacy log key, while has_upstream_retry_after is explicit.
    hasRetryAfter: hasYahooRetryAfter,
    hasUpstreamRetryAfter: hasYahooRetryAfter,
    retryAfterSource: result.retry_after_source,
    hasUpstreamErrorText: Boolean(result.upstream_error_text),
  };
}

// =============================================================================
// TOKEN ACQUISITION
// =============================================================================

type GetTokenResult =
  | { accessToken: string; expiresIn: number }
  | { error: string; errorDescription?: string; retryable?: boolean; retryAfter?: number; retryAfterSource?: YahooRetryAfterSource; upstreamStatus?: number };

function toTokenResult(credentials: { accessToken: string; expiresAt: Date }): GetTokenResult {
  return {
    accessToken: credentials.accessToken,
    expiresIn: Math.floor((credentials.expiresAt.getTime() - Date.now()) / 1000),
  };
}

function leaseExpired(
  credentials: { refreshLeaseOwner?: string; refreshLeaseExpiresAt?: Date } | null,
  nowMs = Date.now()
): boolean {
  if (!credentials?.refreshLeaseOwner) {
    return true;
  }
  return credentials.refreshLeaseExpiresAt
    ? credentials.refreshLeaseExpiresAt.getTime() <= nowMs
    : true;
}

function isRefreshCooldown(credentials: { refreshLeaseOwner?: string; refreshLeaseExpiresAt?: Date } | null): boolean {
  return Boolean(credentials?.refreshLeaseOwner?.startsWith(REFRESH_COOLDOWN_OWNER_PREFIX))
    && !leaseExpired(credentials);
}

function retryAfterFromLease(credentials: { refreshLeaseExpiresAt?: Date } | null): number | undefined {
  return boundedPositiveSecondsUntil(credentials?.refreshLeaseExpiresAt);
}

function yahooRefreshCooldownResult(
  credentials: YahooCredentials,
  logDiagnostic: (event: string, fields?: YahooRefreshDiagnosticFields) => void
): GetTokenResult {
  const retryAfter = retryAfterFromLease(credentials) ?? YAHOO_REFRESH_RATE_LIMIT_FALLBACK_COOLDOWN_SECONDS;
  logDiagnostic('refresh_cooldown_active', {
    userId: credentials.clerkUserId,
    phase: 'cooldown',
    outcome: 'retryable_failure',
    diagnosticClass: 'cooldown_active',
    refreshState: 'cooldown',
    retryAfter,
    retryAfterSource: 'cooldown_remaining',
    leaseRemainingSeconds: retryAfter,
  });
  return {
    error: YahooAuthWorkerErrorCode.REFRESH_TEMPORARILY_UNAVAILABLE,
    errorDescription: 'Yahoo token refresh is cooling down after a temporary Yahoo response. Please try again shortly.',
    retryable: true,
    retryAfter,
    retryAfterSource: 'cooldown_remaining',
  };
}

function yahooTokenRequestDiagnosticFields(
  env: YahooConnectEnv,
  grantType: YahooTokenGrantType,
  body: URLSearchParams
): Pick<
  YahooRefreshDiagnosticFields,
  | 'tokenGrantType'
  | 'callbackUrl'
  | 'callbackHost'
  | 'callbackPath'
  | 'requestHasRedirectUri'
  | 'yahooClientIdPresent'
  | 'yahooClientSecretPresent'
> {
  const callbackUrl = getCallbackUrl(env);
  const parsedCallbackUrl = new URL(callbackUrl);

  return {
    tokenGrantType: grantType,
    callbackUrl,
    callbackHost: parsedCallbackUrl.host,
    callbackPath: parsedCallbackUrl.pathname,
    requestHasRedirectUri: body.has('redirect_uri'),
    yahooClientIdPresent: Boolean(env.YAHOO_CLIENT_ID),
    yahooClientSecretPresent: Boolean(env.YAHOO_CLIENT_SECRET),
  };
}

function hasYahooClientCredentials(env: YahooConnectEnv): boolean {
  return Boolean(env.YAHOO_CLIENT_ID && env.YAHOO_CLIENT_SECRET);
}

function yahooAuthorizationCodeTokenBody(code: string, env: YahooConnectEnv): URLSearchParams {
  return new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: getCallbackUrl(env),
  });
}

function yahooRefreshTokenBody(refreshToken: string): URLSearchParams {
  return new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function yahooTokenFailureDiagnosticClass(
  result: Pick<YahooTokenResponse, 'status'>,
  failureKind: YahooTokenFailureDiagnosticKind
): YahooRefreshDiagnosticClass {
  if (isYahooRateLimitStatus(result.status)) {
    return 'yahoo_rate_limit';
  }

  if (failureKind === 'transient_http') {
    return 'yahoo_transient_http';
  }

  if (failureKind === 'transient_text') {
    return 'yahoo_transient_text';
  }

  if (failureKind === 'permanent') {
    return 'yahoo_permanent';
  }

  return 'yahoo_unexpected_response';
}

function yahooTokenFailureOutcome(
  result: Pick<YahooTokenResponse, 'status'>,
  failureKind: YahooTokenFailureDiagnosticKind
): YahooRefreshDiagnosticOutcome {
  if (isYahooRateLimitStatus(result.status)) {
    return 'rate_limited';
  }

  return failureKind === 'permanent' || failureKind === 'unexpected'
    ? 'permanent_failure'
    : 'retryable_failure';
}

/**
 * Get a valid Yahoo access token for the given user, refreshing if needed.
 *
 * Uses a DB lease to ensure only one Worker calls Yahoo's token endpoint for a
 * given credential row. This keeps the refresh path intentionally boring: one
 * owner, one Yahoo refresh request, one guarded storage write. Non-owners do
 * not poll, retry, or become a second token-endpoint caller in the same request.
 */
async function getValidYahooAccessToken(
  storage: YahooStorage,
  userId: string,
  env: YahooConnectEnv,
  initialCredentials?: YahooCredentials,
  correlationId?: string,
  authType?: string
): Promise<GetTokenResult> {
  const logDiagnostic = (event: string, fields: YahooRefreshDiagnosticFields = {}) => {
    logYahooRefreshDiagnostic(event, { correlationId, authType, ...fields });
  };

  let credentials = initialCredentials ?? await storage.getYahooCredentials(userId);
  if (!credentials) {
    logDiagnostic('credentials_missing', { userId });
    return { error: 'not_connected' };
  }

  if (!credentials.needsRefresh) {
    logDiagnostic('token_fresh_returned', {
      userId,
      accessTokenExpiresInSeconds: secondsUntil(credentials.expiresAt),
      secondsSinceCredentialUpdate: secondsSince(credentials.updatedAt),
      refreshState: yahooRefreshState(credentials),
    });
    return toTokenResult(credentials);
  }

  if (isRefreshCooldown(credentials)) {
    return yahooRefreshCooldownResult(credentials, logDiagnostic);
  }

  // Pre-refresh guard: tokens minted under a different Yahoo app can never be
  // refreshed with this worker's client credentials, so skip the doomed Yahoo
  // call. Legacy NULL-fingerprint rows proceed as before and are backfilled on
  // their next successful refresh.
  const runtimeAppFingerprint = await computeYahooAppFingerprint(env.YAHOO_CLIENT_ID);
  const appFingerprintStatus = yahooAppFingerprintStatus(credentials.appFingerprint, runtimeAppFingerprint);
  if (appFingerprintStatus === 'mismatch') {
    logDiagnostic('refresh_app_fingerprint_mismatch', {
      userId,
      phase: 'refresh_request',
      outcome: 'permanent_failure',
      diagnosticClass: 'app_fingerprint_mismatch',
      reason: 'stored_tokens_minted_by_different_yahoo_app',
      appFingerprintStatus,
      storedAppFingerprint: credentials.appFingerprint,
      runtimeAppFingerprint,
      secondsSinceCredentialUpdate: secondsSince(credentials.updatedAt),
    });
    console.error(
      `[yahoo-connect] Yahoo app fingerprint mismatch for user ${maskUserId(userId)}: stored tokens were minted by a different Yahoo app than this worker is configured with`
    );
    return {
      error: YahooAuthWorkerErrorCode.APP_FINGERPRINT_MISMATCH,
      errorDescription: 'Stored Yahoo tokens were issued by a different Yahoo app than this worker is configured with. Reconnect Yahoo, or fix the worker Yahoo client configuration.',
    };
  }

  const ownerId = crypto.randomUUID();
  logDiagnostic('lease_acquire_attempt', {
    userId,
    accessTokenExpiresInSeconds: secondsUntil(credentials.expiresAt),
    secondsSinceCredentialUpdate: secondsSince(credentials.updatedAt),
    refreshState: yahooRefreshState(credentials),
  });
  const leaseAttemptStartedAt = Date.now();
  const won = await storage.acquireRefreshLease(
    userId,
    ownerId,
    LEASE_TTL_MS,
    credentials.refreshToken
  );

  if (!won) {
    logDiagnostic('lease_not_acquired', {
      userId,
      phase: 'lease',
      outcome: 'retryable_failure',
      diagnosticClass: 'lease_not_acquired',
      retryAfter: YAHOO_REFRESH_IN_PROGRESS_RETRY_AFTER_SECONDS,
      retryAfterSource: 'fallback_default',
      refreshState: yahooRefreshState(credentials),
      leaseRemainingSeconds: boundedPositiveSecondsUntil(credentials.refreshLeaseExpiresAt),
    });
    const latest = await storage.getYahooCredentials(userId);
    if (!latest) {
      logDiagnostic('credentials_missing_after_lease_loss', { userId });
      return { error: 'not_connected' };
    }
    if (!latest.needsRefresh) {
      logDiagnostic('lease_loss_found_fresh_token', {
        userId,
        accessTokenExpiresInSeconds: secondsUntil(latest.expiresAt),
        secondsSinceCredentialUpdate: secondsSince(latest.updatedAt),
      });
      return toTokenResult(latest);
    }
    if (isRefreshCooldown(latest)) {
      return yahooRefreshCooldownResult(latest, logDiagnostic);
    }
    return {
      error: YahooAuthWorkerErrorCode.REFRESH_TEMPORARILY_UNAVAILABLE,
      errorDescription: 'Yahoo token refresh is already in progress. Please try again shortly.',
      retryable: true,
      retryAfter: YAHOO_REFRESH_IN_PROGRESS_RETRY_AFTER_SECONDS,
      retryAfterSource: 'fallback_default',
    };
  }

  logDiagnostic('lease_acquired', {
    userId,
    accessTokenExpiresInSeconds: secondsUntil(credentials.expiresAt),
  });
  const leaseRemainingMs = leaseAttemptStartedAt + LEASE_TTL_MS - Date.now();
  if (leaseRemainingMs <= YAHOO_TOKEN_REQUEST_TIMEOUT_MS + YAHOO_REQUEST_LEASE_SAFETY_MS) {
    logDiagnostic('lease_window_too_short', {
      userId,
      phase: 'lease',
      outcome: 'retryable_failure',
      diagnosticClass: 'lease_window_too_short',
      reason: 'lease_window_too_short',
      retryAfter: YAHOO_REFRESH_IN_PROGRESS_RETRY_AFTER_SECONDS,
      retryAfterSource: 'fallback_default',
      leaseRemainingSeconds: Math.max(0, Math.ceil(leaseRemainingMs / 1000)),
    });
    try {
      await storage.releaseRefreshLease(userId, ownerId);
    } catch (releaseError) {
      console.warn('[yahoo-connect] Failed to release Yahoo refresh lease after short lease window:', releaseError);
    }
    return {
      error: YahooAuthWorkerErrorCode.REFRESH_TEMPORARILY_UNAVAILABLE,
      errorDescription: 'Yahoo token refresh lease window was too short to safely call Yahoo. Please try again shortly.',
      retryable: true,
      retryAfter: YAHOO_REFRESH_IN_PROGRESS_RETRY_AFTER_SECONDS,
      retryAfterSource: 'fallback_default',
    };
  }

  const requestBody = yahooRefreshTokenBody(credentials.refreshToken);
  const requestDiagnosticFields = yahooTokenRequestDiagnosticFields(env, 'refresh_token', requestBody);
  if (!hasYahooClientCredentials(env)) {
    logDiagnostic('refresh_config_missing', {
      userId,
      phase: 'refresh_request',
      outcome: 'permanent_failure',
      diagnosticClass: 'yahoo_permanent',
      reason: 'missing_yahoo_client_config',
      ...requestDiagnosticFields,
    });
    try {
      await storage.releaseRefreshLease(userId, ownerId);
    } catch (releaseError) {
      console.warn('[yahoo-connect] Failed to release Yahoo refresh lease after missing Yahoo client config:', releaseError);
    }
    return {
      error: 'refresh_failed',
      errorDescription: 'Yahoo client credentials are not configured',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), YAHOO_TOKEN_REQUEST_TIMEOUT_MS);
  let result: YahooTokenDiagnosticResponse;
  try {
    logDiagnostic('refresh_request_started', {
      userId,
      phase: 'refresh_request',
      outcome: 'attempt_started',
      requestTimeoutMs: YAHOO_TOKEN_REQUEST_TIMEOUT_MS,
      appFingerprintStatus,
      storedAppFingerprint: credentials.appFingerprint,
      runtimeAppFingerprint,
      ...requestDiagnosticFields,
    });
    result = await refreshAccessToken(requestBody, env, controller.signal);
  } catch (error) {
    const isAbort = isAbortError(error);
    logDiagnostic('refresh_request_exception', {
      userId,
      phase: 'refresh_request',
      outcome: isAbort ? 'timeout' : 'fetch_error',
      diagnosticClass: isAbort ? 'timeout' : 'fetch_error',
      reason: isAbort ? 'abort' : 'fetch_error',
      requestTimeoutMs: YAHOO_TOKEN_REQUEST_TIMEOUT_MS,
    });
    console.error(
      `[yahoo-connect] Yahoo token refresh request failed for user ${maskUserId(userId)}:`,
      error instanceof Error ? error.message : error
    );
    try {
      await storage.releaseRefreshLease(userId, ownerId);
    } catch (releaseError) {
      console.warn('[yahoo-connect] Failed to release Yahoo refresh lease after refresh exception:', releaseError);
    }
    return {
      error: YahooAuthWorkerErrorCode.REFRESH_TEMPORARILY_UNAVAILABLE,
      errorDescription: isAbort
        ? 'Yahoo token refresh timed out. Please try again shortly.'
        : 'Yahoo token refresh request failed. Please try again shortly.',
      retryable: true,
      retryAfter: YAHOO_DEFAULT_TRANSIENT_RETRY_AFTER_SECONDS,
      retryAfterSource: 'fallback_default',
    };
  } finally {
    clearTimeout(timer);
  }

  if (result.error) {
    const failureKind = classifyYahooTokenFailure(result);
    const diagnosticClass = yahooTokenFailureDiagnosticClass(result, failureKind);
    const diagnosticOutcome = yahooTokenFailureOutcome(result, failureKind);
    const statusSuffix = result.status ? ` (HTTP ${result.status})` : '';
    logDiagnostic('refresh_response_error', {
      userId,
      phase: 'refresh_response',
      outcome: diagnosticOutcome,
      diagnosticClass,
      failureKind,
      ...yahooTokenResponseDiagnosticFields(result),
      secondsSinceCredentialUpdate: secondsSince(credentials.updatedAt),
      ...requestDiagnosticFields,
    });
    console.error(
      `[yahoo-connect] Yahoo token refresh failed for user ${maskUserId(userId)}: ${result.error}${statusSuffix}` +
        (result.error_description ? ` - ${result.error_description}` : '')
    );

    if (failureKind === 'transient_http' || failureKind === 'transient_text') {
      const isRateLimited = isYahooRateLimitStatus(result.status);
      const upstreamRetryAfter = result.retry_after_source === 'upstream_header'
        ? result.retry_after
        : undefined;
      const retryAfter = upstreamRetryAfter
        ?? (isRateLimited
          ? YAHOO_REFRESH_RATE_LIMIT_FALLBACK_COOLDOWN_SECONDS
          : defaultYahooRetryAfterSeconds(result.status))
        ?? YAHOO_DEFAULT_TRANSIENT_RETRY_AFTER_SECONDS;
      const retryAfterSource = upstreamRetryAfter !== undefined
        ? 'upstream_header'
        : 'fallback_default';
      logDiagnostic('refresh_transient_failure', {
        userId,
        phase: 'refresh_response',
        outcome: diagnosticOutcome,
        diagnosticClass,
        retryAfter,
        retryAfterSource,
        failureKind,
        ...yahooTokenResponseDiagnosticFields(result),
        secondsSinceCredentialUpdate: secondsSince(credentials.updatedAt),
      });
      if (isRateLimited) {
        try {
          const cooldownMarked = await storage.markRefreshCooldown(
            userId,
            ownerId,
            retryAfter * 1000
          );
          logDiagnostic('refresh_cooldown_marked', {
            userId,
            phase: 'cooldown',
            outcome: diagnosticOutcome,
            diagnosticClass,
            retryAfter,
            retryAfterSource,
            failureKind,
            reason: cooldownMarked ? 'cooldown_marked' : 'owner_guard_miss',
            ...yahooTokenResponseDiagnosticFields(result),
            secondsSinceCredentialUpdate: secondsSince(credentials.updatedAt),
          });
          if (!cooldownMarked) {
            const latest = await storage.getYahooCredentials(userId);
            if (latest && isRefreshCooldown(latest)) {
              return yahooRefreshCooldownResult(latest, logDiagnostic);
            }
          }
        } catch (cooldownError) {
          console.warn('[yahoo-connect] Failed to mark Yahoo refresh cooldown:', cooldownError);
          logDiagnostic('refresh_cooldown_mark_failed', {
            userId,
            phase: 'cooldown',
            outcome: 'retryable_failure',
            diagnosticClass,
            retryAfter,
            retryAfterSource,
            failureKind,
            reason: 'storage_error',
            ...yahooTokenResponseDiagnosticFields(result),
            secondsSinceCredentialUpdate: secondsSince(credentials.updatedAt),
          });
        }
      } else {
        logDiagnostic('refresh_failure_lease_retained', {
          userId,
          phase: 'refresh_response',
          outcome: diagnosticOutcome,
          diagnosticClass,
          retryAfter,
          retryAfterSource,
          failureKind,
          ...yahooTokenResponseDiagnosticFields(result),
          secondsSinceCredentialUpdate: secondsSince(credentials.updatedAt),
        });
      }
      return {
        error: YahooAuthWorkerErrorCode.REFRESH_TEMPORARILY_UNAVAILABLE,
        errorDescription: result.error_description || 'Yahoo token refresh temporarily unavailable. Please try again shortly.',
        retryable: true,
        retryAfter,
        retryAfterSource,
        upstreamStatus: result.status,
      };
    }

    try {
      await storage.releaseRefreshLease(userId, ownerId);
    } catch (releaseError) {
      console.warn('[yahoo-connect] Failed to release Yahoo refresh lease after Yahoo refresh error:', releaseError);
    }

    logDiagnostic('refresh_permanent_failure', {
      userId,
      phase: 'refresh_response',
      outcome: diagnosticOutcome,
      diagnosticClass,
      failureKind,
      ...yahooTokenResponseDiagnosticFields(result),
      secondsSinceCredentialUpdate: secondsSince(credentials.updatedAt),
    });
    return {
      error: 'refresh_failed',
      errorDescription: result.error_description || 'Failed to refresh access token',
      upstreamStatus: result.status,
    };
  }

  if (!hasUsableTokenFields(result)) {
    logDiagnostic('refresh_invalid_response', {
      userId,
      upstreamStatus: result.status,
      bodyClass: result.upstream_body_class,
      hasRetryAfter: result.retry_after_source === 'upstream_header',
    });
    console.error(`[yahoo-connect] Yahoo token refresh returned an invalid token response for user ${maskUserId(userId)}`);
    try {
      await storage.releaseRefreshLease(userId, ownerId);
    } catch (releaseError) {
      console.warn('[yahoo-connect] Failed to release Yahoo refresh lease after invalid Yahoo refresh response:', releaseError);
    }
    return { error: 'refresh_failed', errorDescription: 'Failed to refresh access token' };
  }

  const expiresAt = new Date(Date.now() + result.expires_in * 1000);
  const nextRefreshToken = result.refresh_token || credentials.refreshToken;
  const refreshTokenReturned = Boolean(result.refresh_token);
  const refreshTokenChanged = Boolean(result.refresh_token && result.refresh_token !== credentials.refreshToken);
  const wrote = await storage.updateYahooCredentials(
    userId,
    // A successful refresh proves the row's tokens belong to the runtime app,
    // so stamping the fingerprint here also backfills legacy NULL rows.
    { accessToken: result.access_token, refreshToken: nextRefreshToken, expiresAt, appFingerprint: runtimeAppFingerprint },
    ownerId
  );

  if (wrote) {
    logDiagnostic('credential_update_succeeded', {
      userId,
      phase: 'credential_update',
      outcome: 'success',
      accessTokenLifetimeSeconds: result.expires_in,
      refreshTokenReturned,
      refreshTokenChanged,
      secondsSinceCredentialUpdate: secondsSince(credentials.updatedAt),
    });
    console.log(`[yahoo-connect] Token refreshed for user ${maskUserId(userId)}`);
    return { accessToken: result.access_token, expiresIn: result.expires_in };
  }

  logDiagnostic('credential_update_owner_guard_miss', {
    userId,
    phase: 'credential_update',
    outcome: 'retryable_failure',
    refreshTokenReturned,
    refreshTokenChanged,
  });
  const recovered = await storage.updateYahooCredentialsIfRefreshTokenMatches(
    userId,
    { accessToken: result.access_token, refreshToken: nextRefreshToken, expiresAt, appFingerprint: runtimeAppFingerprint },
    credentials.refreshToken
  );
  if (recovered) {
    logDiagnostic('credential_update_recovered_after_owner_guard_miss', {
      userId,
      phase: 'credential_update',
      outcome: 'success',
      accessTokenLifetimeSeconds: result.expires_in,
      refreshTokenReturned,
      refreshTokenChanged,
      recoveryAttempted: true,
      recoverySucceeded: true,
      secondsSinceCredentialUpdate: secondsSince(credentials.updatedAt),
    });
    console.log(`[yahoo-connect] Token refreshed for user ${maskUserId(userId)} after owner guard miss`);
    return { accessToken: result.access_token, expiresIn: result.expires_in };
  }

  const latest = await storage.getYahooCredentials(userId);
  if (!latest) {
    logDiagnostic('credentials_missing_after_recovery_miss', { userId });
    return { error: 'not_connected' };
  }
  if (latest && !latest.needsRefresh) {
    logDiagnostic('owner_guard_miss_found_fresh_token', {
      userId,
      accessTokenExpiresInSeconds: secondsUntil(latest.expiresAt),
      secondsSinceCredentialUpdate: secondsSince(latest.updatedAt),
    });
    return toTokenResult(latest);
  }
  try {
    await storage.releaseRefreshLease(userId, ownerId);
  } catch (releaseError) {
    console.warn('[yahoo-connect] Failed to release Yahoo refresh lease after owner guard miss:', releaseError);
  }
  return {
    error: YahooAuthWorkerErrorCode.REFRESH_TEMPORARILY_UNAVAILABLE,
    errorDescription: 'Yahoo token refresh could not be stored safely. Please try again shortly.',
    retryable: true,
    retryAfter: YAHOO_REFRESH_IN_PROGRESS_RETRY_AFTER_SECONDS,
    retryAfterSource: 'fallback_default',
  };
}

function yahooRefreshFailureResponse(
  result: Extract<GetTokenResult, { error: string }>,
  corsHeaders: Record<string, string>
): Response {
  // The error code is the canonical response signal; retryable is retained for downstream clients.
  if (result.error === YahooAuthWorkerErrorCode.REFRESH_TEMPORARILY_UNAVAILABLE) {
    const retryAfter = result.retryAfter;
    const retryAfterSource = result.retryAfterSource;
    const headers: Record<string, string> = { 'Content-Type': 'application/json', ...corsHeaders };
    if (retryAfter) {
      headers['Retry-After'] = String(retryAfter);
    }

    return new Response(
      JSON.stringify({
        error: YahooAuthWorkerErrorCode.REFRESH_TEMPORARILY_UNAVAILABLE,
        error_description: result.errorDescription || 'Yahoo token refresh is temporarily unavailable. Please try again later.',
        retryable: true,
        retry_after: retryAfter,
        retry_after_source: retryAfterSource,
        upstream_status: result.upstreamStatus,
      }),
      {
        status: 503,
        headers,
      }
    );
  }

  // Pass the coded error through (refresh_failed, app_fingerprint_mismatch, ...)
  // so reconnect-required classification stays code-driven downstream.
  return new Response(
    JSON.stringify({
      error: result.error,
      error_description: result.errorDescription || 'Failed to refresh access token',
      upstream_status: result.upstreamStatus,
    }),
    {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    }
  );
}

function yahooApiFailureResponse(
  response: Pick<Response, 'headers' | 'status'>,
  corsHeaders: Record<string, string>
): Response {
  const classification = classifyYahooApiFailure(response);
  const retryAfter = classification.retryAfter;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...corsHeaders };
  if (retryAfter) {
    headers['Retry-After'] = String(retryAfter);
  }

  // Expose upstream_status deliberately: it lets MCP clients distinguish Yahoo
  // 999 rate limits from ordinary transient 5xx failures without log access.
  if (classification.retryable) {
    const isRateLimited = classification.kind === 'rate_limited';
    return new Response(
      JSON.stringify({
        error: YahooAuthWorkerErrorCode.YAHOO_API_TEMPORARILY_UNAVAILABLE,
        error_description: isRateLimited
          ? 'Yahoo is temporarily rate limiting league discovery. Please wait a bit and try again.'
          : 'Yahoo league discovery is temporarily unavailable. Please try again later.',
        retryable: true,
        retry_after: retryAfter,
        upstream_status: classification.upstreamStatus,
      }),
      {
        status: classification.status,
        headers,
      }
    );
  }

  return new Response(
    JSON.stringify({
      error: YahooAuthWorkerErrorCode.YAHOO_API_ERROR,
      error_description: `Yahoo API returned ${classification.upstreamStatus}`,
      upstream_status: classification.upstreamStatus,
    }),
    {
      // Discovery 403/404 can be ambiguous between Yahoo permissions, stale
      // league IDs, and upstream platform behavior, so keep them as platform
      // API failures instead of routing users into reconnect-required auth UI.
      status: classification.kind === 'auth_error' ? classification.status : 502,
      headers,
    }
  );
}

// =============================================================================
// HANDLERS
// =============================================================================

/**
 * GET /connect/yahoo/authorize
 *
 * Initiates the Yahoo OAuth flow by redirecting to Yahoo's authorization page.
 * Generates a state parameter for CSRF protection containing userId and nonce.
 */
export async function handleYahooAuthorize(
  env: YahooConnectEnv,
  userId: string,
  corsHeaders: Record<string, string>,
  request?: Request
): Promise<Response> {
  try {
    const storage = YahooStorage.fromEnvironment(env);

    // Generate state as userId:nonce for CSRF protection
    const nonce = generateNonce();
    const state = `${userId}:${nonce}`;

    // In preview, store the frontend origin so the callback can redirect back
    const redirectAfter = (env.ENVIRONMENT === 'preview' && request)
      ? resolvePreviewOrigin(request)
      : undefined;

    // Store state for validation in callback
    await storage.createPlatformOAuthState({
      state,
      clerkUserId: userId,
      platform: 'yahoo',
      expiresInSeconds: 600, // 10 minutes
      redirectAfter,
    });

    // Build Yahoo OAuth URL
    const authUrl = new URL(YAHOO_AUTH_URL);
    authUrl.searchParams.set('client_id', env.YAHOO_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', getCallbackUrl(env));
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', YAHOO_SCOPE);
    authUrl.searchParams.set('state', state);

    console.log(`[yahoo-connect] Redirecting user ${maskUserId(userId)} to Yahoo OAuth`);

    return new Response(null, {
      status: 302,
      headers: {
        Location: authUrl.toString(),
        ...corsHeaders,
      },
    });
  } catch (error) {
    logYahooSetupFailure(env, 'onboarding_failed', {
      stage: 'authorization_start',
      failure_kind: 'storage',
      error_code: 'authorization_failed',
      http_status: 500,
      auth_type: 'clerk',
    }, request);
    console.error('[yahoo-connect] Authorization error:', error);
    return new Response(
      JSON.stringify({
        error: 'authorization_failed',
        error_description: 'Failed to initiate Yahoo authorization',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }
}

/**
 * GET /connect/yahoo/callback?code=xxx&state=xxx
 *
 * Handles the redirect from Yahoo after user grants/denies consent.
 * Exchanges the authorization code for access and refresh tokens.
 */
export async function handleYahooCallback(
  request: Request,
  env: YahooConnectEnv,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  let frontendUrl = getFrontendUrl(env);

  // Helper for error redirects
  const errorRedirect = (error: string, description?: string) => {
    const redirectUrl = new URL(`${frontendUrl}/leagues`);
    redirectUrl.searchParams.set('error', error);
    if (description) {
      redirectUrl.searchParams.set('error_description', description);
    }
    return new Response(null, {
      status: 302,
      headers: { Location: redirectUrl.toString(), ...corsHeaders },
    });
  };

  // Check for OAuth error from Yahoo
  if (errorParam) {
    console.log(`[yahoo-connect] OAuth error from Yahoo: ${errorParam}`);
    return errorRedirect('oauth_denied', url.searchParams.get('error_description') || 'User denied access');
  }

  // Validate required parameters
  if (!code) {
    if (state) {
      logYahooSetupFailure(env, 'oauth_callback_failed', {
        stage: 'callback_validation',
        failure_kind: 'validation',
        error_code: 'missing_code',
        http_status: 302,
        auth_type: 'clerk',
      }, request);
    }
    console.log('[yahoo-connect] Callback missing code parameter');
    return errorRedirect('missing_code', 'Authorization code not provided');
  }

  if (!state) {
    logYahooSetupFailure(env, 'oauth_callback_failed', {
      stage: 'callback_validation',
      failure_kind: 'validation',
      error_code: 'missing_state',
      http_status: 302,
      auth_type: 'clerk',
    }, request);
    console.log('[yahoo-connect] Callback missing state parameter');
    return errorRedirect('missing_state', 'State parameter not provided');
  }

  try {
    const storage = YahooStorage.fromEnvironment(env);

    // Validate and consume state (single-use)
    const stateData = await storage.consumePlatformOAuthState(state);
    if (!stateData) {
      logYahooSetupFailure(env, 'oauth_callback_failed', {
        stage: 'state_validation',
        failure_kind: 'validation',
        error_code: 'invalid_state',
        http_status: 302,
        auth_type: 'clerk',
      }, request);
      console.log('[yahoo-connect] Invalid or expired state');
      return errorRedirect('invalid_state', 'Invalid or expired state parameter');
    }

    const { clerkUserId } = stateData;

    // Use stored redirect origin for preview deployments
    if (stateData.redirectAfter) {
      frontendUrl = stateData.redirectAfter;
    }

    // Exchange code for tokens
    const exchangeController = new AbortController();
    const exchangeTimer = setTimeout(() => exchangeController.abort(), YAHOO_TOKEN_REQUEST_TIMEOUT_MS);
    let tokenResponse: YahooTokenDiagnosticResponse;
    const requestBody = yahooAuthorizationCodeTokenBody(code, env);
    const requestDiagnosticFields = yahooTokenRequestDiagnosticFields(env, 'authorization_code', requestBody);
    logYahooRefreshDiagnostic('token_exchange_request_started', {
      userId: clerkUserId,
      authType: 'clerk',
      phase: 'token_exchange',
      outcome: 'attempt_started',
      requestTimeoutMs: YAHOO_TOKEN_REQUEST_TIMEOUT_MS,
      ...requestDiagnosticFields,
    });
    try {
      tokenResponse = await exchangeCodeForTokens(requestBody, env, exchangeController.signal);
    } catch (error) {
      clearTimeout(exchangeTimer);
      logYahooSetupFailure(env, 'oauth_callback_failed', {
        stage: 'token_exchange',
        failure_kind: isAbortError(error) ? 'timeout' : 'fetch_error',
        error_code: YahooAuthWorkerErrorCode.TOKEN_EXCHANGE_UNAVAILABLE,
        http_status: 302,
        retryable: true,
        retry_after: YAHOO_DEFAULT_TRANSIENT_RETRY_AFTER_SECONDS,
        retry_after_source: 'fallback_default',
        auth_type: 'clerk',
      }, request);
      logYahooRefreshDiagnostic('token_exchange_request_exception', {
        userId: clerkUserId,
        authType: 'clerk',
        phase: 'token_exchange',
        outcome: isAbortError(error) ? 'timeout' : 'fetch_error',
        diagnosticClass: isAbortError(error) ? 'timeout' : 'fetch_error',
        reason: isAbortError(error) ? 'abort' : 'fetch_error',
        requestTimeoutMs: YAHOO_TOKEN_REQUEST_TIMEOUT_MS,
        ...requestDiagnosticFields,
      });
      console.error(
        '[yahoo-connect] Token exchange request failed:',
        error instanceof Error ? error.message : error
      );
      return errorRedirect(
        YahooAuthWorkerErrorCode.TOKEN_EXCHANGE_UNAVAILABLE,
        'Yahoo token exchange is temporarily unavailable. Please try again.'
      );
    }
    clearTimeout(exchangeTimer);

    if (tokenResponse.error) {
      const failureKind = classifyYahooTokenFailure(tokenResponse);
      const isTransient = isTransientYahooTokenFailure(tokenResponse);
      logYahooSetupFailure(env, 'oauth_callback_failed', {
        stage: 'token_exchange',
        failure_kind: failureKind,
        error_code: isTransient ? YahooAuthWorkerErrorCode.TOKEN_EXCHANGE_UNAVAILABLE : 'token_exchange_failed',
        http_status: 302,
        upstream_status: tokenResponse.status,
        retryable: isTransient,
        retry_after: tokenResponse.retry_after,
        retry_after_source: tokenResponse.retry_after_source,
        auth_type: 'clerk',
      }, request);
      logYahooRefreshDiagnostic('token_exchange_response_error', {
        userId: clerkUserId,
        authType: 'clerk',
        phase: 'token_exchange',
        outcome: yahooTokenFailureOutcome(tokenResponse, failureKind),
        diagnosticClass: yahooTokenFailureDiagnosticClass(tokenResponse, failureKind),
        failureKind,
        ...yahooTokenResponseDiagnosticFields(tokenResponse),
        ...requestDiagnosticFields,
      });
      console.error(`[yahoo-connect] Token exchange failed: ${tokenResponse.error}`);
      return errorRedirect(
        isTransient ? YahooAuthWorkerErrorCode.TOKEN_EXCHANGE_UNAVAILABLE : 'token_exchange_failed',
        isTransient
          ? 'Yahoo token exchange is temporarily unavailable. Please try again.'
          : tokenResponse.error_description || 'Failed to exchange code for tokens'
      );
    }

    if (!hasUsableTokenFields(tokenResponse)) {
      logYahooSetupFailure(env, 'oauth_callback_failed', {
        stage: 'token_exchange',
        failure_kind: 'invalid_response',
        error_code: 'token_exchange_failed',
        http_status: 302,
        upstream_status: tokenResponse.status,
        auth_type: 'clerk',
      }, request);
      console.error('[yahoo-connect] Token exchange returned unusable token fields');
      return errorRedirect('token_exchange_failed', 'Yahoo did not return usable token fields');
    }

    // hasUsableTokenFields validates the access-token shape; reconnect must
    // also return a refresh token for future lazy refreshes.
    if (!tokenResponse.refresh_token) {
      logYahooSetupFailure(env, 'oauth_callback_failed', {
        stage: 'token_exchange',
        failure_kind: 'invalid_response',
        error_code: 'missing_refresh_token',
        http_status: 302,
        upstream_status: tokenResponse.status,
        auth_type: 'clerk',
      }, request);
      console.error('[yahoo-connect] Yahoo did not return a refresh token');
      return errorRedirect('token_exchange_failed', 'Yahoo did not provide a refresh token');
    }

    logYahooRefreshDiagnostic('token_exchange_response_success', {
      userId: clerkUserId,
      authType: 'clerk',
      phase: 'token_exchange',
      outcome: 'success',
      accessTokenLifetimeSeconds: tokenResponse.expires_in,
      refreshTokenReturned: Boolean(tokenResponse.refresh_token),
      ...requestDiagnosticFields,
    });

    const yahooGuid = tokenResponse.xoauth_yahoo_guid;
    if (!yahooGuid) {
      console.warn(`[yahoo-connect] Yahoo token exchange omitted GUID for user ${maskUserId(clerkUserId)}`);
    }

    const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);

    // Save credentials, stamped with the fingerprint of the Yahoo app that
    // minted them so later refreshes can detect app/secret mismatches.
    await storage.saveYahooCredentials({
      clerkUserId,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt,
      yahooGuid,
      appFingerprint: await computeYahooAppFingerprint(env.YAHOO_CLIENT_ID),
    });

    console.log(`[yahoo-connect] Successfully connected user ${maskUserId(clerkUserId)} to Yahoo`);

    // Redirect to frontend with success indicator
    const successUrl = new URL(`${frontendUrl}/leagues`);
    successUrl.searchParams.set('yahoo', 'connected');

    return new Response(null, {
      status: 302,
      headers: { Location: successUrl.toString(), ...corsHeaders },
    });
  } catch (error) {
    logYahooSetupFailure(env, 'oauth_callback_failed', {
      stage: 'callback',
      failure_kind: 'exception',
      error_code: 'callback_error',
      http_status: 302,
      auth_type: 'clerk',
    }, request);
    console.error('[yahoo-connect] Callback error:', error);
    return errorRedirect('callback_error', 'An error occurred during authorization');
  }
}

/**
 * GET /connect/yahoo/credentials
 *
 * Returns the current Yahoo access token for API calls.
 * Automatically refreshes the token if it's expired or about to expire.
 */
export async function handleYahooCredentials(
  env: YahooConnectEnv,
  userId: string,
  corsHeaders: Record<string, string>,
  correlationId?: string,
  authType?: string
): Promise<Response> {
  try {
    const storage = YahooStorage.fromEnvironment(env);
    const result = await getValidYahooAccessToken(storage, userId, env, undefined, correlationId, authType);

    if ('error' in result) {
      if (result.error === 'not_connected') {
        return new Response(
          JSON.stringify({
            error: 'not_connected',
            error_description: 'User is not connected to Yahoo',
          }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          }
        );
      }
      logYahooSetupFailure(env, 'platform_auth_failed', {
        stage: 'credential_refresh',
        failure_kind: result.retryable ? 'retryable_auth' : 'auth',
        error_code: result.error,
        http_status: result.error === YahooAuthWorkerErrorCode.REFRESH_TEMPORARILY_UNAVAILABLE ? 503 : 401,
        upstream_status: result.upstreamStatus,
        retryable: result.retryable,
        retry_after: result.retryAfter,
        retry_after_source: result.retryAfterSource,
        correlation_id: correlationId,
        auth_type: authType,
      });
      return yahooRefreshFailureResponse(result, corsHeaders);
    }

    return new Response(
      JSON.stringify({
        access_token: result.accessToken,
        expires_in: result.expiresIn,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          ...corsHeaders,
        },
      }
    );
  } catch (error) {
    logYahooSetupFailure(env, 'platform_auth_failed', {
      stage: 'credentials_lookup',
      failure_kind: 'exception',
      error_code: 'server_error',
      http_status: 500,
      correlation_id: correlationId,
      auth_type: authType,
    });
    console.error('[yahoo-connect] Credentials error:', error);
    return new Response(
      JSON.stringify({
        error: 'server_error',
        error_description: 'Failed to retrieve credentials',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }
}

/**
 * GET /internal/connect/yahoo/credential-health
 *
 * Returns non-secret Yahoo credential timing and refresh lease state for
 * production diagnostics. This never returns access tokens, refresh tokens, or
 * raw lease owner IDs.
 */
export async function handleYahooCredentialHealth(
  env: YahooConnectEnv,
  userId: string,
  corsHeaders: Record<string, string>,
  correlationId?: string
): Promise<Response> {
  try {
    const storage = YahooStorage.fromEnvironment(env);
    const credentials = await storage.getYahooCredentialHealth(userId);

    if (!credentials) {
      return new Response(
        JSON.stringify({
          connected: false,
          hasCredentials: false,
          platform: 'yahoo',
          checkedAt: new Date().toISOString(),
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            ...corsHeaders,
          },
        }
      );
    }

    const checkedAtDate = new Date();
    const checkedAtNowMs = checkedAtDate.getTime();
    const refreshState = yahooRefreshState(credentials, checkedAtNowMs);
    // Keep the internal lease-state enum distinct from the external diagnostic contract.
    const responseRefreshState = publicYahooRefreshState(refreshState);
    const leaseRemainingSeconds = boundedPositiveSecondsUntil(credentials.refreshLeaseExpiresAt, checkedAtNowMs);
    const refresh: { state: string; leaseExpiresAt?: string; retryAfterSeconds?: number } = {
      state: responseRefreshState,
    };
    if (refreshState !== 'none' && credentials.refreshLeaseExpiresAt) {
      refresh.leaseExpiresAt = credentials.refreshLeaseExpiresAt.toISOString();
    }
    if ((refreshState === 'cooldown' || refreshState === 'in_progress') && leaseRemainingSeconds !== undefined) {
      refresh.retryAfterSeconds = leaseRemainingSeconds;
    }
    const checkedAt = checkedAtDate.toISOString();
    const runtimeAppFingerprint = await computeYahooAppFingerprint(env.YAHOO_CLIENT_ID);

    return new Response(
      JSON.stringify({
        connected: true,
        hasCredentials: true,
        platform: 'yahoo',
        checkedAt,
        lastUpdated: credentials.updatedAt?.toISOString() ?? null,
        yahooGuidPresent: credentials.yahooGuidPresent,
        // Fingerprints are non-secret SHA-256 prefixes of the Yahoo client id;
        // 'mismatch' means stored tokens were minted by a different Yahoo app.
        appFingerprint: {
          stored: credentials.appFingerprint ?? null,
          runtime: runtimeAppFingerprint ?? null,
          status: yahooAppFingerprintStatus(credentials.appFingerprint, runtimeAppFingerprint),
        },
        accessToken: {
          expiresAt: credentials.expiresAt.toISOString(),
          expiresInSeconds: nonNegativeSecondsUntil(credentials.expiresAt, checkedAtNowMs),
          needsRefresh: credentials.needsRefresh,
          state: credentials.needsRefresh ? 'needs_refresh' : 'fresh',
        },
        refresh,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          ...corsHeaders,
        },
      }
    );
  } catch (error) {
    logYahooRefreshDiagnostic('credential_health_error', {
      correlationId,
      userId,
      reason: 'storage_error',
    });
    console.error('[yahoo-connect] Credential health error:', error);
    return new Response(
      JSON.stringify({
        error: 'server_error',
        error_description: 'Failed to retrieve Yahoo credential health',
      }),
      {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          ...corsHeaders,
        },
      }
    );
  }
}

/**
 * DELETE /connect/yahoo/disconnect
 *
 * Removes the Yahoo connection for a user, including:
 * - Yahoo OAuth credentials
 * - All discovered Yahoo leagues
 */
export async function handleYahooDisconnect(
  env: YahooConnectEnv,
  userId: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const storage = YahooStorage.fromEnvironment(env);

    // Delete credentials and leagues in parallel
    await Promise.all([
      storage.deleteYahooCredentials(userId),
      storage.deleteAllYahooLeagues(userId),
    ]);

    console.log(`[yahoo-connect] Disconnected user ${maskUserId(userId)} from Yahoo`);

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  } catch (error) {
    console.error('[yahoo-connect] Disconnect error:', error);
    return new Response(
      JSON.stringify({
        error: 'server_error',
        error_description: 'Failed to disconnect from Yahoo',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }
}

/**
 * GET /connect/yahoo/status
 *
 * Returns the current Yahoo connection status for a user.
 */
export async function handleYahooStatus(
  env: YahooConnectEnv,
  userId: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const storage = YahooStorage.fromEnvironment(env);

    // Public status exposes only coarse, non-secret health for the web UI.
    const [credentials, leagues] = await Promise.all([
      storage.getYahooCredentialHealth(userId),
      // Exclude archived to match the visible active-list count semantics; Yahoo
      // now has a real archived set, so this excludes archived recurring groups.
      storage.getYahooLeagues(userId, 'exclude-archived'),
    ]);
    const checkedAtNowMs = Date.now();

    return new Response(
      JSON.stringify({
        connected: !!credentials,
        leagueCount: leagues.length,
        lastUpdated: credentials?.updatedAt?.toISOString(),
        health: credentials ? buildPublicYahooHealth(credentials, checkedAtNowMs) : undefined,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  } catch (error) {
    console.error('[yahoo-connect] Status error:', error);
    return new Response(
      JSON.stringify({
        error: 'server_error',
        error_description: 'Failed to check Yahoo status',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Exchange authorization code for access and refresh tokens
 */
async function exchangeCodeForTokens(
  body: URLSearchParams,
  env: YahooConnectEnv,
  signal?: AbortSignal
): Promise<YahooTokenDiagnosticResponse> {
  const credentials = btoa(`${env.YAHOO_CLIENT_ID}:${env.YAHOO_CLIENT_SECRET}`);

  const response = await fetch(YAHOO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: body.toString(),
    signal,
  });

  const data = await readYahooTokenResponse(
    response,
    'token_error',
    'Failed to exchange code for tokens'
  );

  return data;
}

/**
 * Refresh an expired access token using the refresh token
 */
async function refreshAccessToken(
  body: URLSearchParams,
  env: YahooConnectEnv,
  signal?: AbortSignal
): Promise<YahooTokenDiagnosticResponse> {
  const credentials = btoa(`${env.YAHOO_CLIENT_ID}:${env.YAHOO_CLIENT_SECRET}`);

  const response = await fetch(YAHOO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: body.toString(),
    signal,
  });

  const data = await readYahooTokenResponse(
    response,
    'refresh_error',
    'Failed to refresh access token'
  );

  return data;
}

// =============================================================================
// LEAGUE DISCOVERY
// =============================================================================

const YAHOO_FANTASY_API_URL = 'https://fantasysports.yahooapis.com/fantasy/v2';

// Cap the renew-chain walk so a malformed/looping pointer set can't fetch
// unbounded league metas. Yahoo Fantasy Sports has run since ~2001 (~25 NFL
// seasons), so a real renew chain — one league renewed every year since launch —
// won't exceed this. The cap only guards against malformed/cyclic pointer data;
// matches Sleeper's MAX_HISTORY_YEARS intent.
const MAX_YAHOO_CHAIN_DEPTH = 25;

/**
 * Map Yahoo sport codes to our internal sport names
 */
const SPORT_CODE_MAP: Record<string, 'football' | 'baseball' | 'basketball' | 'hockey'> = {
  nfl: 'football',
  mlb: 'baseball',
  nba: 'basketball',
  nhl: 'hockey',
};

interface DiscoveredYahooLeague {
  sport: 'football' | 'baseball' | 'basketball' | 'hockey';
  seasonYear: number;
  leagueKey: string;
  leagueName: string;
  teamId: string;
  teamKey: string;
  teamName: string;
  // Yahoo's prior-season renew pointer (league meta resource) in
  // `{game_key}_{league_id}` form (empty string at the oldest league). Seeds the
  // chain walk's first hop. May be absent in some responses.
  renew?: string;
}

/**
 * A renew pointer in Yahoo's `{game_key}_{league_id}` form (e.g. "308_51222").
 * Reconstruct the prior season's league_key as `{game_key}.l.{league_id}`.
 * Returns null when the pointer is empty (chain terminator) or malformed.
 */
function leagueKeyFromRenew(renew: string | undefined | null): string | null {
  if (!renew || typeof renew !== 'string') return null;
  const trimmed = renew.trim();
  if (!trimmed) return null;
  const underscore = trimmed.indexOf('_');
  if (underscore <= 0 || underscore >= trimmed.length - 1) return null;
  const gameKey = trimmed.slice(0, underscore);
  const leagueId = trimmed.slice(underscore + 1);
  if (!gameKey || !leagueId) return null;
  return `${gameKey}.l.${leagueId}`;
}

interface YahooLeagueMeta {
  leagueKey: string;
  renew?: string;
}

/**
 * Fetch a single Yahoo league's meta resource (`/league/{league_key}`) and
 * extract its `league_key` + `renew` pointer. Cached per chain walk so a shared
 * season is not re-fetched. Returns null on a non-OK response or unparseable body
 * (treated as an unresolvable link by the caller).
 */
async function getYahooLeagueMeta(
  leagueKey: string,
  accessToken: string,
  metaCache: Map<string, Promise<YahooLeagueMeta | null>>
): Promise<YahooLeagueMeta | null> {
  const cached = metaCache.get(leagueKey);
  if (cached) return cached;

  // The promise is cached before it settles, so a rejected (non-OK) meta fetch
  // caches a rejected promise. This is intentional: a second reference to the same
  // league_key within the same chain walk re-throws consistently instead of
  // re-fetching, and callers (tryResolveYahooRecurringId) catch it.
  const request = (async (): Promise<YahooLeagueMeta | null> => {
    const url = `${YAHOO_FANTASY_API_URL}/league/${leagueKey}?format=json`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      throw new Error(`Yahoo API ${res.status} while resolving ${leagueKey}`);
    }
    const data = await res.json();
    return parseYahooLeagueMeta(data, leagueKey);
  })();

  metaCache.set(leagueKey, request);
  return request;
}

/**
 * Parse the renew pointer (and confirm the league_key) out of Yahoo's nested
 * single-league meta response. Defensive: `renew` may be absent.
 *
 * Shape: { fantasy_content: { league: [ { league_key, renew, renewed, ... } ] } }
 */
function parseYahooLeagueMeta(data: unknown, fallbackLeagueKey: string): YahooLeagueMeta | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const leagueArray = (data as any)?.fantasy_content?.league;
    if (!Array.isArray(leagueArray) || leagueArray.length < 1) {
      return { leagueKey: fallbackLeagueKey };
    }
    const info = leagueArray[0];
    const leagueKey = typeof info?.league_key === 'string' ? info.league_key : fallbackLeagueKey;
    const renew = typeof info?.renew === 'string' ? info.renew : undefined;
    return { leagueKey, renew };
  } catch {
    return { leagueKey: fallbackLeagueKey };
  }
}

interface YahooRecurringResolutionResult {
  recurringLeagueId?: string;
  failureReason?: string;
}

/**
 * Walk Yahoo's renew chain to the oldest reachable league (the recurring root),
 * mirroring Sleeper's tryResolveRecurringLeagueId. Starting from `leagueKey`:
 * read its `renew` pointer → reconstruct the prior `league_key` → fetch its meta →
 * repeat until `renew` is empty. The root = oldest reachable `league_key`.
 *
 * Includes a fetch cache, a `visited` cycle guard, and a depth cap. When the first
 * league's `renew` is already known (from the bulk discovery response), `seedRenew`
 * skips the initial extra meta fetch.
 */
async function tryResolveYahooRecurringId(
  leagueKey: string,
  accessToken: string,
  cache: Map<string, string | null>,
  metaCache: Map<string, Promise<YahooLeagueMeta | null>>,
  seedRenew?: string
): Promise<YahooRecurringResolutionResult> {
  const path: string[] = [];
  const visited = new Set<string>();
  let currentLeagueKey: string | null = leagueKey;
  let pendingRenew: string | undefined = seedRenew;
  let usedSeed = seedRenew !== undefined;

  while (currentLeagueKey) {
    if (cache.has(currentLeagueKey)) {
      const cached = cache.get(currentLeagueKey) ?? null;
      for (const pathKey of path) cache.set(pathKey, cached);
      return cached
        ? { recurringLeagueId: cached }
        : { failureReason: `unresolved recurring chain at ${currentLeagueKey}` };
    }

    if (visited.has(currentLeagueKey)) {
      for (const pathKey of path) cache.set(pathKey, null);
      return { failureReason: `detected recurring league cycle at ${currentLeagueKey}` };
    }

    if (path.length >= MAX_YAHOO_CHAIN_DEPTH) {
      for (const pathKey of path) cache.set(pathKey, null);
      return { failureReason: `recurring chain exceeded depth cap at ${currentLeagueKey}` };
    }

    visited.add(currentLeagueKey);
    path.push(currentLeagueKey);

    try {
      // Use the seeded renew for the first hop when available; otherwise fetch meta.
      let renew: string | undefined;
      if (usedSeed) {
        renew = pendingRenew;
        usedSeed = false;
      } else {
        const meta = await getYahooLeagueMeta(currentLeagueKey, accessToken, metaCache);
        if (!meta) {
          for (const pathKey of path) cache.set(pathKey, null);
          return { failureReason: `Yahoo returned no meta while resolving ${currentLeagueKey}` };
        }
        renew = meta.renew;
      }

      const priorKey = leagueKeyFromRenew(renew);
      if (!priorKey) {
        // Empty/absent renew → this is the oldest reachable league (the root).
        for (const pathKey of path) cache.set(pathKey, currentLeagueKey);
        return { recurringLeagueId: currentLeagueKey };
      }

      currentLeagueKey = priorKey;
      pendingRenew = undefined;
    } catch {
      // Mid-walk meta fetch failed: use the oldest league we actually reached as
      // the root rather than collapsing to the season-scoped start key. A season
      // that is consistently unreachable (e.g. token can't read deep history) then
      // yields a stable root year-over-year, so an archived league does not
      // resurface on the next re-sync (§8.5 #2). At the first hop currentLeagueKey
      // is still the season-scoped start, so this is never worse than the old
      // fallback. (Cycle/depth-cap below remain hard fallbacks.)
      for (const pathKey of path) cache.set(pathKey, currentLeagueKey);
      return { recurringLeagueId: currentLeagueKey };
    }
  }

  return { failureReason: `unresolved recurring chain at ${leagueKey}` };
}

/**
 * Resolve the Yahoo recurring root for `leagueKey`, falling back to the
 * season-scoped `league_key` when the renew chain can't resolve (mirrors
 * Sleeper's resolveRecurringLeagueId safety net). Never throws.
 */
async function resolveYahooRecurringId(
  leagueKey: string,
  accessToken: string,
  cache: Map<string, string | null>,
  metaCache: Map<string, Promise<YahooLeagueMeta | null>>,
  seedRenew?: string
): Promise<string> {
  const resolution = await tryResolveYahooRecurringId(leagueKey, accessToken, cache, metaCache, seedRenew);
  if (resolution.recurringLeagueId) return resolution.recurringLeagueId;

  console.warn(
    `[yahoo-connect] Falling back to season-scoped league_key ${leagueKey} for recurring grouping: ${resolution.failureReason ?? 'unresolved recurring chain'}`
  );
  return leagueKey;
}

/**
 * Resolve the canonical recurring root for a Yahoo archive write, fresh from the
 * renew chain — never persisting a season-scoped fallback as the archive key when
 * the real root is resolvable. Also returns the group's per-season `league_key`s
 * (for default-clear) and persists the resolved root onto those rows so the
 * read-filter's stored key (`recurring_league_id ?? league_key`) equals the
 * archive key. Mirrors resolveSleeperArchiveTarget.
 *
 * `requestedRecurringId` is the id the UI sent (the displayed recurring id or a
 * season-scoped league_key). Used to locate the group's stored rows; the canonical
 * root is re-resolved from the freshest (most-recent season) row's league_key.
 */
export async function resolveYahooArchiveTarget(
  env: YahooConnectEnv,
  userId: string,
  requestedRecurringId: string
): Promise<{ recurringLeagueId: string; leagueName?: string; seasonLeagueKeys: string[] }> {
  const storage = YahooStorage.fromEnvironment(env);
  const allLeagues = await storage.getYahooLeagues(userId, 'include-all');

  // Rows in this recurring group: stored recurring id matches, or (fallback) the
  // season-scoped league_key equals the requested id.
  const groupRows = allLeagues.filter((l) => {
    const stored = l.recurringLeagueId ?? l.leagueKey;
    return stored === requestedRecurringId || l.leagueKey === requestedRecurringId;
  });

  const seasonLeagueKeys = Array.from(new Set(groupRows.map((l) => l.leagueKey)));

  // Re-resolve the canonical root fresh from the most-recent season's league_key.
  const freshest = groupRows.reduce<YahooLeague | undefined>((best, cur) => {
    if (!best) return cur;
    return cur.seasonYear > best.seasonYear ? cur : best;
  }, undefined);

  let recurringLeagueId = requestedRecurringId;
  if (freshest) {
    // Re-resolution needs the user's access token; resolve it fresh (with refresh).
    const accessToken = await getYahooAccessTokenForResolution(storage, env, userId);
    if (accessToken) {
      const cache = new Map<string, string | null>();
      const metaCache = new Map<string, Promise<YahooLeagueMeta | null>>();
      recurringLeagueId = await resolveYahooRecurringId(freshest.leagueKey, accessToken, cache, metaCache);
    } else {
      // No usable token → fall back to the freshest row's stored id (or league_key).
      recurringLeagueId = freshest.recurringLeagueId ?? freshest.leagueKey;
    }
  }

  // Persist the resolved root onto every row in the group so the read-filter's
  // stored key equals the archive key (tolerates the pre-migration missing column).
  if (seasonLeagueKeys.length > 0) {
    await storage.persistYahooRecurringRoot(userId, seasonLeagueKeys, recurringLeagueId);
  }

  return { recurringLeagueId, leagueName: freshest?.leagueName, seasonLeagueKeys };
}

/**
 * Resolve a usable Yahoo access token for recurring-id resolution, refreshing if
 * needed. Returns null when no credentials exist or the refresh fails — callers
 * fall back to the stored/season-scoped id rather than throwing.
 */
async function getYahooAccessTokenForResolution(
  storage: YahooStorage,
  env: YahooConnectEnv,
  userId: string
): Promise<string | null> {
  const credentials = await storage.getYahooCredentials(userId);
  if (!credentials) return null;
  if (!credentials.needsRefresh) return credentials.accessToken;

  const tokenResult = await getValidYahooAccessToken(storage, userId, env, credentials, undefined, 'clerk');
  if ('error' in tokenResult) {
    console.warn(`[yahoo-connect] Could not refresh token for recurring-id resolution (user ${maskUserId(userId)}): ${tokenResult.error}`);
    return null;
  }
  return tokenResult.accessToken;
}

/**
 * POST /connect/yahoo/discover
 *
 * Discovers all Yahoo Fantasy leagues for the authenticated user.
 * Fetches from Yahoo API, parses the nested response, and saves to storage.
 */
export async function handleYahooDiscover(
  env: YahooConnectEnv,
  userId: string,
  corsHeaders: Record<string, string>,
  correlationId?: string
): Promise<Response> {
  try {
    const storage = YahooStorage.fromEnvironment(env);

    // Get current credentials
    const credentials = await storage.getYahooCredentials(userId);

    if (!credentials) {
      logYahooSetupFailure(env, 'onboarding_failed', {
        stage: 'credential_lookup',
        failure_kind: 'missing_credentials',
        error_code: 'not_connected',
        http_status: 404,
        correlation_id: correlationId,
        auth_type: 'clerk',
      });
      return new Response(
        JSON.stringify({
          error: 'not_connected',
          error_description: 'User is not connected to Yahoo',
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
      );
    }

    // Refresh token if needed
    let accessToken = credentials.accessToken;
    if (credentials.needsRefresh) {
      console.log(`[yahoo-connect] Refreshing token before discovery for user ${maskUserId(userId)}`);
      const tokenResult = await getValidYahooAccessToken(storage, userId, env, credentials, correlationId, 'clerk');
      if ('error' in tokenResult) {
        logYahooSetupFailure(env, 'onboarding_failed', {
          stage: 'credential_refresh',
          failure_kind: tokenResult.retryable ? 'retryable_auth' : 'auth',
          error_code: tokenResult.error,
          http_status: tokenResult.error === YahooAuthWorkerErrorCode.REFRESH_TEMPORARILY_UNAVAILABLE ? 503 : 401,
          upstream_status: tokenResult.upstreamStatus,
          retryable: tokenResult.retryable,
          retry_after: tokenResult.retryAfter,
          retry_after_source: tokenResult.retryAfterSource,
          correlation_id: correlationId,
          auth_type: 'clerk',
        });
        return yahooRefreshFailureResponse(tokenResult, corsHeaders);
      }
      accessToken = tokenResult.accessToken;
    }

    // Call Yahoo API to discover leagues
    // Request leagues with teams subresource to get user's team info
    const apiUrl = `${YAHOO_FANTASY_API_URL}/users;use_login=1/games/leagues;out=teams?format=json`;
    const apiResponse = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!apiResponse.ok) {
      const classification = classifyYahooApiFailure(apiResponse);
      logYahooSetupFailure(env, 'onboarding_failed', {
        stage: 'league_discovery',
        failure_kind: classification.kind,
        error_code: classification.retryable
          ? YahooAuthWorkerErrorCode.YAHOO_API_TEMPORARILY_UNAVAILABLE
          : YahooAuthWorkerErrorCode.YAHOO_API_ERROR,
        http_status: classification.status,
        upstream_status: classification.upstreamStatus,
        retryable: classification.retryable,
        retry_after: classification.retryAfter,
        correlation_id: correlationId,
        auth_type: 'clerk',
      });
      console.error(`[yahoo-connect] Yahoo API error during discovery: ${apiResponse.status}`);
      return yahooApiFailureResponse(
        { status: apiResponse.status, headers: apiResponse.headers },
        corsHeaders
      );
    }

    const rawData = await apiResponse.json();
    const leagues = parseYahooLeaguesResponse(rawData);

    console.log(`[yahoo-connect] Discovered ${leagues.length} leagues for user ${maskUserId(userId)}`);

    // Resolve each league's recurring root (renew-chain walk) and persist it onto
    // the row, tolerating a missing column (pre-migration) exactly like Sleeper.
    // A shared cache de-dupes meta fetches across leagues that share a chain.
    const recurringIdCache = new Map<string, string | null>();
    const metaCache = new Map<string, Promise<YahooLeagueMeta | null>>();

    // Save leagues to storage
    for (const league of leagues) {
      let recurringLeagueId: string | undefined;
      try {
        recurringLeagueId = await resolveYahooRecurringId(
          league.leagueKey,
          accessToken,
          recurringIdCache,
          metaCache,
          league.renew
        );
      } catch (error) {
        // resolveYahooRecurringId never throws, but guard discovery regardless:
        // persist without a recurring id rather than failing the whole sync.
        console.warn(
          `[yahoo-connect] Recurring-id resolution failed for ${league.leagueKey}; saving without it:`,
          error
        );
      }

      await storage.upsertYahooLeague({
        clerkUserId: userId,
        sport: league.sport,
        seasonYear: league.seasonYear,
        leagueKey: league.leagueKey,
        leagueName: league.leagueName,
        teamId: league.teamId,
        teamKey: league.teamKey,
        teamName: league.teamName,
        recurringLeagueId,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        count: leagues.length,
        leagues,
      }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  } catch (error) {
    logYahooSetupFailure(env, 'onboarding_failed', {
      stage: 'league_discovery',
      failure_kind: 'exception',
      error_code: 'server_error',
      http_status: 500,
      correlation_id: correlationId,
      auth_type: 'clerk',
    });
    console.error('[yahoo-connect] Discovery error:', error);
    return new Response(
      JSON.stringify({
        error: 'server_error',
        error_description: 'Failed to discover Yahoo leagues',
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }
}

/**
 * Parse Yahoo's deeply nested JSON response into our league format
 *
 * Yahoo's response structure is:
 * {
 *   fantasy_content: {
 *     users: {
 *       0: {
 *         user: [
 *           { guid: "..." },
 *           {
 *             games: {
 *               0: { game: [{ game_key: "nfl", season: "2024", ... }, { leagues: { 0: { league: [...] }, count: 1 } }] },
 *               count: 1
 *             }
 *           }
 *         ]
 *       },
 *       count: 1
 *     }
 *   }
 * }
 */
function parseYahooLeaguesResponse(data: unknown): DiscoveredYahooLeague[] {
  const leagues: DiscoveredYahooLeague[] = [];

  try {
    // Navigate through Yahoo's nested structure
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fantasyContent = (data as any)?.fantasy_content;
    if (!fantasyContent) return leagues;

    const users = fantasyContent.users;
    if (!users) return leagues;

    // Users is an object with numeric keys and a count
    const userCount = users.count || 0;
    for (let userIdx = 0; userIdx < userCount; userIdx++) {
      const userWrapper = users[userIdx];
      if (!userWrapper?.user) continue;

      // user is an array where [0] is user info, [1] has games
      const userArray = userWrapper.user;
      if (!Array.isArray(userArray) || userArray.length < 2) continue;

      const gamesWrapper = userArray[1]?.games;
      if (!gamesWrapper) continue;

      const gameCount = gamesWrapper.count || 0;
      for (let gameIdx = 0; gameIdx < gameCount; gameIdx++) {
        const gameWrapper = gamesWrapper[gameIdx];
        if (!gameWrapper?.game) continue;

        // game is an array where [0] is game info, [1] has leagues
        const gameArray = gameWrapper.game;
        if (!Array.isArray(gameArray) || gameArray.length < 2) continue;

        const gameInfo = gameArray[0];
        const leaguesWrapper = gameArray[1]?.leagues;
        if (!leaguesWrapper) continue;

        // Extract game info
        const gameCode = gameInfo?.code?.toLowerCase();
        const season = parseInt(gameInfo?.season, 10);
        const sport = SPORT_CODE_MAP[gameCode];

        if (!sport || isNaN(season)) continue;

        // Parse leagues for this game
        const leagueCount = leaguesWrapper.count || 0;
        for (let leagueIdx = 0; leagueIdx < leagueCount; leagueIdx++) {
          const leagueWrapper = leaguesWrapper[leagueIdx];
          if (!leagueWrapper?.league) continue;

          // league is an array where [0] is league info
          const leagueArray = leagueWrapper.league;
          if (!Array.isArray(leagueArray) || leagueArray.length < 1) continue;

          const leagueInfo = leagueArray[0];
          const leagueKey = leagueInfo?.league_key;
          const leagueName = leagueInfo?.name;

          if (!leagueKey || !leagueName) continue;

          // Capture Yahoo's prior-season renew pointer when present in the bulk
          // response. `renew` lets the chain walk skip the first per-league meta
          // fetch; it's defensive (absent in some payloads).
          const renew = typeof leagueInfo?.renew === 'string' ? leagueInfo.renew : undefined;

          // Extract team ID and team name from the league data
          // Yahoo API includes the user's team in the league response
          let teamId = '';
          let teamKey = '';
          let teamName = '';

          // Check if there's team info in the league data (some responses include it)
          if (leagueArray.length > 1 && leagueArray[1]?.teams) {
            const teamsWrapper = leagueArray[1].teams;
            const teamCount = teamsWrapper.count || 0;
            for (let teamIdx = 0; teamIdx < teamCount; teamIdx++) {
              const teamWrapper = teamsWrapper[teamIdx];
              if (teamWrapper?.team) {
                const teamArray = teamWrapper.team;
                if (Array.isArray(teamArray) && teamArray.length > 0) {
                  // team[0] contains multiple objects with team_id, name, etc.
                  for (const item of teamArray[0]) {
                    if (item?.team_key) {
                      teamKey = String(item.team_key);
                    }
                    if (item?.team_id) {
                      teamId = String(item.team_id);
                    }
                    if (item?.name) {
                      teamName = String(item.name);
                    }
                  }
                }
              }
              if (teamId) break; // Found user's team
            }
          }

          // Yahoo's canonical team key is the league key plus ".t.{team_id}".
          const resolvedTeamKey = teamKey || (teamId ? `${leagueKey}.t.${teamId}` : '');

          leagues.push({
            sport,
            seasonYear: season,
            leagueKey,
            leagueName,
            teamId,
            teamKey: resolvedTeamKey,
            teamName,
            renew,
          });
        }
      }
    }
  } catch (parseError) {
    console.error('[yahoo-connect] Error parsing Yahoo response:', parseError);
  }

  return leagues;
}
