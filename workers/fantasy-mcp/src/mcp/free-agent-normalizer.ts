import { ErrorCode } from '@flaim/worker-shared';
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

interface PlatformFreeAgentConfig {
  capabilities: FreeAgentCapabilities;
  ordering: 'platform_rostered_rate_desc' | 'alphabetical';
  ownershipScope: 'platform_global' | 'unavailable';
  entryArrayKey: 'freeAgents' | 'players';
  normalizeEntry: (entry: Record<string, unknown>) => Record<string, unknown>;
}

// One config per platform — adding a platform means adding exactly one entry here.
// ESPN sorts provider-side by platform-wide rostered rate (draft-rank tiebreak);
// Yahoo is sorted locally the same way (nulls last, name/id tiebreak).
const PLATFORM_CONFIG: Record<Platform, PlatformFreeAgentConfig> = {
  espn: {
    capabilities: { acquisitionState: true, rosteredRate: true, startedRate: true },
    ordering: 'platform_rostered_rate_desc',
    ownershipScope: 'platform_global',
    entryArrayKey: 'freeAgents',
    normalizeEntry: normalizeEspnEntry,
  },
  yahoo: {
    capabilities: { acquisitionState: false, rosteredRate: true, startedRate: false },
    ordering: 'platform_rostered_rate_desc',
    ownershipScope: 'platform_global',
    entryArrayKey: 'freeAgents',
    normalizeEntry: normalizeYahooEntry,
  },
  sleeper: {
    capabilities: { acquisitionState: false, rosteredRate: false, startedRate: false },
    ordering: 'alphabetical',
    ownershipScope: 'unavailable',
    entryArrayKey: 'players',
    normalizeEntry: normalizeSleeperEntry,
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function malformed(platform: Platform, detail: string): RouteResult {
  // Structured log so fleet-wide provider-envelope drift is visible in
  // observability queries — the tool-level logger records this as a normal
  // (non-thrown) error result, and the router already saw a success.
  console.error(JSON.stringify({
    schema_version: 1,
    service: 'fantasy-mcp',
    component: 'free-agent-normalizer',
    event: 'malformed_provider_payload',
    outcome: 'failure',
    error_code: ErrorCode.MALFORMED_PROVIDER_RESPONSE,
    platform,
    detail,
  }));
  return {
    success: false,
    code: ErrorCode.MALFORMED_PROVIDER_RESPONSE,
    error: `${ErrorCode.MALFORMED_PROVIDER_RESPONSE}: the platform returned an unexpected free-agent payload shape (${detail}); retry, and report the league if it persists`,
    // The realistic trigger is transient (mid-deploy skew between provider
    // and gateway workers), so a single retry is worthwhile — matching the
    // prose advice above.
    retryable: true,
  };
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
 * Copy an entry with every canonical key removed, so provider-supplied
 * values can never masquerade as gateway normalization — each platform
 * normalizer recomputes its canonical fields from the legacy source fields.
 * Two legacy keys are shared with the canonical layer and therefore
 * normalized in place rather than preserved verbatim: Sleeper's `id`
 * (recomputed from its own `id`, coerced to string) and Yahoo/Sleeper's
 * `team` (empty or missing becomes null).
 */
function stripReservedKeys(entry: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...entry };
  delete copy.acquisitionState;
  delete copy.waiverClearsAt;
  delete copy.team;
  delete copy.id;
  return copy;
}

function normalizeEspnEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const normalized = stripReservedKeys(entry);
  const acquisitionState = espnAcquisitionState(entry.status);
  normalized.acquisitionState = acquisitionState;
  // Canonical club field; ESPN's legacy proTeam (with its 'FA' no-club
  // sentinel) is intentionally left untouched beside it.
  normalized.team =
    typeof entry.proTeam === 'string' && entry.proTeam !== 'FA' && entry.proTeam !== '' ? entry.proTeam : null;
  const id = asIdString(entry.playerId);
  if (id !== undefined) normalized.id = id;
  // A waiver clear time only makes sense on a row that is actually on
  // waivers; a stray provider timestamp on a free-agent or unknown-status
  // row would otherwise produce a self-contradictory entry.
  if (acquisitionState === 'waivers') {
    const waiverClearsAt = isoFromEpochMs(entry.waiverProcessDate);
    if (waiverClearsAt !== undefined) normalized.waiverClearsAt = waiverClearsAt;
  }
  return normalized;
}

function normalizeYahooEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const normalized = stripReservedKeys(entry);
  normalized.team = typeof entry.team === 'string' && entry.team !== '' ? entry.team : null;
  const id = asIdString(entry.playerId);
  if (id !== undefined) normalized.id = id;
  return normalized;
}

function normalizeSleeperEntry(entry: Record<string, unknown>): Record<string, unknown> {
  const normalized = stripReservedKeys(entry);
  normalized.team = typeof entry.team === 'string' && entry.team !== '' ? entry.team : null;
  // Sleeper ids are already strings today; coerce defensively so the canonical
  // id is uniformly a string if the upstream type ever drifts.
  const id = asIdString(entry.id);
  if (id !== undefined) normalized.id = id;
  return normalized;
}

/**
 * Layer the canonical free-agent contract onto a routed provider result.
 * Error results pass through untouched; malformed successes become explicit
 * MALFORMED_PROVIDER_RESPONSE tool errors (error responses are exempt from
 * outputSchema validation, so this is the protocol-safe fail-closed path).
 */
export function normalizeFreeAgentsResult(result: RouteResult, params: ToolParams): RouteResult {
  if (!result.success) return result;
  if (!isPlainObject(result.data)) return malformed(params.platform, 'non-object payload');

  try {
    const data = result.data;
    const platform = params.platform;
    const config = PLATFORM_CONFIG[platform];
    const rawEntries = data[config.entryArrayKey];

    // Every provider handler always sets its entry-array key, even for empty
    // and degraded results — absence can only mean cross-worker contract
    // drift, so it fails closed rather than becoming an authoritative
    // "0 players available".
    if (rawEntries === undefined) return malformed(platform, 'missing player list');
    if (!Array.isArray(rawEntries)) return malformed(platform, 'non-array player list');

    const entries: Record<string, unknown>[] = [];
    for (const entry of rawEntries) {
      if (!isPlainObject(entry)) return malformed(platform, 'non-object player entry');
      entries.push(config.normalizeEntry(entry));
    }

    // Request echoes and count come from authoritative inputs (validated
    // params, actual returned length), not from provider envelope claims.
    const normalized: Record<string, unknown> = {
      ...data,
      leagueId: canonicalLeagueId(platform, data, params),
      seasonYear: params.season_year,
      position: (params.position || 'ALL').toUpperCase(),
      count: entries.length,
      ordering: config.ordering,
      capabilities: { ...config.capabilities },
      ownershipScope: config.ownershipScope,
    };
    normalized[config.entryArrayKey] = entries;

    return { ...result, data: normalized };
  } catch (error) {
    // Totality guard: an unanticipated payload shape must degrade to the
    // explicit malformed error, never to a thrown exception or an
    // un-normalized success that would fail schema validation. Log the real
    // error so a normalizer bug is not misread as a provider problem.
    console.error('[fantasy-mcp] free-agent normalization failed:', error);
    return malformed(params.platform, 'unexpected payload structure');
  }
}
