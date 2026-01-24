/**
 * Yahoo Connect Handlers - OAuth flow for Yahoo Fantasy Sports platform
 * ---------------------------------------------------------------------------
 *
 * Implements the OAuth 2.0 flow for connecting user accounts to Yahoo Fantasy.
 * These handlers manage:
 * - Authorization: Redirect users to Yahoo's OAuth consent page
 * - Callback: Handle Yahoo's redirect with auth code, exchange for tokens
 * - Credentials: Provide access tokens (with auto-refresh) for API calls
 * - Disconnect: Remove Yahoo connection and stored data
 * - Status: Check if user is connected to Yahoo
 *
 * @version 1.0.0
 */

import { YahooStorage } from './yahoo-storage';

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
}

interface YahooTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  xoauth_yahoo_guid?: string;
  error?: string;
  error_description?: string;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

const YAHOO_AUTH_URL = 'https://api.login.yahoo.com/oauth2/request_auth';
const YAHOO_TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';
const YAHOO_SCOPE = 'fspt-r'; // Fantasy Sports read access

/**
 * Get the OAuth callback URL based on environment
 */
function getCallbackUrl(env: YahooConnectEnv): string {
  if (env.ENVIRONMENT === 'dev' || env.NODE_ENV === 'development') {
    return 'http://localhost:8786/connect/yahoo/callback';
  }
  return 'https://api.flaim.app/auth/connect/yahoo/callback';
}

/**
 * Get the frontend URL for redirects after OAuth flow
 */
function getFrontendUrl(env: YahooConnectEnv): string {
  if (env.ENVIRONMENT === 'dev' || env.NODE_ENV === 'development') {
    return 'http://localhost:3000';
  }
  if (env.ENVIRONMENT === 'preview') {
    return 'https://flaim-preview.vercel.app';
  }
  return 'https://flaim.app';
}

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
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const storage = YahooStorage.fromEnvironment(env);

    // Generate state as userId:nonce for CSRF protection
    const nonce = generateNonce();
    const state = `${userId}:${nonce}`;

    // Store state for validation in callback
    await storage.createPlatformOAuthState({
      state,
      clerkUserId: userId,
      platform: 'yahoo',
      expiresInSeconds: 600, // 10 minutes
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

  const frontendUrl = getFrontendUrl(env);

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

    // Exchange code for tokens
    const tokenResponse = await exchangeCodeForTokens(code, env);

    if (tokenResponse.error) {
      console.error(`[yahoo-connect] Token exchange failed: ${tokenResponse.error}`);
      return errorRedirect('token_exchange_failed', tokenResponse.error_description || 'Failed to exchange code for tokens');
    }

    // Validate refresh token is present
    if (!tokenResponse.refresh_token) {
      console.error('[yahoo-connect] Yahoo did not return a refresh token');
      return errorRedirect('token_exchange_failed', 'Yahoo did not provide a refresh token');
    }

    // Calculate token expiration
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

    // If token needs refresh, attempt to refresh it
    if (credentials.needsRefresh) {
      console.log(`[yahoo-connect] Token needs refresh for user ${maskUserId(userId)}`);

      const refreshResult = await refreshAccessToken(credentials.refreshToken, env);

      if (refreshResult.error) {
        console.error(`[yahoo-connect] Token refresh failed: ${refreshResult.error}`);
        return new Response(
          JSON.stringify({
            error: 'refresh_failed',
            error_description: refreshResult.error_description || 'Failed to refresh access token',
          }),
          {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          }
        );
      }

      // Update stored credentials
      const expiresAt = new Date(Date.now() + refreshResult.expires_in * 1000);
      await storage.updateYahooCredentials(userId, {
        accessToken: refreshResult.access_token,
        refreshToken: refreshResult.refresh_token,
        expiresAt,
      });

      console.log(`[yahoo-connect] Token refreshed for user ${maskUserId(userId)}`);

      return new Response(
        JSON.stringify({
          access_token: refreshResult.access_token,
          expires_in: refreshResult.expires_in,
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

    // Return current token
    const expiresIn = Math.floor((credentials.expiresAt.getTime() - Date.now()) / 1000);

    return new Response(
      JSON.stringify({
        access_token: credentials.accessToken,
        expires_in: expiresIn,
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

    // Check credentials and get leagues in parallel
    const [hasCredentials, leagues] = await Promise.all([
      storage.hasYahooCredentials(userId),
      storage.getYahooLeagues(userId),
    ]);

    return new Response(
      JSON.stringify({
        connected: hasCredentials,
        leagueCount: leagues.length,
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
  env: YahooConnectEnv
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
  });

  const data = (await response.json()) as YahooTokenResponse;

  if (!response.ok) {
    return {
      access_token: '',
      expires_in: 0,
      token_type: 'bearer',
      error: data.error || 'token_error',
      error_description: data.error_description || 'Failed to exchange code for tokens',
    };
  }

  return data;
}

/**
 * Refresh an expired access token using the refresh token
 */
async function refreshAccessToken(
  refreshToken: string,
  env: YahooConnectEnv
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
      refresh_token: refreshToken,
    }).toString(),
  });

  const data = (await response.json()) as YahooTokenResponse;

  if (!response.ok) {
    return {
      access_token: '',
      expires_in: 0,
      token_type: 'bearer',
      error: data.error || 'refresh_error',
      error_description: data.error_description || 'Failed to refresh access token',
    };
  }

  return data;
}
