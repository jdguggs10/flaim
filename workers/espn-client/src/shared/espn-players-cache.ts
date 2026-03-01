import type { Env } from '../types';
import { espnFetch } from './espn-api';

const PLAYERS_CACHE_TTL_SECONDS = 24 * 60 * 60;

export interface EspnPlayerRecord {
  id: number;
  fullName: string;
  defaultPositionId: number;
  proTeamId: number;
  percentOwned: number;
}

type EspnPlayerCacheSport = 'football' | 'baseball' | 'basketball' | 'hockey';

const GAME_ID_MAP: Record<EspnPlayerCacheSport, string> = {
  football: 'ffl',
  baseball: 'flb',
  basketball: 'fba',
  hockey: 'fhl',
};

const PLAYER_LIMITS: Record<EspnPlayerCacheSport, number> = {
  football: 3000,
  baseball: 5000,
  basketball: 2000,
  hockey: 2000,
};

function cacheKey(sport: EspnPlayerCacheSport, year: number): string {
  return `espn-players:${sport}:${year}:v1`;
}

function parsePlayerRecord(raw: unknown): EspnPlayerRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === 'number' ? r.id : null;
  const fullName = typeof r.fullName === 'string' && r.fullName.trim() ? r.fullName.trim() : null;
  if (!id || !fullName) return null;

  const ownership = r.ownership as Record<string, unknown> | undefined;
  const percentOwned = typeof ownership?.percentOwned === 'number' ? ownership.percentOwned : 0;

  return {
    id,
    fullName,
    defaultPositionId: typeof r.defaultPositionId === 'number' ? r.defaultPositionId : 0,
    proTeamId: typeof r.proTeamId === 'number' ? r.proTeamId : 0,
    percentOwned,
  };
}

export async function getEspnPlayersIndex(
  env: Env,
  sport: EspnPlayerCacheSport,
  year: number,
): Promise<Map<number, EspnPlayerRecord>> {
  const key = cacheKey(sport, year);

  let cached: string | null = null;
  try {
    cached = await env.ESPN_PLAYERS_CACHE.get(key);
  } catch {
    // KV read failed — fall through to fetch
  }

  if (cached) {
    try {
      const parsed = JSON.parse(cached) as unknown[];
      if (Array.isArray(parsed)) {
        const index = new Map<number, EspnPlayerRecord>();
        for (const item of parsed) {
          const record = parsePlayerRecord(item);
          if (record) index.set(record.id, record);
        }
        return index;
      }
    } catch {
      // Corrupt cache — fall through to fetch
    }
  }

  const gameId = GAME_ID_MAP[sport];
  const limit = PLAYER_LIMITS[sport];
  const path = `/seasons/${year}/players?view=players_wl`;
  const filterHeader = JSON.stringify({
    limit,
    sortPercOwned: { sortPriority: 1, sortAsc: false },
  });

  const response = await espnFetch(path, gameId, {
    timeout: 15000,
    headers: { 'X-Fantasy-Filter': filterHeader },
  });

  if (!response.ok) {
    throw new Error(`ESPN_API_ERROR: players_wl returned ${response.status} for ${sport}`);
  }

  const payload = await response.json() as unknown[];
  const players = Array.isArray(payload) ? payload : [];

  const records: EspnPlayerRecord[] = [];
  for (const item of players) {
    const record = parsePlayerRecord(item);
    if (record) records.push(record);
  }

  try {
    await env.ESPN_PLAYERS_CACHE.put(key, JSON.stringify(records), {
      expirationTtl: PLAYERS_CACHE_TTL_SECONDS,
    });
  } catch (error) {
    console.error('[espn-players-cache] KV write failed; serving from fetch:', error);
  }

  const index = new Map<number, EspnPlayerRecord>();
  for (const record of records) {
    index.set(record.id, record);
  }
  return index;
}
