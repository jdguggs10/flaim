/**
 * Supabase-based ESPN Credential Storage
 * ---------------------------------------------------------------------------
 *
 * Replaces Cloudflare KV storage with Supabase PostgreSQL for credential storage.
 * Provides the same interface as the previous KV implementation (archived) for seamless replacement.
 *
 * Environment Variables Required:
 * - SUPABASE_URL: Project URL (https://your-project-ref.supabase.co)
 * - SUPABASE_SERVICE_KEY: Service role key for full access
 *
 * @version 1.0 - Supabase implementation
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { EspnCredentials, EspnCredentialsWithMetadata, EspnLeague, EspnUserData } from './espn-types';
import { isCurrentSeason, type SeasonSport } from './season-utils';

/**
 * Mask user ID for logging to avoid PII exposure
 * Shows first 8 chars + "..." for debugging while protecting privacy
 */
function maskUserId(userId: string): string {
  if (!userId || userId.length <= 8) return '***';
  return `${userId.substring(0, 8)}...`;
}

export interface SupabaseStorageOptions {
  supabaseUrl: string;
  supabaseKey: string;
  // For Workers, use service role key
  // For client-side, use anon key with RLS
}

// Environment interface for compatibility
export interface SupabaseEnvironment {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

export interface LeagueDefault {
  platform: 'espn' | 'yahoo';
  leagueId: string;
  seasonYear: number;
}

export interface UserPreferences {
  clerkUserId: string;
  defaultSport: 'football' | 'baseball' | 'basketball' | 'hockey' | null;
  defaultFootball: LeagueDefault | null;
  defaultBaseball: LeagueDefault | null;
  defaultBasketball: LeagueDefault | null;
  defaultHockey: LeagueDefault | null;
}

export class EspnSupabaseStorage {
  private supabase: SupabaseClient;

  constructor(options: SupabaseStorageOptions) {
    this.supabase = createClient(options.supabaseUrl, options.supabaseKey);
  }

  // =============================================================================
  // CREDENTIAL OPERATIONS
  // =============================================================================

