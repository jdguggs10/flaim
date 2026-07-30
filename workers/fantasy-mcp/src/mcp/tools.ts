// workers/fantasy-mcp/src/mcp/tools.ts
import { z } from 'zod';
import type { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import type { Env, Platform, Sport, ToolParams } from '../types';
import { routeToClient, type RouteResult } from '../router';
import {
  ErrorCode,
  getDefaultSeasonYear,
  getSeasonLabel,
  logSetupSignal,
  validateRosterSnapshotInput,
  validateTransactionWeekInput,
  withCorrelationId,
  withEvalHeaders,
  withInternalServiceToken,
  type SetupSignalEvent,
} from '@flaim/worker-shared';
import { logEvalEvent } from '../logging';
import { USER_SESSION_WIDGET_URI } from '../widgets/user-session-widget';

// =============================================================================
// MCP RESPONSE TYPES
// =============================================================================

export interface McpToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
  // Index signature to satisfy MCP SDK types
  [key: string]: unknown;
}

export type ToolSecuritySchemes = Array<{
  type: 'oauth2';
  scopes: string[];
}>;

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface UnifiedTool {
  name: string;
  title: string;
  description: string;
  inputSchema: ZodRawShapeCompat;
  /**
   * Declared output schema for structuredContent (FLA-177). Constructed zod
   * object schemas (not raw shapes) so the root object can be .passthrough():
   * the SDK serializes them through the same toJsonSchemaCompat path as
   * inputSchema, and a raw shape would serialize with additionalProperties:false
   * at the root — a too-tight advertisement for tolerant envelopes.
   */
  outputSchema: z.ZodTypeAny;
  requiredScope: 'mcp:read' | 'mcp:write';
  securitySchemes: ToolSecuritySchemes;
  annotations: ToolAnnotations;
  openaiMeta?: {
    invoking: string;
    invoked: string;
  };
  widgetUri?: string;
  handler: (
    args: Record<string, unknown>,
    env: Env,
    authHeader?: string,
    correlationId?: string,
    evalRunId?: string,
    evalTraceId?: string
  ) => Promise<McpToolResponse>;
}

/**
 * Check whether a granted OAuth scope string includes the required scope.
 * Fail-closed: returns false if grantedScope is missing or empty.
 */
export function hasRequiredScope(grantedScope: string | undefined, requiredScope: 'mcp:read' | 'mcp:write'): boolean {
  if (!grantedScope) return false;
  const granted = new Set(grantedScope.split(/\s+/).filter(Boolean));
  return granted.has(requiredScope);
}

function buildSecuritySchemes(scope: 'mcp:read' | 'mcp:write'): ToolSecuritySchemes {
  return [{ type: 'oauth2', scopes: [scope] }];
}

// openWorldHint is false for every Flaim tool: these are closed-system reads
// (and one registry refresh) against the user's connected leagues — current
// OpenAI guidance reserves openWorld for tools that change publicly visible
// internet state.
const READ_ONLY_TOOL_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const REFRESH_TOOL_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  // Not idempotent under the strict MCP definition: each call re-runs provider
  // discovery and can update registry timestamps/metadata, so repeating the
  // call has additional effect even though the end state converges.
  idempotentHint: false,
  openWorldHint: false,
};

// =============================================================================
// OUTPUT SCHEMAS (FLA-177)
// =============================================================================
// SAFETY: the MCP SDK validates every non-error structuredContent against the
// declared outputSchema at runtime and turns a mismatch into a protocol error,
// so a too-tight schema is a production tool outage. Rules:
// - every object is .passthrough() — never .strict()/additionalProperties:false
// - required fields are limited to keys the assembly code ALWAYS sets
// - anything platform-variant is optional and/or nullable
// When in doubt, loosen.

function looseObject(shape: z.ZodRawShape = {}) {
  return z.object(shape).passthrough();
}

/**
 * League entry as returned by get_user_session.allLeagues and get_ancient_history.
 * sport is optional/nullable defensively: gateway assembly already guards absent
 * sport (l.sport?.toLowerCase()), and the registry column's NOT NULL constraint
 * could not be proven from migrations — a null must never become a protocol error.
 */
const leagueEntrySchema = looseObject({
  leagueId: z.string(),
  sport: z.string().nullable().optional(),
  platform: z.string(),
  teamId: z.string().optional(),
  seasonYear: z.number().nullable().optional(),
  leagueName: z.string().nullable().optional(),
  teamName: z.string().nullable().optional(),
  recurringLeagueId: z.string().optional(),
});

/** Default-league summary built by get_user_session (defaultLeague / defaultLeagues values). */
const defaultLeagueSchema = looseObject({
  platform: z.string(),
  leagueId: z.string(),
  sport: z.string().optional(),
  teamId: z.string().optional(),
  seasonYear: z.number().optional(),
  season: z.string().optional(),
  leagueName: z.string().optional(),
  teamName: z.string().optional(),
});

const seasonInfoSchema = looseObject({
  year: z.number(),
  label: z.string(),
});

const GET_USER_SESSION_OUTPUT_SCHEMA = looseObject({
  success: z.boolean(),
  currentDate: z.string(),
  currentSeasons: looseObject({
    football: seasonInfoSchema,
    baseball: seasonInfoSchema,
    basketball: seasonInfoSchema,
    hockey: seasonInfoSchema,
  }),
  timezone: z.string(),
  totalLeaguesFound: z.number(),
  leaguesBySport: z.record(z.number()),
  defaultSport: z.string().nullable(),
  defaultLeague: defaultLeagueSchema.nullable(),
  defaultLeagues: z.record(defaultLeagueSchema),
  allLeagues: z.array(leagueEntrySchema),
  warnings: z.array(z.string()).optional(),
  instructions: z.string(),
});

const REFRESH_LEAGUES_OUTPUT_SCHEMA = looseObject({
  success: z.boolean(),
  requestedPlatforms: z.array(z.string()).optional(),
  results: z
    .record(
      looseObject({
        platform: z.string(),
        status: z.string().describe('success, skipped, or error'),
        httpStatus: z.number().optional(),
        error: z.string().optional(),
        error_description: z.string().optional(),
        retryAfter: z.string().optional(),
        details: z.unknown().optional(),
      })
    )
    .optional()
    .describe('Per-platform refresh outcome keyed by platform name'),
});

const GET_ANCIENT_HISTORY_OUTPUT_SCHEMA = looseObject({
  success: z.boolean(),
  thresholdYear: z.number(),
  oldLeagues: z.array(leagueEntrySchema),
  oldSeasonsFromActiveLeagues: z.record(z.array(leagueEntrySchema)),
  totalOldLeagues: z.number(),
  totalOldSeasons: z.number(),
  warnings: z.array(z.string()).optional(),
});

/**
 * Routed-tool envelope: {success: true, data: <platform envelope>}. The data
 * shape is the tolerant union of the per-platform envelope fields — every field
 * optional, deep entries passthrough — because ESPN, Yahoo, and Sleeper return
 * deliberately different envelopes for the same tool.
 */
function routedOutputSchema(dataShape: z.ZodRawShape) {
  return looseObject({
    success: z.boolean(),
    data: looseObject(dataShape).describe(
      'Platform envelope. Field availability varies by platform (ESPN, Yahoo, Sleeper); absent fields are not provided by that platform.'
    ),
  });
}

const GET_LEAGUE_INFO_OUTPUT_SCHEMA = routedOutputSchema({
  // ESPN
  id: z.union([z.string(), z.number()]).optional(),
  size: z.number().optional(),
  scoringPeriodId: z.number().optional(),
  currentMatchupPeriod: z.number().optional(),
  seasonId: z.number().optional(),
  segmentId: z.number().optional(),
  scoringSettings: looseObject().optional(),
  roster: looseObject().optional(),
  schedule: looseObject().optional(),
  // Yahoo
  leagueKey: z.string().optional(),
  leagueId: z.union([z.string(), z.number()]).optional(),
  url: z.string().optional(),
  numTeams: z.union([z.number(), z.string()]).optional(),
  scoringType: z.string().optional(),
  currentWeek: z.union([z.number(), z.string()]).optional(),
  startWeek: z.union([z.number(), z.string()]).optional(),
  endWeek: z.union([z.number(), z.string()]).optional(),
  isFinished: z.boolean().optional(),
  draftStatus: z.string().optional(),
  // Sleeper
  sport: z.string().optional(),
  season: z.union([z.string(), z.number()]).optional(),
  totalRosters: z.number().optional(),
  rosterPositions: z.array(z.unknown()).optional(),
  previousLeagueId: z.string().nullable().optional(),
  draftId: z.string().nullable().optional(),
  // Shared
  name: z.string().optional(),
  // ESPN returns a status object; Yahoo/Sleeper return status strings.
  status: z.unknown().optional(),
  teams: z
    .array(looseObject({ ownerName: z.string().nullable().optional() }))
    .optional()
    .describe('Team/owner context; exact team fields vary by platform but all include ownerName'),
});

const standingsEntrySchema = looseObject({
  playoffSeed: z.number().nullable().optional(),
  finalRank: z.number().nullable().optional().describe('Verified postseason finish; null when not verifiable'),
  championshipWon: z.boolean().nullable().optional(),
  playoffOutcome: z.string().nullable().optional(),
  outcomeConfidence: z.string().nullable().optional().describe('explicit or derived; null when unknown'),
  madePlayoffs: z.boolean().nullable().optional(),
});

const GET_STANDINGS_OUTPUT_SCHEMA = routedOutputSchema({
  leagueId: z.string().optional(),
  seasonYear: z.number().optional(),
  leagueKey: z.string().optional(),
  leagueName: z.string().optional(),
  seasonPhase: z.string().optional().describe('regular_season, playoffs_in_progress, or season_complete'),
  seasonComplete: z.boolean().optional(),
  standings: z.array(standingsEntrySchema).optional(),
});

