/**
 * Extension Handlers (Clerk Auth)
 * ---------------------------------------------------------------------------
 * Handles extension sync + status for Clerk-authenticated requests.
 * Pairing code + extension token flows have been removed.
 */

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

interface ExtensionSyncBody {
  swid: string;
  s2: string;
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

function jsonResponse(body: Record<string, unknown>, status: number, corsHeaders: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

function parseSyncCredentialsBody(
  rawBody: unknown,
  corsHeaders: Record<string, string>
): { body?: ExtensionSyncBody; response?: Response } {
  if (!rawBody || typeof rawBody !== 'object') {
    return {
      response: jsonResponse({
        error: 'invalid_request',
        error_description: 'Invalid request body',
      }, 400, corsHeaders),
    };
  }

  const bodyRecord = rawBody as { swid?: unknown; s2?: unknown };
  if (typeof bodyRecord.swid !== 'string' || typeof bodyRecord.s2 !== 'string' || !bodyRecord.swid || !bodyRecord.s2) {
    return {
      response: jsonResponse({
        error: 'invalid_request',
        error_description: 'swid and s2 are required',
      }, 400, corsHeaders),
    };
  }

  if (!isValidSwid(bodyRecord.swid)) {
    return {
      response: jsonResponse({
        error: 'invalid_request',
        error_description: 'Invalid SWID format (expected UUID in curly braces)',
      }, 400, corsHeaders),
    };
  }

  if (!isValidS2(bodyRecord.s2)) {
    return {
      response: jsonResponse({
        error: 'invalid_request',
        error_description: 'Invalid espn_s2 format (too short)',
      }, 400, corsHeaders),
    };
  }

  return {
    body: {
      swid: bodyRecord.swid,
      s2: bodyRecord.s2,
    },
  };
}

// =============================================================================
// HANDLERS
// =============================================================================

/**
 * POST /extension/sync
 * Sync ESPN credentials from extension (Clerk auth required)
 */
export async function handleSyncCredentials(
  request: Request,
  env: ExtensionEnv,
  userId: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const rawBody = await request.json().catch(() => null);
    const parsedBody = parseSyncCredentialsBody(rawBody, corsHeaders);
    if (parsedBody.response) {
      return parsedBody.response;
    }
    const body = parsedBody.body!;

    // Store credentials
    const credStorage = EspnSupabaseStorage.fromEnvironment(env);
    const success = await credStorage.setCredentials(userId, body.swid, body.s2);

    if (!success) {
      return jsonResponse({
        error: 'server_error',
        error_description: 'Failed to store credentials',
      }, 500, corsHeaders);
    }

    console.log(`[extension] Credentials synced for ${maskUserId(userId)}`);

    return jsonResponse({
      success: true,
      message: 'Credentials synced successfully',
    }, 200, corsHeaders);
  } catch (error) {
    console.error('[extension] Failed to sync credentials:', error);
    return jsonResponse({
      error: 'server_error',
      error_description: 'Failed to sync credentials',
    }, 500, corsHeaders);
  }
}

/**
 * GET /extension/status
 * Check extension status (Clerk auth required)
 */
export async function handleGetExtensionStatus(
  env: ExtensionEnv,
  userId: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const credStorage = EspnSupabaseStorage.fromEnvironment(env);
    const hasCredentials = await credStorage.hasCredentials(userId);
    const metadata = await credStorage.getCredentialMetadata(userId);
    const preferences = await credStorage.getUserPreferences(userId);

    return new Response(JSON.stringify({
      success: true,
      connected: hasCredentials,
      hasCredentials,
      lastSync: metadata?.lastUpdated || null,
      preferences: {
        defaultSport: preferences.defaultSport,
        defaultFootball: preferences.defaultFootball,
        defaultBaseball: preferences.defaultBaseball,
        defaultBasketball: preferences.defaultBasketball,
        defaultHockey: preferences.defaultHockey,
      },
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
 * Web UI fallback status (Clerk auth required)
 * Returns connection based on stored credentials (no extension tokens).
 */
export async function handleGetConnection(
  env: ExtensionEnv,
  userId: string,
  corsHeaders: Record<string, string>
): Promise<Response> {
  try {
    const credStorage = EspnSupabaseStorage.fromEnvironment(env);
    const hasCredentials = await credStorage.hasCredentials(userId);
    const metadata = await credStorage.getCredentialMetadata(userId);

    return new Response(JSON.stringify({
      success: true,
      connected: hasCredentials,
      token: null,
      lastSync: metadata?.lastUpdated || null,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  } catch (error) {
    console.error('[extension] Failed to get connection status:', error);
    return new Response(JSON.stringify({
      error: 'server_error',
      error_description: 'Failed to get connection status',
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}
