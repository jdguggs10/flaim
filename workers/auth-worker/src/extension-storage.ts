/**
 * Extension Storage - Supabase-based Extension Pairing and Token Storage
 * ---------------------------------------------------------------------------
 *
 * Handles Chrome extension pairing codes and access tokens for automatic
 * ESPN credential capture.
 *
 * Tables required (see docs/migrations/005_extension_tables.sql):
 * - extension_pairing_codes: Short-lived pairing codes (10 min expiry)
 * - extension_tokens: Long-lived extension access tokens
 *
 * @version 1.0.0
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// =============================================================================
// TYPES
// =============================================================================

export interface ExtensionPairingCode {
  code: string;
  userId: string;
  expiresAt: Date;
  usedAt?: Date;
}

export interface ExtensionToken {
  id: string;
  token: string;
  userId: string;
  name?: string;
  createdAt: Date;
  lastUsedAt?: Date;
  revokedAt?: Date;
}

export interface TokenValidationResult {
  valid: boolean;
  userId?: string;
  tokenId?: string;
  error?: string;
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * Character set for pairing codes (no ambiguous chars like 0/O, 1/I/L)
 */
const CODE_CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * Generate a 6-character pairing code
 */
function generatePairingCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARSET[bytes[i] % CODE_CHARSET.length];
  }
  return code;
}

/**
 * Generate a cryptographically secure token (32 bytes, hex encoded)
 */
function generateSecureToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Mask user ID for logging
 */
function maskUserId(userId: string): string {
  if (!userId || userId.length <= 8) return '***';
  return `${userId.substring(0, 8)}...`;
}

// =============================================================================
// EXTENSION STORAGE CLASS
// =============================================================================

export class ExtensionStorage {
  private supabase: SupabaseClient;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  // ---------------------------------------------------------------------------
  // PAIRING CODES
  // ---------------------------------------------------------------------------

  /**
   * Create a new pairing code for a user
   * Deletes any existing unused codes for the user first
   */
  async createPairingCode(userId: string): Promise<{ code: string; expiresAt: Date }> {
    // Delete any existing unused codes for this user
    await this.supabase
      .from('extension_pairing_codes')
      .delete()
      .eq('clerk_user_id', userId)
      .is('used_at', null);

    // Generate new code with 10 minute expiry
    const code = generatePairingCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    const { error } = await this.supabase.from('extension_pairing_codes').insert({
      clerk_user_id: userId,
      code,
      expires_at: expiresAt.toISOString(),
    });

    if (error) {
      console.error(`[extension-storage] Failed to create pairing code for ${maskUserId(userId)}:`, error);
      throw new Error('Failed to create pairing code');
    }

    console.log(`[extension-storage] Created pairing code for ${maskUserId(userId)}, expires at ${expiresAt.toISOString()}`);
    return { code, expiresAt };
  }

  /**
   * Get and validate a pairing code
   */
  async getPairingCode(code: string): Promise<ExtensionPairingCode | null> {
    const { data, error } = await this.supabase
      .from('extension_pairing_codes')
      .select('code, clerk_user_id, expires_at, used_at')
      .eq('code', code.toUpperCase())
      .single();

    if (error || !data) {
      return null;
    }

    return {
      code: data.code,
      userId: data.clerk_user_id,
      expiresAt: new Date(data.expires_at),
      usedAt: data.used_at ? new Date(data.used_at) : undefined,
    };
  }

  /**
   * Mark a pairing code as used (atomic operation)
   * Returns true only if exactly 1 row was updated, preventing race conditions
   */
  async markCodeAsUsed(code: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('extension_pairing_codes')
      .update({ used_at: new Date().toISOString() })
      .eq('code', code.toUpperCase())
      .is('used_at', null)
      .select('id');

    if (error) {
      console.error(`[extension-storage] Failed to mark code as used:`, error);
      return false;
    }

    // Verify exactly 1 row was updated (prevents race condition)
    if (!data || data.length !== 1) {
      console.log(`[extension-storage] Code already used or not found: ${code} (rows affected: ${data?.length ?? 0})`);
      return false;
    }

    return true;
  }

  // ---------------------------------------------------------------------------
  // EXTENSION TOKENS
  // ---------------------------------------------------------------------------

