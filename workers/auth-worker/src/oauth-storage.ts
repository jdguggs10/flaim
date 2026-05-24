/**
 * OAuth Storage - Supabase-based OAuth Code and Token Storage
 * ---------------------------------------------------------------------------
 *
 * Handles OAuth 2.1 authorization codes and access tokens for Claude
 * direct access via MCP connectors.
 *
 * Tables required (see flaim-docs/migrations/001_oauth_tables.sql):
 * - oauth_codes: Authorization codes (short-lived, one-time use)
 * - oauth_tokens: Access tokens (longer-lived, revocable)
 *
 * @version 1.0.0
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  createClientBoundToken,
  generateSecureToken,
  getClientIdFromBoundToken,
  isConfidentialClientId,
} from './oauth-client-auth';

// =============================================================================
// TYPES
// =============================================================================

export interface OAuthCode {
  code: string;
  userId: string;
  redirectUri: string;
  clientId?: string;
  codeChallenge?: string;
  codeChallengeMethod?: 'S256';
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
  clientId?: string;
  codeChallenge?: string;
  codeChallengeMethod?: 'S256';
  scope?: string;
  resource?: string; // RFC 8707 resource indicator
  expiresInSeconds?: number; // Default: 600 (10 minutes)
}

export interface CreateTokenParams {
  userId: string;
  scope?: string;
  resource?: string; // RFC 8707 resource indicator
  redirectUri?: string; // For deriving clientName
  clientId?: string; // Confidential OAuth client binding
  clientName?: string; // AI platform name (Claude, ChatGPT, etc.)
  expiresInSeconds?: number; // Default: 3600 (1 hour)
  includeRefreshToken?: boolean;
  refreshTokenExpiresInSeconds?: number; // Default: 31536000 (1 year)
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
  resource?: string | null;
  error?: string;
}

export const DEFAULT_OAUTH_ACCESS_TOKEN_TTL_SECONDS = 3600; // 1 hour
export const DEFAULT_OAUTH_REFRESH_TOKEN_TTL_SECONDS = 31536000; // 1 year
export const MIN_OAUTH_REFRESH_TOKEN_TTL_SECONDS = 3600; // 1 hour
export const MAX_OAUTH_REFRESH_TOKEN_TTL_SECONDS = 31536000; // 1 year

export interface OAuthStorageEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  OAUTH_REFRESH_TOKEN_TTL_SECONDS?: string;
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Verify PKCE code verifier against stored challenge
 * RFC 7636 requires code_verifier to be 43-128 characters, unreserved charset.
 */
