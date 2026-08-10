import type { Platform, ToolParams } from '../types';
import type { RouteResult } from '../router';

/**
 * Provider-neutral normalization for get_free_agents (FLA-216).
 *
 * Additive and in place: canonical fields are layered onto the provider
 * envelope and entries; every legacy provider field stays untouched, because
 * published clients pin old schemas and the wire carries no client version.
 *
 * SAFETY: the gateway declares the canonical envelope fields as required in
 * the tool's outputSchema, and the MCP SDK turns a non-error structuredContent
 * mismatch into a protocol error. Every path through here therefore returns
 * either a fully normalized, schema-valid success or an explicit tool error —
 * a malformed provider success (non-object payload, non-array entries value,
 * non-object entry) is converted to MALFORMED_PROVIDER_RESPONSE, never passed
 * through. Unknown provider values map to null or are omitted, never guessed.
 * Canonical keys are computed fresh each call; provider-supplied values under
 * those keys are discarded so capability rules cannot be defeated upstream.
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

function malformed(detail: string): RouteResult {
  return {
    success: false,
    code: 'MALFORMED_PROVIDER_RESPONSE',
    error: `MALFORMED_PROVIDER_RESPONSE: the platform returned an unexpected free-agent payload shape (${detail}); retry, and report the league if it persists`,
  } as RouteResult;
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

/**
 * Positive finite epoch-ms → ISO 8601; anything else is omitted, never
 * invented. Zero/negative epochs (1970 and earlier) are provider garbage for
 * a waiver clear date and fail closed to omission by design.
 */
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

/**
 * Copy an entry with the canonical keys this platform computes removed, so
 * provider-supplied values can never masquerade as gateway normalization.
 * Sleeper's `id` is the one shared legacy/canonical key and is kept.
 */
function stripReservedKeys(entry: Record<string, unknown>, keepId: boolean): Record<string, unknown> {
  const { acquisitionState: _a, waiverClearsAt: _w, team: _t, id, ...rest } = entry;
  void _a; void _w; void _t;
  return keepId && id !== undefined ? { ...rest, id } : rest;
}

function normalizeEspnEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const normalized = stripReservedKeys(entry, false);
  normalized.acquisitionState = espnAcquisitionState(entry.status);
  // Canonical club field; ESPN's legacy proTeam (with its 'FA' no-club
  // sentinel) is intentionally left untouched beside it.
  normalized.team =
    typeof entry.proTeam === 'string' && entry.proTeam !== 'FA' && entry.proTeam !== '' ? entry.proTeam : null;
  const id = asIdString(entry.playerId);
  if (id !== undefined) normalized.id = id;
  const waiverClearsAt = isoFromEpochMs(entry.waiverProcessDate);
  if (waiverClearsAt !== undefined) normalized.waiverClearsAt = waiverClearsAt;
  return normalized;
}

function normalizeYahooEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const normalized = stripReservedKeys(entry, false);
  normalized.team = typeof entry.team === 'string' && entry.team !== '' ? entry.team : null;
  const id = asIdString(entry.playerId);
  if (id !== undefined) normalized.id = id;
  return normalized;
}

function normalizeSleeperEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const normalized = stripReservedKeys(entry, true);
  normalized.team = typeof entry.team === 'string' && entry.team !== '' ? entry.team : null;
  // Sleeper ids are already strings today; coerce defensively so the canonical
  // id is uniformly a string if the upstream type ever drifts.
  const id = asIdString(entry.id);
  if (id !== undefined) normalized.id = id;
  else delete normalized.id;
  return normalized;
}

const ENTRY_NORMALIZERS: Record<Platform, (entry: Record<string, unknown>) => Record<string, unknown>> = {
  espn: normalizeEspnEntry,
  yahoo: normalizeYahooEntry,
  sleeper: normalizeSleeperEntry,
};

/**
 * Layer the canonical free-agent contract onto a routed provider result.
 * Error results pass through untouched; malformed successes become explicit
 * MALFORMED_PROVIDER_RESPONSE tool errors (error responses are exempt from
 * outputSchema validation, so this is the protocol-safe fail-closed path).
 */
export function normalizeFreeAgentsResult(result: RouteResult, params: ToolParams): RouteResult {
  if (!result.success) return result;
  if (!isPlainObject(result.data)) return malformed('non-object payload');

  try {
    const data = result.data;
    const platform = params.platform;
    const entryKey = ENTRY_ARRAY_KEY[platform];
    const rawEntries = data[entryKey];

    if (rawEntries !== undefined && !Array.isArray(rawEntries)) return malformed('non-array player list');

    let entries: Record<string, unknown>[] | undefined;
    if (Array.isArray(rawEntries)) {
      entries = [];
      for (const entry of rawEntries) {
        if (!isPlainObject(entry)) return malformed('non-object player entry');
        entries.push(ENTRY_NORMALIZERS[platform](entry));
      }
    }

    // Request echoes and count come from authoritative inputs (validated
    // params, actual returned length), not from provider envelope claims.
    const normalized: Record<string, unknown> = {
      ...data,
      leagueId: canonicalLeagueId(platform, data, params),
      seasonYear: params.season_year,
      position: (params.position || 'ALL').toUpperCase(),
      count: entries ? entries.length : 0,
      ordering: ORDERING[platform],
      capabilities: { ...CAPABILITIES[platform] },
      ownershipScope: OWNERSHIP_SCOPE[platform],
    };
    if (entries !== undefined) normalized[entryKey] = entries;

    return { ...result, data: normalized };
  } catch {
    // Totality guard: an unanticipated payload shape must degrade to the
    // explicit malformed error, never to a thrown exception or an
    // un-normalized success that would fail schema validation.
    return malformed('unexpected payload structure');
  }
}
