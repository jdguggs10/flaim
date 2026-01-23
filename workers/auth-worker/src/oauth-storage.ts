/**
 * OAuth Storage - Supabase-based OAuth Code and Token Storage
 * ---------------------------------------------------------------------------
 *
 * Handles OAuth 2.1 authorization codes and access tokens for Claude
 * direct access via MCP connectors.
 *
 * Tables required (see docs/migrations/001_oauth_tables.sql):
 * - oauth_codes: Authorization codes (short-lived, one-time use)
 * - oauth_tokens: Access tokens (longer-lived, revocable)
 *
 * @version 1.0.0
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// =============================================================================
// TYPES
// =============================================================================

export interface OAuthCode {
  code: string;
  userId: string;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: 'S256' | 'plain';
  scope: string;
  resource?: string; // RFC 8707 resource indicator
  expiresAt: Date;
  usedAt?: Date;
}

export interface OAuthToken {
  id?: string; // Database UUID for revocation
  accessToken: string;
  userId: string;
  scope: string;
  resource?: string; // RFC 8707 resource indicator
  clientName?: string; // AI platform name (Claude, ChatGPT, etc.)
  expiresAt: Date;
  revokedAt?: Date;
  refreshToken?: string;
  refreshTokenExpiresAt?: Date;
}

export interface OAuthState {
  state: string;
  redirectUri: string;
  clientId?: string;
  expiresAt: Date;
}

export interface CreateCodeParams {
  userId: string;
  redirectUri: string;
  codeChallenge?: string;
  codeChallengeMethod?: 'S256' | 'plain';
  scope?: string;
  resource?: string; // RFC 8707 resource indicator
  expiresInSeconds?: number; // Default: 600 (10 minutes)
}

export interface CreateTokenParams {
  userId: string;
  scope?: string;
  resource?: string; // RFC 8707 resource indicator
  redirectUri?: string; // For deriving clientName
  clientName?: string; // AI platform name (Claude, ChatGPT, etc.)
  expiresInSeconds?: number; // Default: 3600 (1 hour)
  includeRefreshToken?: boolean;
  refreshTokenExpiresInSeconds?: number; // Default: 604800 (7 days)
}

export interface CreateStateParams {
  state: string;
  redirectUri: string;
  clientId?: string;
  expiresInSeconds?: number; // Default: 600 (10 minutes)
}

export interface TokenValidationResult {
  valid: boolean;
  userId?: string;
  scope?: string;
  error?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: Date;
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Generate a cryptographically secure random string
 * URL-safe base64 encoding
 */
function generateSecureToken(length: number = 32): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  // Convert to base64url (URL-safe)
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Verify PKCE code verifier against stored challenge
 */
async function verifyPkceChallenge(
  codeVerifier: string,
  codeChallenge: string,
  method: 'S256' | 'plain'
): Promise<boolean> {
  if (method === 'plain') {
    return codeVerifier === codeChallenge;
  }

  // S256: SHA-256 hash of verifier, base64url encoded
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  const base64 = btoa(String.fromCharCode(...hashArray));
  const base64url = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  return base64url === codeChallenge;
}

/**
 * Mask user ID for logging
 */
function maskUserId(userId: string): string {
  if (!userId || userId.length <= 8) return '***';
  return `${userId.substring(0, 8)}...`;
}

/**
 * Derive AI platform name from OAuth redirect URI
 */
function getClientNameFromRedirectUri(redirectUri: string): string {
  if (!redirectUri) return 'MCP Client';
  const uri = redirectUri.toLowerCase();
  if (uri.includes('claude.ai') || uri.includes('claude.com')) return 'Claude';
  if (uri.includes('chatgpt.com') || uri.includes('openai.com')) return 'ChatGPT';
  if (uri.includes('gemini') || uri.includes('google.com')) return 'Gemini';
  if (uri.includes('localhost') || uri.includes('127.0.0.1')) return 'Development';
  return 'MCP Client';
}

// =============================================================================
// OAUTH STORAGE CLASS
// =============================================================================

export class OAuthStorage {
  private supabase: SupabaseClient;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  // ---------------------------------------------------------------------------
  // AUTHORIZATION CODES
  // ---------------------------------------------------------------------------