  /**
   * Exchange a pairing code for an access token
   * Revokes any existing tokens for the user first (token rotation)
   */
  async exchangeCodeForToken(code: string): Promise<{
    success: true; token: string; userId: string
  } | {
    success: false; reason: 'not_found' | 'expired' | 'already_used' | 'race_condition' | 'storage_error'
  }> {
    // Validate the code
    const pairingCode = await this.getPairingCode(code);
    if (!pairingCode) {
      console.log(`[extension-storage] Code not found: ${code}`);
      return { success: false, reason: 'not_found' };
    }

    // Check if code is expired
    if (new Date() > pairingCode.expiresAt) {
      console.log(`[extension-storage] Code expired: ${code}`);
      return { success: false, reason: 'expired' };
    }

    // Check if code is already used
    if (pairingCode.usedAt) {
      console.log(`[extension-storage] Code already used: ${code}`);
      return { success: false, reason: 'already_used' };
    }

    // Mark code as used
    const marked = await this.markCodeAsUsed(code);
    if (!marked) {
      return { success: false, reason: 'race_condition' };
    }

    // Revoke any existing active tokens for this user (token rotation)
    await this.supabase
      .from('extension_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('clerk_user_id', pairingCode.userId)
      .is('revoked_at', null);

    // Generate and store new token
    const token = generateSecureToken();
    const { error } = await this.supabase.from('extension_tokens').insert({
      clerk_user_id: pairingCode.userId,
      token,
    });

    if (error) {
      console.error(`[extension-storage] Failed to create token for ${maskUserId(pairingCode.userId)}:`, error);
      return { success: false, reason: 'storage_error' };
    }

    console.log(`[extension-storage] Token created for ${maskUserId(pairingCode.userId)}`);
    return { success: true, token, userId: pairingCode.userId };
  }

  /**
   * Validate an extension token and return user ID
   */
  async validateToken(token: string): Promise<TokenValidationResult> {
    const { data, error } = await this.supabase
      .from('extension_tokens')
      .select('id, clerk_user_id, revoked_at')
      .eq('token', token)
      .single();

    if (error || !data) {
      return { valid: false, error: 'Token not found' };
    }

    if (data.revoked_at) {
      return { valid: false, error: 'Token revoked' };
    }

    return {
      valid: true,
      userId: data.clerk_user_id,
      tokenId: data.id,
    };
  }

  /**
   * Update token's last_used_at timestamp
   */
  async updateTokenLastUsed(token: string): Promise<void> {
    await this.supabase
      .from('extension_tokens')
      .update({ last_used_at: new Date().toISOString() })
      .eq('token', token);
  }

  /**
   * Revoke a specific token by ID
   */
  async revokeToken(tokenId: string, userId: string): Promise<boolean> {
    const { error } = await this.supabase
      .from('extension_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', tokenId)
      .eq('clerk_user_id', userId)
      .is('revoked_at', null);

    if (error) {
      console.error(`[extension-storage] Failed to revoke token:`, error);
      return false;
    }

    console.log(`[extension-storage] Token ${tokenId} revoked for ${maskUserId(userId)}`);
    return true;
  }

  /**
   * Get active token for a user (for status page)
   */
  async getActiveToken(userId: string): Promise<ExtensionToken | null> {
    const { data, error } = await this.supabase
      .from('extension_tokens')
      .select('id, token, clerk_user_id, name, created_at, last_used_at, revoked_at')
      .eq('clerk_user_id', userId)
      .is('revoked_at', null)
      .single();

    if (error || !data) {
      return null;
    }

    return {
      id: data.id,
      token: data.token,
      userId: data.clerk_user_id,
      name: data.name,
      createdAt: new Date(data.created_at),
      lastUsedAt: data.last_used_at ? new Date(data.last_used_at) : undefined,
      revokedAt: data.revoked_at ? new Date(data.revoked_at) : undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // FACTORY
  // ---------------------------------------------------------------------------

  static fromEnvironment(env: { SUPABASE_URL: string; SUPABASE_SERVICE_KEY: string }): ExtensionStorage {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
      throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
    }
    return new ExtensionStorage(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  }
}