const GET_MATCHUPS_OUTPUT_SCHEMA = routedOutputSchema({
  leagueId: z.string().optional(),
  seasonYear: z.number().optional(),
  currentScoringPeriod: z.number().optional(),
  matchupPeriod: z.number().nullable().optional(),
  leagueKey: z.string().optional(),
  leagueName: z.string().optional(),
  currentWeek: z.union([z.number(), z.string()]).optional(),
  matchupWeek: z.union([z.number(), z.string()]).optional(),
  week: z.number().optional(),
  matchups: z
    .array(
      looseObject({
        home: looseObject().nullable().optional(),
        away: looseObject().nullable().optional(),
      })
    )
    .optional(),
});

const GET_ROSTER_OUTPUT_SCHEMA = routedOutputSchema({
  leagueId: z.string().optional(),
  teamId: z.union([z.string(), z.number()]).optional(),
  teamKey: z.string().optional(),
  teamName: z.string().optional(),
  rosterId: z.number().optional(),
  ownerId: z.string().nullable().optional(),
  ownerName: z.string().nullable().optional(),
  snapshot: looseObject({ type: z.string() })
    .optional()
    .describe('Identifies what was returned: current, week, or date'),
  roster: z.array(looseObject()).optional().describe('ESPN roster entries'),
  players: z.array(looseObject()).optional().describe('Yahoo roster entries'),
  starters: z.array(z.unknown()).optional(),
  bench: z.array(z.unknown()).optional(),
  reserve: z.array(z.unknown()).optional(),
  taxi: z.array(z.unknown()).optional(),
  record: looseObject().optional(),
  points: z.number().nullable().optional(),
  playersPoints: z.record(z.unknown()).optional(),
  rosters: z.array(looseObject()).optional().describe('Sleeper league-wide roster list when no team is selected'),
  limitations: looseObject().optional(),
});

const freeAgentEntrySchema = looseObject({
  percentOwned: z
    .number()
    .nullable()
    .optional()
    .describe('ESPN-wide roster rate or Yahoo-wide market rate; null/absent when the provider reports none'),
  percentStarted: z.number().nullable().optional(),
  status: z.string().nullable().optional(),
  waiverProcessDate: z.union([z.string(), z.number()]).nullable().optional(),
});

const GET_FREE_AGENTS_OUTPUT_SCHEMA = routedOutputSchema({
  // ESPN
  leagueId: z.string().optional(),
  seasonYear: z.number().optional(),
  // Yahoo
  leagueKey: z.string().optional(),
  leagueName: z.string().optional(),
  position: z.string().optional(),
  freeAgents: z.array(freeAgentEntrySchema).optional().describe('ESPN/Yahoo available-player entries'),
  // Sleeper
  platform: z.string().optional(),
  sport: z.string().optional(),
  league_id: z.string().optional(),
  season_year: z.number().optional(),
  players: z.array(freeAgentEntrySchema).optional().describe('Sleeper available-player entries'),
  warning: z.string().optional(),
  // Shared
  count: z.number().optional(),
});

const searchPlayerEntrySchema = looseObject({
  id: z.string().optional(),
  name: z.string().optional(),
  team: z.string().nullable().optional(),
  position: z.string().nullable().optional(),
  market_percent_owned: z.number().nullable().optional(),
  ownership_scope: z.string().optional(),
  league_status: z.string().nullable().optional().describe('ROSTERED, FREE_AGENT, or null when unavailable'),
  league_team_name: z.string().nullable().optional(),
  league_owner_name: z.string().nullable().optional(),
});

const GET_PLAYERS_OUTPUT_SCHEMA = routedOutputSchema({
  platform: z.string().optional(),
  sport: z.string().optional(),
  query: z.string().optional(),
  count: z.number().optional(),
  leagueKey: z.string().optional(),
  leagueName: z.string().optional(),
  players: z.array(searchPlayerEntrySchema).optional(),
});

const transactionEntrySchema = looseObject({
  transaction_id: z.string().optional(),
  timestamp: z.number().optional(),
  date: z.string().optional(),
  type: z.string().optional(),
  status: z.string().nullable().optional(),
  week: z.number().nullable().optional(),
  provider_scoring_period_id: z.number().optional(),
  team_ids: z.array(z.union([z.string(), z.number()])).optional(),
  players_added: z.array(looseObject({
    id: z.string(),
    name: z.string().optional(),
    position: z.string().optional(),
    team: z.string().optional(),
  })).optional(),
  players_dropped: z.array(looseObject({
    id: z.string(),
    name: z.string().optional(),
    position: z.string().optional(),
    team: z.string().optional(),
  })).optional(),
  trade_sides: z.array(looseObject({
    team_id: z.string().optional(),
    acquired: z.array(looseObject({
      id: z.string(),
      name: z.string().optional(),
      position: z.string().optional(),
      team: z.string().optional(),
    })).optional(),
    gave_up: z.array(looseObject({
      id: z.string(),
      name: z.string().optional(),
      position: z.string().optional(),
      team: z.string().optional(),
    })).optional(),
  })).nullable().optional(),
  faab_bid: z.number().nullable().optional(),
  waiver_priority: z.number().nullable().optional(),
  draft_picks: z.array(z.unknown()).nullable().optional(),
});

const transactionWindowSchema = looseObject({
  mode: z.enum([
    'explicit_week',
    'recent_two_weeks',
    'recent_two_weeks_timestamp',
    'preseason',
  ]).optional(),
  unit: z.literal('matchup_period').optional(),
  requested_week: z.number().nullable().optional(),
  normalization: z.enum(['none', 'legacy_scoring_period_to_matchup']).optional(),
  weeks: z.array(z.number()).optional(),
  provider_scoring_period_ids: z.array(z.number()).optional(),
  start_date: z.string().nullable().optional(),
  end_date: z.string().nullable().optional(),
  date_bounds_kind: z.enum([
    'exact_contiguous',
    'envelope_non_contiguous',
    'unavailable',
  ]).optional(),
  timezone: z.literal('America/New_York').optional(),
});

const transactionLimitationsSchema = looseObject({
  structured_details_incomplete: z.literal(true),
  omitted_unscoped_rows: z.number().optional(),
  omitted_conflicting_rows: z.number().optional(),
  exact_date_bounds_unavailable: z.literal(true).optional(),
  window_coverage_incomplete: z.literal(true).optional(),
});

const GET_TRANSACTIONS_OUTPUT_SCHEMA = routedOutputSchema({
  platform: z.string().optional(),
  sport: z.string().optional(),
  league_id: z.string().optional(),
  season_year: z.number().optional(),
  window: transactionWindowSchema.optional(),
  source: z.enum([
    'mTransactions2',
    'mTransactions2_with_activity_trade_details',
    'activity_feed',
  ]).optional(),
  limitations: transactionLimitationsSchema.optional(),
  count: z.number().optional(),
  truncated: z.boolean().optional(),
  transactions: z.array(transactionEntrySchema).optional(),
  teams: z.record(z.string()).optional().describe('ESPN team ID to display name map'),
  warning: z.string().optional(),
  dropped_invalid_timestamp_count: z.number().optional(),
});

// =============================================================================
// HELPER: Active league threshold
// =============================================================================

/**
 * Get the threshold year for "active" leagues.
 * A league is active if it has a season >= this year.
 */
function getActiveThresholdYear(): number {
  return new Date().getFullYear() - 2;
}

function logMcpSetupFailure(
  env: Env,
  event: string,
  fields: Omit<SetupSignalEvent, 'service' | 'event' | 'outcome'>
): void {
  logSetupSignal({
    service: 'fantasy-mcp',
    event,
    environment: env.ENVIRONMENT || env.NODE_ENV,
    ...fields,
    outcome: 'failure',
  } as SetupSignalEvent & Record<string, unknown>);
}

function logSessionDiscoveryFailure(
  env: Env,
  platform: Platform,
  stage: string,
  correlationId: string | undefined,
  fields: Omit<SetupSignalEvent, 'service' | 'component' | 'event' | 'outcome' | 'platform' | 'stage' | 'correlation_id'>
): void {
  logMcpSetupFailure(env, 'session_discovery_failed', {
    component: 'session-discovery',
    platform,
    stage,
    correlation_id: correlationId,
    ...fields,
  });
}

// =============================================================================
// HELPER: Fetch user leagues from auth-worker
// =============================================================================

interface UserLeague {
  leagueId: string;
  sport: string;
  platform: string;
  teamId?: string;
  seasonYear?: number;
  leagueName?: string;
  teamName?: string;
  recurringLeagueId?: string;
}

function getYahooStableLeagueId(leagueId: string): string {
  const stableId = leagueId.match(/^[^.]+\.l\.(.+)$/)?.[1];
  return stableId || leagueId;
}

function getActiveLeagueGroupKey(league: UserLeague): string {
  if (league.platform === 'yahoo') {
    return `${league.platform}:${(league.sport || '').toLowerCase()}:${getYahooStableLeagueId(league.leagueId)}`;
  }
  if (league.platform === 'sleeper') {
    return `${league.platform}:${(league.sport || '').toLowerCase()}:${league.recurringLeagueId || league.leagueId}`;
  }
  if (league.platform === 'espn') {
    return `${league.platform}:${(league.sport || '').toLowerCase()}:${league.leagueId}`;
  }
  return `${league.platform}:${league.leagueId}`;
}

/**
 * Query suffix for the internal leagues endpoints. When `includeHistorical` is set
 * (get_ancient_history), request the 'exclude-hidden' filter so archived 'historical'
 * leagues are returned while 'hidden' ones stay suppressed. Absent → the endpoint
 * default 'exclude-archived' (the active get_user_session view, drops both modes).
 */
function archivedQuery(includeHistorical: boolean): string {
  return includeHistorical ? '?archived=exclude-hidden' : '';
}

