import type { Platform, ToolParams } from '../types';
import type { RouteResult } from '../router';

/**
 * Provider-neutral normalization for get_free_agents (FLA-216).
 *
 * Additive and in place: canonical fields are layered onto the provider
 * envelope and entries; every legacy provider field stays untouched, because
 * published clients pin old schemas and the wire carries no client version.
 *
 * SAFETY: this function must be total. The gateway declares the canonical
 * envelope fields as required in the tool's outputSchema, and the MCP SDK
 * turns a structuredContent mismatch into a protocol error — so every path
 * through here must either add the full canonical envelope or return the
 * result untouched (non-object payloads, which already fail today's schema).
 * Unknown provider values map to null; they are never guessed.
 */

interface FreeAgentCapabilities {
  acquisitionState: boolean;
  rosteredRate: boolean;
  startedRate: boolean;
}

const CAPABILITIES: Record<Platform, FreeAgentCapabilities> = {
  espn: { acquisitionState: true, rosteredRate: true, startedRate: true },
  yahoo: { acquisitionState: false, rosteredRate: true, startedRate: false },
  sleeper: { acquisitionState: false, rosteredRate: false, startedRate: false },
};

const ORDERING: Record<Platform, string> = {
  // ESPN sorts provider-side by platform-wide rostered rate (draft-rank tiebreak);
  // Yahoo is sorted locally the same way (nulls last, name/id tiebreak).
  espn: 'platform_rostered_rate_desc',
  yahoo: 'platform_rostered_rate_desc',
  sleeper: 'alphabetical',
};

const OWNERSHIP_SCOPE: Record<Platform, string> = {
  espn: 'platform_global',
  yahoo: 'platform_global',
  sleeper: 'unavailable',
};

const ENTRY_ARRAY_KEY: Record<Platform, string> = {
  espn: 'freeAgents',
  yahoo: 'freeAgents',
  sleeper: 'players',
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asIdString(value: unknown): string | undefined {
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/** ESPN status → canonical acquisition state; unknown/missing fails closed to null. */
function espnAcquisitionState(status: unknown): 'free_agent' | 'waivers' | null {
  if (status === 'FREEAGENT') return 'free_agent';
  if (status === 'WAIVERS') return 'waivers';
  return null;
}

/** Valid finite epoch-ms → ISO 8601; anything else is omitted, never invented. */
function isoFromEpochMs(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function canonicalLeagueId(platform: Platform, data: Record<string, unknown>, params: ToolParams): string {
  const providerKey = platform === 'yahoo' ? 'leagueKey' : platform === 'sleeper' ? 'league_id' : 'leagueId';
  const fromProvider = data[providerKey];
  if (typeof fromProvider === 'string' && fromProvider.length > 0) return fromProvider;
  if (typeof fromProvider === 'number' && Number.isFinite(fromProvider)) return String(fromProvider);
  return params.league_id;
}

function normalizeEspnEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
    ...entry,
    acquisitionState: espnAcquisitionState(entry.status),
    // Canonical club field; ESPN's legacy proTeam (with its 'FA' no-club
    // sentinel) is intentionally left untouched beside it.
    team: typeof entry.proTeam === 'string' && entry.proTeam !== 'FA' && entry.proTeam !== '' ? entry.proTeam : null,
  };
  const id = asIdString(entry.playerId);
  if (id !== undefined) normalized.id = id;
  const waiverClearsAt = isoFromEpochMs(entry.waiverProcessDate);
  if (waiverClearsAt !== undefined) normalized.waiverClearsAt = waiverClearsAt;
  return normalized;
}

function normalizeYahooEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = {
    ...entry,
    team: typeof entry.team === 'string' && entry.team !== '' ? entry.team : null,
  };
  const id = asIdString(entry.playerId);
  if (id !== undefined) normalized.id = id;
  return normalized;
}

function normalizeSleeperEntry(entry: Record<string, unknown>): Record<string, unknown> {
  return {
    ...entry,
    team: typeof entry.team === 'string' && entry.team !== '' ? entry.team : null,
  };
}

const ENTRY_NORMALIZERS: Record<Platform, (entry: Record<string, unknown>) => Record<string, unknown>> = {
  espn: normalizeEspnEntry,
  yahoo: normalizeYahooEntry,
  sleeper: normalizeSleeperEntry,
};

/**
 * Layer the canonical free-agent contract onto a routed provider result.
 * Returns the result untouched for errors and non-object payloads.
 */
export function normalizeFreeAgentsResult(result: RouteResult, params: ToolParams): RouteResult {
  if (!result.success || !isPlainObject(result.data)) return result;

  try {
    const data = result.data;
    const platform = params.platform;
    const entryKey = ENTRY_ARRAY_KEY[platform];
    const rawEntries = data[entryKey];

    const entries = Array.isArray(rawEntries)
      ? rawEntries.map((entry) => (isPlainObject(entry) ? ENTRY_NORMALIZERS[platform](entry) : entry))
      : rawEntries;

    const normalized: Record<string, unknown> = {
      ...data,
      leagueId: canonicalLeagueId(platform, data, params),
      seasonYear: typeof data.seasonYear === 'number' ? data.seasonYear : params.season_year,
      position: typeof data.position === 'string' ? data.position : (params.position || 'ALL').toUpperCase(),
      count: typeof data.count === 'number' ? data.count : Array.isArray(entries) ? entries.length : 0,
      ordering: ORDERING[platform],
      capabilities: { ...CAPABILITIES[platform] },
      ownershipScope: OWNERSHIP_SCOPE[platform],
    };
    if (entries !== undefined) normalized[entryKey] = entries;

    return { ...result, data: normalized };
  } catch {
    // Totality guard: an unanticipated payload shape must degrade to the
    // legacy passthrough response, never to a thrown error.
    return result;
  }
}
