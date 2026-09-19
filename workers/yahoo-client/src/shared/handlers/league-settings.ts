import type { YahooCredentials } from '../auth';
import { yahooFetch } from '../yahoo-api';
import { asArray, getPath, toYahooBoolean, unwrapLeague } from '../normalizers';
import { extractLeagueSettings } from './utils';

/**
 * Shared `/league/{key}/settings` fetch, used by `get_league_info` (FLA-284)
 * and `get_matchups` (FLA-404, category-scoring stat names). Best-effort and
 * degrades to `undefined` on a rejected fetch, a non-2xx response, a JSON
 * parse failure, or a settings shape `extractLeagueSettings` doesn't
 * recognize — it never throws, so a caller can always fall back to omitting
 * the fields this supplies. `label` identifies the calling tool in the log
 * line only (e.g. "get_league_info", "get_matchups").
 */
export async function fetchLeagueSettings(
  credentials: YahooCredentials,
  leagueId: string,
  cid: string,
  label: string
): Promise<Record<string, unknown> | undefined> {
  try {
    const response = await yahooFetch(`/league/${leagueId}/settings`, { credentials });
    if (!response.ok) {
      throw new Error(`Yahoo returned ${response.status}`);
    }

    const raw = await response.json();
    const leagueArray = getPath(raw, ['fantasy_content', 'league']);
    const merged = unwrapLeague(leagueArray);
    const settings = extractLeagueSettings(merged.settings);
    if (!settings) {
      throw new Error('unrecognized settings shape');
    }
    return settings;
  } catch (error) {
    console.warn(
      `[yahoo-client] ${cid} ${label} settings fetch failed: ${error instanceof Error ? error.message : String(error)}`
    );
    return undefined;
  }
}

export interface YahooStatCategory {
  statId: string;
  name: string | null;
  displayName: string | null;
  isDisplayOnly: boolean;
}

/**
 * Read `stat_categories.stats` off a settings object (as returned by
 * `fetchLeagueSettings`) into a lookup keyed by stat id. Yahoo sends
 * `stat_id` as a number in some captures and a string in others, so the key
 * is always `String(stat_id)`. Returns an empty map when `settings` is
 * `undefined` (the settings fetch failed) so callers can treat "no names"
 * and "settings unavailable" the same way — every category simply falls
 * back to its stat id.
 */
export function extractStatCategories(settings: Record<string, unknown> | undefined): Map<string, YahooStatCategory> {
  const categories = new Map<string, YahooStatCategory>();
  if (!settings) return categories;

  const statCategories = settings.stat_categories as Record<string, unknown> | undefined;
  const statsArray = asArray(getPath(statCategories, ['stats']) as Record<string, unknown> | undefined);

  for (const entry of statsArray) {
    const stat = getPath(entry, ['stat']) as Record<string, unknown> | undefined;
    if (!stat || stat.stat_id === undefined || stat.stat_id === null) continue;
    const statId = String(stat.stat_id);
    categories.set(statId, {
      statId,
      name: typeof stat.name === 'string' ? stat.name : null,
      displayName: typeof stat.display_name === 'string' ? stat.display_name : null,
      isDisplayOnly: toYahooBoolean(stat.is_only_display_stat) === true,
    });
  }

  return categories;
}
