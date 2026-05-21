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

import { YahooStorage, type YahooCredentialHealth, type YahooCredentials } from './yahoo-storage';
import { getFrontendUrl, resolvePreviewOrigin } from './preview-url';
import {
  YAHOO_DEFAULT_TRANSIENT_RETRY_AFTER_SECONDS,
  YAHOO_REFRESH_IN_PROGRESS_RETRY_AFTER_SECONDS,
  classifyYahooApiFailure,
  defaultYahooRetryAfterSeconds,
  isYahooRateLimitStatus,
  isYahooTransientHttpStatus,
  parseRetryAfterSeconds,
  YahooAuthWorkerErrorCode,
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
  retry_after?: number;
  retry_after_source?: YahooRetryAfterSource;
}

type YahooCredentialRefreshState = 'none' | 'in_progress' | 'cooldown' | 'expired';
type YahooTokenGrantType = 'authorization_code' | 'refresh_token';
type YahooRetryAfterSource = 'upstream_header' | 'fallback_default';
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
  | 'credential_update'
  | 'waiter';
type YahooRefreshDiagnosticOutcome =
  | 'attempt_started'
  | 'success'
  | 'retry_scheduled'
  | 'retryable_failure'
  | 'permanent_failure'
  | 'rate_limited'
  | 'timeout'
  | 'fetch_error'
  | 'cooldown_active'
  | 'cooldown_bypassed'
  | 'lease_budget_exhausted';
type YahooRefreshDiagnosticClass =
  | 'yahoo_rate_limit'
  | 'yahoo_transient_http'
  | 'yahoo_transient_text'
  | 'yahoo_permanent'
  | 'yahoo_unexpected_response'
  | 'fetch_error'
  | 'timeout'
  | 'cooldown_active'
  | 'lease_wait_timeout'
  | 'lease_budget_exhausted';

interface YahooRefreshDiagnosticFields {
  correlationId?: string;
  userId?: string;
  attempt?: number;
  phase?: YahooRefreshDiagnosticPhase;
  outcome?: YahooRefreshDiagnosticOutcome;
  diagnosticClass?: YahooRefreshDiagnosticClass;
  reason?: string;
  refreshState?: YahooCredentialRefreshState;
  accessTokenExpiresInSeconds?: number;
  accessTokenLifetimeSeconds?: number;
  leaseRemainingSeconds?: number;
  leaseBudgetRemainingMs?: number;
  requestTimeoutMs?: number;
  retryAfter?: number;
  retryAfterSource?: YahooRetryAfterSource;
  upstreamStatus?: number;
  tokenError?: string;
  failureKind?: YahooTokenFailureDiagnosticKind;
  bodyClass?: YahooTokenBodyClass;
  upstreamErrorText?: string;
  // True only when Yahoo sent a parseable Retry-After header. Fallback/default
  // retry hints are identified separately with retryAfterSource. Kept as the
  // original field name for existing log queries; prefer hasUpstreamRetryAfter.
  hasRetryAfter?: boolean;
  hasUpstreamRetryAfter?: boolean;
  hasUpstreamErrorText?: boolean;
  retryDelayMs?: number;
  retryAttempt?: number;
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
// Must stay below the ~25s MCP gateway timeout budget so waiters return a
// retryable 503 before the gateway drops the request.
const MAX_LEASE_WAIT_MS = 10_000;
const POLL_INTERVAL_MS   =    300;
const MAX_REFRESH_ATTEMPTS = 3;
const REFRESH_COOLDOWN_OWNER_PREFIX = 'cooldown:';
const YAHOO_OWNER_MAX_RETRIES = 1;
const YAHOO_OWNER_RETRY_DELAY_MS = 250;
const YAHOO_OWNER_RETRY_LEASE_SAFETY_MS = 1_000;

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
  if (fields.attempt !== undefined) payload.attempt = fields.attempt;
  if (fields.phase !== undefined) payload.phase = fields.phase;
  if (fields.outcome !== undefined) payload.outcome = fields.outcome;
  if (fields.diagnosticClass !== undefined) payload.diagnostic_class = fields.diagnosticClass;
  if (fields.reason !== undefined) payload.reason = fields.reason;
  if (fields.refreshState !== undefined) payload.refresh_state = fields.refreshState;
  if (fields.accessTokenExpiresInSeconds !== undefined) payload.access_token_expires_in_seconds = fields.accessTokenExpiresInSeconds;
  if (fields.accessTokenLifetimeSeconds !== undefined) payload.access_token_lifetime_seconds = fields.accessTokenLifetimeSeconds;
  if (fields.leaseRemainingSeconds !== undefined) payload.lease_remaining_seconds = fields.leaseRemainingSeconds;
  if (fields.leaseBudgetRemainingMs !== undefined) payload.lease_budget_remaining_ms = fields.leaseBudgetRemainingMs;
  if (fields.requestTimeoutMs !== undefined) payload.request_timeout_ms = fields.requestTimeoutMs;
  if (fields.retryAfter !== undefined) payload.retry_after = fields.retryAfter;
  if (fields.retryAfterSource !== undefined) payload.retry_after_source = fields.retryAfterSource;
  if (fields.upstreamStatus !== undefined) payload.upstream_status = fields.upstreamStatus;
  if (fields.tokenError !== undefined) payload.token_error = fields.tokenError;
  if (fields.failureKind !== undefined) payload.failure_kind = fields.failureKind;
  if (fields.bodyClass !== undefined) payload.body_class = fields.bodyClass;
  if (fields.upstreamErrorText !== undefined) payload.upstream_error_text = fields.upstreamErrorText;
  if (fields.hasRetryAfter !== undefined) payload.has_retry_after = fields.hasRetryAfter;
  if (fields.hasUpstreamRetryAfter !== undefined) payload.has_upstream_retry_after = fields.hasUpstreamRetryAfter;
  if (fields.hasUpstreamErrorText !== undefined) payload.has_upstream_error_text = fields.hasUpstreamErrorText;
  if (fields.retryDelayMs !== undefined) payload.retry_delay_ms = fields.retryDelayMs;
  if (fields.retryAttempt !== undefined) payload.retry_attempt = fields.retryAttempt;
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