async function verifyPkceChallenge(
  codeVerifier: string,
  codeChallenge: string,
  method: 'S256'
): Promise<boolean> {
  // RFC 7636 §4.1: code_verifier must use unreserved characters only
  if (!/^[A-Za-z0-9\-._~]+$/.test(codeVerifier)) {
    console.log('[oauth-storage] PKCE code_verifier contains invalid characters');
    return false;
  }

  // RFC 7636 §4.1: code_verifier must be 43-128 characters
  if (codeVerifier.length < 43 || codeVerifier.length > 128) {
    console.log(`[oauth-storage] PKCE code_verifier length out of range: ${codeVerifier.length}`);
    return false;
  }

  // S256: SHA-256 hash of verifier, base64url encoded
  const encoder = new TextEncoder();
  const data = encoder.encode(codeVerifier);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  const base64 = btoa(String.fromCharCode(...hashArray));
  const computed = base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  // Constant-time comparison to prevent timing attacks
  const computedBytes = encoder.encode(computed);
  const expectedBytes = encoder.encode(codeChallenge);
  if (computedBytes.length !== expectedBytes.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < computedBytes.length; i++) {
    result |= computedBytes[i] ^ expectedBytes[i];
  }
  return result === 0;
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

function isLoopbackHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

/**
 * Normalize redirect URI for equality checks.
 * OAuth loopback callbacks can use localhost or 127.0.0.1 interchangeably;
 * treat them as equivalent when scheme/port/path/query/hash are identical.
 */
function normalizeRedirectUriForComparison(redirectUri: string): string {
  try {
    const parsed = new URL(redirectUri);
    const hostname = parsed.hostname.toLowerCase();
    if (isLoopbackHostname(hostname)) {
      parsed.hostname = 'localhost';
      if (!parsed.port) {
        parsed.port = parsed.protocol === 'https:' ? '443' : '80';
      }
    }
    return parsed.toString();
  } catch {
    return redirectUri;
  }
}

function redirectUrisMatch(expectedRedirectUri: string, actualRedirectUri: string): boolean {
  return normalizeRedirectUriForComparison(expectedRedirectUri) === normalizeRedirectUriForComparison(actualRedirectUri);
}

// =============================================================================
// OAUTH STORAGE CLASS
// =============================================================================

export class OAuthStorage {
  private supabase: SupabaseClient;
  private refreshTokenTtlSeconds: number;

  constructor(supabaseUrl: string, supabaseKey: string, options?: { refreshTokenTtlSeconds?: number }) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.refreshTokenTtlSeconds = options?.refreshTokenTtlSeconds ?? DEFAULT_OAUTH_REFRESH_TOKEN_TTL_SECONDS;
  }

  // ---------------------------------------------------------------------------
  // AUTHORIZATION CODES
  // ---------------------------------------------------------------------------

  /**
   * Create and store a new authorization code
   */
  async createAuthorizationCode(params: CreateCodeParams): Promise<string> {
    const code = params.clientId && isConfidentialClientId(params.clientId)
      ? createClientBoundToken('mcp_ac', params.clientId, generateSecureToken(32))
      : generateSecureToken(32);
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
      console.log(
        `[oauth-storage] OAuth state lookup failed: state=${state.substring(0, 8)}..., found=${!!data}, error=${error?.message || 'none'}`
      );
      return false;
    }

    const expiresAt = new Date(data.expires_at);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      await this.supabase.from('oauth_states').delete().eq('state', state);
      console.log(`[oauth-storage] OAuth state expired: ${state.substring(0, 8)}...`);
      return false;
    }

    if (!redirectUrisMatch(data.redirect_uri, redirectUri)) {
      console.log(
        `[oauth-storage] OAuth state redirect URI mismatch: state=${state.substring(0, 8)}..., expected=${data.redirect_uri}, got=${redirectUri}`
      );
      return false;
    }

    if (clientId && data.client_id && data.client_id !== clientId) {
      console.log(
        `[oauth-storage] OAuth state client_id mismatch: state=${state.substring(0, 8)}..., expected=${data.client_id}, got=${clientId}`
      );
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
      clientId: getClientIdFromBoundToken('mcp_ac', data.code),
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
   *
   * Uses atomic claim (UPDATE ... WHERE used_at IS NULL) to prevent
   * race conditions where two concurrent requests exchange the same code.
   */
  async exchangeCodeForToken(
    code: string,
    redirectUri: string,
    codeVerifier?: string,
    clientId?: string
  ): Promise<OAuthToken | null> {
    // Atomically claim the code — only succeeds if not already used and not expired
    const { data, error } = await this.supabase
      .from('oauth_codes')
      .update({ used_at: new Date().toISOString() })
      .eq('code', code)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .select('*')
      .single();

    if (error || !data) {
      console.log(`[oauth-storage] Auth code not found, expired, or already used: ${code.substring(0, 8)}...`);
      return null;
    }

    const authCode: OAuthCode = {
      code: data.code,
      userId: data.user_id,
      redirectUri: data.redirect_uri,
      clientId: getClientIdFromBoundToken('mcp_ac', data.code),
      codeChallenge: data.code_challenge || undefined,
      codeChallengeMethod: data.code_challenge_method || undefined,
      scope: data.scope,
      resource: data.resource || undefined,
      expiresAt: new Date(data.expires_at),
    };

    // Validate redirect URI matches
    if (!redirectUrisMatch(authCode.redirectUri, redirectUri)) {
      console.log(`[oauth-storage] Redirect URI mismatch: expected ${authCode.redirectUri}, got ${redirectUri}`);
      return null; // Code is already burned — correct per RFC 6749 §4.1.2
    }

    if (authCode.clientId && authCode.clientId !== clientId) {
      // Code has already been consumed by the atomic claim above; this is
      // intentional so a mismatched confidential-client attempt cannot replay.
      console.log('[oauth-storage] Confidential client_id mismatch during auth code exchange; code consumed, returning invalid_grant');
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

    // Create and return access token
    const token = await this.createAccessToken({
      userId: authCode.userId,
      scope: authCode.scope,
      resource: authCode.resource, // RFC 8707 - pass through resource
      redirectUri: authCode.redirectUri, // For deriving clientName
      clientId: authCode.clientId,
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
    const expiresInSeconds = params.expiresInSeconds ?? DEFAULT_OAUTH_ACCESS_TOKEN_TTL_SECONDS; // 1 hour default
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    // Derive clientName from redirectUri if not explicitly provided
    const clientName = params.clientName || (params.redirectUri ? getClientNameFromRedirectUri(params.redirectUri) : 'MCP Client');

    let refreshToken: string | undefined;
    let refreshTokenExpiresAt: Date | undefined;

    if (params.includeRefreshToken) {
      const opaqueRefreshToken = generateSecureToken(32);
      refreshToken = params.clientId && isConfidentialClientId(params.clientId)
        ? createClientBoundToken('mcp_rt', params.clientId, opaqueRefreshToken)
        : opaqueRefreshToken;
      const refreshExpiresIn = params.refreshTokenExpiresInSeconds ?? this.refreshTokenTtlSeconds;
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
  async validateAccessToken(accessToken: string, expectedResource?: string): Promise<TokenValidationResult> {
    const { data, error } = await this.supabase
      .from('oauth_tokens')
      .select('user_id, scope, resource, expires_at, revoked_at')
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

    // Check resource/audience if stored
    if (expectedResource && data.resource && data.resource !== expectedResource) {
      return { valid: false, error: 'Token resource mismatch' };
    }

    return {
      valid: true,
      userId: data.user_id,
      scope: data.scope,
      resource: data.resource || null,
    };
  }

  /**
   * Refresh an access token using a refresh token
   */
  async refreshAccessToken(refreshToken: string, clientId?: string): Promise<OAuthToken | null> {
    const tokenClientId = getClientIdFromBoundToken('mcp_rt', refreshToken);
    if (tokenClientId && tokenClientId !== clientId) {
      console.log('[oauth-storage] Confidential client_id mismatch during refresh');
      return null;
    }

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
      clientId: tokenClientId,
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
   * Get all currently valid access tokens for a user.
   *
   * Connection status should use getRefreshableUserTokens so an idle MCP
   * client remains connected between one-hour access token refreshes.
   *
   * @deprecated Use getRefreshableUserTokens for connection status. This only
   * reflects current access-token validity.
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
   * Get all connections that can still be refreshed for a user.
   *
   * Returns raw token fields for server-side management. Do not expose returned
   * OAuthToken objects directly to clients.
   */
  async getRefreshableUserTokens(userId: string): Promise<OAuthToken[]> {
    const { data, error } = await this.supabase
      .from('oauth_tokens')
      .select('*')
      .eq('user_id', userId)
      .is('revoked_at', null)
      .not('refresh_token', 'is', null)
      .gt('refresh_token_expires_at', new Date().toISOString())
      .limit(50);

    if (error) {
      console.error('[oauth-storage] Failed to get refreshable user tokens:', error);
      return [];
    }

    if (!data) {
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
   * Check if a user has any active refreshable MCP OAuth connections.
   */
  async hasActiveConnection(userId: string): Promise<boolean> {
    const tokens = await this.getRefreshableUserTokens(userId);
    return tokens.length > 0;
  }

  // ---------------------------------------------------------------------------
  // FACTORY METHODS
  // ---------------------------------------------------------------------------

  /**
   * Create instance from environment variables
   */
  static fromEnvironment(env: OAuthStorageEnv): OAuthStorage {
    return new OAuthStorage(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
      refreshTokenTtlSeconds: parseRefreshTokenTtlSeconds(env.OAUTH_REFRESH_TOKEN_TTL_SECONDS),
    });
  }
}

function parseRefreshTokenTtlSeconds(value?: string): number {
  if (!value) {
    return DEFAULT_OAUTH_REFRESH_TOKEN_TTL_SECONDS;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(
      `[oauth-storage] Invalid OAUTH_REFRESH_TOKEN_TTL_SECONDS="${value}", using default ${DEFAULT_OAUTH_REFRESH_TOKEN_TTL_SECONDS}s`
    );
    return DEFAULT_OAUTH_REFRESH_TOKEN_TTL_SECONDS;
  }

  if (parsed < MIN_OAUTH_REFRESH_TOKEN_TTL_SECONDS) {
    console.warn(
      `[oauth-storage] OAUTH_REFRESH_TOKEN_TTL_SECONDS="${value}" is below minimum, clamping to ${MIN_OAUTH_REFRESH_TOKEN_TTL_SECONDS}s`
    );
    return MIN_OAUTH_REFRESH_TOKEN_TTL_SECONDS;
  }

  if (parsed > MAX_OAUTH_REFRESH_TOKEN_TTL_SECONDS) {
    console.warn(
      `[oauth-storage] OAUTH_REFRESH_TOKEN_TTL_SECONDS="${value}" exceeds max, clamping to ${MAX_OAUTH_REFRESH_TOKEN_TTL_SECONDS}s`
    );
    return MAX_OAUTH_REFRESH_TOKEN_TTL_SECONDS;
  }

  return Math.floor(parsed);
}
