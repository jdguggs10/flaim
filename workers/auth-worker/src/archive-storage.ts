/**
 * Manual league archive storage (FLA-124).
 * ---------------------------------------------------------------------------
 *
 * Archive state lives in its own `archived_leagues` table keyed on a stable
 * recurring-league identity — NOT a column on the season-scoped league tables.
 * This is what makes archive survive annual re-syncs: discovery upserts league
 * rows for new seasons without touching this table, so the league stays hidden.
 *
 * The archive key is `(clerk_user_id, platform, sport, recurring_league_id)`,
 * where `recurring_league_id` is the SAME value the league row stores
 * (ESPN: `league_id`; Sleeper: `recurring_league_id ?? league_id`). The read-path
 * filter is therefore a plain column comparison against the archived set — no
 * separate key-computation and no dependency on display-grouping heuristics (D2).
 *
 * All access uses the Supabase service-role key (bypasses RLS), matching every
 * existing league table.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type ArchivePlatform = 'espn' | 'yahoo' | 'sleeper';
export type ArchiveSport = 'football' | 'baseball' | 'basketball' | 'hockey';

export interface ArchivedLeague {
  platform: ArchivePlatform;
  sport: ArchiveSport;
  recurringLeagueId: string;
  leagueName?: string;
  archivedAt?: string;
}

interface ArchivedLeagueRow {
  platform: string;
  sport: string;
  recurring_league_id: string;
  league_name: string | null;
  archived_at: string | null;
}

function maskUserId(userId: string): string {
  if (!userId || userId.length <= 8) return '***';
  return `${userId.substring(0, 8)}...`;
}

export interface ArchiveStorageEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

export class ArchiveStorage {
  private supabase: SupabaseClient;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  static fromEnvironment(env: ArchiveStorageEnv): ArchiveStorage {
    return new ArchiveStorage(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  }

  /**
   * Archive a league for a user. Idempotent — re-archiving the same
   * (platform, sport, recurringLeagueId) updates the denormalized name.
   */
  async archiveLeague(
    clerkUserId: string,
    platform: ArchivePlatform,
    sport: ArchiveSport,
    recurringLeagueId: string,
    leagueName?: string
  ): Promise<boolean> {
    try {
      if (!clerkUserId || !recurringLeagueId) return false;

      const { error } = await this.supabase
        .from('archived_leagues')
        .upsert(
          {
            clerk_user_id: clerkUserId,
            platform,
            sport,
            recurring_league_id: recurringLeagueId,
            league_name: leagueName ?? null,
            archived_at: new Date().toISOString(),
          },
          { onConflict: 'clerk_user_id,platform,sport,recurring_league_id' }
        );

      if (error) {
        console.error('[archive-storage] archiveLeague error:', error);
        return false;
      }

      console.log(
        `[archive-storage] archiveLeague: archived ${platform}:${sport}:${recurringLeagueId} for user ${maskUserId(clerkUserId)}`
      );
      return true;
    } catch (error) {
      console.error('[archive-storage] Failed to archive league:', error);
      return false;
    }
  }

  /**
   * Remove an archive entry (restore the league to the visible/AI surfaces).
   */
  async unarchiveLeague(
    clerkUserId: string,
    platform: ArchivePlatform,
    sport: ArchiveSport,
    recurringLeagueId: string
  ): Promise<boolean> {
    try {
      if (!clerkUserId || !recurringLeagueId) return false;

      const { error } = await this.supabase
        .from('archived_leagues')
        .delete()
        .eq('clerk_user_id', clerkUserId)
        .eq('platform', platform)
        .eq('sport', sport)
        .eq('recurring_league_id', recurringLeagueId);

      if (error) {
        console.error('[archive-storage] unarchiveLeague error:', error);
        return false;
      }

      console.log(
        `[archive-storage] unarchiveLeague: restored ${platform}:${sport}:${recurringLeagueId} for user ${maskUserId(clerkUserId)}`
      );
      return true;
    } catch (error) {
      console.error('[archive-storage] Failed to unarchive league:', error);
      return false;
    }
  }

  /**
   * List all archived leagues for a user (for the Archived UI section).
   */
  async listArchived(clerkUserId: string): Promise<ArchivedLeague[]> {
    try {
      if (!clerkUserId) return [];

      const { data, error } = await this.supabase
        .from('archived_leagues')
        .select('platform, sport, recurring_league_id, league_name, archived_at')
        .eq('clerk_user_id', clerkUserId);

      if (error || !data) {
        if (error) console.error('[archive-storage] listArchived error:', error);
        return [];
      }

      return (data as ArchivedLeagueRow[]).map((row) => ({
        platform: row.platform as ArchivePlatform,
        sport: row.sport as ArchiveSport,
        recurringLeagueId: row.recurring_league_id,
        leagueName: row.league_name ?? undefined,
        archivedAt: row.archived_at ?? undefined,
      }));
    } catch (error) {
      console.error('[archive-storage] Failed to list archived leagues:', error);
      return [];
    }
  }

  /**
   * Return the set of archived `recurring_league_id`s for a user + platform.
   * Used by the read-path filter as a plain column comparison (D2).
   *
   * THROWS on a DB error (fail-closed). Exclude-path callers (internal
   * `includeArchived:false`) let it propagate so a transient error fails the
   * league read rather than silently un-hiding archived leagues from the AI —
   * the gateway already tolerates a platform fetch failure (audit #10). Annotate-path
   * callers (public UI) catch it and fall back to an empty set (fail-open) so the
   * UI just loses the archived flag.
   */
  async getArchivedSet(clerkUserId: string, platform: ArchivePlatform): Promise<Set<string>> {
    if (!clerkUserId) return new Set();

    const { data, error } = await this.supabase
      .from('archived_leagues')
      .select('recurring_league_id')
      .eq('clerk_user_id', clerkUserId)
      .eq('platform', platform);

    if (error || !data) {
      console.error('[archive-storage] getArchivedSet error:', error);
      throw new Error(`Failed to get archived set: ${error?.message ?? 'no data returned'}`);
    }

    return new Set((data as { recurring_league_id: string }[]).map((row) => row.recurring_league_id));
  }
}