  /**
   * Create and store a new authorization code
   */
  async createAuthorizationCode(params: CreateCodeParams): Promise<string> {
    const code = generateSecureToken(32);
    const expiresInSeconds = params.expiresInSeconds ?? 600; // 10 minutes default
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    const { error } = await this.supabase.from('oauth_codes').insert({
      code,
      user_id: params.userId,
      redirect_uri: params.redirectUri,
      code_challenge: params.codeChallenge || null,
      code_challenge_method: params.codeChallengeMethod || null,
      scope: params.scope || 'mcp:read',
      resource: params.resource || null, // RFC 8707
      expires_at: expiresAt.toISOString(),
    });

    if (error) {
      console.error('[oauth-storage] Failed to create authorization code:', error);
      throw new Error('Failed to create authorization code');
    }

    console.log(`[oauth-storage] Created auth code for user ${maskUserId(params.userId)}, expires in ${expiresInSeconds}s`);
    return code;
  }

  // ---------------------------------------------------------------------------
  // OAUTH STATE (CSRF PROTECTION)
  // ---------------------------------------------------------------------------

  /**
   * Store OAuth state for server-side validation
   */
  async createOAuthState(params: CreateStateParams): Promise<void> {
    const expiresInSeconds = params.expiresInSeconds ?? 600; // 10 minutes default
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    const { error } = await this.supabase.from('oauth_states').insert({
      state: params.state,
      redirect_uri: params.redirectUri,
      client_id: params.clientId || null,
      expires_at: expiresAt.toISOString(),
    });

    if (error) {
      console.error('[oauth-storage] Failed to store OAuth state:', error);
      throw new Error('Failed to store OAuth state');
    }
  }

  /**
   * Validate and consume OAuth state (single-use)
   */
  async consumeOAuthState(
    state: string,
    redirectUri: string,
    clientId?: string
  ): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('oauth_states')
      .select('state, redirect_uri, client_id, expires_at')
      .eq('state', state)
      .single();

    if (error || !data) {
      return false;
    }