async function refreshUserLeagues(
  env: Env,
  platforms: Platform[] | undefined,
  authHeader?: string,
  correlationId?: string,
  evalRunId?: string,
  evalTraceId?: string
): Promise<McpToolResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);
  const cid = correlationId || 'no-cid';

  try {
    console.log(`[fantasy-mcp] ${cid} refreshing leagues via auth-worker`);
    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    };
    const withCorrelation = correlationId ? withCorrelationId(baseHeaders, correlationId) : new Headers(baseHeaders);
    const withInternal = withInternalServiceToken(withCorrelation, env, 'auth-worker /internal/leagues/refresh');
    const headers = withEvalHeaders(withInternal, evalRunId, evalTraceId);

    const response = await env.AUTH_WORKER.fetch(
      new Request('https://internal/internal/leagues/refresh', {
        method: 'POST',
        headers,
        body: JSON.stringify(platforms && platforms.length > 0 ? { platforms } : {}),
        signal: controller.signal,
      })
    );

    clearTimeout(timeoutId);

    if (response.status === 401) {
      return mcpAuthError('https://api.flaim.app/mcp', 'mcp:write');
    }

    const contentType = response.headers.get('Content-Type') || '';
    const payload = contentType.includes('application/json')
      ? await response.json().catch(() => ({ success: false, error: 'Invalid JSON from auth-worker' }))
      : { success: response.ok, error: await response.text().catch(() => 'No response body') };

    if (
      response.status === 403 &&
      typeof payload === 'object' &&
      payload !== null &&
      (payload as { error?: unknown }).error === 'insufficient_scope'
    ) {
      // Genuine scope denial from the auth-worker's mcp:write gate — the body
      // says error="insufficient_scope". Surface the RFC 6750 challenge so
      // clients can run a consent upgrade. Auth-worker also returns 403 for a
      // missing/invalid internal service token (an ops misconfiguration, not a
      // user-consent problem); that and any other 403 fall through to the plain
      // structured tool error below with NO auth challenge.
      return mcpInsufficientScopeError('https://api.flaim.app/mcp', 'mcp:write');
    }

    if (!response.ok) {
      const errorPayload = {
        success: false,
        status: response.status,
        error: typeof payload === 'object' && payload !== null && 'error' in payload
          ? String((payload as { error?: unknown }).error)
          : `Auth-worker refresh failed with ${response.status}`,
        data: payload,
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(errorPayload, null, 2) }],
        structuredContent: errorPayload,
        isError: true,
      };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
      structuredContent: payload as Record<string, unknown>,
      ...(didRefreshBatchFail(payload) ? { isError: true } : {}),
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    const errorPayload = {
      success: false,
      code: isTimeout ? 'AUTH_WORKER_TIMEOUT' : 'AUTH_WORKER_REFRESH_FAILED',
      error: isTimeout
        ? 'League refresh timed out after 15 seconds'
        : `League refresh failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
    console.error(`[fantasy-mcp] ${cid} failed to refresh leagues:`, error);
    return {
      content: [{ type: 'text', text: JSON.stringify(errorPayload, null, 2) }],
      structuredContent: errorPayload,
      isError: true,
    };
  }
}

async function fetchUserLeagues(
  env: Env,
  authHeader?: string,
  correlationId?: string,
  evalRunId?: string,
  evalTraceId?: string,
  includeHistorical: boolean = false
): Promise<{ leagues: UserLeague[]; error?: string; status?: number }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  const cid = correlationId || 'no-cid';

  try {
    console.log(`[fantasy-mcp] ${cid} fetching leagues from auth-worker`);

    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    };
    const withCorrelation = correlationId ? withCorrelationId(baseHeaders, correlationId) : new Headers(baseHeaders);
    const withInternal = withInternalServiceToken(withCorrelation, env, 'auth-worker /internal/leagues');
    const headers = withEvalHeaders(withInternal, evalRunId, evalTraceId);

    const response = await env.AUTH_WORKER.fetch(
      new Request(`https://internal/internal/leagues${archivedQuery(includeHistorical)}`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      })
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      logSessionDiscoveryFailure(env, 'espn', 'league_fetch', correlationId, {
        failure_kind: response.status === 401 || response.status === 403 ? 'auth' : 'upstream',
        error_code: response.status === 401 || response.status === 403 ? 'auth_worker_auth_failed' : 'auth_worker_fetch_failed',
        http_status: response.status,
      });
      console.error(`[fantasy-mcp] ${cid} leagues fetch failed: ${response.status}`);
      const text = await response.text().catch(() => 'no body');
      return {
        leagues: [],
        error: `Auth-worker returned ${response.status}: ${text}`,
        status: response.status,
      };
    }

    const data = (await response.json()) as { success?: boolean; leagues?: UserLeague[] };
    const leagues = (data.leagues || []).map((l) => ({
      ...l,
      platform: l.platform || 'espn', // Default to espn for backward compatibility
    }));
    console.log(`[fantasy-mcp] ${cid} found ${leagues.length} leagues`);
    return { leagues };
  } catch (error) {
    clearTimeout(timeoutId);
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    logSessionDiscoveryFailure(env, 'espn', 'league_fetch', correlationId, {
      failure_kind: isTimeout ? 'timeout' : 'fetch_error',
      error_code: isTimeout ? 'auth_worker_timeout' : 'auth_worker_fetch_exception',
    });
    console.error(`[fantasy-mcp] ${cid} failed to fetch leagues:`, error);
    return {
      leagues: [],
      error:
        isTimeout
          ? 'Fetch timed out after 5 seconds'
          : `Fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

async function fetchYahooLeagues(
  env: Env,
  authHeader?: string,
  correlationId?: string,
  evalRunId?: string,
  evalTraceId?: string,
  includeHistorical: boolean = false
): Promise<{ leagues: UserLeague[]; error?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  const cid = correlationId || 'no-cid';

  try {
    console.log(`[fantasy-mcp] ${cid} fetching Yahoo leagues from auth-worker`);

    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    };
    const withCorrelation = correlationId ? withCorrelationId(baseHeaders, correlationId) : new Headers(baseHeaders);
    const withInternal = withInternalServiceToken(withCorrelation, env, 'auth-worker /internal/leagues/yahoo');
    const headers = withEvalHeaders(withInternal, evalRunId, evalTraceId);

    const response = await env.AUTH_WORKER.fetch(
      new Request(`https://internal/internal/leagues/yahoo${archivedQuery(includeHistorical)}`, {
        headers,
        signal: controller.signal,
      })
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      logSessionDiscoveryFailure(env, 'yahoo', 'league_fetch', correlationId, {
        failure_kind: response.status === 401 || response.status === 403 ? 'auth' : 'upstream',
        error_code: response.status === 401 || response.status === 403 ? 'auth_worker_auth_failed' : 'auth_worker_fetch_failed',
        http_status: response.status,
      });
      console.error(`[fantasy-mcp] ${cid} Yahoo leagues fetch failed: ${response.status}`);
      return { leagues: [], error: `Yahoo leagues fetch failed: ${response.status}` };
    }

    const data = (await response.json()) as {
      leagues?: Array<{
        sport: string;
        leagueKey: string;
        leagueName: string;
        teamId?: string;
        teamName?: string;
        seasonYear: number;
      }>;
    };

    const leagues: UserLeague[] = (data.leagues || []).map((league) => ({
      platform: 'yahoo' as const,
      sport: league.sport,
      leagueId: league.leagueKey,
      leagueName: league.leagueName,
      teamId: league.teamId || '',
      teamName: league.teamName,
      seasonYear: league.seasonYear,
    }));

    console.log(`[fantasy-mcp] ${cid} found ${leagues.length} Yahoo leagues`);
    return { leagues };
  } catch (error) {
    clearTimeout(timeoutId);
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    logSessionDiscoveryFailure(env, 'yahoo', 'league_fetch', correlationId, {
      failure_kind: isTimeout ? 'timeout' : 'fetch_error',
      error_code: isTimeout ? 'auth_worker_timeout' : 'auth_worker_fetch_exception',
    });
    const errorMsg = isTimeout ? 'Yahoo leagues fetch timed out' : `Yahoo leagues fetch failed: ${(error as Error).message}`;
    console.error(`[fantasy-mcp] ${cid} failed to fetch Yahoo leagues: ${errorMsg}`);
    return { leagues: [], error: errorMsg };
  }
}

async function fetchSleeperLeagues(
  env: Env,
  authHeader?: string,
  correlationId?: string,
  evalRunId?: string,
  evalTraceId?: string,
  includeHistorical: boolean = false
): Promise<{ leagues: UserLeague[]; error?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  const cid = correlationId || 'no-cid';

  try {
    console.log(`[fantasy-mcp] ${cid} fetching Sleeper leagues from auth-worker`);

    const baseHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(authHeader ? { Authorization: authHeader } : {}),
    };
    const withCorrelation = correlationId ? withCorrelationId(baseHeaders, correlationId) : new Headers(baseHeaders);
    const withInternal = withInternalServiceToken(withCorrelation, env, 'auth-worker /internal/leagues/sleeper');
    const headers = withEvalHeaders(withInternal, evalRunId, evalTraceId);

    const response = await env.AUTH_WORKER.fetch(
      new Request(`https://internal/internal/leagues/sleeper${archivedQuery(includeHistorical)}`, {
        headers,
        signal: controller.signal,
      })
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      logSessionDiscoveryFailure(env, 'sleeper', 'league_fetch', correlationId, {
        failure_kind: response.status === 401 || response.status === 403 ? 'auth' : 'upstream',
        error_code: response.status === 401 || response.status === 403 ? 'auth_worker_auth_failed' : 'auth_worker_fetch_failed',
        http_status: response.status,
      });
      console.error(`[fantasy-mcp] ${cid} Sleeper leagues fetch failed: ${response.status}`);
      return { leagues: [], error: `Sleeper leagues fetch failed: ${response.status}` };
    }

    const data = (await response.json()) as {
      leagues?: Array<{
        sport: string;
        leagueId: string;
        leagueName: string;
        rosterId?: number;
        seasonYear: number;
        recurringLeagueId?: string;
      }>;
    };

    const leagues: UserLeague[] = (data.leagues || []).map((league) => ({
      platform: 'sleeper' as const,
      sport: league.sport,
      leagueId: league.leagueId,
      leagueName: league.leagueName,
      teamId: league.rosterId ? String(league.rosterId) : '',
      seasonYear: league.seasonYear,
      recurringLeagueId: league.recurringLeagueId,
    }));

    console.log(`[fantasy-mcp] ${cid} found ${leagues.length} Sleeper leagues`);
    return { leagues };
  } catch (error) {
    clearTimeout(timeoutId);
    const isTimeout = error instanceof Error && error.name === 'AbortError';
    logSessionDiscoveryFailure(env, 'sleeper', 'league_fetch', correlationId, {
      failure_kind: isTimeout ? 'timeout' : 'fetch_error',
      error_code: isTimeout ? 'auth_worker_timeout' : 'auth_worker_fetch_exception',
    });
    const errorMsg = isTimeout ? 'Sleeper leagues fetch timed out' : `Sleeper leagues fetch failed: ${(error as Error).message}`;
    console.error(`[fantasy-mcp] ${cid} failed to fetch Sleeper leagues: ${errorMsg}`);
    return { leagues: [], error: errorMsg };
  }
}

