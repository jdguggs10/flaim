/**
 * OAuth Storage - Supabase-based OAuth Code and Token Storage
 * ---------------------------------------------------------------------------
 *
 * Handles OAuth 2.1 authorization codes and access tokens for Claude
 * direct access via MCP connectors.
 *
 * Database contract: supabase/migrations/
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
import {
  isMissingTokenRpcError,
  legacyClaimMcpOAuthCode,
  legacyClaimMcpOAuthRefreshToken,
  legacyConsumeMcpOAuthState,
  legacyCreateMcpOAuthState,
  legacyFindMcpOAuthAccessToken,
  legacyRevokeMcpOAuthAccessToken,
  warnTokenRpcFallback,
} from './token-rpc-compat';

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
  grantType?: 'authorization_code' | 'refresh_token'; // Separates new connections from keepalive refreshes
}

export interface CreateStateParams {
  state: string;
  redirectUri: string;
  clientId?: string;
  scope: string;
  codeChallenge: string;
  resource?: string;
  expiresInSeconds?: number; // Default: 600 (10 minutes)
}

interface OAuthStateBindingInput {
  clientId?: string;
  scope: string;
  codeChallenge: string;
  resource?: string;
}

interface OAuthCodeClaimRow {
  user_id: string;
  redirect_uri: string;
  code_challenge: string | null;
  code_challenge_method: 'S256' | null;
  scope: string;
  resource: string | null;
  expires_at: string;
}

interface OAuthAccessTokenRow {
  user_id: string;
  scope: string;
  resource: string | null;
  client_name: string | null;
  expires_at: string;
  revoked_at: string | null;
}

interface OAuthRefreshTokenClaimRow {
  user_id: string;
  scope: string;
  resource: string | null;
  client_name: string | null;
}

const OAUTH_STATE_BINDING_PREFIX = 'oauth-state-v1:';

function encodeOAuthStateBinding(params: OAuthStateBindingInput): string {
  return `${OAUTH_STATE_BINDING_PREFIX}${JSON.stringify({
    clientId: params.clientId ?? null,
    scope: params.scope,
    codeChallenge: params.codeChallenge,
    resource: params.resource ?? null,
  })}`;
}

export interface TokenValidationResult {
  valid: boolean;
  userId?: string;
  scope?: string;
  resource?: string | null;
  clientName?: string | null;
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
  if (uri.includes('perplexity.ai') || uri.includes('perplexity.com')) return 'Perplexity';
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
    const encodedBinding = encodeOAuthStateBinding(params);

    let { data, error } = await this.supabase.rpc('create_mcp_oauth_state', {
      p_state: params.state,
      p_redirect_uri: params.redirectUri,
      // Reuse the internal text column so scope binding does not require a
      // schema migration. This value is never exposed as the OAuth client_id.
      p_binding: encodedBinding,
      p_expires_at: expiresAt.toISOString(),
    });

    if (isMissingTokenRpcError(error)) {
      warnTokenRpcFallback('create_mcp_oauth_state');
      ({ data, error } = await legacyCreateMcpOAuthState(this.supabase, {
        state: params.state,
        redirectUri: params.redirectUri,
        binding: encodedBinding,
        expiresAt: expiresAt.toISOString(),
      }));
    }

    if (error || data !== true) {
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
    clientId: string | undefined,
    scope: string,
    codeChallenge: string | undefined,
    resource: string | undefined
  ): Promise<boolean> {
    if (!codeChallenge) {
      return false;
    }

    const encodedBinding = encodeOAuthStateBinding({
      clientId,
      scope,
      codeChallenge,
      resource,
    });
    let { data, error } = await this.supabase.rpc('consume_mcp_oauth_state', {
      p_state: state,
      p_redirect_uri: redirectUri,
      p_binding: encodedBinding,
    });

    if (isMissingTokenRpcError(error)) {
      warnTokenRpcFallback('consume_mcp_oauth_state');
      ({ data, error } = await legacyConsumeMcpOAuthState(this.supabase, {
        state,
        redirectUri,
        binding: encodedBinding,
      }));
    }

    if (error || data !== true) {
      console.log(
        `[oauth-storage] OAuth state claim failed: state=${state.substring(0, 8)}..., claimed=${data === true ? 1 : 0}, error=${error?.message || 'none'}`
      );
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
    // Handler validation should reject this before storage, but keep this
    // pre-claim guard for direct/internal callers so a wrong client_id does
    // not burn an otherwise valid confidential authorization code.
    const boundClientId = getClientIdFromBoundToken('mcp_ac', code);
    if (boundClientId && boundClientId !== clientId) {
      console.log('[oauth-storage] Confidential client_id mismatch before auth code claim');
      return null;
    }

    // Atomically claim the code — only succeeds if not already used and not expired
    let { data, error } = await this.supabase
      .rpc('claim_mcp_oauth_code', { p_code: code })
      .maybeSingle();

    if (isMissingTokenRpcError(error)) {
      warnTokenRpcFallback('claim_mcp_oauth_code');
      ({ data, error } = await legacyClaimMcpOAuthCode(this.supabase, code));
    }

    if (error || !data) {
      console.log(`[oauth-storage] Auth code not found, expired, or already used: ${code.substring(0, 8)}...`);
      return null;
    }
    const claimedCode = data as OAuthCodeClaimRow;

    const authCode: OAuthCode = {
      code,
      userId: claimedCode.user_id,
      redirectUri: claimedCode.redirect_uri,
      clientId: boundClientId,
      codeChallenge: claimedCode.code_challenge || undefined,
      codeChallengeMethod: claimedCode.code_challenge_method || undefined,
      scope: claimedCode.scope,
      resource: claimedCode.resource || undefined,
      expiresAt: new Date(claimedCode.expires_at),
    };

    // Validate redirect URI matches
    if (!redirectUrisMatch(authCode.redirectUri, redirectUri)) {
      console.log(`[oauth-storage] Redirect URI mismatch: expected ${authCode.redirectUri}, got ${redirectUri}`);
      return null; // Code is already burned — correct per RFC 6749 §4.1.2
    }

    if (authCode.clientId && authCode.clientId !== clientId) {
      // Code has already been consumed by the atomic claim above; this is
      // intentional for replay safety if an internal caller bypassed the
      // pre-claim/handler binding checks.
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
      grantType: 'authorization_code',
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
      grant_type: params.grantType ?? null,
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
    let { data, error } = await this.supabase
      .rpc('find_mcp_oauth_access_token', { p_access_token: accessToken })
      .maybeSingle();

    if (isMissingTokenRpcError(error)) {
      warnTokenRpcFallback('find_mcp_oauth_access_token');
      ({ data, error } = await legacyFindMcpOAuthAccessToken(
        this.supabase,
        accessToken
      ));
    }

    if (error || !data) {
      return { valid: false, error: 'Token not found' };
    }
    const tokenRow = data as OAuthAccessTokenRow;

    // Check if revoked
    if (tokenRow.revoked_at) {
      return { valid: false, error: 'Token has been revoked' };
    }

    // Check if expired
    if (new Date(tokenRow.expires_at) < new Date()) {
      return { valid: false, error: 'Token has expired' };
    }

    // Check resource/audience if stored
    if (expectedResource && tokenRow.resource && tokenRow.resource !== expectedResource) {
      return { valid: false, error: 'Token resource mismatch' };
    }

    return {
      valid: true,
      userId: tokenRow.user_id,
      scope: tokenRow.scope,
      resource: tokenRow.resource || null,
      clientName: tokenRow.client_name || null,
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

    let { data, error } = await this.supabase
      .rpc('claim_mcp_oauth_refresh_token', { p_refresh_token: refreshToken })
      .maybeSingle();

    if (isMissingTokenRpcError(error)) {
      warnTokenRpcFallback('claim_mcp_oauth_refresh_token');
      ({ data, error } = await legacyClaimMcpOAuthRefreshToken(
        this.supabase,
        refreshToken
      ));
    }

    if (error || !data) {
      console.log('[oauth-storage] Refresh token not found, expired, or already used');
      return null;
    }
    const claimedToken = data as OAuthRefreshTokenClaimRow;

    // Create new token with same scope, resource, and clientName
    const newToken = await this.createAccessToken({
      userId: claimedToken.user_id,
      scope: claimedToken.scope,
      resource: claimedToken.resource || undefined, // Preserve resource for audience validation
      clientId: tokenClientId,
      clientName: claimedToken.client_name || undefined, // Preserve clientName
      includeRefreshToken: true,
      grantType: 'refresh_token',
    });

    return newToken;
  }

  /**
   * Revoke an access token
   */
  async revokeToken(accessToken: string): Promise<boolean> {
    let { data, error } = await this.supabase.rpc('revoke_mcp_oauth_access_token', {
      p_access_token: accessToken,
    });

    if (isMissingTokenRpcError(error)) {
      warnTokenRpcFallback('revoke_mcp_oauth_access_token');
      ({ data, error } = await legacyRevokeMcpOAuthAccessToken(
        this.supabase,
        accessToken
      ));
    }

    if (error || data !== true) {
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
