import type { Env } from '../types';
import { handleSleeperError, sleeperFetch } from './sleeper-api';

const PLAYERS_CACHE_TTL_SECONDS = 24 * 60 * 60;

// Memoizes the PARSED, immutable index (not the raw JSON string) so repeat
// calls within a warm isolate skip re-running JSON.parse/normalize/toPlayerIndex
// on every roster/matchup/transaction/free-agent request.
const inMemoryPlayersCache = new Map<string, { index: Map<string, SleeperPlayerRecord>; expiresAt: number }>();

// Dedupes concurrent loads for the same sport within one isolate so a burst
// of parallel calls (e.g. roster + matchup requests landing together) shares
// a single KV read / Sleeper fetch instead of racing separate ones.
const inFlightLoads = new Map<string, Promise<Map<string, SleeperPlayerRecord>>>();

export function clearSleeperPlayersInMemoryCacheForTesting(): void {
  inMemoryPlayersCache.clear();
  inFlightLoads.clear();
}

export interface SleeperPlayerRecord {
  player_id: string;
  full_name: string;
  first_name?: string;
  last_name?: string;
  position?: string;
  team?: string;
  active: boolean;
}

type SleeperPlayerCacheSport = 'football' | 'basketball';

type SleeperPlayersApiRecord = {
  player_id?: unknown;
  full_name?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  position?: unknown;
  team?: unknown;
  active?: unknown;
};

