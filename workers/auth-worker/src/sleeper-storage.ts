import { createClient } from '@supabase/supabase-js';

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
  sleeper_user_id: string;
  created_at: string;
  updated_at: string;
}

export interface SleeperLeague {
  id: string;
  clerkUserId: string;
  leagueId: string;
  sport: string;
  seasonYear: number;
  leagueName: string;
  rosterId: number | null;
  sleeperUserId: string;
}

export class SleeperStorage {
  private supabase;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  static fromEnvironment(env: SleeperStorageEnv): SleeperStorage {
    return new SleeperStorage(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  }

  async getSleeperConnection(clerkUserId: string): Promise<{ sleeperUserId: string; sleeperUsername: string | null } | null> {
    const { data, error } = await this.supabase
      .from('sleeper_connections')
      .select('sleeper_user_id, sleeper_username')
      .eq('clerk_user_id', clerkUserId)
      .single();

    if (error || !data) return null;
    return {
      sleeperUserId: (data as SleeperConnectionRow).sleeper_user_id,
      sleeperUsername: (data as SleeperConnectionRow).sleeper_username,
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
    sleeperUserId: string;
  }): Promise<void> {
    const { error } = await this.supabase
      .from('sleeper_leagues')
      .upsert({
        clerk_user_id: league.clerkUserId,
        league_id: league.leagueId,
        sport: league.sport,
        season_year: league.seasonYear,
        league_name: league.leagueName,
        roster_id: league.rosterId,
        sleeper_user_id: league.sleeperUserId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'clerk_user_id,league_id,season_year' });

    if (error) throw new Error(`Failed to save Sleeper league: ${error.message}`);
  }

  async deleteSleeperLeague(clerkUserId: string, leagueId: string): Promise<void> {
    // Resolve platform identifiers before deleting (route arg is DB row UUID)
    const { data: row } = await this.supabase
      .from('sleeper_leagues')
      .select('league_id, season_year')
      .eq('clerk_user_id', clerkUserId)
      .eq('id', leagueId)
      .maybeSingle();

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

  private async _clearDefaultsForLeague(
    clerkUserId: string,
    platform: 'sleeper',
    leagueId: string,
    seasonYear: number
  ): Promise<void> {
    const sportColumns = ['football', 'baseball', 'basketball', 'hockey'] as const;
    const { data, error } = await this.supabase
      .from('user_preferences')
      .select('default_football, default_baseball, default_basketball, default_hockey')
      .eq('clerk_user_id', clerkUserId)
      .maybeSingle();

    if (error || !data) return;

    const updates: Record<string, null> = {};
    for (const sport of sportColumns) {
      const col = `default_${sport}` as keyof typeof data;
      const stored = data[col] as { platform: string; leagueId: string; seasonYear: number } | null;
      if (stored && stored.platform === platform && stored.leagueId === leagueId && stored.seasonYear === seasonYear) {
        updates[col] = null;
      }
    }

    if (Object.keys(updates).length === 0) return;

    await this.supabase
      .from('user_preferences')
      .upsert(
        { clerk_user_id: clerkUserId, ...updates, updated_at: new Date().toISOString() },
        { onConflict: 'clerk_user_id' }
      );
  }

  private async _clearDefaultsForPlatform(
    clerkUserId: string,
    platform: 'sleeper'
  ): Promise<void> {
    const sportColumns = ['football', 'baseball', 'basketball', 'hockey'] as const;
    const { data, error } = await this.supabase
      .from('user_preferences')
      .select('default_football, default_baseball, default_basketball, default_hockey')
      .eq('clerk_user_id', clerkUserId)
      .maybeSingle();

    if (error || !data) return;

    const updates: Record<string, null> = {};
    for (const sport of sportColumns) {
      const col = `default_${sport}` as keyof typeof data;
      const stored = data[col] as { platform: string } | null;
      if (stored && stored.platform === platform) {
        updates[col] = null;
      }
    }

    if (Object.keys(updates).length === 0) return;

    await this.supabase
      .from('user_preferences')
      .upsert(
        { clerk_user_id: clerkUserId, ...updates, updated_at: new Date().toISOString() },
        { onConflict: 'clerk_user_id' }
      );
  }
}
