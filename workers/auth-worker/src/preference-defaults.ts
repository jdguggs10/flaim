/**
 * Shared helpers for clearing stale sport defaults in user_preferences.
 * Used by SupabaseStorage, YahooStorage, and SleeperStorage after league deletion
 * to keep user_preferences.default_<sport> in sync with the leagues tables.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

type Platform = 'espn' | 'yahoo' | 'sleeper';
type StoredDefault = { platform: string; leagueId: string; seasonYear: number } | null;

const SPORT_COLUMNS = ['football', 'baseball', 'basketball', 'hockey'] as const;

function maskUserId(userId: string): string {
  if (!userId || userId.length <= 8) return '***';
  return `${userId.substring(0, 8)}...`;
}

/**
 * Clear any sport default that matches the given platform + leagueId.
 * When seasonYear is provided, only clears an exact {platform, leagueId, seasonYear} match.
 * When omitted (ESPN all-seasons delete), clears any matching {platform, leagueId}.
 */
export async function clearDefaultsForLeague(
  supabase: SupabaseClient,
  clerkUserId: string,
  platform: Platform,
  leagueId: string,
  seasonYear?: number
): Promise<void> {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('default_football, default_baseball, default_basketball, default_hockey')
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle();

  if (error) {
    console.error('[preference-defaults] clearDefaultsForLeague: failed to read preferences:', error);
    return;
  }
  if (!data) return;

  const updates: Record<string, null> = {};
  for (const sport of SPORT_COLUMNS) {
    const col = `default_${sport}` as keyof typeof data;
    const stored = data[col] as StoredDefault;
    if (
      stored &&
      stored.platform === platform &&
      stored.leagueId === leagueId &&
      (seasonYear === undefined || stored.seasonYear === seasonYear)
    ) {
      updates[col] = null;
    }
  }

  if (Object.keys(updates).length === 0) return;

  const { error: upsertError } = await supabase
    .from('user_preferences')
    .upsert(
      { clerk_user_id: clerkUserId, ...updates, updated_at: new Date().toISOString() },
      { onConflict: 'clerk_user_id' }
    );

  if (upsertError) {
    console.error('[preference-defaults] clearDefaultsForLeague: failed to clear stale defaults:', upsertError);
  } else {
    console.log(`[preference-defaults] clearDefaultsForLeague: cleared stale ${platform}:${leagueId} default for user ${maskUserId(clerkUserId)}`);
  }
}

/**
 * Clear all sport defaults for a given platform (used on full-platform disconnect).
 */
export async function clearDefaultsForPlatform(
  supabase: SupabaseClient,
  clerkUserId: string,
  platform: Platform
): Promise<void> {
  const { data, error } = await supabase
    .from('user_preferences')
    .select('default_football, default_baseball, default_basketball, default_hockey')
    .eq('clerk_user_id', clerkUserId)
    .maybeSingle();

  if (error) {
    console.error('[preference-defaults] clearDefaultsForPlatform: failed to read preferences:', error);
    return;
  }
  if (!data) return;

  const updates: Record<string, null> = {};
  for (const sport of SPORT_COLUMNS) {
    const col = `default_${sport}` as keyof typeof data;
    const stored = data[col] as { platform: string } | null;
    if (stored && stored.platform === platform) {
      updates[col] = null;
    }
  }

  if (Object.keys(updates).length === 0) return;

  const { error: upsertError } = await supabase
    .from('user_preferences')
    .upsert(
      { clerk_user_id: clerkUserId, ...updates, updated_at: new Date().toISOString() },
      { onConflict: 'clerk_user_id' }
    );

  if (upsertError) {
    console.error('[preference-defaults] clearDefaultsForPlatform: failed to clear platform defaults:', upsertError);
  } else {
    console.log(`[preference-defaults] clearDefaultsForPlatform: cleared ${platform} defaults for user ${maskUserId(clerkUserId)}`);
  }
}