function toCacheSportPath(sport: SleeperPlayerCacheSport): '/players/nfl' | '/players/nba' {
  return sport === 'football' ? '/players/nfl' : '/players/nba';
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function parsePlayerRecord(raw: SleeperPlayersApiRecord, fallbackId?: string): SleeperPlayerRecord | null {
  const id = asNonEmptyString(raw.player_id) ?? asNonEmptyString(fallbackId);
  if (!id) return null;

  const firstName = asNonEmptyString(raw.first_name);
  const lastName = asNonEmptyString(raw.last_name);
  const derivedName = [firstName, lastName].filter(Boolean).join(' ').trim();
  const fullName = asNonEmptyString(raw.full_name) ?? (derivedName || id);

  return {
    player_id: id,
    full_name: fullName,
    first_name: firstName,
    last_name: lastName,
    position: asNonEmptyString(raw.position),
    team: asNonEmptyString(raw.team),
    active: raw.active === true,
  };
}

interface NormalizedPlayers {
  records: SleeperPlayerRecord[];
  /** Entries that were non-objects, or objects that failed parsePlayerRecord. */
  skipped: number;
}

function normalizePlayers(input: unknown): NormalizedPlayers | null {
  if (Array.isArray(input)) {
    const records: SleeperPlayerRecord[] = [];
    let skipped = 0;
    for (const item of input) {
      if (!item || typeof item !== 'object') {
        skipped++;
        continue;
      }
      const parsed = parsePlayerRecord(item as SleeperPlayersApiRecord);
      if (!parsed) {
        skipped++;
        continue;
      }
      records.push(parsed);
    }
    return { records, skipped };
  }

  if (!input || typeof input !== 'object') {
    return null;
  }

  const records: SleeperPlayerRecord[] = [];
  let skipped = 0;
  for (const [playerId, value] of Object.entries(input as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') {
      skipped++;
      continue;
    }
    const parsed = parsePlayerRecord(value as SleeperPlayersApiRecord, playerId);
    if (!parsed) {
      skipped++;
      continue;
    }
    records.push(parsed);
  }

  return { records, skipped };
}

// Structurally invalid: nothing usable came out, or more than half of the
// entries were unusable (a mostly-corrupt payload/cache entry shouldn't
// become the authoritative index for a full day). No fixed minimum-record
// threshold — small, fully-valid fixtures (including in tests) must pass.
// If a future Sleeper format change ever makes most entries unparseable, the
// index refuses to load and enrichment degrades loudly (id-only + warnings)
// on every call rather than silently serving a thinned index for 24h.
function isStructurallyInvalid(normalized: NormalizedPlayers): boolean {
  return normalized.records.length === 0 || normalized.skipped > normalized.records.length;
}

function toPlayerIndex(players: SleeperPlayerRecord[]): Map<string, SleeperPlayerRecord> {
  const map = new Map<string, SleeperPlayerRecord>();
  for (const player of players) {
    map.set(player.player_id, player);
  }
  return map;
}

export function cacheKeyForSport(sport: SleeperPlayerCacheSport): string {
  return `players:${sport}:v1`;
}

export async function getSleeperPlayersIndex(
  env: Env,
  sport: SleeperPlayerCacheSport,
): Promise<Map<string, SleeperPlayerRecord>> {
  const cacheKey = cacheKeyForSport(sport);

  const cachedInMemory = inMemoryPlayersCache.get(cacheKey);
  if (cachedInMemory && cachedInMemory.expiresAt > Date.now()) {
    return cachedInMemory.index;
  }

  const inFlight = inFlightLoads.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const loadPromise = loadSleeperPlayersIndex(env, sport, cacheKey).finally(() => {
    inFlightLoads.delete(cacheKey);
  });
  inFlightLoads.set(cacheKey, loadPromise);
  return loadPromise;
}

async function loadSleeperPlayersIndex(
  env: Env,
  sport: SleeperPlayerCacheSport,
  cacheKey: string,
): Promise<Map<string, SleeperPlayerRecord>> {
  let cached: string | null = null;
  try {
    cached = await env.SLEEPER_PLAYERS_CACHE.get(cacheKey);
  } catch {
    // KV read failed — treat as cache miss and fall through to Sleeper fetch.
  }

  if (cached) {
    try {
      const parsedCached = normalizePlayers(JSON.parse(cached));
      // A structurally invalid cached entry (empty, or majority-malformed —
      // e.g. a previously-poisoned entry) is treated the same as unparseable
      // JSON below: fall through and refetch rather than serving (and
      // re-memoizing) a bad index for the full TTL.
      if (parsedCached && !isStructurallyInvalid(parsedCached)) {
        const index = toPlayerIndex(parsedCached.records);
        memoize(cacheKey, index);
        return index;
      }
    } catch {
      // Defensive fallback: refetch from Sleeper when cache data is malformed.
    }
  }

  const response = await sleeperFetch(toCacheSportPath(sport));
  if (!response.ok) handleSleeperError(response);

  const payload = await response.json();
  const normalized = normalizePlayers(payload) ?? { records: [], skipped: 0 };
  if (isStructurallyInvalid(normalized)) {
    // Never persist a structurally invalid index (in memory or KV) from a
    // 200 payload — that would silently poison the 24h cache. Throwing lets
    // callers (loadSleeperPlayersIndexForEnrichment, get_free_agents)
    // degrade with a warning instead, and the next call gets a clean retry.
    throw new Error(
      `SLEEPER_INVALID_PLAYER_INDEX: Sleeper players endpoint returned an unusable player index ` +
      `(${normalized.records.length} valid, ${normalized.skipped} skipped)`
    );
  }

  const serialized = JSON.stringify(normalized.records);
  try {
    await env.SLEEPER_PLAYERS_CACHE.put(cacheKey, serialized, {
      expirationTtl: PLAYERS_CACHE_TTL_SECONDS,
    });
  } catch (error) {
    console.error('[sleeper-players-cache] KV write failed; serving from in-memory only:', error);
  }

  const index = toPlayerIndex(normalized.records);
  memoize(cacheKey, index);
  return index;
}

function memoize(cacheKey: string, index: Map<string, SleeperPlayerRecord>): void {
  inMemoryPlayersCache.set(cacheKey, {
    index,
    expiresAt: Date.now() + PLAYERS_CACHE_TTL_SECONDS * 1000,
  });
}
