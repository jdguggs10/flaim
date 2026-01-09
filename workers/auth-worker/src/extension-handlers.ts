/**
 * Extension Handlers for Chrome Extension Authentication
 * ---------------------------------------------------------------------------
 *
 * Handles pairing code generation, token exchange, and credential sync
 * for the Flaim Chrome extension.
 *
 * Flow:
 * 1. User generates pairing code on flaim.app/extension (requires Clerk auth)
 * 2. User enters code in extension popup
 * 3. Extension exchanges code for permanent token
 * 4. Extension uses token to sync ESPN credentials
 *
 * @version 1.0.0
 */

import { ExtensionStorage } from './extension-storage';
import { EspnSupabaseStorage } from './supabase-storage';

// =============================================================================
// TYPES
// =============================================================================

export interface ExtensionEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  NODE_ENV?: string;
  ENVIRONMENT?: string;
}

// =============================================================================
// RATE LIMITING
// =============================================================================

interface RateLimitEntry {
  attempts: number;
  firstAttempt: number;
}

// In-memory rate limiter for pairing attempts
// Note: Resets on worker restart, which is acceptable for basic protection
const pairingAttempts = new Map<string, RateLimitEntry>();

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_PAIRING_ATTEMPTS = 10;
const MAX_CODE_GENERATION_PER_HOUR = 5;

// In-memory rate limiter for code generation
const codeGenerationAttempts = new Map<string, RateLimitEntry>();
const CODE_GEN_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Check if a user is rate limited for code generation
 */
