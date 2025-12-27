/**
 * OAuth Handlers for Claude Direct Access
 * ---------------------------------------------------------------------------
 *
 * Implements OAuth 2.1 endpoints for Claude MCP connector authentication.
 * Follows the MCP specification for authorization.
 *
 * Flow:
 * 1. Claude → GET /authorize → redirect to frontend consent page
 * 2. Frontend → POST /oauth/code (with Clerk JWT) → returns auth code
 * 3. Claude → POST /token → exchanges code for access token
 * 4. Claude → uses token for MCP requests
 *
 * @version 1.0.0
 */

import { OAuthStorage } from './oauth-storage';

// =============================================================================
// TYPES
// =============================================================================

export interface OAuthEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  NODE_ENV?: string;
  ENVIRONMENT?: string;
}

interface AuthorizeParams {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
}

interface TokenRequest {
  grant_type: string;
  code?: string;
  redirect_uri?: string;
  code_verifier?: string;
  refresh_token?: string;
  client_id?: string;
  client_secret?: string;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

// Claude OAuth callback URLs (allowlist these)
const ALLOWED_REDIRECT_URIS = [
  'https://claude.ai/api/mcp/auth_callback',
  'https://claude.com/api/mcp/auth_callback',
  // For local development/testing
  'http://localhost:3000/oauth/callback',
  'http://localhost:6274/oauth/callback',
];

// OAuth client ID (static for now, no DCR)
const OAUTH_CLIENT_ID = 'flaim-mcp';

// Frontend URL for consent page
const getFrontendUrl = (env: OAuthEnv): string => {
  if (env.ENVIRONMENT === 'dev' || env.NODE_ENV === 'development') {
    return 'http://localhost:3000';
  }
  if (env.ENVIRONMENT === 'preview') {
    return 'https://flaim-preview.vercel.app'; // Update with actual preview URL
  }
  return 'https://flaim.app';
};

// Base URL for OAuth endpoints (used in metadata)
const getBaseUrl = (env: OAuthEnv): string => {
  if (env.ENVIRONMENT === 'dev' || env.NODE_ENV === 'development') {
    return 'http://localhost:8786';
  }
  return 'https://api.flaim.app';
};

// =============================================================================
// UTILITIES
// =============================================================================

function isValidRedirectUri(uri: string): boolean {
  return ALLOWED_REDIRECT_URIS.some(allowed => {
    // Exact match or starts with (for local dev with ports)
    return uri === allowed || uri.startsWith(allowed);
  });
}

function buildErrorRedirect(redirectUri: string, error: string, description: string, state?: string): string {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  url.searchParams.set('error_description', description);
  if (state) url.searchParams.set('state', state);
  return url.toString();
}

function buildSuccessRedirect(redirectUri: string, code: string, state?: string): string {
  const url = new URL(redirectUri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);
  return url.toString();
}

// =============================================================================
// METADATA DISCOVERY
// =============================================================================

/**
 * OAuth 2.0 Authorization Server Metadata (RFC 8414)
 * GET /.well-known/oauth-authorization-server
 */
export function handleMetadataDiscovery(env: OAuthEnv, corsHeaders: Record<string, string>): Response {
  const baseUrl = getBaseUrl(env);

  const metadata = {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/authorize`,
    token_endpoint: `${baseUrl}/token`,
    revocation_endpoint: `${baseUrl}/revoke`,
    // Token introspection not implemented
    // introspection_endpoint: `${baseUrl}/introspect`,

    // Supported features
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256', 'plain'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
    scopes_supported: ['mcp:read', 'mcp:write'],

    // Service documentation
    service_documentation: 'https://flaim.app/docs/oauth',
  };

  return new Response(JSON.stringify(metadata), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600', // Cache for 1 hour
      ...corsHeaders,
    },
  });
}

// =============================================================================
// AUTHORIZATION ENDPOINT
// =============================================================================

/**
 * Authorization endpoint - redirects to frontend consent page
 * GET /authorize
 *
 * This endpoint doesn't authenticate the user directly - it redirects to
 * the frontend where Clerk handles authentication and shows the consent UI.
 */
export function handleAuthorize(request: Request, env: OAuthEnv): Response {
  const url = new URL(request.url);
  const params: AuthorizeParams = {
    response_type: url.searchParams.get('response_type') || '',
    client_id: url.searchParams.get('client_id') || '',
    redirect_uri: url.searchParams.get('redirect_uri') || '',
    scope: url.searchParams.get('scope') || undefined,
    state: url.searchParams.get('state') || undefined,
    code_challenge: url.searchParams.get('code_challenge') || undefined,
    code_challenge_method: url.searchParams.get('code_challenge_method') || undefined,
  };

  // Validate required parameters
  if (params.response_type !== 'code') {
    if (params.redirect_uri && isValidRedirectUri(params.redirect_uri)) {
      return Response.redirect(
        buildErrorRedirect(params.redirect_uri, 'unsupported_response_type', 'Only code response type is supported', params.state),
        302
      );
    }
    return new Response(JSON.stringify({
      error: 'unsupported_response_type',
      error_description: 'Only code response type is supported',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  if (!params.redirect_uri) {
    return new Response(JSON.stringify({
      error: 'invalid_request',
      error_description: 'redirect_uri is required',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  if (!isValidRedirectUri(params.redirect_uri)) {
    return new Response(JSON.stringify({
      error: 'invalid_request',
      error_description: 'redirect_uri is not in the allowed list',
    }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  // PKCE is required (OAuth 2.1)
  if (!params.code_challenge) {
    return Response.redirect(
      buildErrorRedirect(params.redirect_uri, 'invalid_request', 'code_challenge is required (PKCE)', params.state),
      302
    );
  }

  // Build frontend consent URL
  const frontendUrl = getFrontendUrl(env);
  const consentUrl = new URL(`${frontendUrl}/oauth/consent`);

  // Pass all OAuth params to frontend
  consentUrl.searchParams.set('redirect_uri', params.redirect_uri);
  if (params.scope) consentUrl.searchParams.set('scope', params.scope);
  if (params.state) consentUrl.searchParams.set('state', params.state);
  if (params.code_challenge) consentUrl.searchParams.set('code_challenge', params.code_challenge);
  if (params.code_challenge_method) consentUrl.searchParams.set('code_challenge_method', params.code_challenge_method);
  if (params.client_id) consentUrl.searchParams.set('client_id', params.client_id);

  console.log(`[oauth] Redirecting to consent page: ${consentUrl.toString()}`);

  return Response.redirect(consentUrl.toString(), 302);
}

/**
 * Create authorization code (called by frontend after consent)
 * POST /oauth/code
 *
 * Request body:
 * - redirect_uri: string
 * - scope: string (optional)
 * - state: string (optional)
 * - code_challenge: string
 * - code_challenge_method: string (optional, defaults to S256)
 *
 * Requires Clerk JWT in Authorization header.
 */
export async function handleCreateCode(
  request: Request,
  env: OAuthEnv,
  userId: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const body = await request.json() as {
      redirect_uri: string;
      scope?: string;
      state?: string;
      code_challenge?: string;
      code_challenge_method?: string;
    };

    if (!body.redirect_uri) {
      return new Response(JSON.stringify({
        error: 'invalid_request',
        error_description: 'redirect_uri is required',
      }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    if (!isValidRedirectUri(body.redirect_uri)) {
      return new Response(JSON.stringify({
        error: 'invalid_request',
        error_description: 'redirect_uri is not in the allowed list',
      }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    const storage = OAuthStorage.fromEnvironment(env);

    const code = await storage.createAuthorizationCode({
      userId,
      redirectUri: body.redirect_uri,
      scope: body.scope || 'mcp:read',
      codeChallenge: body.code_challenge,
      codeChallengeMethod: (body.code_challenge_method as 'S256' | 'plain') || 'S256',
      expiresInSeconds: 600, // 10 minutes
    });

    // Return the code and redirect URL for frontend to use
    const redirectUrl = buildSuccessRedirect(body.redirect_uri, code, body.state);

    return new Response(JSON.stringify({
      success: true,
      code,
      redirect_url: redirectUrl,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (error) {
    console.error('[oauth] Failed to create authorization code:', error);
    return new Response(JSON.stringify({
      error: 'server_error',
      error_description: 'Failed to create authorization code',
    }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  }
}

// =============================================================================
// TOKEN ENDPOINT
// =============================================================================

/**
 * Token endpoint - exchange code for access token or refresh
 * POST /token
 *
 * Grant types:
 * - authorization_code: exchange code for token
 * - refresh_token: refresh an expired token
 */
export async function handleToken(
  request: Request,
  env: OAuthEnv,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    // Parse body (support both form-encoded and JSON)
    let body: TokenRequest;
    const contentType = request.headers.get('Content-Type') || '';

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await request.formData();
      body = {
        grant_type: formData.get('grant_type') as string || '',
        code: formData.get('code') as string || undefined,
        redirect_uri: formData.get('redirect_uri') as string || undefined,
        code_verifier: formData.get('code_verifier') as string || undefined,
        refresh_token: formData.get('refresh_token') as string || undefined,
        client_id: formData.get('client_id') as string || undefined,
        client_secret: formData.get('client_secret') as string || undefined,
      };
    } else {
      body = await request.json() as TokenRequest;
    }

    const storage = OAuthStorage.fromEnvironment(env);

    // Handle authorization_code grant
    if (body.grant_type === 'authorization_code') {
      if (!body.code) {
        return new Response(JSON.stringify({
          error: 'invalid_request',
          error_description: 'code is required',
        }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      if (!body.redirect_uri) {
        return new Response(JSON.stringify({
          error: 'invalid_request',
          error_description: 'redirect_uri is required',
        }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      const token = await storage.exchangeCodeForToken(
        body.code,
        body.redirect_uri,
        body.code_verifier
      );

      if (!token) {
        return new Response(JSON.stringify({
          error: 'invalid_grant',
          error_description: 'Invalid authorization code or PKCE verification failed',
        }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      // Return OAuth 2.0 token response
      const response: Record<string, any> = {
        access_token: token.accessToken,
        token_type: 'Bearer',
        expires_in: Math.floor((token.expiresAt.getTime() - Date.now()) / 1000),
        scope: token.scope,
      };

      if (token.refreshToken) {
        response.refresh_token = token.refreshToken;
      }

      console.log(`[oauth] Issued access token for user, expires in ${response.expires_in}s`);

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'Pragma': 'no-cache',
          ...corsHeaders,
        },
      });
    }

    // Handle refresh_token grant
    if (body.grant_type === 'refresh_token') {
      if (!body.refresh_token) {
        return new Response(JSON.stringify({
          error: 'invalid_request',
          error_description: 'refresh_token is required',
        }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      const token = await storage.refreshAccessToken(body.refresh_token);

      if (!token) {
        return new Response(JSON.stringify({
          error: 'invalid_grant',
          error_description: 'Invalid or expired refresh token',
        }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      const response: Record<string, any> = {
        access_token: token.accessToken,
        token_type: 'Bearer',
        expires_in: Math.floor((token.expiresAt.getTime() - Date.now()) / 1000),
        scope: token.scope,
      };

      if (token.refreshToken) {
        response.refresh_token = token.refreshToken;
      }

      console.log(`[oauth] Refreshed access token, expires in ${response.expires_in}s`);

      return new Response(JSON.stringify(response), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'Pragma': 'no-cache',
          ...corsHeaders,
        },
      });
    }

    // Unsupported grant type
    return new Response(JSON.stringify({
      error: 'unsupported_grant_type',
      error_description: 'Only authorization_code and refresh_token grants are supported',
    }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });

  } catch (error) {
    console.error('[oauth] Token endpoint error:', error);
    return new Response(JSON.stringify({
      error: 'server_error',
      error_description: 'Internal server error',
    }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  }
}

// =============================================================================
// REVOCATION ENDPOINT
// =============================================================================

/**
 * Token revocation endpoint (RFC 7009)
 * POST /revoke
 *
 * Revokes an access token or refresh token.
 */
export async function handleRevoke(
  request: Request,
  env: OAuthEnv,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    // Parse body
    let token: string | undefined;
    const contentType = request.headers.get('Content-Type') || '';

    if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await request.formData();
      token = formData.get('token') as string || undefined;
    } else {
      const body = await request.json() as { token?: string };
      token = body.token;
    }

    if (!token) {
      return new Response(JSON.stringify({
        error: 'invalid_request',
        error_description: 'token is required',
      }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
    }

    const storage = OAuthStorage.fromEnvironment(env);
    await storage.revokeToken(token);

    // RFC 7009: Always return 200 OK, even if token was already revoked or invalid
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  } catch (error) {
    console.error('[oauth] Revocation endpoint error:', error);
    // Still return 200 per RFC 7009
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }
}

// =============================================================================
// TOKEN VALIDATION (for internal use by MCP workers)
// =============================================================================

/**
 * Validate OAuth token and return user ID
 * Used by auth-worker's getVerifiedUserId to support both Clerk JWT and OAuth tokens
 */
export async function validateOAuthToken(
  token: string,
  env: OAuthEnv
): Promise<{ userId: string; scope: string } | null> {
  const storage = OAuthStorage.fromEnvironment(env);
  const result = await storage.validateAccessToken(token);

  if (!result.valid || !result.userId) {
    return null;
  }

  return {
    userId: result.userId,
    scope: result.scope || 'mcp:read',
  };
}

// =============================================================================
// FRONTEND MANAGEMENT ENDPOINTS
// =============================================================================

/**
 * Check active connection status
 * Used by frontend to see if user has connected Claude
 */
export async function handleCheckStatus(
  env: OAuthEnv,
  userId: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const storage = OAuthStorage.fromEnvironment(env);
    const hasConnection = await storage.hasActiveConnection(userId);

    return new Response(JSON.stringify({
      success: true,
      hasConnection,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (error) {
    console.error('[oauth] Check status error:', error);
    return new Response(JSON.stringify({
      error: 'server_error',
      error_description: 'Failed to check connection status',
    }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  }
}

/**
 * Revoke all tokens for a user
 * Used by frontend to "Disconnect" Claude
 */
export async function handleRevokeAll(
  env: OAuthEnv,
  userId: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const storage = OAuthStorage.fromEnvironment(env);
    const count = await storage.revokeAllUserTokens(userId);

    return new Response(JSON.stringify({
      success: true,
      revokedCount: count,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (error) {
    console.error('[oauth] Revoke all error:', error);
    return new Response(JSON.stringify({
      error: 'server_error',
      error_description: 'Failed to revoke connections',
    }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  }
}
