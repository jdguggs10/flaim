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

import { YahooStorage, type YahooCredentials } from './yahoo-storage';
import { getFrontendUrl, resolvePreviewOrigin } from './preview-url';
import { YahooAuthWorkerErrorCode } from '@flaim/worker-shared';

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
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const YAHOO_AUTH_URL = 'https://api.login.yahoo.com/oauth2/request_auth';
const YAHOO_TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';
const YAHOO_SCOPE = 'fspt-r'; // Fantasy Sports read access

const LEASE_TTL_MS       = 30_000;
const REFRESH_TIMEOUT_MS = 20_000; // must be < LEASE_TTL_MS
const POLL_INTERVAL_MS   =    300;
const MAX_REFRESH_ATTEMPTS = 3;

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
  Partial<YahooTokenResponse> &
  Pick<YahooTokenResponse, 'access_token' | 'expires_in'>;

function isUsableTokenResponse(response: Partial<YahooTokenResponse>): response is UsableYahooTokenResponse {
  return typeof response.access_token === 'string'
    && response.access_token.length > 0
    && typeof response.expires_in === 'number'
    && Number.isFinite(response.expires_in)
    && response.expires_in > 0;
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
  return status === 429 || (typeof status === 'number' && status >= 500);
}

function normalizeYahooTokenErrorText(response: Pick<YahooTokenResponse, 'error' | 'error_description' | 'upstream_error_text'>): string {
  return [response.error, response.error_description, response.upstream_error_text]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join(' ')
    .toLowerCase();
}

function hasPermanentYahooTokenFailureSignal(text: string): boolean {
  // Evaluated before transient signals so mixed messages like "temporarily unavailable, token revoked" stay permanent.
  return text.includes('invalid_grant')
    || text.includes('revoked')
    || text.includes('permanent')
    || text.includes('expired')
    || text.includes('already used');
}

// Observed Yahoo trigger: a plain-text "Too many requests to Yahoo token endpoint" body with HTTP 400.
function hasTransientYahooTokenFailureSignal(text: string): boolean {
  return text.includes('too many')
    || text.includes('rate limit')
    || text.includes('temporarily')
    || text.includes('temporary');
}

function isTransientYahooTokenFailure(response: Pick<YahooTokenResponse, 'status' | 'error' | 'error_description' | 'upstream_error_text'>): boolean {
  if (isTransientYahooTokenError(response.status)) {
    return true;
  }

  const text = normalizeYahooTokenErrorText(response);
  // Permanent signals win over transient-looking text so revoked/expired tokens still trigger reconnect.
  if (hasPermanentYahooTokenFailureSignal(text)) {
    return false;
  }

  // After permanent signals are ruled out, allow token-endpoint text matching on any error status.
  // Without status, do not guess from text alone.
  return response.status !== undefined && response.status >= 400 && hasTransientYahooTokenFailureSignal(text);
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
): Promise<YahooTokenResponse> {
  const text = await response.text();
  const data = parseYahooTokenBody(text);
  const nonJsonDescription = data ? undefined : trimYahooTokenBody(text);

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
    };
  }

  return toYahooTokenResponse(data);
}

// =============================================================================
// TOKEN ACQUISITION
// =============================================================================

type GetTokenResult =
  | { accessToken: string; expiresIn: number }
  | { error: string; errorDescription?: string; retryable?: boolean };

type RetryTokenResult =
  | GetTokenResult
  | { retry: true; credentials: YahooCredentials };

function toTokenResult(credentials: { accessToken: string; expiresAt: Date }): GetTokenResult {
  return {
    accessToken: credentials.accessToken,
    expiresIn: Math.floor((credentials.expiresAt.getTime() - Date.now()) / 1000),
  };
}

