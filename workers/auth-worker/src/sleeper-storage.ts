import { createClient } from '@supabase/supabase-js';
import { clearDefaultsForLeague as _clearDefaultsForLeague, clearDefaultsForPlatform as _clearDefaultsForPlatform } from './preference-defaults';
import { ArchiveStorage, archivedKey, isSuppressed, type ArchivedFilter } from './archive-storage';

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
  private archive: ArchiveStorage;
  private recurringLeagueIdColumnStatus: 'unknown' | 'available' | 'missing' = 'unknown';

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.archive = new ArchiveStorage(supabaseUrl, supabaseKey);
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

  /**
   * Retrieve Sleeper leagues for a user.
   * `archived` controls how suppressed leagues are treated; the recurring identity
   * is `recurring_league_id ?? league_id`:
   *   'include-all'      (default) — dedupe/discovery readers, unfiltered
   *   'exclude-archived' — drop both archive modes (active get_user_session view)
   *   'exclude-hidden'   — drop only 'hidden' (get_ancient_history view)
   */
  async getSleeperLeagues(clerkUserId: string, archived: ArchivedFilter = 'include-all'): Promise<SleeperLeague[]> {
    const { data, error } = await this.supabase
      .from('sleeper_leagues')
      .select('*')
      .eq('clerk_user_id', clerkUserId)
      .order('season_year', { ascending: false });

    if (error) throw new Error(`Failed to get Sleeper leagues: ${error.message}`);
    if (!data) return [];

    const archivedMap = archived === 'include-all'
      ? null
      : await this.archive.getArchivedMap(clerkUserId, 'sleeper');

    const rows = (data as SleeperLeagueRow[]).filter((row) => {
      if (!archivedMap) return true;
      const recurringId = row.recurring_league_id ?? row.league_id;
      return !isSuppressed(archived, archivedMap, archivedKey(row.sport, recurringId));
    });

    return rows.map((row) => ({
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

  /**
   * Persist the canonical recurring root onto every Sleeper row in a group.
   * After an archive write resolves the chain root, this writes that root
   * into `recurring_league_id` for the given season-scoped `league_id`s, so the
   * STORED column the read-filter keys on (`recurring_league_id ?? league_id`) equals
   * the archive-table key. Without this, a row whose stored column is NULL would key
   * the filter on its season-scoped `league_id` while the archive keys on the root —
   * and the archived league would leak back into the AI surfaces.
   *
   * Tolerates the pre-migration missing-column case (same fallback as saveSleeperLeague):
   * if the column is absent, the persist is a no-op and the read-filter already falls
   * back to `league_id`, so callers should archive on the season-scoped id in that case.
   */
  async persistRecurringRoot(clerkUserId: string, leagueIds: string[], recurringRoot: string): Promise<void> {
    if (!clerkUserId || leagueIds.length === 0 || this.recurringLeagueIdColumnStatus === 'missing') return;

    const { error } = await this.supabase
      .from('sleeper_leagues')
      .update({ recurring_league_id: recurringRoot, updated_at: new Date().toISOString() })
      .eq('clerk_user_id', clerkUserId)
      .in('league_id', leagueIds);

    if (!error) {
      this.recurringLeagueIdColumnStatus = 'available';
      return;
    }

    if (!isMissingRecurringLeagueIdColumnError(error as SupabaseErrorLike)) {
      throw new Error(`Failed to persist Sleeper recurring root: ${(error as SupabaseErrorLike).message}`);
    }

    console.warn(
      `[sleeper-storage] recurring_league_id column unavailable for user ${maskUserId(clerkUserId)}; skipping recurring-root persist (code=${(error as SupabaseErrorLike).code ?? 'unknown'})`
    );
    this.recurringLeagueIdColumnStatus = 'missing';
  }

  async deleteSleeperLeague(clerkUserId: string, leagueId: string): Promise<void> {
    // Resolve platform identifiers before deleting (route arg is DB row UUID).
    // Single read serves both the default-clear (league_id + season_year) and the
    // archive cleanup (sport + recurring archive key).
    const { data: row, error: lookupError } = await this.supabase
      .from('sleeper_leagues')
      .select('league_id, season_year, recurring_league_id, sport')
      .eq('clerk_user_id', clerkUserId)
      .eq('id', leagueId)
      .maybeSingle();

    if (lookupError) {
      console.warn(`[sleeper-storage] Failed to look up Sleeper league ${leagueId} before delete:`, lookupError);
    }

    // Resolve the recurring archive key before the row is gone. Tolerates a
    // missing recurring_league_id column (pre-migration) by falling back to league_id.
    let archiveRecurringId: { sport: string; recurringLeagueId: string } | null = null;
    if (row) {
      const recurringId =
        (row as { recurring_league_id?: string | null }).recurring_league_id ?? row.league_id;
      const sport = (row as { sport?: string }).sport;
      if (sport) {
        archiveRecurringId = { sport, recurringLeagueId: recurringId };
      }
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

    // A true delete also removes the league's archive entry.
    if (archiveRecurringId) {
      await this.archive.unarchiveLeague(
        clerkUserId,
        'sleeper',
        archiveRecurringId.sport as 'football' | 'baseball' | 'basketball' | 'hockey',
        archiveRecurringId.recurringLeagueId
      );
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
