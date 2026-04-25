import { createClient } from '@supabase/supabase-js';
import { clearDefaultsForLeague as _clearDefaultsForLeague, clearDefaultsForPlatform as _clearDefaultsForPlatform } from './preference-defaults';

function maskUserId(userId: string): string {
  if (!userId || userId.length <= 8) return '***';
  return `${userId.substring(0, 8)}...`;
}

interface SleeperStorageEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

interface SleeperConnectionRow {
  clerk_user_id: string;
  sleeper_user_id: string;
  sleeper_username: string | null;
  created_at: string;
  updated_at: string;
}

interface SleeperLeagueRow {
  id: string;
  clerk_user_id: string;
  league_id: string;
  sport: string;
  season_year: number;
  league_name: string;
  roster_id: number | null;
  recurring_league_id?: string | null;
  sleeper_user_id: string;
  created_at: string;
  updated_at: string;
}

interface SupabaseErrorLike {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

export interface SleeperLeague {
  id: string;
  clerkUserId: string;
  leagueId: string;
  sport: string;
  seasonYear: number;
  leagueName: string;
  rosterId: number | null;
  recurringLeagueId?: string;
  sleeperUserId: string;
}

function isMissingRecurringLeagueIdColumnError(error: SupabaseErrorLike | null | undefined): boolean {
  return error?.code === '42703' || error?.code === 'PGRST204';
}

export class SleeperStorage {
  private supabase;
  private recurringLeagueIdColumnStatus: 'unknown' | 'available' | 'missing' = 'unknown';

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  static fromEnvironment(env: SleeperStorageEnv): SleeperStorage {
    return new SleeperStorage(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  }

  async getSleeperConnection(clerkUserId: string): Promise<{ sleeperUserId: string; sleeperUsername: string | null; updatedAt?: string } | null> {
    const { data, error } = await this.supabase
      .from('sleeper_connections')
      .select('sleeper_user_id, sleeper_username, updated_at')
      .eq('clerk_user_id', clerkUserId)
      .single();

    if (error || !data) return null;
    return {
      sleeperUserId: (data as SleeperConnectionRow).sleeper_user_id,
      sleeperUsername: (data as SleeperConnectionRow).sleeper_username,
      updatedAt: (data as SleeperConnectionRow).updated_at,
    };
  }

  async saveSleeperConnection(clerkUserId: string, sleeperUserId: string, sleeperUsername: string | null): Promise<void> {
    const { error } = await this.supabase
      .from('sleeper_connections')
      .upsert({
        clerk_user_id: clerkUserId,
        sleeper_user_id: sleeperUserId,
        sleeper_username: sleeperUsername,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'clerk_user_id' });

    if (error) throw new Error(`Failed to save Sleeper connection: ${error.message}`);
  }

  async deleteSleeperConnection(clerkUserId: string): Promise<void> {
    // Delete leagues first (no FK cascade)
    await this.deleteAllSleeperLeagues(clerkUserId);

    const { error } = await this.supabase
      .from('sleeper_connections')
      .delete()
      .eq('clerk_user_id', clerkUserId);

    if (error) throw new Error(`Failed to delete Sleeper connection: ${error.message}`);
  }

  async getSleeperLeagues(clerkUserId: string): Promise<SleeperLeague[]> {
    const { data, error } = await this.supabase
      .from('sleeper_leagues')
      .select('*')
      .eq('clerk_user_id', clerkUserId)
      .order('season_year', { ascending: false });

    if (error) throw new Error(`Failed to get Sleeper leagues: ${error.message}`);
    if (!data) return [];

    return (data as SleeperLeagueRow[]).map((row) => ({
      id: row.id,
      clerkUserId: row.clerk_user_id,
      leagueId: row.league_id,
      sport: row.sport,
      seasonYear: row.season_year,
      leagueName: row.league_name,
      rosterId: row.roster_id,
      recurringLeagueId: row.recurring_league_id ?? undefined,
      sleeperUserId: row.sleeper_user_id,
    }));
  }

  async saveSleeperLeague(league: {
    clerkUserId: string;
    leagueId: string;
    sport: string;
    seasonYear: number;
    leagueName: string;
    rosterId: number | null;
    recurringLeagueId?: string;
    sleeperUserId: string;
  }): Promise<void> {
    const basePayload = {
      clerk_user_id: league.clerkUserId,
      league_id: league.leagueId,
      sport: league.sport,
      season_year: league.seasonYear,
      league_name: league.leagueName,
      roster_id: league.rosterId,
      sleeper_user_id: league.sleeperUserId,
      updated_at: new Date().toISOString(),
    };

    if (league.recurringLeagueId && this.recurringLeagueIdColumnStatus !== 'missing') {
      const error = await this.upsertSleeperLeagueRow({
        ...basePayload,
        recurring_league_id: league.recurringLeagueId,
      });

      if (!error) {
        this.recurringLeagueIdColumnStatus = 'available';
        return;
      }

      if (!isMissingRecurringLeagueIdColumnError(error)) {
        throw new Error(`Failed to save Sleeper league: ${error.message}`);
      }

      console.warn(
        `[sleeper-storage] recurring_league_id column unavailable for user ${maskUserId(league.clerkUserId)} league ${league.leagueId}; retrying without it (code=${error.code ?? 'unknown'})`
      );
      this.recurringLeagueIdColumnStatus = 'missing';
    }

    const legacyError = await this.upsertSleeperLeagueRow(basePayload);
    if (legacyError) throw new Error(`Failed to save Sleeper league: ${legacyError.message}`);
  }

  async deleteSleeperLeague(clerkUserId: string, leagueId: string): Promise<void> {
    // Resolve platform identifiers before deleting (route arg is DB row UUID)
    const { data: row, error: lookupError } = await this.supabase
      .from('sleeper_leagues')
      .select('league_id, season_year')
      .eq('clerk_user_id', clerkUserId)
      .eq('id', leagueId)
      .maybeSingle();

    if (lookupError) {
      console.warn(`[sleeper-storage] Failed to look up Sleeper league ${leagueId} before delete:`, lookupError);
    }

    const { error } = await this.supabase
      .from('sleeper_leagues')
      .delete()
      .eq('clerk_user_id', clerkUserId)
      .eq('id', leagueId);

    if (error) throw new Error(`Failed to delete Sleeper league: ${error.message}`);

    // Clear any sport default pointing to this league (keyed by platform league_id + season)
    if (row) {
      await this._clearDefaultsForLeague(clerkUserId, 'sleeper', row.league_id, row.season_year);
    }
  }

  async deleteAllSleeperLeagues(clerkUserId: string): Promise<void> {
    const { error } = await this.supabase
      .from('sleeper_leagues')
      .delete()
      .eq('clerk_user_id', clerkUserId);

    if (error) throw new Error(`Failed to delete Sleeper leagues: ${error.message}`);

    // Clear all Sleeper sport defaults for this user
    await this._clearDefaultsForPlatform(clerkUserId, 'sleeper');
  }

  private async _clearDefaultsForLeague(clerkUserId: string, platform: 'sleeper', leagueId: string, seasonYear: number): Promise<void> {
    const result = await _clearDefaultsForLeague(this.supabase, clerkUserId, platform, leagueId, seasonYear);
    if (result.skipped) {
      console.warn(`[sleeper-storage] clearDefaultsForLeague skipped for user ${maskUserId(clerkUserId)}: ${result.error ?? 'unknown reason'}`);
    }
  }

  private async _clearDefaultsForPlatform(clerkUserId: string, platform: 'sleeper'): Promise<void> {
    const result = await _clearDefaultsForPlatform(this.supabase, clerkUserId, platform);
    if (result.skipped) {
      console.warn(`[sleeper-storage] clearDefaultsForPlatform skipped for user ${maskUserId(clerkUserId)}: ${result.error ?? 'unknown reason'}`);
    }
  }

  private async upsertSleeperLeagueRow(payload: Record<string, unknown>): Promise<SupabaseErrorLike | null> {
    const { error } = await this.supabase
      .from('sleeper_leagues')
      .upsert(payload, { onConflict: 'clerk_user_id,league_id,season_year' });

    return (error as SupabaseErrorLike | null) ?? null;
  }
}