function leaseExpired(credentials: { refreshLeaseOwner?: string; refreshLeaseExpiresAt?: Date } | null): boolean {
  if (!credentials?.refreshLeaseOwner) {
    return true;
  }
  return credentials.refreshLeaseExpiresAt
    ? credentials.refreshLeaseExpiresAt.getTime() <= Date.now()
    : true;
}

async function waitForFreshCredentialsOrLeaseClear(
  storage: YahooStorage,
  userId: string,
  credentials: YahooCredentials
): Promise<RetryTokenResult> {
  let latest: YahooCredentials | null = credentials;

  while (latest && !leaseExpired(latest)) {
    await sleep(POLL_INTERVAL_MS + Math.floor(Math.random() * 100));
    latest = await storage.getYahooCredentials(userId);

    if (!latest) {
      return { error: 'not_connected' };
    }
    if (!latest.needsRefresh) {
      return toTokenResult(latest);
    }
    if (leaseExpired(latest)) {
      return { retry: true, credentials: latest };
    }
  }

  if (!latest) {
    return { error: 'not_connected' };
  }
  if (!latest.needsRefresh) {
    return toTokenResult(latest);
  }
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
  initialCredentials?: YahooCredentials
): Promise<GetTokenResult> {
  let credentials = initialCredentials ?? await storage.getYahooCredentials(userId);
  if (!credentials) {
    return { error: 'not_connected' };
  }

  for (let attempt = 0; attempt < MAX_REFRESH_ATTEMPTS; attempt++) {
    if (!credentials.needsRefresh) {
      return toTokenResult(credentials);
    }

    const ownerId = crypto.randomUUID();
    const won = await storage.acquireRefreshLease(
      userId,
      ownerId,
      LEASE_TTL_MS,
      credentials.refreshToken
    );

    if (!won) {
      const latest = await storage.getYahooCredentials(userId);
      if (!latest) {
        return { error: 'not_connected' };
      }
      if (!latest.needsRefresh) {
        return toTokenResult(latest);
      }
      if (leaseExpired(latest)) {
        credentials = latest;
        continue;
      }

      const loserResult = await waitForFreshCredentialsOrLeaseClear(
        storage,
        userId,
        latest
      );

      if ('retry' in loserResult) {
        credentials = loserResult.credentials;
        continue;
      }
      return loserResult;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
    let result: YahooTokenResponse;
    try {
      result = await refreshAccessToken(credentials.refreshToken, env, controller.signal);
    } catch (error) {
      clearTimeout(timer);
      const isAbort = error instanceof Error && error.name === 'AbortError';
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
          ? 'Yahoo token refresh timed out. Please try again later.'
          : 'Yahoo token refresh is temporarily unavailable. Please try again later.',
        retryable: true,
      };
    }
    clearTimeout(timer);

    if (result.error) {
      const statusSuffix = result.status ? ` (HTTP ${result.status})` : '';
      console.error(
        `[yahoo-connect] Yahoo token refresh failed for user ${maskUserId(userId)}: ${result.error}${statusSuffix}` +
          (result.error_description ? ` - ${result.error_description}` : '')
      );
      try {
        await storage.releaseRefreshLease(userId, ownerId);
      } catch (releaseError) {
        console.warn('[yahoo-connect] Failed to release Yahoo refresh lease after Yahoo refresh error:', releaseError);
      }
      const latest = await storage.getYahooCredentials(userId);
      if (latest && !latest.needsRefresh && looksLikeNewerCredentials(credentials, latest)) {
        console.log(`[yahoo-connect] Using concurrently refreshed token for user ${maskUserId(userId)}`);
        return toTokenResult(latest);
      }
      if (isTransientYahooTokenFailure(result)) {
        return {
          error: YahooAuthWorkerErrorCode.REFRESH_TEMPORARILY_UNAVAILABLE,
          errorDescription: result.error_description || 'Yahoo token refresh is temporarily unavailable',
          retryable: true,
        };
      }
      return {
        error: 'refresh_failed',
        errorDescription: result.error_description || 'Failed to refresh access token',
      };
    }

    if (!isUsableTokenResponse(result)) {
      console.error(`[yahoo-connect] Yahoo token refresh returned an invalid token response for user ${maskUserId(userId)}`);
      try {
        await storage.releaseRefreshLease(userId, ownerId);
      } catch (releaseError) {
        console.warn('[yahoo-connect] Failed to release Yahoo refresh lease after invalid Yahoo refresh response:', releaseError);
      }
      return { error: 'refresh_failed', errorDescription: 'Failed to refresh access token' };
    }

    const expiresAt = new Date(Date.now() + result.expires_in * 1000);
    const wrote = await storage.updateYahooCredentials(
      userId,
      { accessToken: result.access_token, refreshToken: result.refresh_token, expiresAt },
      ownerId
    );

    if (wrote) {
      console.log(`[yahoo-connect] Token refreshed for user ${maskUserId(userId)}`);
      return { accessToken: result.access_token, expiresIn: result.expires_in };
    }

    const latest = await storage.getYahooCredentials(userId);
    if (!latest) {
      return { error: 'not_connected' };
    }
    if (!latest.needsRefresh) {
      return toTokenResult(latest);
    }
    credentials = latest;
  }

  const latest = await storage.getYahooCredentials(userId);
  if (latest && !latest.needsRefresh) {
    return toTokenResult(latest);
  }
  return { error: 'refresh_failed' };
}