// =============================================================================
// HELPER: Format MCP response
// =============================================================================

function mcpSuccess(data: unknown): McpToolResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}

function mcpError(message: string, code: string = 'ERROR'): McpToolResponse {
  return {
    content: [{ type: 'text', text: message }],
    structuredContent: { success: false, code, error: message },
    isError: true,
  };
}

function didRefreshBatchFail(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const record = payload as { success?: unknown; results?: unknown };
  return record.success === false;
}

// Derive metadata URL from resource: strip /mcp path, add .well-known
// e.g. https://api.flaim.app/mcp → https://api.flaim.app/.well-known/oauth-protected-resource
//      https://api.flaim.app/fantasy/mcp → https://api.flaim.app/fantasy/.well-known/oauth-protected-resource
function deriveResourceMetadataUrl(resource: string): string {
  const url = new URL(resource);
  const basePath = url.pathname.replace(/\/mcp$/, '');
  return `${url.origin}${basePath}/.well-known/oauth-protected-resource`;
}

/**
 * Genuine authentication failure (invalid/expired token, introspection failure,
 * provider 401 without valid scope context). Keeps error="invalid_token".
 * For a valid token that merely lacks the required scope, use
 * mcpInsufficientScopeError instead.
 */
export function mcpAuthError(resource: string, requiredScope?: 'mcp:read' | 'mcp:write'): McpToolResponse {
  const resourceMetadata = deriveResourceMetadataUrl(resource);
  const scopeChallenge = requiredScope ? `, scope="${requiredScope}"` : '';
  return {
    content: [{ type: 'text', text: 'AUTH_FAILED: Authentication required' }],
    isError: true,
    _meta: {
      'mcp/www_authenticate': [
        `Bearer resource_metadata="${resourceMetadata}"${scopeChallenge}, error="invalid_token", error_description="Authentication required"`,
      ],
    },
  };
}

/**
 * Valid token, missing scope (RFC 6750 insufficient_scope). Used by the
 * per-tool scope gate in server.ts and by the auth-worker 403 path in
 * refreshUserLeagues. The challenge carries BOTH error and error_description —
 * ChatGPT requires both parameters present to trigger its consent UI.
 */
export function mcpInsufficientScopeError(
  resource: string,
  requiredScope: 'mcp:read' | 'mcp:write'
): McpToolResponse {
  const resourceMetadata = deriveResourceMetadataUrl(resource);
  const description = requiredScope === 'mcp:write'
    ? 'mcp:write scope is required to refresh leagues'
    : `${requiredScope} scope is required for this tool`;
  return {
    content: [{ type: 'text', text: `INSUFFICIENT_SCOPE: ${description}` }],
    structuredContent: { success: false, code: ErrorCode.INSUFFICIENT_SCOPE, error: description },
    isError: true,
    _meta: {
      'mcp/www_authenticate': [
        `Bearer resource_metadata="${resourceMetadata}", scope="${requiredScope}", error="insufficient_scope", error_description="${description}"`,
      ],
    },
  };
}

function routeResultToMcp(result: RouteResult): McpToolResponse {
  if (result.success) {
    return mcpSuccess({
      success: true,
      data: result.data,
    });
  }

  const errorPayload: Record<string, unknown> = {
    success: false,
    code: result.code || 'ERROR',
    error: result.error || 'Unknown error',
  };
  if (result.status !== undefined) errorPayload.status = result.status;
  if (result.upstream_status !== undefined) errorPayload.upstream_status = result.upstream_status;
  if (result.retryable !== undefined) errorPayload.retryable = result.retryable;
  if (result.retry_after !== undefined) errorPayload.retry_after = result.retry_after;
  if (result.retry_after_source !== undefined) errorPayload.retry_after_source = result.retry_after_source;

  const meta: Record<string, unknown> = {};
  if (result.status !== undefined) meta.status = result.status;
  if (result.upstream_status !== undefined) meta.upstream_status = result.upstream_status;
  if (result.retryable !== undefined) meta.retryable = result.retryable;
  if (result.retry_after !== undefined) meta.retry_after = result.retry_after;
  if (result.retry_after_source !== undefined) meta.retry_after_source = result.retry_after_source;

  const text = typeof errorPayload.error === 'string' && errorPayload.error.startsWith(`${errorPayload.code}:`)
    ? errorPayload.error
    : `${errorPayload.code}: ${errorPayload.error}`;

  return {
    content: [{ type: 'text', text }],
    structuredContent: errorPayload,
    isError: true,
    ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
  };
}

// =============================================================================
// HELPER: Tool logging with correlation ID and timing
// =============================================================================

