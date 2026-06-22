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
 * separate key-computation and no dependency on display-grouping heuristics.
 *
 * All access uses the Supabase service-role key (bypasses RLS), matching every
 * existing league table.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type ArchivePlatform = 'espn' | 'yahoo' | 'sleeper';
export type ArchiveSport = 'football' | 'baseball' | 'basketball' | 'hockey';

/**
 * Suppression mode (FLA-150):
 *   'historical' — hidden from get_user_session but browsable in get_ancient_history
 *   'hidden'     — hidden from BOTH AI tools (the original binary-archive behavior)
 */
export type ArchiveMode = 'historical' | 'hidden';

/**
 * How a league read should treat archived leagues:
 *   'include-all'      — return everything (dedupe / discovery / UI annotation)
 *   'exclude-archived' — drop BOTH modes (the active get_user_session view)
 *   'exclude-hidden'   — drop only 'hidden' (the get_ancient_history view)
 */
export type ArchivedFilter = 'include-all' | 'exclude-archived' | 'exclude-hidden';

export interface ArchivedLeague {
  platform: ArchivePlatform;
  sport: ArchiveSport;
  recurringLeagueId: string;
  leagueName?: string;
  archivedAt?: string;
  mode: ArchiveMode;
}

interface ArchivedLeagueRow {
  platform: string;
  sport: string;
  recurring_league_id: string;
  league_name: string | null;
  archived_at: string | null;
  mode?: string | null;
}

/** Normalize a raw `mode` value; anything unexpected (incl. null) → 'hidden' (the
 * most-suppressive, no-leak default). Post-migration every row has a valid mode. */
function normalizeArchiveMode(mode: string | null | undefined): ArchiveMode {
  return mode === 'historical' ? 'historical' : 'hidden';
}

/** True when a DB error indicates the `mode` column doesn't exist yet (code runs
 * before migration 025). Lets the read path fall back to legacy behavior instead
 * of failing closed on a transient-looking error it can actually recover from. */
function isMissingModeColumn(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === '42703') return true; // Postgres undefined_column
  return /column\b.*\bmode\b.*does not exist/i.test(error.message ?? '');
}

/**
 * Decide whether a league row should be dropped under a given filter, given the
 * archived map (from getArchivedMap) and the row's archive key (archivedKey).
 * Centralizes the tri-state semantics so the per-platform storage reads can't drift.
 */
export function isSuppressed(
  filter: ArchivedFilter,
  archived: Map<string, ArchiveMode>,
  key: string
): boolean {
  if (filter === 'include-all') return false;
  const mode = archived.get(key);
  if (mode === undefined) return false; // not archived at all
  if (filter === 'exclude-archived') return true; // active view drops both modes
  return mode === 'hidden'; // exclude-hidden: history view drops only 'hidden'
}

function maskUserId(userId: string): string {
  if (!userId || userId.length <= 8) return '***';
  return `${userId.substring(0, 8)}...`;
}

/**
 * Composite key for the archived set: `sport:recurringId`. The archive table key
 * includes sport, and recurring-league ids are only unique within a sport (the id
 * space is shared across sports), so membership checks must scope by sport too.
 * Centralized here so the read-path and write-path key format can't drift.
 */
export function archivedKey(sport: string, recurringLeagueId: string): string {
  return `${sport}:${recurringLeagueId}`;
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
    leagueName?: string,
    mode: ArchiveMode = 'historical'
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
            mode,
          },
          { onConflict: 'clerk_user_id,platform,sport,recurring_league_id' }
        );

      if (error) {
        console.error('[archive-storage] archiveLeague error:', error);
        return false;
      }

      console.log(
        `[archive-storage] archiveLeague: ${mode} ${platform}:${sport}:${recurringLeagueId} for user ${maskUserId(clerkUserId)}`
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

      // select('*') so the read tolerates the `mode` column being present or absent
      // (pre-migration); normalizeArchiveMode maps a missing/null mode to 'hidden'.
      const { data, error } = await this.supabase
        .from('archived_leagues')
        .select('*')
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
        mode: normalizeArchiveMode(row.mode),
      }));
    } catch (error) {
      console.error('[archive-storage] Failed to list archived leagues:', error);
      return [];
    }
  }

  /**
   * Return archived leagues for a user + platform as a `Map<archivedKey, mode>`,
   * keyed by `sport:recurringId` (see `archivedKey`). The mode lets the read-path
   * filter distinguish 'historical' (browsable in get_ancient_history) from
   * 'hidden' (gone from both AI tools).
   *
   * THROWS on a DB error (fail-closed). Exclude-path callers let it propagate so a
   * transient error fails the league read rather than silently un-hiding archived
   * leagues from the AI. Annotate-path callers (public UI) catch and fall back to
   * an empty map (fail-open) so the UI just loses the archived flag.
   *
   * Tolerates the pre-migration schema: if the `mode` column doesn't exist yet,
   * it falls back to reading without it and treats every archived league as
   * 'hidden' (the original behavior) — so this is safe regardless of whether the
   * migration or the code lands first. Any OTHER DB error still fails closed.
   */
  async getArchivedMap(clerkUserId: string, platform: ArchivePlatform): Promise<Map<string, ArchiveMode>> {
    if (!clerkUserId) return new Map();

    const { data, error } = await this.supabase
      .from('archived_leagues')
      .select('sport, recurring_league_id, mode')
      .eq('clerk_user_id', clerkUserId)
      .eq('platform', platform);

    if (!error && data) {
      return new Map(
        (data as { sport: string; recurring_league_id: string; mode: string | null }[]).map((row) => [
          archivedKey(row.sport, row.recurring_league_id),
          normalizeArchiveMode(row.mode),
        ])
      );
    }

    if (isMissingModeColumn(error)) {
      const { data: legacyData, error: legacyError } = await this.supabase
        .from('archived_leagues')
        .select('sport, recurring_league_id')
        .eq('clerk_user_id', clerkUserId)
        .eq('platform', platform);

      if (!legacyError && legacyData) {
        return new Map(
          (legacyData as { sport: string; recurring_league_id: string }[]).map((row) => [
            archivedKey(row.sport, row.recurring_league_id),
            'hidden' as ArchiveMode,
          ])
        );
      }
      console.error('[archive-storage] getArchivedMap legacy fallback error:', legacyError);
      throw new Error(`Failed to get archived map: ${legacyError?.message ?? 'no data returned'}`);
    }

    console.error('[archive-storage] getArchivedMap error:', error);
    throw new Error(`Failed to get archived map: ${error?.message ?? 'no data returned'}`);
  }

  /**
   * Set of archived keys (both modes) for a user + platform. Back-compat wrapper
   * over getArchivedMap for callers that only need "is this league suppressed at
   * all" (the active-view exclude path). Fail-closed (throws) like getArchivedMap.
   */
  async getArchivedSet(clerkUserId: string, platform: ArchivePlatform): Promise<Set<string>> {
    return new Set((await this.getArchivedMap(clerkUserId, platform)).keys());
  }
}