function yahooRefreshFailureResponse(
  result: Extract<GetTokenResult, { error: string }>,
  corsHeaders: Record<string, string>
): Response {
  // The error code is the canonical response signal; retryable is retained for downstream clients.
  if (result.error === YahooAuthWorkerErrorCode.REFRESH_TEMPORARILY_UNAVAILABLE) {
    return new Response(
      JSON.stringify({
        error: YahooAuthWorkerErrorCode.REFRESH_TEMPORARILY_UNAVAILABLE,
        error_description: result.errorDescription || 'Yahoo token refresh is temporarily unavailable. Please try again later.',
        retryable: true,
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }

  return new Response(
    JSON.stringify({
      error: 'refresh_failed',
      error_description: result.errorDescription || 'Failed to refresh access token',
    }),
    {
      status: 401,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
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
    const exchangeTimer = setTimeout(() => exchangeController.abort(), REFRESH_TIMEOUT_MS);
    let tokenResponse: YahooTokenResponse;
    try {
      tokenResponse = await exchangeCodeForTokens(code, env, exchangeController.signal);
    } catch (error) {
      clearTimeout(exchangeTimer);
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
      console.error(`[yahoo-connect] Token exchange failed: ${tokenResponse.error}`);
      const isTransient = isTransientYahooTokenFailure(tokenResponse);
      return errorRedirect(
        isTransient ? YahooAuthWorkerErrorCode.TOKEN_EXCHANGE_UNAVAILABLE : 'token_exchange_failed',
        isTransient
          ? 'Yahoo token exchange is temporarily unavailable. Please try again.'
          : tokenResponse.error_description || 'Failed to exchange code for tokens'
      );
    }

    // Validate refresh token is present
    if (!tokenResponse.refresh_token) {
      console.error('[yahoo-connect] Yahoo did not return a refresh token');
      return errorRedirect('token_exchange_failed', 'Yahoo did not provide a refresh token');
    }

    // This intentional second Yahoo call proves the refresh path works now,
    // so reconnect cannot look successful and then fail after access-token expiry.
    const validationController = new AbortController();
    const validationTimer = setTimeout(() => validationController.abort(), REFRESH_TIMEOUT_MS);
    let validatedTokenResponse: YahooTokenResponse;
    try {
      validatedTokenResponse = await refreshAccessToken(
        tokenResponse.refresh_token,
        env,
        validationController.signal
      );
    } catch (error) {
      clearTimeout(validationTimer);
      console.error(
        '[yahoo-connect] Refresh token validation failed after Yahoo callback:',
        error instanceof Error ? error.message : error
      );
      return errorRedirect(
        YahooAuthWorkerErrorCode.TOKEN_REFRESH_VALIDATION_UNAVAILABLE,
        'Yahoo refresh token validation is temporarily unavailable. Please try again.'
      );
    }
    clearTimeout(validationTimer);

    if (validatedTokenResponse.error) {
      const statusSuffix = validatedTokenResponse.status ? ` (HTTP ${validatedTokenResponse.status})` : '';
      const isTransient = isTransientYahooTokenFailure(validatedTokenResponse);
      console.error(
        `[yahoo-connect] Refresh token validation failed after Yahoo callback: ${validatedTokenResponse.error}${statusSuffix}` +
          (validatedTokenResponse.error_description ? ` - ${validatedTokenResponse.error_description}` : '')
      );
      return errorRedirect(
        isTransient ? YahooAuthWorkerErrorCode.TOKEN_REFRESH_VALIDATION_UNAVAILABLE : 'token_refresh_validation_failed',
        isTransient
          ? 'Yahoo refresh token validation is temporarily unavailable. Please try again.'
          : 'Yahoo refresh token validation failed'
      );
    }

    if (!isUsableTokenResponse(validatedTokenResponse)) {
      console.error('[yahoo-connect] Refresh token validation returned an invalid token response after Yahoo callback');
      return errorRedirect(
        'token_refresh_validation_failed',
        'Yahoo refresh token validation failed'
      );
    }

    const refreshToken = validatedTokenResponse.refresh_token || tokenResponse.refresh_token;
    const yahooGuid = validatedTokenResponse.xoauth_yahoo_guid || tokenResponse.xoauth_yahoo_guid;

    // Calculate token expiration from the validated refresh response.
    const expiresAt = new Date(Date.now() + validatedTokenResponse.expires_in * 1000);

    // Save credentials
    await storage.saveYahooCredentials({
      clerkUserId,
      accessToken: validatedTokenResponse.access_token,
      refreshToken,
      expiresAt,
      yahooGuid,
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
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const storage = YahooStorage.fromEnvironment(env);
    const result = await getValidYahooAccessToken(storage, userId, env);

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

    // Get credentials (includes updatedAt) and leagues in parallel
    const [credentials, leagues] = await Promise.all([
      storage.getYahooCredentials(userId),
      storage.getYahooLeagues(userId),
    ]);

    return new Response(
      JSON.stringify({
        connected: !!credentials,
        leagueCount: leagues.length,
        lastUpdated: credentials?.updatedAt?.toISOString(),
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
  code: string,
  env: YahooConnectEnv,
  signal?: AbortSignal
): Promise<YahooTokenResponse> {
  const credentials = btoa(`${env.YAHOO_CLIENT_ID}:${env.YAHOO_CLIENT_SECRET}`);

  const response = await fetch(YAHOO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: getCallbackUrl(env),
    }).toString(),
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
  refreshToken: string,
  env: YahooConnectEnv,
  signal?: AbortSignal
): Promise<YahooTokenResponse> {
  const credentials = btoa(`${env.YAHOO_CLIENT_ID}:${env.YAHOO_CLIENT_SECRET}`);

  const response = await fetch(YAHOO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${credentials}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      redirect_uri: getCallbackUrl(env),
      refresh_token: refreshToken,
    }).toString(),
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
  corsHeaders: Record<string, string>
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
      const tokenResult = await getValidYahooAccessToken(storage, userId, env, credentials);
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
      return new Response(
        JSON.stringify({
          error: 'yahoo_api_error',
          error_description: `Yahoo API returned ${apiResponse.status}`,
        }),
        {
          status: apiResponse.status === 401 ? 401 : 502,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        }
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

          leagues.push({
            sport,
            seasonYear: season,
            leagueKey,
            leagueName,
            teamId,
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
