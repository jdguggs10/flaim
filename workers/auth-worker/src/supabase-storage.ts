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
        .upsert({
          clerk_user_id: clerkUserId,
          swid,
          s2,
          email,
          updated_at: new Date().toISOString()
        });

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
      if (!clerkUserId) return null;

      const { data, error } = await this.supabase
        .from('espn_credentials')
        .select('swid, s2')
        .eq('clerk_user_id', clerkUserId)
        .single();

      if (error || !data) return null;

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
   */
  async getCredentialMetadata(clerkUserId: string): Promise<{ hasCredentials: boolean; email?: string; lastUpdated?: string } | null> {
    try {
      if (!clerkUserId) return null;

      const { data, error } = await this.supabase
        .from('espn_credentials')
        .select('email, updated_at')
        .eq('clerk_user_id', clerkUserId)
        .single();

      if (error || !data) {
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
        .select('id')
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
        seasonYear: row.season_year || undefined
      }));
    } catch (error) {
      console.error('Failed to retrieve ESPN leagues:', error);
      return [];
    }
  }

  /**
   * Add a single league to user's collection
   */
  async addLeague(clerkUserId: string, league: EspnLeague): Promise<boolean> {
    try {
      const existingLeagues = await this.getLeagues(clerkUserId);
      
      // Check for duplicates
      const isDuplicate = existingLeagues.some(
        existing => existing.leagueId === league.leagueId && existing.sport === league.sport
      );
      
      if (isDuplicate) {
        throw new Error(`League ${league.leagueId} for ${league.sport} already exists`);
      }
      
      // Check league limit
      if (existingLeagues.length >= 10) {
        throw new Error('Maximum of 10 leagues allowed per user');
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
          season_year: league.seasonYear || null
        });

      if (error) {
        console.error('Supabase error adding league:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Failed to add ESPN league:', error);
      return false;
    }
  }

  /**
   * Remove a league from user's collection
   */
  async removeLeague(clerkUserId: string, leagueId: string, sport: string): Promise<boolean> {
    try {
      const { error } = await this.supabase
        .from('espn_leagues')
        .delete()
        .eq('clerk_user_id', clerkUserId)
        .eq('league_id', leagueId)
        .eq('sport', sport);

      if (error) {
        console.error('Supabase error removing league:', error);
        return false;
      }

      return true;
    } catch (error) {
      console.error('Failed to remove ESPN league:', error);
      return false;
    }
  }

  /**
   * Update a specific league (e.g., add teamId after auto-pull)
   */
  async updateLeague(clerkUserId: string, leagueId: string, updates: Partial<EspnLeague>): Promise<boolean> {
    try {
      const updateData: any = {};
      
      if (updates.teamId !== undefined) updateData.team_id = updates.teamId;
      if (updates.teamName !== undefined) updateData.team_name = updates.teamName;
      if (updates.leagueName !== undefined) updateData.league_name = updates.leagueName;
      if (updates.seasonYear !== undefined) updateData.season_year = updates.seasonYear;

      const { error } = await this.supabase
        .from('espn_leagues')
        .update(updateData)
        .eq('clerk_user_id', clerkUserId)
        .eq('league_id', leagueId);

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