async function withToolLogging<T>(
  correlationId: string | undefined,
  toolName: string,
  context: string,
  fn: () => Promise<T>,
  evalRunId?: string,
  evalTraceId?: string
): Promise<T> {
  const cid = correlationId || 'no-cid';
  const evalTag = evalRunId ? ` eval=${evalRunId}` : '';
  const startTime = Date.now();
  console.log(`[fantasy-mcp] ${cid} ${toolName} ${context}${evalTag}`);
  logEvalEvent({
    service: 'fantasy-mcp',
    phase: 'tool_start',
    correlation_id: correlationId,
    run_id: evalRunId,
    trace_id: evalTraceId,
    tool: toolName,
    message: context,
  });
  try {
    const result = await fn();
    const duration = Date.now() - startTime;
    console.log(`[fantasy-mcp] ${cid} ${toolName} completed in ${duration}ms${evalTag}`);
    logEvalEvent({
      service: 'fantasy-mcp',
      phase: 'tool_end',
      correlation_id: correlationId,
      run_id: evalRunId,
      trace_id: evalTraceId,
      tool: toolName,
      duration_ms: duration,
      status: 'success',
    });
    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[fantasy-mcp] ${cid} ${toolName} failed in ${duration}ms${evalTag}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    logEvalEvent({
      service: 'fantasy-mcp',
      phase: 'tool_error',
      correlation_id: correlationId,
      run_id: evalRunId,
      trace_id: evalTraceId,
      tool: toolName,
      duration_ms: duration,
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

// =============================================================================
// UNIFIED TOOLS
// =============================================================================

export function getUnifiedTools(): UnifiedTool[] {
  const currentDate = new Date().toISOString().split('T')[0];

  return [
    // -------------------------------------------------------------------------
    // Tool 1: get_user_session
    // -------------------------------------------------------------------------
    {
      name: 'get_user_session',
      title: 'User Session',
      requiredScope: 'mcp:read',
      securitySchemes: buildSecuritySchemes('mcp:read'),
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      outputSchema: GET_USER_SESSION_OUTPUT_SCHEMA,
      openaiMeta: { invoking: 'Loading your leagues\u2026', invoked: 'Leagues loaded' },
      widgetUri: USER_SESSION_WIDGET_URI,
      description:
        "Use this alone for user-specific connection, league, or account-status questions, and use it as the first data tool when a request needs the user's connected fantasy league data. Do not call for Flaim capability, permission, or generic setup how-to questions, and do not call for generic coding, scraping, weather, travel, betting, sports news, or other requests that do not need connected league data. For a normal selected-league request, call this once before any other data tool. For an explicit refresh request, call refresh_leagues first and then call this tool after success; call it again even if it ran earlier in the chat. Returns the user's full league landscape: allLeagues (all active leagues), defaultLeagues (per-sport defaults), and defaultLeague (populated only when a single league exists or defaultSport matches). For vague singular prompts, use defaultLeague when present; otherwise use the relevant sport entry in defaultLeagues. For explicit plural or comparative prompts (each, all, compare, across leagues/platforms), enumerate every matching league in allLeagues and call the target tool once per league. For a selected active league, call get_league_info next before the requested league-specific data tool. Skip get_league_info only when answering from session data alone or branching to get_ancient_history. season_year always represents the start year of the season. Read-only.",
      inputSchema: {},
      handler: async (_args, env, authHeader, correlationId, evalRunId, evalTraceId) => {
        return withToolLogging(correlationId, 'get_user_session', 'session', async () => {
        try {
          // Fetch ESPN first so auth failures return immediately.
          const espnData = await fetchUserLeagues(env, authHeader, correlationId, evalRunId, evalTraceId);

          // Check ESPN auth errors
          if (espnData.status === 401 || espnData.status === 403) {
            return mcpAuthError('https://api.flaim.app/mcp');
          }

          // Fetch Yahoo + Sleeper in parallel after ESPN auth passes.
          const [yahooResult, sleeperResult] = await Promise.allSettled([
            fetchYahooLeagues(env, authHeader, correlationId, evalRunId, evalTraceId),
            fetchSleeperLeagues(env, authHeader, correlationId, evalRunId, evalTraceId),
          ]);

          const yahooData = yahooResult.status === 'fulfilled' ? yahooResult.value : { leagues: [] as UserLeague[], error: `Yahoo fetch rejected: ${yahooResult.reason}` };
          const sleeperData = sleeperResult.status === 'fulfilled' ? sleeperResult.value : { leagues: [] as UserLeague[], error: `Sleeper fetch rejected: ${sleeperResult.reason}` };

          // Collect warnings from failed fetches
          const warnings: string[] = [];
          if (espnData.error) warnings.push(`ESPN: ${espnData.error}`);
          if (yahooData.error) warnings.push(`Yahoo: ${yahooData.error}`);
          if (sleeperData.error) warnings.push(`Sleeper: ${sleeperData.error}`);

          // Combine all leagues
          const allLeagues = [...espnData.leagues, ...yahooData.leagues, ...sleeperData.leagues];

          // Track which platforms failed to fetch — used to avoid clearing valid defaults
          // when a platform was temporarily unavailable.
          const failedPlatforms = new Set<string>();
          if (espnData.error) failedPlatforms.add('espn');
          if (yahooData.error) failedPlatforms.add('yahoo');
          if (sleeperData.error) failedPlatforms.add('sleeper');

          // Group leagues by stable identity.
          // Yahoo league_key is season-scoped (`<game_key>.l.<league_id>`), so strip the
          // changing game prefix and group on the stable league_id portion instead.
          // That keeps recurring seasons together without collapsing two same-name leagues.
          const leagueGroups = new Map<string, typeof allLeagues>();
          for (const league of allLeagues) {
            const key = getActiveLeagueGroupKey(league);
            if (!leagueGroups.has(key)) {
              leagueGroups.set(key, []);
            }
            leagueGroups.get(key)!.push(league);
          }

          // Filter to active leagues. The session view is intentionally strict:
          // only the sport's current canonical season belongs here. Older seasons
          // stay discoverable through get_ancient_history.
          const leagues: typeof allLeagues = [];
          for (const [, groupSeasons] of leagueGroups) {
            // Sort by seasonYear descending
            groupSeasons.sort((a, b) => (b.seasonYear || 0) - (a.seasonYear || 0));

            // Determine current season for this league's sport
            const sport = (groupSeasons[0]?.sport || '').toLowerCase();
            const currentYear = getDefaultSeasonYear(sport as Sport);
            const currentSeason = groupSeasons.find(s => s.seasonYear === currentYear);
            if (currentSeason) {
              leagues.push(currentSeason);
            }
            // No fallback to the most recent historical season: showing stale
            // leagues in get_user_session causes agents and widgets to treat
            // old seasons as active. Provider-lag cases get a distinct message
            // below and remain available through get_ancient_history.
          }

          const hasLeagues = leagues.length > 0;
          const hasRawLeagues = allLeagues.length > 0;
          if (!hasLeagues && hasRawLeagues) {
            logMcpSetupFailure(env, 'session_discovery_failed', {
              component: 'session-discovery',
              stage: 'current_season_filter',
              failure_kind: 'stale_data',
              error_code: 'current_season_not_found',
              correlation_id: correlationId,
              league_count: allLeagues.length,
              current_season_found: false,
              past_seasons_found: true,
            });
          }
          const sportCounts = leagues.reduce(
            (acc, l) => {
              const sport = l.sport?.toLowerCase() || 'unknown';
              acc[sport] = (acc[sport] || 0) + 1;
              return acc;
            },
            {} as Record<string, number>
          );

          let sessionMessage: string;
          if (!hasLeagues) {
            sessionMessage = hasRawLeagues
              ? 'No current-season leagues found. Provider data exists, but every returned league is for a non-current season — this usually means the user connected during a previous season and their leagues have not been synced since the new season started. Ask the user to open https://flaim.app/leagues and press "Sync all" to pull the current season, then call get_user_session again. Do not treat historical leagues as active; use get_ancient_history only when the user asks about past seasons.'
              : 'No leagues configured. Ask the user to open https://flaim.app/leagues and connect ESPN, Yahoo, or Sleeper before using Flaim for league-specific advice.';
          } else if (leagues.length === 1) {
            const league = leagues[0];
            sessionMessage = `Use platform="${league.platform}", sport="${league.sport}", leagueId="${league.leagueId}", teamId="${league.teamId || 'none'}", seasonYear=${league.seasonYear} for all tool calls.`;
          } else {
            const sportSummary = Object.entries(sportCounts)
              .map(([sport, count]) => `${count} ${sport}`)
              .join(', ');
            sessionMessage = `User has ${leagues.length} active leagues across ${sportSummary}. Scope rules: (1) For vague singular prompts ("how's my team?", "what's my matchup?"), use the applicable default from the session response: defaultLeague when present, otherwise the relevant sport entry in defaultLeagues — no fan-out, no asking. (2) For explicit plural or comparative prompts ("each of my leagues", "compare my ESPN and Yahoo", "all my teams"), enumerate every matching league in allLeagues and call the target tool once per league before synthesizing. (3) For ambiguous prompts with no applicable default, ask which league. For past seasons or historical data, use get_ancient_history.`;
          }

          // Fetch user preferences for defaults
          interface LeagueDefault {
            platform: 'espn' | 'yahoo' | 'sleeper';
            leagueId: string;
            seasonYear: number;
          }
          interface Preferences {
            defaultSport?: string | null;
            defaultFootball?: LeagueDefault | null;
            defaultBaseball?: LeagueDefault | null;
            defaultBasketball?: LeagueDefault | null;
            defaultHockey?: LeagueDefault | null;
          }
          let preferences: Preferences = {};
          try {
            const baseHeaders: Record<string, string> = {
              'Content-Type': 'application/json',
              ...(authHeader ? { Authorization: authHeader } : {}),
            };
            const withCorrelation = correlationId ? withCorrelationId(baseHeaders, correlationId) : new Headers(baseHeaders);
            const withInternal = withInternalServiceToken(withCorrelation, env, 'auth-worker /internal/user/preferences');
            const headers = withEvalHeaders(withInternal, evalRunId, evalTraceId);
            const prefsResponse = await env.AUTH_WORKER.fetch(
              new Request('https://internal/internal/user/preferences', { headers })
            );
            if (prefsResponse.ok) {
              preferences = await prefsResponse.json();
            }
          } catch (error) {
            console.error('[get_user_session] Failed to fetch preferences:', error);
          }

          // Build per-sport default leagues map from preferences
          const defaultLeagues: Record<string, (typeof leagues)[0]> = {};
          const sportDefaultMap: Record<string, LeagueDefault | null | undefined> = {
            football: preferences.defaultFootball,
            baseball: preferences.defaultBaseball,
            basketball: preferences.defaultBasketball,
            hockey: preferences.defaultHockey,
          };
          const rawLeagueKeys = new Set(
            allLeagues.map((l) => `${l.platform}:${l.leagueId}:${l.seasonYear}`)
          );

          for (const [sport, defaultInfo] of Object.entries(sportDefaultMap)) {
            if (defaultInfo) {
              const matchingLeague = leagues.find(
                (l) =>
                  l.platform === defaultInfo.platform &&
                  l.leagueId === defaultInfo.leagueId &&
                  l.seasonYear === defaultInfo.seasonYear
              );
              if (matchingLeague) {
                defaultLeagues[sport] = matchingLeague;
              } else {
                // Default doesn't match any active league.
                if (failedPlatforms.has(defaultInfo.platform)) {
                  // Platform fetch failed — the league may still be valid. Preserve
                  // the default and surface a transient warning instead of clearing.
                  warnings.push(`Could not verify ${sport} default: ${defaultInfo.platform} data is temporarily unavailable. Default preserved.`);
                } else if (rawLeagueKeys.has(`${defaultInfo.platform}:${defaultInfo.leagueId}:${defaultInfo.seasonYear}`)) {
                  // The default still exists in the provider payload, but is not
                  // part of the current-session view. Preserve it so season
                  // rollover/provider lag does not delete user preferences.
                  warnings.push(`Preserved non-current ${sport} default: league ${defaultInfo.leagueId} is not shown in active leagues.`);
                } else {
                  // Platform fetch succeeded but league is missing — it's genuinely stale.
                  // Keep get_user_session truly read-only: report stale defaults
                  // without mutating preferences from this tool call. Preference
                  // cleanup belongs in an explicit settings/write path.
                  warnings.push(`Stale ${sport} default detected: league ${defaultInfo.leagueId} is no longer in your active leagues. Update your default league in Flaim league settings to clear this warning.`);
                }
              }
            }
          }

          // Compute primary default — three deterministic branches only:
          // 1. defaultSport is set AND that sport has a validated default in defaultLeagues
          // 2. Exactly one active league (single-user shortcut, no prefs needed)
          // 3. null — no arbitrary fallback; model should fan out or ask
          const primarySport = preferences.defaultSport as string | undefined;
          const defaultLeague =
            (primarySport && defaultLeagues[primarySport]) ||
            (leagues.length === 1 ? leagues[0] : null);

          const sessionData = {
            success: true,
            currentDate: new Date().toISOString(),
            currentSeasons: {
              football: { year: getDefaultSeasonYear('football'), label: getSeasonLabel(getDefaultSeasonYear('football'), 'football') },
              baseball: { year: getDefaultSeasonYear('baseball'), label: getSeasonLabel(getDefaultSeasonYear('baseball'), 'baseball') },
              basketball: { year: getDefaultSeasonYear('basketball'), label: getSeasonLabel(getDefaultSeasonYear('basketball'), 'basketball') },
              hockey: { year: getDefaultSeasonYear('hockey'), label: getSeasonLabel(getDefaultSeasonYear('hockey'), 'hockey') },
            },
            timezone: 'America/New_York',
            totalLeaguesFound: leagues.length,
            leaguesBySport: sportCounts,
            defaultSport: preferences.defaultSport || null,
            defaultLeague: defaultLeague
              ? {
                  platform: defaultLeague.platform,
                  sport: defaultLeague.sport,
                  leagueId: defaultLeague.leagueId,
                  teamId: defaultLeague.teamId,
                  seasonYear: defaultLeague.seasonYear,
                  season: getSeasonLabel(defaultLeague.seasonYear || getDefaultSeasonYear(defaultLeague.sport as Sport), defaultLeague.sport as Sport),
                  leagueName: defaultLeague.leagueName,
                  teamName: defaultLeague.teamName,
                }
              : null,
            defaultLeagues: Object.fromEntries(
              Object.entries(defaultLeagues).map(([sport, league]) => [
                sport,
                {
                  platform: league.platform,
                  leagueId: league.leagueId,
                  leagueName: league.leagueName,
                  sport: league.sport,
                  seasonYear: league.seasonYear,
                  season: getSeasonLabel(league.seasonYear || getDefaultSeasonYear(sport as Sport), sport as Sport),
                  teamId: league.teamId,
                  teamName: league.teamName,
                },
              ])
            ),
            allLeagues: leagues,
            warnings: warnings.length > 0 ? warnings : undefined,
            instructions: sessionMessage,
          };
          return {
            content: [{ type: 'text' as const, text: JSON.stringify(sessionData, null, 2) }],
            structuredContent: sessionData as unknown as Record<string, unknown>,
          };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          return mcpError(`Failed to fetch user session: ${message}`);
        }
        }, evalRunId, evalTraceId);
      },
    },

    // -------------------------------------------------------------------------
    // Tool 2: refresh_leagues
    // -------------------------------------------------------------------------
    {
      name: 'refresh_leagues',
      title: 'Refresh Leagues',
      requiredScope: 'mcp:write',
      securitySchemes: buildSecuritySchemes('mcp:write'),
      annotations: REFRESH_TOOL_ANNOTATIONS,
      outputSchema: REFRESH_LEAGUES_OUTPUT_SCHEMA,
      openaiMeta: { invoking: 'Refreshing leagues\u2026', invoked: 'Refresh complete' },
      description:
        'Refresh connected fantasy leagues by asking Flaim to rediscover leagues through connected ESPN, Yahoo, and Sleeper accounts. Use only when the user explicitly asks to refresh or after the user presses the widget refresh button. This is non-destructive, but repeated refreshes can update Flaim registry timestamps and provider metadata; it does not change provider lineups or rosters, add or drop players, submit waiver claims or trades, or modify league settings. If this call succeeds, call get_user_session again to show the updated league list. If it fails, follow the error retry guidance and any retry_after value; do not retry in a loop.',
      inputSchema: {
        platforms: z
          .array(z.enum(['espn', 'yahoo', 'sleeper']))
          .optional()
          .describe('Optional platforms to refresh. Omit to refresh every connected platform.'),
      },
      handler: async (args, env, authHeader, correlationId, evalRunId, evalTraceId) => {
        const rawPlatforms = Array.isArray(args.platforms) ? args.platforms : undefined;
        const invalidPlatforms = rawPlatforms
          ?.filter((platform) => platform !== 'espn' && platform !== 'yahoo' && platform !== 'sleeper');
        if (invalidPlatforms?.length) {
          return mcpError(`Invalid platform(s): ${invalidPlatforms.map(String).join(', ')}`);
        }
        if (rawPlatforms?.length === 0) {
          return mcpError('platforms must include at least one platform');
        }
        const platforms = rawPlatforms as Platform[] | undefined;
        return withToolLogging(correlationId, 'refresh_leagues', `platforms=${platforms?.join(',') || 'all'}`, async () => {
          return refreshUserLeagues(env, platforms, authHeader, correlationId, evalRunId, evalTraceId);
        }, evalRunId, evalTraceId);
      },
    },

    // -------------------------------------------------------------------------
    // GET ANCIENT HISTORY - Retrieve old leagues and seasons
    // -------------------------------------------------------------------------
    {
      name: 'get_ancient_history',
      title: 'Ancient History',
      requiredScope: 'mcp:read',
      securitySchemes: buildSecuritySchemes('mcp:read'),
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      outputSchema: GET_ANCIENT_HISTORY_OUTPUT_SCHEMA,
      openaiMeta: { invoking: 'Searching old seasons\u2026', invoked: 'History loaded' },
      description:
        'Use this only after get_user_session, and only when the user is clearly asking about a non-current season or an inactive league. This is the historical branch: it returns past seasons and historical leagues outside the current season view. Use for last season, older seasons, inactive leagues, or historical performance. Read-only.',
      inputSchema: {
        platform: z
          .enum(['espn', 'yahoo', 'sleeper'])
          .optional()
          .describe('Optional: filter to specific platform'),
      },
      handler: async (args, env, authHeader, correlationId, evalRunId, evalTraceId) => {
        const { platform } = args as { platform?: 'espn' | 'yahoo' | 'sleeper' };
        return withToolLogging(correlationId, 'get_ancient_history', `ancient platform=${platform || 'all'}`, async () => {
        try {
          // Fetch platform leagues in parallel (only requested platforms)
          // includeHistorical=true → archived 'historical' leagues stay browsable in
          // history (the 'exclude-hidden' filter), unlike get_user_session which drops
          // all archived. 'hidden' leagues are still suppressed here.
          const fetchArgs = [env, authHeader, correlationId, evalRunId, evalTraceId] as const;
          const promises: Promise<{ leagues: UserLeague[]; error?: string }>[] = [];
          if (!platform || platform === 'espn') promises.push(fetchUserLeagues(...fetchArgs, true));
          if (!platform || platform === 'yahoo') promises.push(fetchYahooLeagues(...fetchArgs, true));
          if (!platform || platform === 'sleeper') promises.push(fetchSleeperLeagues(...fetchArgs, true));

          const results = await Promise.allSettled(promises);
          const allLeagues: UserLeague[] = [];
          const warnings: string[] = [];
          for (const result of results) {
            if (result.status === 'fulfilled') {
              allLeagues.push(...result.value.leagues);
              if (result.value.error) warnings.push(result.value.error);
            } else {
              warnings.push(`Fetch rejected: ${result.reason}`);
            }
          }

          const thresholdYear = getActiveThresholdYear();

          // Group by stable league identity.
          // For Yahoo, collapse recurring seasons by stripping the season-specific
          // game prefix from league_key, while still keeping distinct active leagues separate.
          const leagueGroups = new Map<string, typeof allLeagues>();
          for (const league of allLeagues) {
            const key = getActiveLeagueGroupKey(league);
            if (!leagueGroups.has(key)) {
              leagueGroups.set(key, []);
            }
            leagueGroups.get(key)!.push(league);
          }

          // Separate old leagues vs old seasons of active leagues
          const oldLeagues: typeof allLeagues = [];
          const oldSeasons: Record<string, typeof allLeagues> = {};

          for (const [key, groupSeasons] of leagueGroups) {
            groupSeasons.sort((a, b) => (b.seasonYear || 0) - (a.seasonYear || 0));
            const mostRecentYear = groupSeasons[0]?.seasonYear || 0;

            if (mostRecentYear < thresholdYear) {
              // Entire league is old - include all seasons
              oldLeagues.push(...groupSeasons);
            } else {
              // Active league - include everything except the current season
              const sport = (groupSeasons[0]?.sport || '').toLowerCase();
              const currentYear = getDefaultSeasonYear(sport as Sport);
              const ancientSeasons = groupSeasons.filter(s => s.seasonYear !== currentYear);
              if (ancientSeasons.length > 0) {
                oldSeasons[key] = ancientSeasons;
              }
            }
          }

          return mcpSuccess({
            success: true,
            thresholdYear,
            oldLeagues,
            oldSeasonsFromActiveLeagues: oldSeasons,
            totalOldLeagues: oldLeagues.length,
            totalOldSeasons: Object.values(oldSeasons).flat().length,
            warnings: warnings.length > 0 ? warnings : undefined,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          return mcpError(`Failed to fetch ancient history: ${message}`);
        }
        }, evalRunId, evalTraceId);
      },
    },

    // -------------------------------------------------------------------------
    // Tool 2: get_league_info
    // -------------------------------------------------------------------------
    {
      name: 'get_league_info',
      title: 'League Context',
      requiredScope: 'mcp:read',
      securitySchemes: buildSecuritySchemes('mcp:read'),
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      outputSchema: GET_LEAGUE_INFO_OUTPUT_SCHEMA,
      openaiMeta: { invoking: 'Fetching league info\u2026', invoked: 'League info ready' },
      description: `For a selected active league, call this immediately after get_user_session and before the requested standings, matchup, roster, free-agent, player, or transaction tool. Skip it only when answering from session data alone or branching to get_ancient_history. This provides the baseline league context for analysis: league name, settings, scoring type, roster configuration, and team/owner context, plus schedule or season-window metadata when the platform provides it. When fanning out across multiple leagues, call this once per league. The exact team fields vary by platform but all include ownerName. Use values from get_user_session. Read-only. Current date is ${currentDate}.`,
      inputSchema: {
        platform: z
          .enum(['espn', 'yahoo', 'sleeper'])
          .describe('Fantasy platform (e.g., "espn", "yahoo", "sleeper")'),
        sport: z
          .enum(['football', 'baseball', 'basketball', 'hockey'])
          .describe('Sport type (e.g., "football", "baseball")'),
        league_id: z.string().describe('League ID (get from get_user_session)'),
        season_year: z.number().describe('Season start year — use the season_year returned by get_user_session for this league; only pass an older year when the user explicitly asks about a past season'),
      },
      handler: async (args, env, authHeader, correlationId, evalRunId, evalTraceId) => {
        const params: ToolParams = {
          platform: args.platform as Platform,
          sport: args.sport as Sport,
          league_id: args.league_id as string,
          season_year: args.season_year as number,
        };

        return withToolLogging(correlationId, 'get_league_info', `${params.platform} ${params.sport} league=provided`, async () => {
          const result = await routeToClient(env, 'get_league_info', params, authHeader, correlationId, evalRunId, evalTraceId);
          return routeResultToMcp(result);
        }, evalRunId, evalTraceId);
      },
    },

    // -------------------------------------------------------------------------
    // Tool 3: get_standings
    // -------------------------------------------------------------------------
    {
      name: 'get_standings',
      title: 'League Standings',
      requiredScope: 'mcp:read',
      securitySchemes: buildSecuritySchemes('mcp:read'),
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      outputSchema: GET_STANDINGS_OUTPUT_SCHEMA,
      openaiMeta: { invoking: 'Fetching standings\u2026', invoked: 'Standings ready' },
      description: `Get season standings and outcome snapshot; includes verified season-outcome fields when available. Returns team records, rankings, and points summaries. The rank field is a standings sort position (1 = best): on ESPN and Sleeper it is computed by Flaim from win percentage; on Yahoo it is passed through from Yahoo's own standings API. It is NOT a verified postseason finish. For verified postseason outcome, use finalRank and championshipWon instead. Also returns seasonPhase (regular_season/playoffs_in_progress/season_complete), seasonComplete, and per-team outcome fields: finalRank, championshipWon, playoffOutcome, outcomeConfidence, madePlayoffs, playoffSeed. Outcome fields are null when not verifiable — do not infer championship from rank or team name. outcomeConfidence is 'explicit' when the platform reports final ranks, or 'derived' when the champion and runner-up were determined from the final winners-bracket matchup (ESPN historical seasons may omit final ranks); a tied championship game is resolved using the league's playoff tie rule (ESPN's default advances the higher seed). Note: playoffOutcome returns 'in_progress' on Sleeper for teams in active playoffs; ESPN and Yahoo return null for that state. ESPN may also include projected-rank fields. Best used after get_user_session and after get_league_info for the specified league so team names and league context are already established. For multi-league comparisons, call once per league. For historical finish questions, call get_ancient_history first to discover seasons, then call this tool per season for verified outcomes. Read-only. Current date is ${currentDate}.`,
      inputSchema: {
        platform: z
          .enum(['espn', 'yahoo', 'sleeper'])
          .describe('Fantasy platform (e.g., "espn", "yahoo", "sleeper")'),
        sport: z
          .enum(['football', 'baseball', 'basketball', 'hockey'])
          .describe('Sport type (e.g., "football", "baseball")'),
        league_id: z.string().describe('League ID (get from get_user_session)'),
        season_year: z.number().describe('Season start year — use the season_year returned by get_user_session for this league; only pass an older year when the user explicitly asks about a past season'),
      },
      handler: async (args, env, authHeader, correlationId, evalRunId, evalTraceId) => {
        const params: ToolParams = {
          platform: args.platform as Platform,
          sport: args.sport as Sport,
          league_id: args.league_id as string,
          season_year: args.season_year as number,
        };

        return withToolLogging(correlationId, 'get_standings', `${params.platform} ${params.sport} league=provided`, async () => {
          const result = await routeToClient(env, 'get_standings', params, authHeader, correlationId, evalRunId, evalTraceId);
          return routeResultToMcp(result);
        }, evalRunId, evalTraceId);
      },
    },

    // -------------------------------------------------------------------------
    // Tool 4: get_matchups
    // -------------------------------------------------------------------------
    {
      name: 'get_matchups',
      title: 'League Matchups',
      requiredScope: 'mcp:read',
      securitySchemes: buildSecuritySchemes('mcp:read'),
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      outputSchema: GET_MATCHUPS_OUTPUT_SCHEMA,
      openaiMeta: { invoking: 'Fetching matchups\u2026', invoked: 'Matchups ready' },
      description: `Get matchups/scoreboard for a specific week or the current week. Best used after get_user_session and after get_league_info for the specified league so the model already knows the league's team names, owner/team mapping, and league context before interpreting the matchup. For multi-league comparisons, call once per league. Read-only. Current date is ${currentDate}.`,
      inputSchema: {
        platform: z
          .enum(['espn', 'yahoo', 'sleeper'])
          .describe('Fantasy platform (e.g., "espn", "yahoo", "sleeper")'),
        sport: z
          .enum(['football', 'baseball', 'basketball', 'hockey'])
          .describe('Sport type (e.g., "football", "baseball")'),
        league_id: z.string().describe('League ID (get from get_user_session)'),
        season_year: z.number().describe('Season start year — use the season_year returned by get_user_session for this league; only pass an older year when the user explicitly asks about a past season'),
        week: z.number().int().min(1).optional().describe('Week number (optional, must be ≥ 1, defaults to current week)'),
      },
      handler: async (args, env, authHeader, correlationId, evalRunId, evalTraceId) => {
        const params: ToolParams = {
          platform: args.platform as Platform,
          sport: args.sport as Sport,
          league_id: args.league_id as string,
          season_year: args.season_year as number,
          week: args.week as number | undefined,
        };

        return withToolLogging(correlationId, 'get_matchups', `${params.platform} ${params.sport} league=provided week=${params.week || 'current'}`, async () => {
          const result = await routeToClient(env, 'get_matchups', params, authHeader, correlationId, evalRunId, evalTraceId);
          return routeResultToMcp(result);
        }, evalRunId, evalTraceId);
      },
    },

    // -------------------------------------------------------------------------
    // Tool 5: get_roster
    // -------------------------------------------------------------------------
    {
      name: 'get_roster',
      title: 'Team Roster',
      requiredScope: 'mcp:read',
      securitySchemes: buildSecuritySchemes('mcp:read'),
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      outputSchema: GET_ROSTER_OUTPUT_SCHEMA,
      openaiMeta: { invoking: 'Fetching roster\u2026', invoked: 'Roster ready' },
      description: `Get roster details for a specific team — current by default, historical on request. Exact payload varies by platform: ESPN and Yahoo return player entries with lineup/position context, while Sleeper returns starters, bench, reserve, taxi, and record metadata for the selected roster. Historical snapshots: pass week for football (all platforms) and Sleeper basketball (matchup week), or as_of_date (YYYY-MM-DD) for ESPN/Yahoo baseball, basketball, and hockey — never both; an invalid selector returns a corrective error naming the right one. Every response includes a snapshot block identifying what was returned (current vs week vs date); historical responses may add limitation flags (acquisitionMetadataAvailable, reserveAndTaxiClassificationAvailable) when provider history omits those details. For "roster during matchup week N" questions in daily sports, ask the user for a specific date rather than guessing — one matchup spans several daily rosters. Best used after get_user_session and after get_league_info for the specified league so the model already knows the league's team names, owner/team mapping, league settings, and roster context before interpreting this roster. Requires authentication except on Sleeper's public API. Read-only. Current date is ${currentDate}.`,
      inputSchema: {
        platform: z
          .enum(['espn', 'yahoo', 'sleeper'])
          .describe('Fantasy platform (e.g., "espn", "yahoo", "sleeper")'),
        sport: z
          .enum(['football', 'baseball', 'basketball', 'hockey'])
          .describe('Sport type (e.g., "football", "baseball")'),
        league_id: z.string().describe('League ID (get from get_user_session)'),
        season_year: z.number().describe('Season start year — use the season_year returned by get_user_session for this league; only pass an older year when the user explicitly asks about a past season'),
        team_id: z.string().optional().describe('Team ID for the target roster. Recommended for all platforms; required on Yahoo and for historical Sleeper rosters. If omitted, platform behavior varies and may not resolve to the user\'s team.'),
        // Numeric constraints live in shared validation (not zod) so week: 0
        // and fractional weeks get the corrective selector error instead of a
        // generic MCP invalid-arguments failure.
        week: z.number().optional().describe('Historical weekly roster snapshot (positive integer). Football on all platforms, plus Sleeper basketball (matchup week). Not valid for ESPN/Yahoo daily sports — use as_of_date there. Omit for the current roster; pass at most one of week or as_of_date.'),
        as_of_date: z.string().optional().describe('Historical calendar-day roster snapshot in YYYY-MM-DD format. ESPN and Yahoo baseball, basketball, and hockey only — football and Sleeper use week. Omit for the current roster; pass at most one of week or as_of_date.'),
      },
      handler: async (args, env, authHeader, correlationId, evalRunId, evalTraceId) => {
        const validation = validateRosterSnapshotInput(
          args.platform as Platform,
          args.sport as Sport,
          args.week as number | undefined,
          args.as_of_date as string | undefined
        );
        if (!validation.ok) {
          return routeResultToMcp({ success: false, code: validation.code, error: validation.error });
        }

        const params: ToolParams = {
          platform: args.platform as Platform,
          sport: args.sport as Sport,
          league_id: args.league_id as string,
          season_year: args.season_year as number,
          team_id: args.team_id as string | undefined,
          snapshot: validation.snapshot,
        };

        // Published-client compatibility (FLA-209): a normalized week shows up
        // in logs so shim traffic stays visible.
        const snapshotLog = validation.snapshot.type === 'current' && validation.snapshot.requestedWeek !== undefined
          ? `current(week ${validation.snapshot.requestedWeek} normalized)`
          : validation.snapshot.type;
        return withToolLogging(correlationId, 'get_roster', `${params.platform} ${params.sport} league=provided team=${params.team_id ? 'provided' : 'self'} snapshot=${snapshotLog}`, async () => {
          const result = await routeToClient(env, 'get_roster', params, authHeader, correlationId, evalRunId, evalTraceId);
          return routeResultToMcp(result);
        }, evalRunId, evalTraceId);
      },
    },

    // -------------------------------------------------------------------------
    // Tool 6: get_free_agents
    // -------------------------------------------------------------------------
    {
      name: 'get_free_agents',
      title: 'Available Players',
      requiredScope: 'mcp:read',
      securitySchemes: buildSecuritySchemes('mcp:read'),
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      outputSchema: GET_FREE_AGENTS_OUTPUT_SCHEMA,
      openaiMeta: { invoking: 'Searching available players\u2026', invoked: 'Available players ready' },
      description: `Get players available to acquire in the specified fantasy league, optionally filtered by position. This is fantasy-league availability, not professional-contract status. ESPN percentOwned/percentStarted are the percentages of all ESPN leagues where the player is rostered/started, not the share of rostered teams that start him. Yahoo percentOwned, when present, is Yahoo-wide; none is ownership within the selected league, and Sleeper provides no percentage. Label every reported percentage as an ESPN-wide roster/start rate or Yahoo-wide market rate. If a rate is missing, write "[Provider] market ownership rate: not provided"; do not repeat response field names or null values, call get_players, or offer a lookup. team/proTeam is the real-life club (FA means the provider lists no current pro team). Only ESPN status/waiverProcessDate represents fantasy acquisition state here. Call Yahoo/Sleeper rows "available players," never specifically free agents or waivers, and do not promise an immediate add. A returned player is already confirmed available in that league. For a returned list or field explanation, end after the requested facts—never add an "if you want" offer, qualitative ranking, recommendation, role, health, trend, or outlook. Translate ESPN status codes silently into plain language; never print raw codes such as FREEAGENT or WAIVERS. Use current web evidence before adding analysis or pickup recommendations. Follow get_user_session then get_league_info for the selected league; fan out once per league for comparisons. Use get_roster for a separate player-ownership question. Requires authentication on ESPN/Yahoo; Sleeper uses the public API. Read-only. Current date is ${currentDate}.`,
      inputSchema: {
        platform: z
          .enum(['espn', 'yahoo', 'sleeper'])
          .describe('Fantasy platform — "espn", "yahoo", or "sleeper"'),
        sport: z
          .enum(['football', 'baseball', 'basketball', 'hockey'])
          .describe('Sport type (e.g., "football", "baseball")'),
        league_id: z.string().describe('League ID (get from get_user_session)'),
        season_year: z.number().describe('Season start year — use the season_year returned by get_user_session for this league; only pass an older year when the user explicitly asks about a past season'),
        position: z
          .string()
          .optional()
          .describe('Filter by position (e.g., "QB", "RB", "SP", "C"). Default: ALL'),
        count: z
          .number()
          .optional()
          .describe('Maximum number of players to return (max: 100). Pass the user-requested number exactly; omit only when no number was requested (default: 25).'),
      },
      handler: async (args, env, authHeader, correlationId, evalRunId, evalTraceId) => {
        const params: ToolParams = {
          platform: args.platform as Platform,
          sport: args.sport as Sport,
          league_id: args.league_id as string,
          season_year: args.season_year as number,
          position: args.position as string | undefined,
          count: args.count as number | undefined,
        };

        return withToolLogging(correlationId, 'get_free_agents', `${params.platform} ${params.sport} league=provided pos=${params.position || 'ALL'}`, async () => {
          const result = await routeToClient(env, 'get_free_agents', params, authHeader, correlationId, evalRunId, evalTraceId);
          return routeResultToMcp(result);
        }, evalRunId, evalTraceId);
      },
    },

    // -------------------------------------------------------------------------
    // Tool 7: get_players
    // -------------------------------------------------------------------------
    {
      name: 'get_players',
      title: 'Search Players',
      requiredScope: 'mcp:read',
      securitySchemes: buildSecuritySchemes('mcp:read'),
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      outputSchema: GET_PLAYERS_OUTPUT_SCHEMA,
      openaiMeta: { invoking: 'Searching players\u2026', invoked: 'Players ready' },
      description: `Search for player identity by name. Always returns identity fields, but ownership context varies by platform. ESPN and Yahoo return market/global ownership and can also populate league ownership fields when credentials and league context are available. Sleeper returns identity plus ownership_scope="unavailable" with market_percent_owned=null. For a selected active league, call this after get_user_session and get_league_info so league-specific ownership and team names can be resolved. League ownership fields: league_status ("ROSTERED" = on a team, "FREE_AGENT" = available, null = unavailable), league_team_name (fantasy team name if rostered), league_owner_name (team owner if rostered). When those league fields are absent, null, or unavailable, fall back to get_roster to verify manually. Use values from get_user_session. Read-only. Current date is ${currentDate}.`,
      inputSchema: {
        query: z
          .string()
          .min(2)
          .describe('Player name search string (minimum 2 characters)'),
        platform: z
          .enum(['espn', 'yahoo', 'sleeper'])
          .describe('Fantasy platform (e.g., "espn", "yahoo", "sleeper")'),
        sport: z
          .enum(['football', 'baseball', 'basketball', 'hockey'])
          .describe('Sport type (e.g., "football", "baseball")'),
        league_id: z.string().describe('League ID (get from get_user_session)'),
        season_year: z.number().describe('Season start year — use the season_year returned by get_user_session for this league; only pass an older year when the user explicitly asks about a past season'),
        position: z
          .string()
          .optional()
          .describe('Filter by position (e.g., "QB", "RB", "SP", "C"). Default: ALL'),
        count: z
          .number()
          .optional()
          .describe('Maximum number of players to return (default: 10, max: 25)'),
      },
      handler: async (args, env, authHeader, correlationId, evalRunId, evalTraceId) => {
        const params: ToolParams = {
          platform: args.platform as Platform,
          sport: args.sport as Sport,
          league_id: args.league_id as string,
          season_year: args.season_year as number,
          query: args.query as string,
          position: args.position as string | undefined,
          count: args.count as number | undefined,
        };

        return withToolLogging(correlationId, 'get_players', `${params.platform} ${params.sport} q=provided pos=${params.position || 'ALL'}`, async () => {
          const result = await routeToClient(env, 'get_players', params, authHeader, correlationId, evalRunId, evalTraceId);
          return routeResultToMcp(result);
        }, evalRunId, evalTraceId);
      },
    },

    // -------------------------------------------------------------------------
    // Tool 8: get_transactions
    // -------------------------------------------------------------------------
    {
      name: 'get_transactions',
      title: 'League Transactions',
      requiredScope: 'mcp:read',
      securitySchemes: buildSecuritySchemes('mcp:read'),
      annotations: READ_ONLY_TOOL_ANNOTATIONS,
      outputSchema: GET_TRANSACTIONS_OUTPUT_SCHEMA,
      openaiMeta: { invoking: 'Fetching transactions\u2026', invoked: 'Transactions ready' },
      description: `Get recent league transactions including adds, drops, waivers, and completed trades. Best used after get_user_session and usually after get_league_info so the model already knows the league's team names and owner/team mapping before summarizing activity. Each normalized transaction includes a date field (YYYY-MM-DD), type, status, week, and optional team_ids. When presenting results, organize by time period (today, yesterday, this week, older) AND by team within each period so the user can see both when moves happened and what each team did. Week handling is platform-specific: ESPN week always means matchup period, including daily sports where one matchup spans several provider scoring periods; week 0 is ESPN preseason, and omitting week selects the current and previous matchup periods. Sleeper accepts positive matchup weeks starting at 1; omit week for its current and previous week. Yahoo uses a recent 14-day timestamp window and ignores explicit week. ESPN currently uses its activity feed as the authoritative source, reports source/limitations/window metadata, and cannot reliably answer failed-bid or trade-lifecycle-only filters until its structured source is restored. ESPN responses include a teams map (team ID to display name) to resolve numeric team_ids. Yahoo and Sleeper generally rely on get_league_info for team-name resolution. Use values from get_user_session. Read-only. Current date is ${currentDate}.`,
      inputSchema: {
        platform: z
          .enum(['espn', 'yahoo', 'sleeper'])
          .describe('Fantasy platform (e.g., "espn", "yahoo", "sleeper")'),
        sport: z
          .enum(['football', 'baseball', 'basketball', 'hockey'])
          .describe('Sport type (e.g., "football", "baseball")'),
        league_id: z.string().describe('League ID (get from get_user_session)'),
        season_year: z.number().describe('Season start year — use the season_year returned by get_user_session for this league; only pass an older year when the user explicitly asks about a past season'),
        week: z.number().int().min(0).optional().describe('Optional public week selector. ESPN accepts matchup period 0 or later (0 = preseason), including baseball, basketball, and hockey; omit it for the current and previous matchup periods. Sleeper accepts matchup week 1 or later; omit it for the current and previous week. Yahoo ignores week and uses a recent 14-day timestamp window'),
        type: z
          .enum(['add', 'drop', 'trade', 'waiver', 'pending_trade', 'trade_proposal', 'trade_decline', 'trade_veto', 'trade_uphold', 'failed_bid'])
          .optional()
          .describe('Optional transaction type filter. Sleeper supports add/drop/trade/waiver. Yahoo supports add/drop/trade plus waiver/pending_trade for the authenticated user\'s own pending items. ESPN activity data supports completed add/drop/trade/waiver rows; failed_bid and trade lifecycle filters return ESPN_TRANSACTION_TYPE_UNAVAILABLE while the structured source is disabled.'),
        count: z
          .number()
          .optional()
          .describe('Maximum transactions to return (default: 25, max: 100)'),
      },
      handler: async (args, env, authHeader, correlationId, evalRunId, evalTraceId) => {
        const weekValidation = validateTransactionWeekInput(
          args.platform as Platform,
          args.week
        );
        if (!weekValidation.ok) {
          return routeResultToMcp({
            success: false,
            code: weekValidation.code,
            error: weekValidation.error,
            status: weekValidation.status,
            retryable: weekValidation.retryable,
          });
        }

        const requestedCount = Number(args.count ?? 25);
        const params: ToolParams = {
          platform: args.platform as Platform,
          sport: args.sport as Sport,
          league_id: args.league_id as string,
          season_year: args.season_year as number,
          week: weekValidation.week,
          type: args.type as 'add' | 'drop' | 'trade' | 'waiver' | 'pending_trade' | 'trade_proposal' | 'trade_decline' | 'trade_veto' | 'trade_uphold' | 'failed_bid' | undefined,
          count: Number.isFinite(requestedCount) ? Math.max(1, Math.min(100, requestedCount)) : 25,
        };

        return withToolLogging(correlationId, 'get_transactions', `${params.platform} ${params.sport} league=provided week=${params.week ?? 'recent'}`, async () => {
          const result = await routeToClient(env, 'get_transactions', params, authHeader, correlationId, evalRunId, evalTraceId);
          return routeResultToMcp(result);
        }, evalRunId, evalTraceId);
      },
    },
  ];
}
