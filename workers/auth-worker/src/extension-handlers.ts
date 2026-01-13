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

    // Store credentials
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
    const defaultLeague = await credStorage.getDefaultLeague(userId);

    return new Response(JSON.stringify({
      success: true,
      connected: true,
      hasCredentials,
      lastSync: metadata?.lastUpdated || null,
      defaultLeague: defaultLeague
        ? {
            sport: defaultLeague.sport,
            leagueId: defaultLeague.leagueId,
            leagueName: defaultLeague.leagueName || null,
            teamName: defaultLeague.teamName || null,
            teamId: defaultLeague.teamId || null,
            seasonYear: defaultLeague.seasonYear || null,
          }
        : null,
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