function checkCodeGenerationRateLimit(userId: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = codeGenerationAttempts.get(userId);

  if (!entry) {
    return { allowed: true };
  }

  // Window expired - reset
  if (now - entry.firstAttempt > CODE_GEN_WINDOW_MS) {
    codeGenerationAttempts.delete(userId);
    return { allowed: true };
  }

  // Check if over limit
  if (entry.attempts >= MAX_CODE_GENERATION_PER_HOUR) {
    const retryAfter = Math.ceil((entry.firstAttempt + CODE_GEN_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfter };
  }

  return { allowed: true };
}

/**
 * Record a code generation for a user
 */
function recordCodeGeneration(userId: string): void {
  const now = Date.now();
  const entry = codeGenerationAttempts.get(userId);

  if (!entry || now - entry.firstAttempt > CODE_GEN_WINDOW_MS) {
    codeGenerationAttempts.set(userId, { attempts: 1, firstAttempt: now });
  } else {
    entry.attempts++;
  }
}

/**
 * Check if an IP is rate limited for pairing attempts
 */
function checkPairingRateLimit(ip: string): { allowed: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = pairingAttempts.get(ip);

  if (!entry) {
    return { allowed: true };
  }

  // Window expired - reset
  if (now - entry.firstAttempt > RATE_LIMIT_WINDOW_MS) {
    pairingAttempts.delete(ip);
    return { allowed: true };
  }

  // Check if over limit
  if (entry.attempts >= MAX_PAIRING_ATTEMPTS) {
    const retryAfter = Math.ceil((entry.firstAttempt + RATE_LIMIT_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfter };
  }

  return { allowed: true };
}

/**
 * Record a failed pairing attempt for an IP
 */
function recordPairingAttempt(ip: string): void {
  const now = Date.now();
  const entry = pairingAttempts.get(ip);

  if (!entry || now - entry.firstAttempt > RATE_LIMIT_WINDOW_MS) {
    pairingAttempts.set(ip, { attempts: 1, firstAttempt: now });
  } else {
    entry.attempts++;
  }

  // Cleanup old entries periodically (every 100 new entries)
  if (pairingAttempts.size > 100) {
    for (const [key, val] of pairingAttempts.entries()) {
      if (now - val.firstAttempt > RATE_LIMIT_WINDOW_MS) {
        pairingAttempts.delete(key);
      }
    }
  }
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Mask user ID for logging
 */
function maskUserId(userId: string): string {
  if (!userId || userId.length <= 8) return '***';
  return `${userId.substring(0, 8)}...`;
}

/**
 * Validate SWID format (UUID in curly braces)
 */
function isValidSwid(swid: string): boolean {
  return /^\{[0-9A-Fa-f-]{36}\}$/.test(swid);
}

/**
 * Validate espn_s2 format (minimum length)
 */
function isValidS2(s2: string): boolean {
  return s2.length >= 50;
}

// =============================================================================
// HANDLERS
// =============================================================================

/**
 * POST /extension/code
 * Generate a new pairing code for the authenticated user
 * Rate limited to 5 codes per hour per user
 */
export async function handleCreatePairingCode(
  env: ExtensionEnv,
  userId: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  // Check rate limit
  const rateLimit = checkCodeGenerationRateLimit(userId);
  if (!rateLimit.allowed) {
    console.log(`[extension] Code generation rate limit exceeded for ${maskUserId(userId)}`);
    return new Response(JSON.stringify({
      error: 'rate_limited',
      error_description: 'Too many code generation attempts. Please try again later.',
    }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(rateLimit.retryAfter || 3600),
        ...corsHeaders,
      },
    });
  }

  try {
    const storage = ExtensionStorage.fromEnvironment(env);
    const { code, expiresAt } = await storage.createPairingCode(userId);

    // Record successful generation
    recordCodeGeneration(userId);

    const expiresInSeconds = Math.floor((expiresAt.getTime() - Date.now()) / 1000);

    console.log(`[extension] Pairing code created for ${maskUserId(userId)}`);

    return new Response(JSON.stringify({
      success: true,
      code,
      expiresAt: expiresAt.toISOString(),
      expiresInSeconds,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (error) {
    console.error('[extension] Failed to create pairing code:', error);
    return new Response(JSON.stringify({
      error: 'server_error',
      error_description: 'Failed to create pairing code',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}

/**
 * POST /extension/pair
 * Exchange a pairing code for an access token
 * No authentication required - the code IS the authentication
 * Rate limited to prevent brute-force attacks
 */
export async function handlePairExtension(
  request: Request,
  env: ExtensionEnv,
  corsHeaders: Record<string, string>
): Promise<Response> {
  // Get client IP for rate limiting
  const clientIP = request.headers.get('CF-Connecting-IP') ||
                   request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
                   'unknown';

  // Check rate limit before processing
  const rateLimit = checkPairingRateLimit(clientIP);
  if (!rateLimit.allowed) {
    console.log(`[extension] Rate limit exceeded for IP ${clientIP}`);
    return new Response(JSON.stringify({
      error: 'rate_limited',
      error_description: 'Too many pairing attempts. Please try again later.',
    }), {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(rateLimit.retryAfter || 600),
        ...corsHeaders,
      },
    });
  }

  try {
    const body = await request.json() as { code?: string; deviceName?: string };

    if (!body.code) {
      recordPairingAttempt(clientIP);
      return new Response(JSON.stringify({
        error: 'invalid_request',
        error_description: 'code is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Validate code format (6 uppercase alphanumeric)
    const code = body.code.toUpperCase().trim();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      recordPairingAttempt(clientIP);
      return new Response(JSON.stringify({
        error: 'invalid_request',
        error_description: 'Invalid code format',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const storage = ExtensionStorage.fromEnvironment(env);
    const name = body.deviceName?.trim();
    const safeName = name ? name.slice(0, 64) : undefined;
    const result = await storage.exchangeCodeForToken(code, safeName);

    if (!result.success) {
      // Record failed attempt
      recordPairingAttempt(clientIP);

      // Return specific error messages based on reason
      const errorMessages: Record<string, string> = {
        'expired': 'This code has expired. Please generate a new one.',
        'not_found': 'Invalid code. Please check and try again.',
        'already_used': 'This code has already been used. Please generate a new one.',
        'race_condition': 'This code was just used. Please generate a new one.',
        'storage_error': 'Failed to create token. Please try again.',
      };

      return new Response(JSON.stringify({
        error: result.reason === 'expired' ? 'code_expired' : 'invalid_code',
        error_description: errorMessages[result.reason] || 'Invalid pairing code',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    console.log(`[extension] Extension paired for ${maskUserId(result.userId)}`);

    return new Response(JSON.stringify({
      success: true,
      token: result.token,
      userId: result.userId,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (error) {
    console.error('[extension] Failed to pair extension:', error);
    recordPairingAttempt(clientIP);
    return new Response(JSON.stringify({
      error: 'server_error',
      error_description: 'Failed to pair extension',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}

/**
 * POST /extension/sync
 * Sync ESPN credentials from extension
 * Requires Bearer token authentication
 */
export async function handleSyncCredentials(
  request: Request,
  env: ExtensionEnv,
  userId: string,
  token: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const body = await request.json() as { swid?: string; s2?: string };

    // Validate required fields
    if (!body.swid || !body.s2) {
      return new Response(JSON.stringify({
        error: 'invalid_request',
        error_description: 'swid and s2 are required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Validate credential formats
    if (!isValidSwid(body.swid)) {
      return new Response(JSON.stringify({
        error: 'invalid_request',
        error_description: 'Invalid SWID format (expected UUID in curly braces)',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    if (!isValidS2(body.s2)) {
      return new Response(JSON.stringify({
        error: 'invalid_request',
        error_description: 'Invalid espn_s2 format (too short)',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Store credentials using existing storage
    const credStorage = EspnSupabaseStorage.fromEnvironment(env);
    const success = await credStorage.setCredentials(userId, body.swid, body.s2);

    if (!success) {
      return new Response(JSON.stringify({
        error: 'server_error',
        error_description: 'Failed to store credentials',
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    // Update token last_used_at
    const extStorage = ExtensionStorage.fromEnvironment(env);
    await extStorage.updateTokenLastUsed(token);

    console.log(`[extension] Credentials synced for ${maskUserId(userId)}`);

    return new Response(JSON.stringify({
      success: true,
      message: 'Credentials synced successfully',
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (error) {
    console.error('[extension] Failed to sync credentials:', error);
    return new Response(JSON.stringify({
      error: 'server_error',
      error_description: 'Failed to sync credentials',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}

/**
 * GET /extension/status
 * Check extension connection status
 * Requires Bearer token authentication
 */
export async function handleGetExtensionStatus(
  env: ExtensionEnv,
  userId: string,
  token: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    // Update token last_used_at
    const extStorage = ExtensionStorage.fromEnvironment(env);
    await extStorage.updateTokenLastUsed(token);

    // Check if user has credentials
    const credStorage = EspnSupabaseStorage.fromEnvironment(env);
    const hasCredentials = await credStorage.hasCredentials(userId);
    const metadata = await credStorage.getCredentialMetadata(userId);

    return new Response(JSON.stringify({
      success: true,
      connected: true,
      hasCredentials,
      lastSync: metadata?.lastUpdated || null,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (error) {
    console.error('[extension] Failed to get status:', error);
    return new Response(JSON.stringify({
      error: 'server_error',
      error_description: 'Failed to get status',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}

/**
 * GET /extension/connection
 * Get active extension connection for a user (for web UI)
 * Requires Clerk authentication
 */
export async function handleGetConnection(
  env: ExtensionEnv,
  userId: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const storage = ExtensionStorage.fromEnvironment(env);
    const activeToken = await storage.getActiveToken(userId);

    if (!activeToken) {
      return new Response(JSON.stringify({
        success: true,
        connected: false,
        token: null,
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      connected: true,
      token: {
        id: activeToken.id,
        createdAt: activeToken.createdAt.toISOString(),
        lastUsedAt: activeToken.lastUsedAt?.toISOString() || null,
        name: activeToken.name || null,
      },
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (error) {
    console.error('[extension] Failed to get connection:', error);
    return new Response(JSON.stringify({
      error: 'server_error',
      error_description: 'Failed to get connection status',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}

/**
 * DELETE /extension/token
 * Revoke an extension token
 * Requires Clerk authentication
 */
export async function handleRevokeToken(
  request: Request,
  env: ExtensionEnv,
  userId: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const body = await request.json() as { tokenId?: string };

    if (!body.tokenId) {
      return new Response(JSON.stringify({
        error: 'invalid_request',
        error_description: 'tokenId is required',
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    const storage = ExtensionStorage.fromEnvironment(env);
    const success = await storage.revokeToken(body.tokenId, userId);

    if (!success) {
      return new Response(JSON.stringify({
        error: 'not_found',
        error_description: 'Token not found or already revoked',
      }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    console.log(`[extension] Token revoked for ${maskUserId(userId)}`);

    return new Response(JSON.stringify({
      success: true,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (error) {
    console.error('[extension] Failed to revoke token:', error);
    return new Response(JSON.stringify({
      error: 'server_error',
      error_description: 'Failed to revoke token',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}

/**
 * Validate extension token from Authorization header
 * Returns userId and token if valid
 */
export async function validateExtensionToken(
  request: Request,
  env: ExtensionEnv
): Promise<{ valid: boolean; userId?: string; token?: string; error?: string }> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.toLowerCase().startsWith('bearer ')) {
    return { valid: false, error: 'Missing Authorization header' };
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return { valid: false, error: 'Empty token' };
  }

  // Check if this looks like an extension token (64 hex chars)
  if (!/^[a-f0-9]{64}$/i.test(token)) {
    return { valid: false, error: 'Invalid token format' };
  }

  const storage = ExtensionStorage.fromEnvironment(env);
  const result = await storage.validateToken(token);

  if (!result.valid) {
    return { valid: false, error: result.error };
  }

  return { valid: true, userId: result.userId, token };
}
