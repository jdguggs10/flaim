/**
 * Convert Yahoo's numeric-keyed objects to arrays.
 * Yahoo returns: {"0": {...}, "1": {...}, "count": 2}
 * We want: [{...}, {...}]
 */
export function asArray<T>(obj: Record<string, T> | T[] | undefined | null): T[] {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj;

  const result: T[] = [];
  for (const key of Object.keys(obj)) {
    // Skip non-numeric keys like "count"
    if (/^\d+$/.test(key)) {
      result.push(obj[key]);
    }
  }
  return result;
}

/**
 * Safe deep path traversal.
 * getPath(data, ['fantasy_content', 'league', 0, 'name'])
 */
export function getPath(obj: unknown, path: (string | number)[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current === 'object') {
      current = (current as Record<string | number, unknown>)[key];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Yahoo returns league data as: [metadata, nested_resources]
 * This extracts and merges them into a single object.
 */
export function unwrapLeague(leagueArray: unknown): Record<string, unknown> {
  if (!Array.isArray(leagueArray)) {
    console.warn('[normalizers] unwrapLeague: expected array, got', typeof leagueArray);
    return {};
  }

  // Index 0 is metadata (league_key, name, etc.)
  // Index 1+ are nested resources (standings, scoreboard, etc.)
  const metadata = (leagueArray[0] || {}) as Record<string, unknown>;
  const nested = (leagueArray[1] || {}) as Record<string, unknown>;

  return { ...metadata, ...nested };
}

/**
 * Yahoo returns team data as: [[metadata_array], other_data]
 * This extracts the team metadata.
 */
export function unwrapTeam(teamArray: unknown): Record<string, unknown> {
  if (!Array.isArray(teamArray)) {
    console.warn('[normalizers] unwrapTeam: expected array, got', typeof teamArray);
    return {};
  }

  // First element is array of metadata objects
  const metadataArray = teamArray[0];
  if (!Array.isArray(metadataArray)) {
    return {};
  }

  // Merge all metadata objects
  let result: Record<string, unknown> = {};
  for (const item of metadataArray) {
    if (typeof item === 'object' && item !== null) {
      result = { ...result, ...item };
    }
  }

  // Merge any additional data from index 1+
  for (let i = 1; i < teamArray.length; i++) {
    if (typeof teamArray[i] === 'object' && teamArray[i] !== null) {
      result = { ...result, ...teamArray[i] };
    }
  }

  return result;
}

/**
 * Parse Yahoo ownership.percent_owned safely.
 * Returns null for missing/non-finite values and preserves valid 0 values.
 */
export function parseYahooPercentOwned(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Normalize a Yahoo boolean-flag field. Yahoo's XML->JSON conversion
 * represents these inconsistently across resources: native JSON booleans on
 * some player fields, "0"/"1" strings on league settings (verified against a
 * real captured `/league/{key}/settings` fixture — e.g. `can_trade_draft_picks:
 * "1"`), and bare 0/1 numbers elsewhere in this codebase (e.g.
 * `league.is_finished === 1` in get-league-info.ts/get-standings.ts). Also
 * recognizes the strings "true"/"false" (case-insensitive, trimmed) — an
 * undocumented alternate encoding some Yahoo fields use (FLA-284 audit).
 * Returns undefined for anything unrecognized rather than guessing at a
 * default, e.g. `is_keeper.status`/`kept` must never be coerced to `true`
 * for an unrecognized encoding.
 */
export function toYahooBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value === 'string') {
    if (value === '1') return true;
    if (value === '0') return false;
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    return undefined;
  }
  return undefined;
}

/**
 * Parse a Yahoo numeric field that may arrive as a string (real
 * `/league/{key}/settings` capture: `trade_reject_time: "1"`). Returns
 * undefined for missing/non-finite values rather than coercing to 0.
 *
 * An empty or whitespace-only string is rejected before reaching `Number()`
 * (FLA-284 audit): `Number('')` and `Number('   ')` both evaluate to `0`,
 * which would otherwise misreport "field not sent/blank" as the finite
 * value `0`.
 */
export function toYahooFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}