  /**
   * Store ESPN credentials for a user
   */
  async setCredentials(clerkUserId: string, swid: string, s2: string, email?: string): Promise<boolean> {
    try {
      if (!clerkUserId || !swid || !s2) {
        throw new Error('Missing required parameters: clerkUserId, swid, s2');
      }

      const { error } = await this.supabase
        .from('espn_credentials')
        .upsert(
          {
            clerk_user_id: clerkUserId,
            swid,
            s2,
            email,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'clerk_user_id' }
        );

      if (error) {
        console.error('Supabase error storing credentials:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Failed to store ESPN credentials:', error);
      return false;
    }
  }

  /**
   * Store ESPN credentials for a user (backward compatibility method)
   */
  async setEspnCredentialsForUser(clerkUserId: string, credentials: { swid: string; espn_s2: string; email?: string }): Promise<boolean> {
    return this.setCredentials(clerkUserId, credentials.swid, credentials.espn_s2, credentials.email);
  }

  /**
   * Retrieve ESPN credentials for a user
   */
  async getCredentials(clerkUserId: string): Promise<EspnCredentials | null> {
    try {
      if (!clerkUserId) {
        console.log('[supabase-storage] getCredentials: no clerkUserId provided');
        return null;
      }

      console.log(`[supabase-storage] getCredentials: fetching for user ${maskUserId(clerkUserId)}`);

      const { data, error } = await this.supabase
        .from('espn_credentials')
        .select('swid, s2')
        .eq('clerk_user_id', clerkUserId)
        .maybeSingle();

      if (error) {
        console.error(`[supabase-storage] getCredentials error:`, error.code, error.message);
        return null;
      }

      if (!data) {
        console.log(`[supabase-storage] getCredentials: no data returned`);
        return null;
      }

      console.log(`[supabase-storage] getCredentials: found data, swid length=${data.swid?.length || 0}, s2 length=${data.s2?.length || 0}`);

      if (!data.swid || !data.s2) {
        console.log(`[supabase-storage] getCredentials: swid or s2 is empty/null`);
        return null;
      }

      return {
        swid: data.swid,
        s2: data.s2
      };
    } catch (error) {
      console.error('Failed to retrieve ESPN credentials:', error);
      return null;
    }
  }

  /**
   * Get full credential metadata (without sensitive data)
   * Note: Also checks that swid and s2 are non-empty to ensure consistency
   * with getCredentials() which returns null if swid/s2 are missing.
   */
  async getCredentialMetadata(clerkUserId: string): Promise<{ hasCredentials: boolean; email?: string; lastUpdated?: string } | null> {
    try {
      if (!clerkUserId) {
        console.log('[supabase-storage] getCredentialMetadata: no clerkUserId provided');
        return null;
      }

      console.log(`[supabase-storage] getCredentialMetadata: checking for user ${maskUserId(clerkUserId)}`);

      // Select swid and s2 to verify credentials are actually present (not just an empty row)
      const { data, error } = await this.supabase
        .from('espn_credentials')
        .select('email, updated_at, swid, s2')
        .eq('clerk_user_id', clerkUserId)
        .maybeSingle();

      if (error) {
        console.error(`[supabase-storage] getCredentialMetadata error:`, error.code, error.message);
        return { hasCredentials: false };
      }

      if (!data) {
        console.log(`[supabase-storage] getCredentialMetadata: no data returned`);
        return { hasCredentials: false };
      }

      // Check that swid and s2 are actually present and non-empty
      // This ensures consistency with getCredentials() which returns null if these are missing
      const hasValidCredentials = !!(data.swid && data.s2);
      
      console.log(`[supabase-storage] getCredentialMetadata: found record, hasValidCredentials=${hasValidCredentials}, hasEmail=${!!data.email}, updated_at=${data.updated_at}`);

      if (!hasValidCredentials) {
        console.log(`[supabase-storage] getCredentialMetadata: row exists but swid or s2 is empty/null`);
        return { hasCredentials: false };
      }

      return {
        hasCredentials: true,
        email: data.email || undefined,
        lastUpdated: data.updated_at
      };
    } catch (error) {
      console.error('Failed to get credential metadata:', error);
      return { hasCredentials: false };
    }
  }

  /**
   * Check if user has credentials without retrieving them
   */
  async hasCredentials(clerkUserId: string): Promise<boolean> {
    try {
      if (!clerkUserId) return false;

      const { data, error } = await this.supabase
        .from('espn_credentials')
        .select('clerk_user_id')
        .eq('clerk_user_id', clerkUserId)
        .single();

      return !error && !!data;
    } catch (error) {
      return false;
    }
  }

  /**
   * Delete ESPN credentials for a user
   */
  async deleteCredentials(clerkUserId: string): Promise<boolean> {
    try {
      if (!clerkUserId) return false;

      const { error: credError } = await this.supabase
        .from('espn_credentials')
        .delete()
        .eq('clerk_user_id', clerkUserId);

      const { error: leagueError } = await this.supabase
        .from('espn_leagues')
        .delete()
        .eq('clerk_user_id', clerkUserId);

      return !credError && !leagueError;
    } catch (error) {
      console.error('Failed to delete ESPN credentials:', error);
      return false;
    }
  }

  // =============================================================================
  // LEAGUE MANAGEMENT OPERATIONS
  // =============================================================================

  /**
   * Store league IDs and sports for a user (backward compatibility)
   */
  async setUserLeagues(clerkUserId: string, leagues: Array<{ leagueId: string; sport: string }>): Promise<boolean> {
    const espnLeagues: EspnLeague[] = leagues.map(league => ({
      leagueId: league.leagueId,
      sport: league.sport as 'football' | 'hockey' | 'baseball' | 'basketball'
    }));
    return this.setLeagues(clerkUserId, espnLeagues);
  }

  /**
   * Retrieve user leagues (backward compatibility)
   */
  async getUserLeagues(clerkUserId: string): Promise<Array<{ leagueId: string; sport: string }> | null> {
    const leagues = await this.getLeagues(clerkUserId);
    if (!leagues || leagues.length === 0) return null;

    return leagues.map(league => ({
      leagueId: league.leagueId,
      sport: league.sport
    }));
  }

  /**
   * Store ESPN leagues for a user
   */
  async setLeagues(clerkUserId: string, leagues: EspnLeague[]): Promise<boolean> {
    try {
      if (!clerkUserId) return false;

      if (leagues.length > 10) {
        throw new Error('Maximum of 10 leagues allowed per user');
      }

      // First, delete existing leagues for this user
      await this.supabase
        .from('espn_leagues')
        .delete()
        .eq('clerk_user_id', clerkUserId);

      // If no leagues to insert, we're done
      if (leagues.length === 0) {
        return true;
      }

      // Then insert new leagues
      const leagueData = leagues.map(league => ({
        clerk_user_id: clerkUserId,
        league_id: league.leagueId,
        sport: league.sport,
        team_id: league.teamId || null,
        team_name: league.teamName || null,
        league_name: league.leagueName || null,
        season_year: league.seasonYear || null
      }));

      const { error } = await this.supabase
        .from('espn_leagues')
        .insert(leagueData);

      if (error) {
        console.error('Supabase error storing leagues:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Failed to store ESPN leagues:', error);
      return false;
    }
  }

  /**
   * Retrieve ESPN leagues for a user
   */
  async getLeagues(clerkUserId: string): Promise<EspnLeague[]> {
    try {
      if (!clerkUserId) return [];

      const { data, error } = await this.supabase
        .from('espn_leagues')
        .select('league_id, sport, team_id, team_name, league_name, season_year')
        .eq('clerk_user_id', clerkUserId);

      if (error || !data) return [];

      return data.map(row => ({
        leagueId: row.league_id,
        sport: row.sport as 'football' | 'hockey' | 'baseball' | 'basketball',
        teamId: row.team_id || undefined,
        teamName: row.team_name || undefined,
        leagueName: row.league_name || undefined,
        seasonYear: row.season_year || undefined,
      }));
    } catch (error) {
      console.error('Failed to retrieve ESPN leagues:', error);
      return [];
    }
  }


  /**
   * Check if a specific league already exists for a user
   * Used by extension discovery to avoid duplicates
   */
  async leagueExists(
    clerkUserId: string,
    sport: string,
    leagueId: string,
    seasonYear: number
  ): Promise<boolean> {
    try {
      if (!clerkUserId) return false;

      const { data, error } = await this.supabase
        .from('espn_leagues')
        .select('id')
        .eq('clerk_user_id', clerkUserId)
        .eq('sport', sport)
        .eq('league_id', leagueId)
        .eq('season_year', seasonYear)
        .single();

      return !error && !!data;
    } catch (error) {
      console.error('Failed to check if league exists:', error);
      return false;
    }
  }

  /**
   * Get current season leagues for a user (for default dropdown)
   * Returns leagues where seasonYear matches the current season for their sport.
   * Uses sport-specific rollover logic (America/New_York timezone).
   */
  async getCurrentSeasonLeagues(clerkUserId: string): Promise<EspnLeague[]> {
    try {
      if (!clerkUserId) return [];

      const allLeagues = await this.getLeagues(clerkUserId);

      // Filter to current season leagues only using sport-specific rollover rules
      return allLeagues.filter(league => {
        if (!league.seasonYear || !league.sport) return false;
        return isCurrentSeason(league.sport as SeasonSport, league.seasonYear);
      });
    } catch (error) {
      console.error('Failed to get current season leagues:', error);
      return [];
    }
  }

  /**
   * Add a single league to user's collection
   * Returns result object with success flag and optional error code
   */
  async addLeague(clerkUserId: string, league: EspnLeague): Promise<{ success: boolean; code?: 'DUPLICATE' | 'LIMIT_EXCEEDED' | 'DB_ERROR'; error?: string }> {
    try {
      const existingLeagues = await this.getLeagues(clerkUserId);

      // Check for duplicates (including seasonYear for multi-season support)
      const isDuplicate = existingLeagues.some(
        existing => existing.leagueId === league.leagueId
          && existing.sport === league.sport
          && existing.seasonYear === league.seasonYear
      );

      if (isDuplicate) {
        return {
          success: false,
          code: 'DUPLICATE',
          error: `League ${league.leagueId} for ${league.sport} season ${league.seasonYear} already exists`
        };
      }

      // Check league limit
      if (existingLeagues.length >= 10) {
        return {
          success: false,
          code: 'LIMIT_EXCEEDED',
          error: 'Maximum of 10 leagues allowed per user'
        };
      }

      const { error } = await this.supabase
        .from('espn_leagues')
        .insert({
          clerk_user_id: clerkUserId,
          league_id: league.leagueId,
          sport: league.sport,
          team_id: league.teamId || null,
          team_name: league.teamName || null,
          league_name: league.leagueName || null,
          season_year: league.seasonYear || null,
        });

      if (error) {
        console.error('Supabase error adding league:', error);
        return { success: false, code: 'DB_ERROR', error: 'Database error' };
      }

      return { success: true };
    } catch (error) {
      console.error('Failed to add ESPN league:', error);
      return { success: false, code: 'DB_ERROR', error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Remove a league from user's collection.
   * Always deletes ALL seasons for the given leagueId + sport.
   * Returns true only if at least one row was actually deleted.
   */
  async removeLeague(clerkUserId: string, leagueId: string, sport: string): Promise<boolean> {
    try {
      console.log(`[removeLeague] Attempting delete: userId=${maskUserId(clerkUserId)}, leagueId=${leagueId}, sport=${sport}`);

      const { data, error } = await this.supabase
        .from('espn_leagues')
        .delete()
        .eq('clerk_user_id', clerkUserId)
        .eq('league_id', leagueId)
        .eq('sport', sport)
        .select('id, league_id, sport, season_year');

      if (error) {
        console.error('[removeLeague] Supabase error:', error);
        return false;
      }

      const deletedCount = data?.length ?? 0;
      console.log(`[removeLeague] Deleted ${deletedCount} row(s) for leagueId=${leagueId}, sport=${sport}`);

      if (deletedCount === 0) {
        console.warn(`[removeLeague] No rows matched for userId=${maskUserId(clerkUserId)}, leagueId=${leagueId}, sport=${sport}`);
        return false;
      }

      return true;
    } catch (error) {
      console.error('[removeLeague] Failed to remove ESPN league:', error);
      return false;
    }
  }

  /**
   * Update a specific league (e.g., add teamId after auto-pull)
   * Requires sport and seasonYear to uniquely target a row in multi-season context.
   */
  async updateLeague(
    clerkUserId: string,
    leagueId: string,
    sport: string,
    seasonYear: number | undefined,
    updates: Partial<Omit<EspnLeague, 'leagueId' | 'sport' | 'seasonYear'>>
  ): Promise<boolean> {
    try {
      const updateData: any = {};

      if (updates.teamId !== undefined) updateData.team_id = updates.teamId;
      if (updates.teamName !== undefined) updateData.team_name = updates.teamName;
      if (updates.leagueName !== undefined) updateData.league_name = updates.leagueName;

      let query = this.supabase
        .from('espn_leagues')
        .update(updateData)
        .eq('clerk_user_id', clerkUserId)
        .eq('league_id', leagueId)
        .eq('sport', sport);

      // If seasonYear provided, target that specific season; otherwise target null season_year rows (legacy)
      if (seasonYear !== undefined) {
        query = query.eq('season_year', seasonYear);
      } else {
        query = query.is('season_year', null);
      }

      const { error } = await query;

      if (error) {
        console.error('Supabase error updating league:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Failed to update ESPN league:', error);
      return false;
    }
  }

  /**
   * Set a league as the user's default for a sport.
   * Validates the league exists and has a team selected before setting.
   * Stores the default in user_preferences (not in the league table).
   */
  async setDefaultLeague(
    clerkUserId: string,
    platform: 'espn' | 'yahoo',
    sport: 'football' | 'baseball' | 'basketball' | 'hockey',
    leagueId: string,
    seasonYear: number
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // Validate the league exists and has a team_id (ESPN only for now)
      if (platform === 'espn') {
        const { data: targetLeague, error: checkError } = await this.supabase
          .from('espn_leagues')
          .select('league_id, team_id')
          .eq('clerk_user_id', clerkUserId)
          .eq('league_id', leagueId)
          .eq('sport', sport)
          .eq('season_year', seasonYear)
          .single();

        if (checkError || !targetLeague) {
          console.error('ESPN league not found for default:', checkError);
          return { success: false, error: 'League not found' };
        }

        if (!targetLeague.team_id) {
          return { success: false, error: 'Cannot set default: no team selected for this league' };
        }
      }
      // Note: Yahoo validation could be added here if needed

      // Build the default object
      const defaultValue: LeagueDefault = { platform, leagueId, seasonYear };
      const columnName = `default_${sport}`;

      // Upsert into user_preferences
      const { error: upsertError } = await this.supabase
        .from('user_preferences')
        .upsert(
          {
            clerk_user_id: clerkUserId,
            [columnName]: defaultValue,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'clerk_user_id' }
        );

      if (upsertError) {
        console.error('[supabase-storage] setDefaultLeague upsert error:', upsertError);
        return { success: false, error: 'Failed to set default' };
      }

      console.log(`[supabase-storage] setDefaultLeague: set ${sport} default to ${platform}:${leagueId}:${seasonYear} for user ${maskUserId(clerkUserId)}`);
      return { success: true };
    } catch (error) {
      console.error('Failed to set default league:', error);
      return { success: false, error: 'Internal error' };
    }
  }

  /**
   * Clear a user's default for a sport
   */
  async clearDefaultLeague(
    clerkUserId: string,
    sport: 'football' | 'baseball' | 'basketball' | 'hockey'
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const columnName = `default_${sport}`;

      const { error } = await this.supabase
        .from('user_preferences')
        .upsert(
          {
            clerk_user_id: clerkUserId,
            [columnName]: null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'clerk_user_id' }
        );

      if (error) {
        console.error('[supabase-storage] clearDefaultLeague error:', error);
        return { success: false, error: 'Failed to clear default' };
      }

      console.log(`[supabase-storage] clearDefaultLeague: cleared ${sport} default for user ${maskUserId(clerkUserId)}`);
      return { success: true };
    } catch (error) {
      console.error('Failed to clear default league:', error);
      return { success: false, error: 'Internal error' };
    }
  }

  /**
   * Get user preferences
   */
  async getUserPreferences(clerkUserId: string): Promise<UserPreferences> {
    if (!clerkUserId) {
      console.log('[supabase-storage] getUserPreferences: no clerkUserId provided');
      return {
        clerkUserId: '',
        defaultSport: null,
        defaultFootball: null,
        defaultBaseball: null,
        defaultBasketball: null,
        defaultHockey: null,
      };
    }

    try {
      console.log(`[supabase-storage] getUserPreferences: fetching for user ${maskUserId(clerkUserId)}`);

      const { data, error } = await this.supabase
        .from('user_preferences')
        .select('clerk_user_id, default_sport, default_football, default_baseball, default_basketball, default_hockey')
        .eq('clerk_user_id', clerkUserId)
        .single();

      if (error || !data) {
        console.log(`[supabase-storage] getUserPreferences: no preferences found, returning defaults`);
        return {
          clerkUserId,
          defaultSport: null,
          defaultFootball: null,
          defaultBaseball: null,
          defaultBasketball: null,
          defaultHockey: null,
        };
      }

      console.log(`[supabase-storage] getUserPreferences: found defaultSport=${data.default_sport}`);

      return {
        clerkUserId: data.clerk_user_id,
        defaultSport: data.default_sport,
        defaultFootball: data.default_football as LeagueDefault | null,
        defaultBaseball: data.default_baseball as LeagueDefault | null,
        defaultBasketball: data.default_basketball as LeagueDefault | null,
        defaultHockey: data.default_hockey as LeagueDefault | null,
      };
    } catch (error) {
      console.error('[supabase-storage] getUserPreferences error:', error);
      return {
        clerkUserId,
        defaultSport: null,
        defaultFootball: null,
        defaultBaseball: null,
        defaultBasketball: null,
        defaultHockey: null,
      };
    }
  }

  /**
   * Set user's default sport
   * Returns success/error object to match setDefaultLeague pattern
   */
  async setDefaultSport(
    clerkUserId: string,
    sport: 'football' | 'baseball' | 'basketball' | 'hockey' | null
  ): Promise<{ success: boolean; error?: string }> {
    if (!clerkUserId) {
      console.log('[supabase-storage] setDefaultSport: no clerkUserId provided');
      return { success: false, error: 'Missing clerkUserId' };
    }

    try {
      const { error } = await this.supabase
        .from('user_preferences')
        .upsert(
          {
            clerk_user_id: clerkUserId,
            default_sport: sport,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'clerk_user_id' }
        );

      if (error) {
        console.error('[supabase-storage] setDefaultSport error:', error);
        return { success: false, error: 'Failed to set default sport' };
      }

      console.log(`[supabase-storage] setDefaultSport: set to ${sport} for user ${maskUserId(clerkUserId)}`);
      return { success: true };
    } catch (error) {
      console.error('[supabase-storage] setDefaultSport error:', error);
      return { success: false, error: 'Internal error' };
    }
  }

  /**
   * Get setup status for the chat app inline banner
   * Returns whether user has credentials, leagues, and a default team
   */
  async getSetupStatus(clerkUserId: string): Promise<{
    hasCredentials: boolean;
    hasLeagues: boolean;
    hasDefaultTeam: boolean;
  }> {
    try {
      // Get credential status
      const credMetadata = await this.getCredentialMetadata(clerkUserId);
      const hasCredentials = credMetadata?.hasCredentials || false;

      // Get leagues and preferences in parallel
      const [leagues, preferences] = await Promise.all([
        this.getLeagues(clerkUserId),
        this.getUserPreferences(clerkUserId),
      ]);
      const hasLeagues = leagues.length > 0;

      // Check if any sport has a default set
      const hasDefaultTeam = !!(
        preferences.defaultFootball ||
        preferences.defaultBaseball ||
        preferences.defaultBasketball ||
        preferences.defaultHockey
      );

      return {
        hasCredentials,
        hasLeagues,
        hasDefaultTeam
      };
    } catch (error) {
      console.error('Failed to get setup status:', error);
      return {
        hasCredentials: false,
        hasLeagues: false,
        hasDefaultTeam: false
      };
    }
  }

  // =============================================================================
  // UTILITY METHODS
  // =============================================================================

  /**
   * Get all data for a user (credentials + leagues)
   */
  async getUserData(clerkUserId: string): Promise<{
    hasCredentials: boolean;
    leagues: EspnLeague[];
    metadata?: any
  }> {
    try {
      const [hasCredentials, leagues, metadata] = await Promise.all([
        this.hasCredentials(clerkUserId),
        this.getLeagues(clerkUserId),
        this.getCredentialMetadata(clerkUserId)
      ]);

      return {
        hasCredentials,
        leagues,
        metadata
      };
    } catch (error) {
      console.error('Failed to get user data:', error);
      return {
        hasCredentials: false,
        leagues: []
      };
    }
  }

  // =============================================================================
  // STATIC FACTORY METHODS
  // =============================================================================

  /**
   * Create instance from Cloudflare Worker environment
   */
  static fromEnvironment(env: SupabaseEnvironment): EspnSupabaseStorage {
    return new EspnSupabaseStorage({
      supabaseUrl: env.SUPABASE_URL,
      supabaseKey: env.SUPABASE_SERVICE_KEY
    });
  }

  /**
   * Create instance for MCP workers
   */
  static async getCredentialsForMcp(env: SupabaseEnvironment, clerkUserId: string): Promise<EspnCredentials | null> {
    const storage = new EspnSupabaseStorage({
      supabaseUrl: env.SUPABASE_URL,
      supabaseKey: env.SUPABASE_SERVICE_KEY
    });
    return await storage.getCredentials(clerkUserId);
  }
}