  console.log(JSON.stringify(payload));
}

function looksLikeNewerCredentials(
  original: { accessToken: string; refreshToken: string; updatedAt?: Date },
  latest: { accessToken: string; refreshToken: string; updatedAt?: Date }
): boolean {
  if (latest.accessToken !== original.accessToken || latest.refreshToken !== original.refreshToken) {
    return true;
  }

  if (latest.updatedAt && original.updatedAt) {
    return latest.updatedAt.getTime() > original.updatedAt.getTime();
  }

  return false;
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

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

// Empty token error bodies carry no useful diagnostic detail for logs or callers.
function trimYahooTokenBody(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}...` : trimmed;
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
  const nonJsonDescription = data ? undefined : trimYahooTokenBody(text);
  const bodyClassForErrorPaths: YahooTokenBodyClass = data
    ? 'json_error'
    : text.trim().length === 0
      ? 'empty'
      : 'plain_text';
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
      error_description: typeof data?.error_description === 'string'
        ? data.error_description
        : fallbackErrorDescription,
      upstream_error_text: nonJsonDescription,
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
      status: response.status,
      retry_after: retryAfter,
      retry_after_source: retryAfterSource,
      upstream_body_class: 'invalid_success_shape',
    };
  }

  return {
    ...toYahooTokenResponse(data),
    upstream_body_class: 'usable_success',
  };
}

// =============================================================================
// TOKEN ACQUISITION
// =============================================================================

type GetTokenResult =
  | { accessToken: string; expiresIn: number }
  | { error: string; errorDescription?: string; retryable?: boolean; retryAfter?: number; retryAfterSource?: YahooRetryAfterSource; upstreamStatus?: number };

type RetryTokenResult =
  | GetTokenResult
  | { retry: true; credentials: YahooCredentials };

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

async function clearLegacyYahooRefreshCooldown(
  storage: YahooStorage,
  credentials: YahooCredentials,
  correlationId?: string
): Promise<YahooCredentials> {
  if (!credentials.refreshLeaseOwner?.startsWith(REFRESH_COOLDOWN_OWNER_PREFIX)) {
    return credentials;
  }

  logYahooRefreshDiagnostic('cooldown_bypassed', {
    correlationId,
    userId: credentials.clerkUserId,
    phase: 'cooldown',
    outcome: 'cooldown_bypassed',
    diagnosticClass: 'cooldown_active',
    reason: 'legacy_cooldown_cleared',
    leaseRemainingSeconds: retryAfterFromLease(credentials),
    refreshState: yahooRefreshState(credentials),
  });

  try {
    await storage.releaseRefreshLease(credentials.clerkUserId, credentials.refreshLeaseOwner);
  } catch (releaseError) {
    console.warn('[yahoo-connect] Failed to release legacy Yahoo refresh cooldown:', releaseError);
    logYahooRefreshDiagnostic('cooldown_bypass_release_failed', {
      correlationId,
      userId: credentials.clerkUserId,
      phase: 'cooldown',
      outcome: 'cooldown_bypassed',
      diagnosticClass: 'cooldown_active',
      reason: 'release_failed',
    });
  }
  return {
    ...credentials,
    refreshLeaseOwner: undefined,
    refreshLeaseExpiresAt: undefined,
  };
}

function retryAfterFromLease(credentials: { refreshLeaseExpiresAt?: Date } | null): number | undefined {
  return boundedPositiveSecondsUntil(credentials?.refreshLeaseExpiresAt);
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

function yahooRefreshTokenBody(refreshToken: string, env: YahooConnectEnv): URLSearchParams {
  return new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function shouldOwnerRetryYahooTokenResult(
  result: Pick<YahooTokenResponse, 'status' | 'error' | 'error_description' | 'upstream_error_text' | 'retry_after_source'>,
  failureKind: YahooTokenFailureDiagnosticKind
): boolean {
  const status = result.status;
  if (isYahooRateLimitStatus(status)) {
    return false;
  }
  if (result.retry_after_source === 'upstream_header') {
    return false;
  }

  // This intentionally mirrors the current Yahoo transient-status classifier:
  // non-rate-limit transient HTTP failures are server-side 5xx responses.
  // Transient text is limited to nonstandard token responses where Yahoo sent
  // explicit backoff; respect that header instead of immediately retrying.
  return failureKind === 'transient_text'
    || (failureKind === 'transient_http' && typeof status === 'number' && status >= 500);
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

function ownerRetryBudgetRemainingMs(leaseDeadlineMs: number, delayMs = 0): number {
  return Math.max(
    0,
    leaseDeadlineMs - Date.now() - delayMs - YAHOO_OWNER_RETRY_LEASE_SAFETY_MS
  );
}

function ownerRetryTimeoutBudgetMs(leaseDeadlineMs: number, delayMs = 0): number {
  return Math.min(
    YAHOO_TOKEN_REQUEST_TIMEOUT_MS,
    ownerRetryBudgetRemainingMs(leaseDeadlineMs, delayMs)
  );
}

function canScheduleOwnerRetry(leaseDeadlineMs: number): boolean {
  return ownerRetryTimeoutBudgetMs(leaseDeadlineMs, YAHOO_OWNER_RETRY_DELAY_MS) > 0;
}

function hasOwnerRequestBudget(leaseDeadlineMs: number): boolean {
  return ownerRetryTimeoutBudgetMs(leaseDeadlineMs) > 0;
}

async function releaseYahooRefreshLeaseAfterFailure(
  storage: YahooStorage,
  userId: string,
  ownerId: string,
  correlationId: string | undefined,
  outcome: YahooRefreshDiagnosticOutcome
): Promise<void> {
  try {
    await storage.releaseRefreshLease(userId, ownerId);
    logYahooRefreshDiagnostic('refresh_failure_lease_released', {
      correlationId,
      userId,
      phase: 'lease',
      outcome,
    });
  } catch (releaseError) {
    console.warn('[yahoo-connect] Failed to release Yahoo refresh lease after refresh failure:', releaseError);
    logYahooRefreshDiagnostic('refresh_failure_lease_release_failed', {
      correlationId,
      userId,
      phase: 'lease',
      outcome,
      reason: 'release_failed',
    });
  }
}

async function waitForFreshCredentialsOrLeaseClear(
  storage: YahooStorage,
  userId: string,
  credentials: YahooCredentials,
  correlationId?: string
): Promise<RetryTokenResult> {
  let latest: YahooCredentials | null = credentials;
  const deadline = Date.now() + MAX_LEASE_WAIT_MS;

  while (latest && !leaseExpired(latest)) {
    if (isRefreshCooldown(latest)) {
      latest = await clearLegacyYahooRefreshCooldown(storage, latest, correlationId);
      return { retry: true, credentials: latest };
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      logYahooRefreshDiagnostic('lease_wait_timeout', {
        correlationId,
        userId,
        phase: 'waiter',
        outcome: 'retryable_failure',
        diagnosticClass: 'lease_wait_timeout',
        retryAfter: YAHOO_REFRESH_IN_PROGRESS_RETRY_AFTER_SECONDS,
        refreshState: yahooRefreshState(latest),
        leaseRemainingSeconds: boundedPositiveSecondsUntil(latest.refreshLeaseExpiresAt),
      });
      return {
        error: YahooAuthWorkerErrorCode.REFRESH_TEMPORARILY_UNAVAILABLE,
        errorDescription: 'Yahoo token refresh is already in progress. Please try again shortly.',
        retryable: true,
        retryAfter: YAHOO_REFRESH_IN_PROGRESS_RETRY_AFTER_SECONDS,
        retryAfterSource: 'fallback_default',
      };
    }

    const waitMs = Math.min(POLL_INTERVAL_MS + Math.floor(Math.random() * 100), remainingMs);
    await sleep(waitMs);
    latest = await storage.getYahooCredentials(userId);

    if (!latest) {
      logYahooRefreshDiagnostic('credentials_missing_while_waiting', { correlationId, userId });
      return { error: 'not_connected' };
    }
    if (!latest.needsRefresh) {
      logYahooRefreshDiagnostic('lease_wait_finished_with_fresh_token', {
        correlationId,
        userId,
        accessTokenExpiresInSeconds: secondsUntil(latest.expiresAt),
      });
      return toTokenResult(latest);
    }
    if (leaseExpired(latest)) {
      logYahooRefreshDiagnostic('lease_expired_retrying_refresh', {
        correlationId,
        userId,
        refreshState: yahooRefreshState(latest),
      });
      return { retry: true, credentials: latest };
    }
  }

  if (!latest) {
    logYahooRefreshDiagnostic('credentials_missing_after_wait', { correlationId, userId });
    return { error: 'not_connected' };
  }
  if (!latest.needsRefresh) {
    logYahooRefreshDiagnostic('lease_wait_finished_with_fresh_token', {
      correlationId,
      userId,
      accessTokenExpiresInSeconds: secondsUntil(latest.expiresAt),
    });
    return toTokenResult(latest);
  }
  logYahooRefreshDiagnostic('lease_expired_retrying_refresh', {
    correlationId,
    userId,
    refreshState: yahooRefreshState(latest),
  });
  return { retry: true, credentials: latest };
}

/**
 * Get a valid Yahoo access token for the given user, refreshing if needed.
 *
 * Uses a DB lease to ensure only one Worker calls Yahoo's token endpoint at a
 * time for a given user. Other concurrent callers wait and pick up the freshly
 * written token when the winner finishes.
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

  for (let attempt = 0; attempt < MAX_REFRESH_ATTEMPTS; attempt++) {
    if (!credentials.needsRefresh) {
      logDiagnostic('token_fresh_returned', {
        userId,
        attempt,
        accessTokenExpiresInSeconds: secondsUntil(credentials.expiresAt),
        refreshState: yahooRefreshState(credentials),
      });
      return toTokenResult(credentials);
    }
    if (isRefreshCooldown(credentials)) {
      credentials = await clearLegacyYahooRefreshCooldown(storage, credentials, correlationId);
    }

    const ownerId = crypto.randomUUID();
    logDiagnostic('lease_acquire_attempt', {
      userId,
      attempt,
      accessTokenExpiresInSeconds: secondsUntil(credentials.expiresAt),
      refreshState: yahooRefreshState(credentials),
    });
    // Include lease acquisition time in the owner budget so slow storage never
    // leaves the refresh request racing the actual DB lease expiry.
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
        attempt,
        refreshState: yahooRefreshState(credentials),
        leaseRemainingSeconds: boundedPositiveSecondsUntil(credentials.refreshLeaseExpiresAt),
      });
      const latest = await storage.getYahooCredentials(userId);
      if (!latest) {
        logDiagnostic('credentials_missing_after_lease_loss', { userId, attempt });
        return { error: 'not_connected' };
      }
      if (!latest.needsRefresh) {
        logDiagnostic('lease_loss_found_fresh_token', {
          userId,
          attempt,
          accessTokenExpiresInSeconds: secondsUntil(latest.expiresAt),
        });
        return toTokenResult(latest);
      }
      if (isRefreshCooldown(latest)) {
        credentials = await clearLegacyYahooRefreshCooldown(storage, latest, correlationId);
        logDiagnostic('cooldown_cleared_retrying', {
          userId,
          attempt,
          phase: 'cooldown',
          outcome: 'cooldown_bypassed',
          diagnosticClass: 'cooldown_active',
          refreshState: 'cooldown',
        });
        continue;
      }
      if (leaseExpired(latest)) {
        logDiagnostic('lease_loss_found_expired_lease_retrying', {
          userId,
          attempt,
          refreshState: yahooRefreshState(latest),
        });
        credentials = latest;
        continue;
      }

      const loserResult = await waitForFreshCredentialsOrLeaseClear(
        storage,
        userId,
        latest,
        correlationId
      );

      if ('retry' in loserResult) {
        credentials = loserResult.credentials;
        continue;
      }
      return loserResult;
    }

    logDiagnostic('lease_acquired', {
      userId,
      attempt,
      accessTokenExpiresInSeconds: secondsUntil(credentials.expiresAt),
    });
    const leaseDeadlineMs = leaseAttemptStartedAt + LEASE_TTL_MS;
    let result: YahooTokenDiagnosticResponse | undefined;
    let retryAttempt = 0;

    while (true) {
      if (!hasOwnerRequestBudget(leaseDeadlineMs)) {
        logDiagnostic('refresh_request_exception', {
          userId,
          attempt,
          retryAttempt,
          phase: 'refresh_request',
          outcome: 'lease_budget_exhausted',
          diagnosticClass: 'lease_budget_exhausted',
          reason: 'lease_budget_exhausted',
          retryAfter: YAHOO_REFRESH_IN_PROGRESS_RETRY_AFTER_SECONDS,
          retryAfterSource: 'fallback_default',
          leaseBudgetRemainingMs: ownerRetryBudgetRemainingMs(leaseDeadlineMs),
        });
        await releaseYahooRefreshLeaseAfterFailure(
          storage,
          userId,
          ownerId,
          correlationId,
          'lease_budget_exhausted'
        );
        return {
          error: YahooAuthWorkerErrorCode.REFRESH_TEMPORARILY_UNAVAILABLE,
          errorDescription: 'Yahoo token refresh lease budget was exhausted before a request could be sent. Please try again shortly.',
          retryable: true,
          // This is local lease contention, not Yahoo backoff; ask callers to retry shortly.
          retryAfter: YAHOO_REFRESH_IN_PROGRESS_RETRY_AFTER_SECONDS,
          retryAfterSource: 'fallback_default',
        };
      }
      const requestBody = yahooRefreshTokenBody(credentials.refreshToken, env);
      const requestDiagnosticFields = yahooTokenRequestDiagnosticFields(env, 'refresh_token', requestBody);
      if (!hasYahooClientCredentials(env)) {
        logDiagnostic('refresh_config_missing', {
          userId,
          attempt,
          retryAttempt,
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
      const requestTimeoutMs = ownerRetryTimeoutBudgetMs(leaseDeadlineMs);
      const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        logDiagnostic('refresh_request_started', {
          userId,
          attempt,
          retryAttempt,
          phase: 'refresh_request',
          outcome: 'attempt_started',
          requestTimeoutMs,
          leaseBudgetRemainingMs: ownerRetryBudgetRemainingMs(leaseDeadlineMs),
          ...requestDiagnosticFields,
        });
        result = await refreshAccessToken(requestBody, env, controller.signal);
      } catch (error) {
        clearTimeout(timer);
        const isAbort = isAbortError(error);
        if (!isAbort && retryAttempt < YAHOO_OWNER_MAX_RETRIES && canScheduleOwnerRetry(leaseDeadlineMs)) {
          const nextRetryAttempt = retryAttempt + 1;
          logDiagnostic('refresh_owner_retry_scheduled', {
            userId,
            attempt,
            phase: 'refresh_request',
            outcome: 'retry_scheduled',
            diagnosticClass: 'fetch_error',
            reason: 'fetch_error',
            retryAttempt: nextRetryAttempt,
            retryDelayMs: YAHOO_OWNER_RETRY_DELAY_MS,
            leaseBudgetRemainingMs: ownerRetryBudgetRemainingMs(leaseDeadlineMs, YAHOO_OWNER_RETRY_DELAY_MS),
          });
          retryAttempt = nextRetryAttempt;
          await sleep(YAHOO_OWNER_RETRY_DELAY_MS);
          continue;
        }

        logDiagnostic('refresh_request_exception', {
          userId,
          attempt,
          retryAttempt,
          phase: 'refresh_request',
          outcome: isAbort ? 'timeout' : 'fetch_error',
          diagnosticClass: isAbort ? 'timeout' : 'fetch_error',
          reason: isAbort ? 'abort' : 'fetch_error',
          requestTimeoutMs,
          leaseBudgetRemainingMs: ownerRetryBudgetRemainingMs(leaseDeadlineMs),
        });
        console.error(
          `[yahoo-connect] Yahoo token refresh request failed for user ${maskUserId(userId)}:`,
          error instanceof Error ? error.message : error
        );
        await releaseYahooRefreshLeaseAfterFailure(
          storage,
          userId,
          ownerId,
          correlationId,
          isAbort ? 'timeout' : 'fetch_error'
        );
        return {
          error: YahooAuthWorkerErrorCode.REFRESH_TEMPORARILY_UNAVAILABLE,
          errorDescription: isAbort
            ? 'Yahoo token refresh timed out. Please try again shortly.'
            : 'Yahoo token refresh request failed. Please try again shortly.',
          retryable: true,
          retryAfter: YAHOO_DEFAULT_TRANSIENT_RETRY_AFTER_SECONDS,
          retryAfterSource: 'fallback_default',
        };
      }
      clearTimeout(timer);

      if (!result.error) {
        break;
      }

      const failureKind = classifyYahooTokenFailure(result);
      const diagnosticClass = yahooTokenFailureDiagnosticClass(result, failureKind);
      const diagnosticOutcome = yahooTokenFailureOutcome(result, failureKind);
      const statusSuffix = result.status ? ` (HTTP ${result.status})` : '';
      logDiagnostic('refresh_response_error', {
        userId,
        attempt,
        retryAttempt,
        phase: 'refresh_response',
        outcome: diagnosticOutcome,
        diagnosticClass,
        upstreamStatus: result.status,
        tokenError: result.error,
        failureKind,
        bodyClass: result.upstream_body_class,
        upstreamErrorText: result.upstream_error_text,
        hasRetryAfter: result.retry_after_source === 'upstream_header',
        hasUpstreamRetryAfter: result.retry_after_source === 'upstream_header',
        retryAfterSource: result.retry_after_source,
        hasUpstreamErrorText: Boolean(result.upstream_error_text),
        ...requestDiagnosticFields,
      });
      console.error(
        `[yahoo-connect] Yahoo token refresh failed for user ${maskUserId(userId)}: ${result.error}${statusSuffix}` +
          (result.error_description ? ` - ${result.error_description}` : '')
      );
      const latest = await storage.getYahooCredentials(userId);
      if (latest && !latest.needsRefresh && looksLikeNewerCredentials(credentials, latest)) {
        logDiagnostic('concurrent_refresh_used', {
          userId,
          attempt,
          accessTokenExpiresInSeconds: secondsUntil(latest.expiresAt),
        });
        console.log(`[yahoo-connect] Using concurrently refreshed token for user ${maskUserId(userId)}`);
        try {
          await storage.releaseRefreshLease(userId, ownerId);
        } catch (releaseError) {
          console.warn('[yahoo-connect] Failed to release Yahoo refresh lease after concurrent refresh:', releaseError);
        }
        return toTokenResult(latest);
      }
      if (failureKind === 'transient_http' || failureKind === 'transient_text') {
        if (
          retryAttempt < YAHOO_OWNER_MAX_RETRIES
          && shouldOwnerRetryYahooTokenResult(result, failureKind)
          && canScheduleOwnerRetry(leaseDeadlineMs)
        ) {
          const nextRetryAttempt = retryAttempt + 1;
          logDiagnostic('refresh_owner_retry_scheduled', {
            userId,
            attempt,
            phase: 'refresh_response',
            outcome: 'retry_scheduled',
            diagnosticClass,
            retryAttempt: nextRetryAttempt,
            retryDelayMs: YAHOO_OWNER_RETRY_DELAY_MS,
            leaseBudgetRemainingMs: ownerRetryBudgetRemainingMs(leaseDeadlineMs, YAHOO_OWNER_RETRY_DELAY_MS),
            upstreamStatus: result.status,
            tokenError: result.error,
            failureKind,
          });
          retryAttempt = nextRetryAttempt;
          await sleep(YAHOO_OWNER_RETRY_DELAY_MS);
          continue;
        }

        const retryAfter = result.retry_after
          ?? defaultYahooRetryAfterSeconds(result.status)
          ?? YAHOO_DEFAULT_TRANSIENT_RETRY_AFTER_SECONDS;
        const retryAfterSource = result.retry_after_source ?? 'fallback_default';
        logDiagnostic('refresh_transient_failure', {
          userId,
          attempt,
          retryAttempt,
          phase: 'refresh_response',
          outcome: diagnosticOutcome,
          diagnosticClass,
          retryAfter,
          retryAfterSource,
          upstreamStatus: result.status,
          tokenError: result.error,
          failureKind,
          bodyClass: result.upstream_body_class,
          upstreamErrorText: result.upstream_error_text,
          hasUpstreamRetryAfter: result.retry_after_source === 'upstream_header',
        });
        await releaseYahooRefreshLeaseAfterFailure(
          storage,
          userId,
          ownerId,
          correlationId,
          diagnosticOutcome
        );
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
        attempt,
        retryAttempt,
        phase: 'refresh_response',
        outcome: diagnosticOutcome,
        diagnosticClass,
        upstreamStatus: result.status,
        tokenError: result.error,
        failureKind,
        bodyClass: result.upstream_body_class,
        upstreamErrorText: result.upstream_error_text,
      });
      return {
        error: 'refresh_failed',
        errorDescription: result.error_description || 'Failed to refresh access token',
        upstreamStatus: result.status,
      };
    }

    // The loop only breaks after a defined non-error result; this guard keeps
    // TypeScript and future refactors honest without changing runtime behavior.
    if (!result) {
      logDiagnostic('refresh_invalid_response', { userId, attempt, retryAttempt });
      throw new Error('Invariant violation: Yahoo refresh result missing after success loop');
    }

    if (!hasUsableTokenFields(result)) {
      logDiagnostic('refresh_invalid_response', {
        userId,
        attempt,
        retryAttempt,
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
    const refreshTokenReturned = Boolean(result.refresh_token);
    const refreshTokenChanged = Boolean(result.refresh_token && result.refresh_token !== credentials.refreshToken);
    const refreshedCredentials = { accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt };
    const wrote = await storage.updateYahooCredentials(
      userId,
      refreshedCredentials,
      ownerId
    );

    if (wrote) {
      logDiagnostic('credential_update_succeeded', {
        userId,
        attempt,
        phase: 'credential_update',
        outcome: 'success',
        accessTokenLifetimeSeconds: result.expires_in,
        refreshTokenReturned,
        refreshTokenChanged,
      });
      console.log(`[yahoo-connect] Token refreshed for user ${maskUserId(userId)}`);
      return { accessToken: result.access_token, expiresIn: result.expires_in };
    }

    logDiagnostic('credential_update_owner_guard_miss', {
      userId,
      attempt,
      phase: 'credential_update',
      outcome: 'retryable_failure',
      refreshTokenReturned,
      refreshTokenChanged,
    });
    const recoveredWrite = await storage.updateYahooCredentialsIfRefreshTokenMatches(
      userId,
      refreshedCredentials,
      credentials.refreshToken
    );
    if (recoveredWrite) {
      logDiagnostic('credential_update_recovered_after_owner_guard_miss', {
        userId,
        attempt,
        phase: 'credential_update',
        outcome: 'success',
        accessTokenLifetimeSeconds: result.expires_in,
        refreshTokenReturned,
        refreshTokenChanged,
        recoveryAttempted: true,
        recoverySucceeded: true,
      });
      console.log(`[yahoo-connect] Token refresh write recovered for user ${maskUserId(userId)}`);
      return { accessToken: result.access_token, expiresIn: result.expires_in };
    }

    logDiagnostic('credential_update_recovery_miss', {
      userId,
      attempt,
      phase: 'credential_update',
      outcome: 'retryable_failure',
      refreshTokenReturned,
      refreshTokenChanged,
      recoveryAttempted: true,
      recoverySucceeded: false,
    });
    const latest = await storage.getYahooCredentials(userId);
    if (!latest) {
      logDiagnostic('credentials_missing_after_recovery_miss', { userId, attempt });
      return { error: 'not_connected' };
    }
    if (!latest.needsRefresh) {
      logDiagnostic('owner_guard_miss_found_fresh_token', {
        userId,
        attempt,
        accessTokenExpiresInSeconds: secondsUntil(latest.expiresAt),
      });
      return toTokenResult(latest);
    }
    credentials = latest;
  }

  const latest = await storage.getYahooCredentials(userId);
  if (latest && !latest.needsRefresh) {
    logDiagnostic('max_attempts_found_fresh_token', {
      userId,
      accessTokenExpiresInSeconds: secondsUntil(latest.expiresAt),
    });
    return toTokenResult(latest);
  }
  logDiagnostic('max_refresh_attempts_exhausted', { userId });
  return { error: 'refresh_failed' };
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

  return new Response(
    JSON.stringify({
      error: 'refresh_failed',
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
    console.log('[yahoo-connect] Callback missing code parameter');
    return errorRedirect('missing_code', 'Authorization code not provided');
  }

  if (!state) {
    console.log('[yahoo-connect] Callback missing state parameter');
    return errorRedirect('missing_state', 'State parameter not provided');
  }

  try {
    const storage = YahooStorage.fromEnvironment(env);

    // Validate and consume state (single-use)
    const stateData = await storage.consumePlatformOAuthState(state);
    if (!stateData) {
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
    let tokenResponse: YahooTokenResponse;
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
      logYahooRefreshDiagnostic('token_exchange_response_error', {
        userId: clerkUserId,
        authType: 'clerk',
        phase: 'token_exchange',
        outcome: yahooTokenFailureOutcome(tokenResponse, failureKind),
        diagnosticClass: yahooTokenFailureDiagnosticClass(tokenResponse, failureKind),
        upstreamStatus: tokenResponse.status,
        tokenError: tokenResponse.error,
        failureKind,
        bodyClass: (tokenResponse as YahooTokenDiagnosticResponse).upstream_body_class,
        hasRetryAfter: tokenResponse.retry_after_source === 'upstream_header',
        hasUpstreamRetryAfter: tokenResponse.retry_after_source === 'upstream_header',
        retryAfterSource: tokenResponse.retry_after_source,
        hasUpstreamErrorText: Boolean(tokenResponse.upstream_error_text),
        ...requestDiagnosticFields,
      });
      console.error(`[yahoo-connect] Token exchange failed: ${tokenResponse.error}`);
      const isTransient = isTransientYahooTokenFailure(tokenResponse);
      return errorRedirect(
        isTransient ? YahooAuthWorkerErrorCode.TOKEN_EXCHANGE_UNAVAILABLE : 'token_exchange_failed',
        isTransient
          ? 'Yahoo token exchange is temporarily unavailable. Please try again.'
          : tokenResponse.error_description || 'Failed to exchange code for tokens'
      );
    }

    if (!hasUsableTokenFields(tokenResponse)) {
      console.error('[yahoo-connect] Token exchange returned unusable token fields');
      return errorRedirect('token_exchange_failed', 'Yahoo did not return usable token fields');
    }

    // hasUsableTokenFields validates the access-token shape; reconnect must
    // also return a refresh token for future lazy refreshes.
    if (!tokenResponse.refresh_token) {
      console.error('[yahoo-connect] Yahoo did not return a refresh token');
      return errorRedirect('token_exchange_failed', 'Yahoo did not provide a refresh token');
    }

    if (!tokenResponse.xoauth_yahoo_guid) {
      console.warn(`[yahoo-connect] Yahoo token exchange omitted GUID for user ${maskUserId(clerkUserId)}`);
    }

    // Yahoo's authorization-code response is the authorization proof. Avoid an
    // immediate refresh-token validation call here; lazy refresh is still
    // protected by the per-user lease when the token later ages.
    const expiresAt = new Date(Date.now() + tokenResponse.expires_in * 1000);

    // Save credentials
    await storage.saveYahooCredentials({
      clerkUserId,
      accessToken: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      expiresAt,
      yahooGuid: tokenResponse.xoauth_yahoo_guid,
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

    return new Response(
      JSON.stringify({
        connected: true,
        hasCredentials: true,
        platform: 'yahoo',
        checkedAt,
        lastUpdated: credentials.updatedAt?.toISOString() ?? null,
        yahooGuidPresent: credentials.yahooGuidPresent,
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
      storage.getYahooLeagues(userId),
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
      const errorText = await apiResponse.text();
      console.error(`[yahoo-connect] Yahoo API error: ${apiResponse.status} - ${errorText}`);
      return yahooApiFailureResponse(
        { status: apiResponse.status, headers: apiResponse.headers },
        corsHeaders
      );
    }

    const rawData = await apiResponse.json();
    const leagues = parseYahooLeaguesResponse(rawData);

    console.log(`[yahoo-connect] Discovered ${leagues.length} leagues for user ${maskUserId(userId)}`);

    // Save leagues to storage
    for (const league of leagues) {
      await storage.upsertYahooLeague({
        clerkUserId: userId,
        sport: league.sport,
        seasonYear: league.seasonYear,
        leagueKey: league.leagueKey,
        leagueName: league.leagueName,
        teamId: league.teamId,
        teamKey: league.teamKey,
        teamName: league.teamName,
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
          });
        }
      }
    }
  } catch (parseError) {
    console.error('[yahoo-connect] Error parsing Yahoo response:', parseError);
  }

  return leagues;
}