    const expiresAt = new Date(data.expires_at);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      await this.supabase.from('oauth_states').delete().eq('state', state);
      return false;
    }

    if (data.redirect_uri !== redirectUri) {
      return false;
    }

    if (clientId && data.client_id && data.client_id !== clientId) {
      return false;
    }

    await this.supabase.from('oauth_states').delete().eq('state', state);
    return true;
  }

  /**
   * Retrieve and validate an authorization code
   * Returns null if code is invalid, expired, or already used
   */
  async getAuthorizationCode(code: string): Promise<OAuthCode | null> {
    const { data, error } = await this.supabase
      .from('oauth_codes')
      .select('*')
      .eq('code', code)
      .single();

    if (error || !data) {
      console.log(`[oauth-storage] Auth code not found: ${code.substring(0, 8)}...`);
      return null;
    }

    // Check if expired
    if (new Date(data.expires_at) < new Date()) {
      console.log(`[oauth-storage] Auth code expired: ${code.substring(0, 8)}...`);
      return null;
    }

    // Check if already used
    if (data.used_at) {
      console.log(`[oauth-storage] Auth code already used: ${code.substring(0, 8)}...`);
      return null;
    }

    return {
      code: data.code,
      userId: data.user_id,
      redirectUri: data.redirect_uri,
      codeChallenge: data.code_challenge || undefined,
      codeChallengeMethod: data.code_challenge_method || undefined,
      scope: data.scope,
      resource: data.resource || undefined, // RFC 8707
      expiresAt: new Date(data.expires_at),
      usedAt: data.used_at ? new Date(data.used_at) : undefined,
    };
  }

  /**
   * Mark an authorization code as used (prevents replay attacks)
   */
  async markCodeAsUsed(code: string): Promise<boolean> {
    const { error } = await this.supabase
      .from('oauth_codes')
      .update({ used_at: new Date().toISOString() })
      .eq('code', code);

    if (error) {
      console.error('[oauth-storage] Failed to mark code as used:', error);
      return false;
    }

    return true;
  }

  /**
   * Exchange authorization code for access token
   * Validates PKCE if present
   */
  async exchangeCodeForToken(
    code: string,
    redirectUri: string,
    codeVerifier?: string
  ): Promise<OAuthToken | null> {
    // Get and validate the code
    const authCode = await this.getAuthorizationCode(code);
    if (!authCode) {
      return null;
    }

    // Validate redirect URI matches
    if (authCode.redirectUri !== redirectUri) {
      console.log(`[oauth-storage] Redirect URI mismatch: expected ${authCode.redirectUri}, got ${redirectUri}`);
      return null;
    }

    // Validate PKCE if challenge was provided
    if (authCode.codeChallenge) {
      if (!codeVerifier) {
        console.log('[oauth-storage] PKCE code_verifier required but not provided');
        return null;
      }

      const method = authCode.codeChallengeMethod || 'S256';
      const valid = await verifyPkceChallenge(codeVerifier, authCode.codeChallenge, method);
      if (!valid) {
        console.log('[oauth-storage] PKCE verification failed');
        return null;
      }
    }

    // Mark code as used
    await this.markCodeAsUsed(code);

    // Create and return access token
    const token = await this.createAccessToken({
      userId: authCode.userId,
      scope: authCode.scope,
      resource: authCode.resource, // RFC 8707 - pass through resource
      redirectUri: authCode.redirectUri, // For deriving clientName
      includeRefreshToken: true,
    });

    return token;
  }

  // ---------------------------------------------------------------------------
  // ACCESS TOKENS
  // ---------------------------------------------------------------------------

  /**
   * Create and store a new access token
   */
  async createAccessToken(params: CreateTokenParams): Promise<OAuthToken> {
    const accessToken = generateSecureToken(32);
    const expiresInSeconds = params.expiresInSeconds ?? 3600; // 1 hour default
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    // Derive clientName from redirectUri if not explicitly provided
    const clientName = params.clientName || (params.redirectUri ? getClientNameFromRedirectUri(params.redirectUri) : 'MCP Client');

    let refreshToken: string | undefined;
    let refreshTokenExpiresAt: Date | undefined;

    if (params.includeRefreshToken) {
      refreshToken = generateSecureToken(32);
      const refreshExpiresIn = params.refreshTokenExpiresInSeconds ?? 604800; // 7 days default
      refreshTokenExpiresAt = new Date(Date.now() + refreshExpiresIn * 1000);
    }

    const { data, error } = await this.supabase.from('oauth_tokens').insert({
      access_token: accessToken,
      user_id: params.userId,
      scope: params.scope || 'mcp:read',
      resource: params.resource || null, // RFC 8707
      client_name: clientName,
      expires_at: expiresAt.toISOString(),
      refresh_token: refreshToken || null,
      refresh_token_expires_at: refreshTokenExpiresAt?.toISOString() || null,
    }).select('id').single();

    if (error) {
      console.error('[oauth-storage] Failed to create access token:', error);
      throw new Error('Failed to create access token');
    }

    console.log(`[oauth-storage] Created access token for user ${maskUserId(params.userId)} (${clientName}), expires in ${expiresInSeconds}s`);

    return {
      id: data?.id,
      accessToken,
      userId: params.userId,
      scope: params.scope || 'mcp:read',
      resource: params.resource, // RFC 8707
      clientName,
      expiresAt,
      refreshToken,
      refreshTokenExpiresAt,
    };
  }

  /**
   * Validate an access token
   * Returns user ID and scope if valid
   */
  async validateAccessToken(accessToken: string): Promise<TokenValidationResult> {
    const { data, error } = await this.supabase
      .from('oauth_tokens')
      .select('user_id, scope, expires_at, revoked_at')
      .eq('access_token', accessToken)
      .single();

    if (error || !data) {
      return { valid: false, error: 'Token not found' };
    }

    // Check if revoked
    if (data.revoked_at) {
      return { valid: false, error: 'Token has been revoked' };
    }

    // Check if expired
    if (new Date(data.expires_at) < new Date()) {
      return { valid: false, error: 'Token has expired' };
    }

    return {
      valid: true,
      userId: data.user_id,
      scope: data.scope,
    };
  }

  /**
   * Refresh an access token using a refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<OAuthToken | null> {
    const { data, error } = await this.supabase
      .from('oauth_tokens')
      .select('*')
      .eq('refresh_token', refreshToken)
      .single();

    if (error || !data) {
      console.log('[oauth-storage] Refresh token not found');
      return null;
    }

    // Check if revoked
    if (data.revoked_at) {
      console.log('[oauth-storage] Refresh token has been revoked');
      return null;
    }

    // Check if refresh token expired
    if (data.refresh_token_expires_at && new Date(data.refresh_token_expires_at) < new Date()) {
      console.log('[oauth-storage] Refresh token has expired');
      return null;
    }

    // Revoke the old token
    await this.revokeToken(data.access_token);

    // Create new token with same scope, resource, and clientName
    const newToken = await this.createAccessToken({
      userId: data.user_id,
      scope: data.scope,
      resource: data.resource || undefined, // Preserve resource for audience validation
      clientName: data.client_name || undefined, // Preserve clientName
      includeRefreshToken: true,
    });

    return newToken;
  }

  /**
   * Revoke an access token
   */
  async revokeToken(accessToken: string): Promise<boolean> {
    const { error } = await this.supabase
      .from('oauth_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('access_token', accessToken);

    if (error) {
      console.error('[oauth-storage] Failed to revoke token:', error);
      return false;
    }

    console.log(`[oauth-storage] Revoked token: ${accessToken.substring(0, 8)}...`);
    return true;
  }

  /**
   * Revoke a token by its database ID (for single-connection revoke)
   * Returns true if revoked, false if not found or already revoked
   */
  async revokeTokenById(tokenId: string, userId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('oauth_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', tokenId)
      .eq('user_id', userId) // Ensure user owns this token
      .is('revoked_at', null) // Only revoke if not already revoked
      .select('id')
      .single();

    if (error || !data) {
      console.log(`[oauth-storage] Token not found or already revoked: ${tokenId}`);
      return false;
    }

    console.log(`[oauth-storage] Revoked token by ID: ${tokenId}`);
    return true;
  }

  /**
   * Revoke all tokens for a user (e.g., on disconnect)
   */
  async revokeAllUserTokens(userId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('oauth_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('revoked_at', null)
      .select('id');

    if (error) {
      console.error('[oauth-storage] Failed to revoke user tokens:', error);
      return 0;
    }

    const count = data?.length || 0;
    console.log(`[oauth-storage] Revoked ${count} tokens for user ${maskUserId(userId)}`);
    return count;
  }

  /**
   * Get all active tokens for a user
   */
  async getUserTokens(userId: string): Promise<OAuthToken[]> {
    const { data, error } = await this.supabase
      .from('oauth_tokens')
      .select('*')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString());

    if (error || !data) {
      return [];
    }

    return data.map((row) => ({
      id: row.id,
      accessToken: row.access_token,
      userId: row.user_id,
      scope: row.scope,
      resource: row.resource || undefined,
      clientName: row.client_name || 'MCP Client',
      expiresAt: new Date(row.expires_at),
      refreshToken: row.refresh_token || undefined,
      refreshTokenExpiresAt: row.refresh_token_expires_at
        ? new Date(row.refresh_token_expires_at)
        : undefined,
    }));
  }

  /**
   * Check if a user has any active OAuth connections
   */
  async hasActiveConnection(userId: string): Promise<boolean> {
    const tokens = await this.getUserTokens(userId);
    return tokens.length > 0;
  }

  // ---------------------------------------------------------------------------
  // RATE LIMITING
  // ---------------------------------------------------------------------------

  /**
   * Check rate limit for a user (does not increment)
   * Default limit: 200 calls/day
   */
  async checkRateLimit(userId: string, limit: number = 200): Promise<RateLimitResult> {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    const { data, error } = await this.supabase
      .from('rate_limits')
      .select('request_count, window_date')
      .eq('user_id', userId)
      .eq('window_date', today)
      .single();

    // Calculate reset time (next midnight UTC)
    const now = new Date();
    const resetAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));

    if (error || !data) {
      // No record yet - user hasn't made any calls today
      return {
        allowed: true,
        remaining: limit,
        limit,
        resetAt,
      };
    }

    const count = data.request_count || 0;
    const remaining = Math.max(0, limit - count);

    return {
      allowed: count < limit,
      remaining,
      limit,
      resetAt,
    };
  }

  /**
   * Increment rate limit counter for a user (upsert)
   * Returns the updated count
   */
  async incrementRateLimit(userId: string): Promise<number> {
    // Use the RPC function which handles the upsert/increment logic atomically in SQL
    const { data: updated, error: updateError } = await this.supabase.rpc('increment_rate_limit', {
      p_user_id: userId,
    });

    if (updateError) {
      console.error('[oauth-storage] Failed to increment rate limit:', updateError);
      // Don't fail the request on rate limit errors - log and continue
      return 0;
    }

    return updated?.[0]?.request_count || 0;
  }

  // ---------------------------------------------------------------------------
  // FACTORY METHODS
  // ---------------------------------------------------------------------------

  /**
   * Create instance from environment variables
   */
  static fromEnvironment(env: { SUPABASE_URL: string; SUPABASE_SERVICE_KEY: string }): OAuthStorage {
    return new OAuthStorage(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  }
}
