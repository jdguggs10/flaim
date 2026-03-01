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
 * Debug helper - log raw Yahoo response structure
 */
export function logStructure(label: string, obj: unknown, _depth = 2): void {
  const seen = new WeakSet();
  const replacer = (_key: string, value: unknown) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  };
  console.log(`[yahoo-debug] ${label}:`, JSON.stringify(obj, replacer, 2).slice(0, 2000));
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
