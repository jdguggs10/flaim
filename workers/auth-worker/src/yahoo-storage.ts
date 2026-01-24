/**
 * Yahoo Storage - Supabase-based storage for Yahoo OAuth credentials and leagues
 * ---------------------------------------------------------------------------
 *
 * Handles platform OAuth state (CSRF protection), Yahoo OAuth credentials,
 * and discovered Yahoo Fantasy leagues.
 *
 * Tables required (see docs/migrations/009_yahoo_platform.sql):
 * - platform_oauth_states: CSRF protection for platform OAuth flows
 * - yahoo_credentials: OAuth tokens for Yahoo Fantasy API access
 * - yahoo_leagues: Discovered Yahoo Fantasy leagues
 *
 * @version 1.0.0
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// =============================================================================
// TYPES
// =============================================================================

export type Platform = 'yahoo' | 'sleeper' | 'cbs';
export type Sport = 'football' | 'baseball' | 'basketball' | 'hockey';

export interface PlatformOAuthState {
  clerkUserId: string;
  platform: Platform;
  redirectAfter?: string;
}

export interface CreateStateParams {
  state: string;
  clerkUserId: string;
  platform: Platform;
  redirectAfter?: string;
  expiresInSeconds?: number; // Default: 600 (10 minutes)
}

export interface YahooCredentials {
  clerkUserId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  yahooGuid?: string;
  needsRefresh: boolean;
}

export interface SaveCredentialsParams {
  clerkUserId: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  yahooGuid?: string;
}

export interface UpdateCredentialsParams {
  accessToken: string;
  refreshToken?: string;
  expiresAt: Date;
}

export interface YahooLeague {
  id: string;
  clerkUserId: string;
  sport: Sport;
  seasonYear: number;
  leagueKey: string;
  leagueName: string;
  teamId?: string;
  teamKey?: string;
  isDefault: boolean;
}

export interface SaveLeagueParams {
  clerkUserId: string;
  sport: Sport;
  seasonYear: number;
  leagueKey: string;
  leagueName: string;
  teamId?: string;
  teamKey?: string;
  isDefault?: boolean;
}

// =============================================================================
// UTILITIES
// =============================================================================

/**
 * 5-minute buffer for token refresh
 * Tokens expiring within this window should be proactively refreshed
 */
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

/**
 * Mask user ID for logging
 */
function maskUserId(userId: string): string {
  if (!userId || userId.length <= 8) return '***';
  return `${userId.substring(0, 8)}...`;
}

// =============================================================================
// YAHOO STORAGE CLASS
// =============================================================================

export class YahooStorage {
  private supabase: SupabaseClient;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  // ---------------------------------------------------------------------------
  // PLATFORM OAUTH STATE (CSRF PROTECTION)
  // ---------------------------------------------------------------------------

  /**
   * Store OAuth state for platform OAuth flows (Yahoo, Sleeper, etc.)
   * Separate from MCP OAuth states
   */
  async createPlatformOAuthState(params: CreateStateParams): Promise<void> {
    const expiresInSeconds = params.expiresInSeconds ?? 600; // 10 minutes default
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    const { error } = await this.supabase.from('platform_oauth_states').insert({
      state: params.state,
      clerk_user_id: params.clerkUserId,
      platform: params.platform,
      redirect_after: params.redirectAfter || null,
      expires_at: expiresAt.toISOString(),
    });

    if (error) {
      console.error('[yahoo-storage] Failed to create platform OAuth state:', error);
      throw new Error('Failed to create platform OAuth state');
    }

    console.log(`[yahoo-storage] Created OAuth state for ${params.platform}, user ${maskUserId(params.clerkUserId)}`);
  }

