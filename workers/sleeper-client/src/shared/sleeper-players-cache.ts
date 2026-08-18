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

function normalizePlayers(input: unknown): SleeperPlayerRecord[] | null {
  if (Array.isArray(input)) {
    const fromArray: SleeperPlayerRecord[] = [];
    for (const item of input) {
      if (!item || typeof item !== 'object') continue;
      const parsed = parsePlayerRecord(item as SleeperPlayersApiRecord);
      if (!parsed) continue;
      fromArray.push(parsed);
    }
    return fromArray;
  }

  if (!input || typeof input !== 'object') {
    return null;
  }

  const fromObject: SleeperPlayerRecord[] = [];
  for (const [playerId, value] of Object.entries(input as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const parsed = parsePlayerRecord(value as SleeperPlayersApiRecord, playerId);
    if (!parsed) continue;
    fromObject.push(parsed);
  }

  return fromObject;
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
      // A cached-but-empty index is treated the same as a malformed cache
      // entry below: fall through and refetch rather than serving (and
      // re-memoizing) zero usable players for the full TTL.
      if (parsedCached && parsedCached.length > 0) {
        const index = toPlayerIndex(parsedCached);
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
  const parsedPlayers = normalizePlayers(payload) ?? [];
  if (parsedPlayers.length === 0) {
    // Never persist an empty index (in memory or KV) from a 200 payload —
    // that would silently poison the 24h cache. Throwing lets callers
    // (loadSleeperPlayersIndexForEnrichment, get_free_agents) degrade with a
    // warning instead, and the next call gets a clean retry.
    throw new Error(
      'SLEEPER_EMPTY_PLAYER_INDEX: Sleeper players endpoint returned zero usable player records'
    );
  }

  const serialized = JSON.stringify(parsedPlayers);
  try {
    await env.SLEEPER_PLAYERS_CACHE.put(cacheKey, serialized, {
      expirationTtl: PLAYERS_CACHE_TTL_SECONDS,
    });
  } catch (error) {
    console.error('[sleeper-players-cache] KV write failed; serving from in-memory only:', error);
  }

  const index = toPlayerIndex(parsedPlayers);
  memoize(cacheKey, index);
  return index;
}

function memoize(cacheKey: string, index: Map<string, SleeperPlayerRecord>): void {
  inMemoryPlayersCache.set(cacheKey, {
    index,
    expiresAt: Date.now() + PLAYERS_CACHE_TTL_SECONDS * 1000,
  });
}
