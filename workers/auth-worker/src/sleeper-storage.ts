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
    const { error } = await this.supabase
      .from('sleeper_leagues')
      .delete()
      .eq('clerk_user_id', clerkUserId)
      .eq('id', leagueId);

    if (error) throw new Error(`Failed to delete Sleeper league: ${error.message}`);
  }

  async deleteAllSleeperLeagues(clerkUserId: string): Promise<void> {
    const { error } = await this.supabase
      .from('sleeper_leagues')
      .delete()
      .eq('clerk_user_id', clerkUserId);

    if (error) throw new Error(`Failed to delete Sleeper leagues: ${error.message}`);
  }
}