  /**
   * Consume OAuth state (single-use) and return associated data
   * Returns null if state is invalid, expired, or doesn't exist
   */
  async consumePlatformOAuthState(state: string): Promise<PlatformOAuthState | null> {
    const { data, error } = await this.supabase
      .from('platform_oauth_states')
      .select('state, clerk_user_id, platform, redirect_after, expires_at')
      .eq('state', state)
      .single();

    if (error || !data) {
      console.log(`[yahoo-storage] OAuth state not found: ${state.substring(0, 8)}...`);
      return null;
    }

    // Always delete the state (single-use)
    await this.supabase.from('platform_oauth_states').delete().eq('state', state);

    // Check if expired
    const expiresAt = new Date(data.expires_at);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() < Date.now()) {
      console.log(`[yahoo-storage] OAuth state expired: ${state.substring(0, 8)}...`);
      return null;
    }

    return {
      clerkUserId: data.clerk_user_id,
      platform: data.platform as Platform,
      redirectAfter: data.redirect_after || undefined,
    };
  }

  // ---------------------------------------------------------------------------
  // YAHOO CREDENTIALS
  // ---------------------------------------------------------------------------

  /**
   * Save or update Yahoo OAuth credentials for a user
   */
  async saveYahooCredentials(params: SaveCredentialsParams): Promise<void> {
    const { error } = await this.supabase.from('yahoo_credentials').upsert(
      {
        clerk_user_id: params.clerkUserId,
        access_token: params.accessToken,
        refresh_token: params.refreshToken,
        expires_at: params.expiresAt.toISOString(),
        yahoo_guid: params.yahooGuid || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'clerk_user_id' }
    );

    if (error) {
      console.error('[yahoo-storage] Failed to save Yahoo credentials:', error);
      throw new Error('Failed to save Yahoo credentials');
    }

    console.log(`[yahoo-storage] Saved Yahoo credentials for user ${maskUserId(params.clerkUserId)}`);
  }

  /**
   * Get Yahoo credentials for a user
   * Includes needsRefresh flag based on 5-minute buffer
   */
  async getYahooCredentials(clerkUserId: string): Promise<YahooCredentials | null> {
    const { data, error } = await this.supabase
      .from('yahoo_credentials')
      .select('clerk_user_id, access_token, refresh_token, expires_at, yahoo_guid')
      .eq('clerk_user_id', clerkUserId)
      .single();

    if (error || !data) {
      return null;
    }

    const expiresAt = new Date(data.expires_at);
    const needsRefresh = expiresAt.getTime() - Date.now() < REFRESH_BUFFER_MS;

    return {
      clerkUserId: data.clerk_user_id,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt,
      yahooGuid: data.yahoo_guid || undefined,
      needsRefresh,
    };
  }

  /**
   * Update Yahoo credentials after token refresh
   */
  async updateYahooCredentials(
    clerkUserId: string,
    params: UpdateCredentialsParams
  ): Promise<void> {
    const updateData: Record<string, string> = {
      access_token: params.accessToken,
      expires_at: params.expiresAt.toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (params.refreshToken) {
      updateData.refresh_token = params.refreshToken;
    }

    const { error } = await this.supabase
      .from('yahoo_credentials')
      .update(updateData)
      .eq('clerk_user_id', clerkUserId);

    if (error) {
      console.error('[yahoo-storage] Failed to update Yahoo credentials:', error);
      throw new Error('Failed to update Yahoo credentials');
    }

    console.log(`[yahoo-storage] Updated Yahoo credentials for user ${maskUserId(clerkUserId)}`);
  }

  /**
   * Delete Yahoo credentials for a user
   */
  async deleteYahooCredentials(clerkUserId: string): Promise<void> {
    const { error } = await this.supabase
      .from('yahoo_credentials')
      .delete()
      .eq('clerk_user_id', clerkUserId);

    if (error) {
      console.error('[yahoo-storage] Failed to delete Yahoo credentials:', error);
      throw new Error('Failed to delete Yahoo credentials');
    }

    console.log(`[yahoo-storage] Deleted Yahoo credentials for user ${maskUserId(clerkUserId)}`);
  }

  /**
   * Check if a user has Yahoo credentials (quick existence check)
   */
  async hasYahooCredentials(clerkUserId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('yahoo_credentials')
      .select('clerk_user_id')
      .eq('clerk_user_id', clerkUserId)
      .single();

    return !error && data !== null;
  }

  // ---------------------------------------------------------------------------
  // YAHOO LEAGUES
  // ---------------------------------------------------------------------------

  /**
   * Upsert a Yahoo league (insert or update on conflict)
   * Returns the league ID
   */
  async upsertYahooLeague(params: SaveLeagueParams): Promise<string> {
    const { data, error } = await this.supabase
      .from('yahoo_leagues')
      .upsert(
        {
          clerk_user_id: params.clerkUserId,
          sport: params.sport,
          season_year: params.seasonYear,
          league_key: params.leagueKey,
          league_name: params.leagueName,
          team_id: params.teamId || null,
          team_key: params.teamKey || null,
          is_default: params.isDefault ?? false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'clerk_user_id,league_key,season_year' }
      )
      .select('id')
      .single();

    if (error) {
      console.error('[yahoo-storage] Failed to upsert Yahoo league:', error);
      throw new Error('Failed to upsert Yahoo league');
    }

    return data.id;
  }

  /**
   * Get all Yahoo leagues for a user
   */
  async getYahooLeagues(clerkUserId: string): Promise<YahooLeague[]> {
    const { data, error } = await this.supabase
      .from('yahoo_leagues')
      .select('*')
      .eq('clerk_user_id', clerkUserId);

    if (error || !data) {
      return [];
    }

    return data.map((row) => ({
      id: row.id,
      clerkUserId: row.clerk_user_id,
      sport: row.sport as Sport,
      seasonYear: row.season_year,
      leagueKey: row.league_key,
      leagueName: row.league_name,
      teamId: row.team_id || undefined,
      teamKey: row.team_key || undefined,
      isDefault: row.is_default,
    }));
  }

  /**
   * Set a league as the default for a user
   * Clears any existing default first
   */
  async setDefaultYahooLeague(clerkUserId: string, leagueId: string): Promise<void> {
    // Clear existing defaults for this user
    const { error: clearError } = await this.supabase
      .from('yahoo_leagues')
      .update({ is_default: false })
      .eq('clerk_user_id', clerkUserId);

    if (clearError) {
      console.error('[yahoo-storage] Failed to clear default Yahoo league:', clearError);
      throw new Error('Failed to clear default Yahoo league');
    }

    // Set new default
    const { error: setError } = await this.supabase
      .from('yahoo_leagues')
      .update({ is_default: true })
      .eq('id', leagueId);

    if (setError) {
      console.error('[yahoo-storage] Failed to set default Yahoo league:', setError);
      throw new Error('Failed to set default Yahoo league');
    }

    console.log(`[yahoo-storage] Set default Yahoo league ${leagueId} for user ${maskUserId(clerkUserId)}`);
  }

  /**
   * Delete a specific Yahoo league
   */
  async deleteYahooLeague(clerkUserId: string, leagueId: string): Promise<void> {
    const { error } = await this.supabase
      .from('yahoo_leagues')
      .delete()
      .eq('clerk_user_id', clerkUserId)
      .eq('id', leagueId);

    if (error) {
      console.error('[yahoo-storage] Failed to delete Yahoo league:', error);
      throw new Error('Failed to delete Yahoo league');
    }

    console.log(`[yahoo-storage] Deleted Yahoo league ${leagueId} for user ${maskUserId(clerkUserId)}`);
  }

  /**
   * Delete all Yahoo leagues for a user
   */
  async deleteAllYahooLeagues(clerkUserId: string): Promise<void> {
    const { error } = await this.supabase
      .from('yahoo_leagues')
      .delete()
      .eq('clerk_user_id', clerkUserId);

    if (error) {
      console.error('[yahoo-storage] Failed to delete all Yahoo leagues:', error);
      throw new Error('Failed to delete all Yahoo leagues');
    }

    console.log(`[yahoo-storage] Deleted all Yahoo leagues for user ${maskUserId(clerkUserId)}`);
  }

  // ---------------------------------------------------------------------------
  // FACTORY METHODS
  // ---------------------------------------------------------------------------

  /**
   * Create instance from environment variables
   */
  static fromEnvironment(env: { SUPABASE_URL: string; SUPABASE_SERVICE_KEY: string }): YahooStorage {
    return new YahooStorage(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  }
}
