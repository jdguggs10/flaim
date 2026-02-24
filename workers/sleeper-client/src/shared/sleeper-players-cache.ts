import type { Env } from '../types';
import { handleSleeperError, sleeperFetch } from './sleeper-api';

const PLAYERS_CACHE_TTL_SECONDS = 24 * 60 * 60;
const inMemoryPlayersCache = new Map<string, { value: string; expiresAt: number }>();

export function clearSleeperPlayersInMemoryCacheForTesting(): void {
  inMemoryPlayersCache.clear();
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
      if (!parsed || !parsed.active) continue;
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
    if (!parsed || !parsed.active) continue;
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
  const now = Date.now();
  const cachedInMemory = inMemoryPlayersCache.get(cacheKey);
  let cached = cachedInMemory && cachedInMemory.expiresAt > now ? cachedInMemory.value : null;

  if (!cached) cached = await env.SLEEPER_PLAYERS_CACHE.get(cacheKey);

  if (cached) {
    try {
      const parsedCached = normalizePlayers(JSON.parse(cached));
      if (parsedCached) {
        inMemoryPlayersCache.set(cacheKey, {
          value: cached,
          expiresAt: now + PLAYERS_CACHE_TTL_SECONDS * 1000,
        });
        return toPlayerIndex(parsedCached);
      }
    } catch {
      // Defensive fallback: refetch from Sleeper when cache data is malformed.
    }
  }

  const response = await sleeperFetch(toCacheSportPath(sport));
  if (!response.ok) handleSleeperError(response);

  const payload = await response.json();
  const parsedPlayers = normalizePlayers(payload) ?? [];
  const serialized = JSON.stringify(parsedPlayers);
  await env.SLEEPER_PLAYERS_CACHE.put(cacheKey, serialized, {
    expirationTtl: PLAYERS_CACHE_TTL_SECONDS,
  });
  inMemoryPlayersCache.set(cacheKey, {
    value: serialized,
    expiresAt: now + PLAYERS_CACHE_TTL_SECONDS * 1000,
  });

  return toPlayerIndex(parsedPlayers);
}
