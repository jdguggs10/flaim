import { EspnSupabaseStorage } from './supabase-storage';
import { AutomaticLeagueDiscoveryFailed, EspnAuthenticationFailed } from './espn-types';
import {
  EspnHistoryJobStorage,
  durableHistoryEnabledFor,
  publicHistoryStatus,
  startQueuedEspnHistoryJob,
  type EspnHistoryEnv,
} from './espn-history';
import {
  discoverAndSaveCurrentLeagues,
  discoverAndSaveLeagues,
  type DiscoveredLeague,
  type SeasonCounts,
} from './v3/league-discovery';
import { handleYahooDiscover, type YahooConnectEnv } from './yahoo-connect-handlers';
import {
  refreshSleeperLeaguesFromStoredConnection,
  type SleeperConnectEnv,
} from './sleeper-connect-handlers';
import {
  logSyncEnvelope,
  NORMAL_REFRESH_COOLDOWN_SECONDS,
  SyncStateStorage,
  UPSTREAM_BACKOFF_COOLDOWN_SECONDS,
  type SyncSource,
} from './sync-state';

export const REFRESH_PLATFORMS = ['espn', 'yahoo', 'sleeper'] as const;
export type RefreshPlatform = typeof REFRESH_PLATFORMS[number];

type ProviderStatus = 'success' | 'skipped' | 'error';

export interface ProviderRefreshResult {
  platform: RefreshPlatform;
  status: ProviderStatus;
  httpStatus?: number;
  error?: string;
  error_description?: string;
  retryAfter?: string;
  details?: unknown;
}

export interface LeagueRefreshResponse {
  success: boolean;
  requestedPlatforms: RefreshPlatform[];
  results: Partial<Record<RefreshPlatform, ProviderRefreshResult>>;
}

type LeagueRefreshEnv = {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  ESPN_DURABLE_HISTORY_ENABLED?: string;
  ESPN_DURABLE_HISTORY_USERS?: string;
  ESPN_HISTORY_REFRESH?: EspnHistoryEnv['ESPN_HISTORY_REFRESH'];
};

interface EspnRefreshExecution {
  result: ProviderRefreshResult;
  leaseTransferred: boolean;
}

export interface RefreshRequestValidation {
  platforms?: RefreshPlatform[];
  error?: {
    status: 400;
    body: {
      error: string;
      error_description: string;
      unknownPlatforms?: string[];
    };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function parseLeagueRefreshRequest(request: Request): Promise<RefreshRequestValidation> {
  const rawBody = await request.text();
  if (!rawBody.trim()) {
    return { platforms: [...REFRESH_PLATFORMS] };
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return {
      error: {
        status: 400,
        body: {
          error: 'invalid_request',
          error_description: 'Request body must be valid JSON',
        },
      },
    };
  }

  if (!isRecord(body) || body.platforms === undefined) {
    return { platforms: [...REFRESH_PLATFORMS] };
  }

  if (!Array.isArray(body.platforms) || body.platforms.some((platform) => typeof platform !== 'string')) {
    return {
      error: {
        status: 400,
        body: {
          error: 'invalid_platforms',
          error_description: 'platforms must be an array of platform names',
        },
      },
    };
  }

  if (body.platforms.length === 0) {
    return {
      error: {
        status: 400,
        body: {
          error: 'invalid_platforms',
          error_description: 'platforms must include at least one platform',
        },
      },
    };
  }

  if (body.platforms.length > REFRESH_PLATFORMS.length) {
    return {
      error: {
        status: 400,
        body: {
          error: 'invalid_platforms',
          error_description: `platforms may include at most ${REFRESH_PLATFORMS.length} entries`,
        },
      },
    };
  }

  const requested = Array.from(new Set(body.platforms));
  const known = new Set<string>(REFRESH_PLATFORMS);
  const unknownPlatforms = requested.filter((platform) => !known.has(platform));
  if (unknownPlatforms.length > 0) {
    return {
      error: {
        status: 400,
        body: {
          error: 'unknown_platform',
          error_description: `Unknown platform(s): ${unknownPlatforms.join(', ')}`,
          unknownPlatforms,
        },
      },
    };
  }

  return { platforms: requested as RefreshPlatform[] };
}

function errorDescription(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

async function refreshEspnLeagues(env: { SUPABASE_URL: string; SUPABASE_SERVICE_KEY: string }, userId: string): Promise<ProviderRefreshResult> {
  const storage = EspnSupabaseStorage.fromEnvironment(env);
  const credentials = await storage.getCredentials(userId);
  if (!credentials) {
    return {
      platform: 'espn',
      status: 'skipped',
      httpStatus: 400,
      error: 'credentials_not_found',
      error_description: 'ESPN credentials not found. Please sync credentials first.',
    };
  }

  try {
    const result = await discoverAndSaveLeagues(userId, credentials.swid, credentials.s2, storage);
    return {
      platform: 'espn',
      status: 'success',
      httpStatus: 200,
      details: {
        discovered: result.discovered,
        currentSeason: result.currentSeason,
        pastSeasons: result.pastSeasons,
        currentSeasonCount: result.currentSeason.found,
        pastSeasonsCount: result.pastSeasons.found,
      },
    };
  } catch (error) {
    if (error instanceof AutomaticLeagueDiscoveryFailed) {
      const savedLeagues = await storage.getCurrentSeasonLeagues(userId);
      const discovered: DiscoveredLeague[] = savedLeagues.map((league) => ({
        sport: league.sport,
        leagueId: league.leagueId,
        leagueName: league.leagueName || '',
        teamId: league.teamId || '',
        teamName: league.teamName || '',
        seasonYear: league.seasonYear || 0,
      }));
      const currentSeason: SeasonCounts = {
        found: savedLeagues.length,
        added: 0,
        alreadySaved: savedLeagues.length,
        refreshed: 0,
      };
      return {
        platform: 'espn',
        status: 'success',
        httpStatus: 200,
        details: {
          discovered,
          currentSeason,
          pastSeasons: { found: 0, added: 0, alreadySaved: 0, refreshed: 0 },
          currentSeasonCount: currentSeason.found,
          pastSeasonsCount: 0,
        },
      };
    }

    const description = errorDescription(error, 'ESPN league refresh failed');
    const isAuthError = error instanceof EspnAuthenticationFailed ||
      description.includes('authentication') ||
      description.includes('expired') ||
      description.includes('invalid');
    return {
      platform: 'espn',
      status: 'error',
      httpStatus: isAuthError ? 401 : 500,
      error: isAuthError ? 'espn_auth_failed' : 'discovery_failed',
      error_description: description,
    };
  }
}

async function savedCurrentEspnDetails(storage: EspnSupabaseStorage, userId: string) {
  const savedLeagues = await storage.getCurrentSeasonLeagues(userId);
  const discovered: DiscoveredLeague[] = savedLeagues.map((league) => ({
    sport: league.sport,
    leagueId: league.leagueId,
    leagueName: league.leagueName || '',
    teamId: league.teamId || '',
    teamName: league.teamName || '',
    seasonYear: league.seasonYear || 0,
  }));
  const currentSeason: SeasonCounts = {
    found: discovered.length,
    added: 0,
    alreadySaved: discovered.length,
    refreshed: 0,
  };
  return { discovered, currentSeason };
}

async function activeWebEspnHistoryResult(
  env: LeagueRefreshEnv,
  userId: string
): Promise<ProviderRefreshResult | null> {
  if (!durableHistoryEnabledFor(env, userId)) return null;
  const job = await EspnHistoryJobStorage.fromEnvironment(env).activeForUser(userId);
  if (!job) return null;
  const storage = EspnSupabaseStorage.fromEnvironment(env);
  const { discovered, currentSeason } = await savedCurrentEspnDetails(storage, userId);
  return {
    platform: 'espn',
    status: 'success',
    httpStatus: 200,
    details: {
      discovered,
      currentSeason,
      pastSeasons: { found: 0, added: 0, alreadySaved: 0, refreshed: 0 },
      currentSeasonCount: currentSeason.found,
      pastSeasonsCount: 0,
      history: publicHistoryStatus(job),
    },
  };
}

async function refreshEspnLeaguesForWeb(
  env: LeagueRefreshEnv,
  userId: string,
  ownerId: string,
  syncState: SyncStateStorage
): Promise<EspnRefreshExecution> {
  if (!env.ESPN_HISTORY_REFRESH) {
    throw new Error('ESPN history workflow binding is unavailable');
  }
  const historyEnv = env as EspnHistoryEnv;
  const storage = EspnSupabaseStorage.fromEnvironment(env);
  const historyStorage = EspnHistoryJobStorage.fromEnvironment(historyEnv);
  const credentials = await historyStorage.credentials(userId);
  if (!credentials) {
    return {
      leaseTransferred: false,
      result: {
        platform: 'espn',
        status: 'skipped',
        httpStatus: 400,
        error: 'credentials_not_found',
        error_description: 'ESPN credentials not found. Please sync credentials first.',
      },
    };
  }

  let historyOwner: string | null = null;
  try {
    const current = await discoverAndSaveCurrentLeagues(
      userId,
      credentials.swid,
      credentials.s2,
      storage
    );
    if (current.savedLeagues.length !== current.currentSeason.found) {
      throw new Error('Unable to save every current ESPN league');
    }

    const credentialSnapshot = await historyStorage.credentials(userId);
    if (!credentialSnapshot || credentialSnapshot.updatedAt !== credentials.updatedAt) {
      throw new EspnAuthenticationFailed('ESPN credentials changed during refresh');
    }
    const queued = await historyStorage.createOrCoalesce(userId, credentialSnapshot.updatedAt);
    if (queued.created) {
      if (!await historyStorage.setCurrentLeagues(queued.job.id, current.savedLeagues)) {
        await historyStorage.terminal(
          queued.job.id,
          'failed',
          'job_context_failed',
          'Unable to store current ESPN leagues for history refresh'
        );
        throw new Error('Unable to store ESPN history job context');
      }
      historyOwner = `history:${queued.job.id}`;
      if (!await syncState.transferLease(userId, 'espn', ownerId, historyOwner)) {
        await historyStorage.terminal(
          queued.job.id,
          'failed',
          'history_lease_transfer_failed',
          'Unable to transfer the ESPN history lease'
        );
        historyOwner = null;
        throw new Error('Unable to transfer ESPN history lease');
      }
    }

    const started = await startQueuedEspnHistoryJob(historyEnv, queued);
    return {
      leaseTransferred: queued.created,
      result: {
        platform: 'espn',
        status: 'success',
        httpStatus: 200,
        details: {
          discovered: current.discovered,
          currentSeason: current.currentSeason,
          pastSeasons: { found: 0, added: 0, alreadySaved: 0, refreshed: 0 },
          currentSeasonCount: current.currentSeason.found,
          pastSeasonsCount: 0,
          history: publicHistoryStatus(started.job),
        },
      },
    };
  } catch (error) {
    if (historyOwner) {
      await syncState.settle(userId, 'espn', historyOwner, {
        status: 'error',
        cooldownSeconds: cooldownSecondsForResult({
          platform: 'espn',
          status: 'error',
          httpStatus: 500,
          error_description: errorDescription(error, 'ESPN history refresh failed'),
        }),
        syncSource: 'web',
        errorCode: 'history_start_failed',
        errorMessage: errorDescription(error, 'ESPN history refresh failed'),
      });
    }
    throw error;
  }
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function refreshYahooLeagues(
  env: YahooConnectEnv,
  userId: string,
  corsHeaders: Record<string, string>,
  correlationId?: string
): Promise<ProviderRefreshResult> {
  const response = await handleYahooDiscover(env, userId, corsHeaders, correlationId);
  const body = await parseResponseBody(response);
  const retryAfter = response.headers.get('Retry-After') ?? undefined;

  return {
    platform: 'yahoo',
    status: response.ok ? 'success' : response.status === 404 ? 'skipped' : 'error',
    httpStatus: response.status,
    ...(retryAfter ? { retryAfter } : {}),
    ...(isRecord(body) && typeof body.error === 'string' ? { error: body.error } : {}),
    ...(isRecord(body) && typeof body.error_description === 'string' ? { error_description: body.error_description } : {}),
    details: body,
  };
}

async function refreshSleeperLeagues(env: SleeperConnectEnv, userId: string): Promise<ProviderRefreshResult> {
  try {
    const result = await refreshSleeperLeaguesFromStoredConnection(env, userId);
    return {
      platform: 'sleeper',
      status: result.status,
      httpStatus: result.status === 'success' ? 200 : 404,
      ...(result.status === 'skipped'
        ? {
            error: result.error,
            error_description: result.error_description,
            details: result.details,
          }
        : { details: result.details }),
    };
  } catch (error) {
    return {
      platform: 'sleeper',
      status: 'error',
      httpStatus: 500,
      error: 'discovery_failed',
      error_description: errorDescription(error, 'Sleeper league refresh failed'),
    };
  }
}

function cooldownBlockedResult(
  platform: RefreshPlatform,
  state: 'in_progress' | 'cooldown',
  retryAfterSeconds: number
): ProviderRefreshResult {
  return {
    platform,
    status: 'error',
    httpStatus: 429,
    error: 'refresh_cooldown',
    error_description: state === 'in_progress'
      ? `A ${platform} refresh is already in progress. Try again in ${retryAfterSeconds} seconds.`
      : `${platform} refresh is cooling down. Try again in ${retryAfterSeconds} seconds.`,
    retryAfter: String(retryAfterSeconds),
  };
}

/**
 * Cooldown classification: upstream 429/timeout gets the long backoff
 * (or the provider's own Retry-After when longer); everything else gets
 * the normal post-refresh cooldown.
 */
export function cooldownSecondsForResult(result: ProviderRefreshResult): number {
  const providerRetryAfter = Number(result.retryAfter);
  const timedOut = /timeout|timed out/i.test(result.error_description ?? '');
  if (result.httpStatus === 429 || timedOut) {
    return Number.isFinite(providerRetryAfter) && providerRetryAfter > UPSTREAM_BACKOFF_COOLDOWN_SECONDS
      ? providerRetryAfter
      : UPSTREAM_BACKOFF_COOLDOWN_SECONDS;
  }
  return NORMAL_REFRESH_COOLDOWN_SECONDS;
}

function leagueCountFromResult(result: ProviderRefreshResult): number | undefined {
  const details = result.details;
  if (typeof details !== 'object' || details === null) return undefined;
  const record = details as Record<string, unknown>;
  if (typeof record.currentSeasonCount === 'number') return record.currentSeasonCount;
  if (typeof record.count === 'number') return record.count;
  if (typeof record.leagues_found === 'number') return record.leagues_found;
  return undefined;
}

export async function refreshLeaguesForUser(
  env: LeagueRefreshEnv,
  userId: string,
  platforms: RefreshPlatform[],
  corsHeaders: Record<string, string>,
  correlationId?: string,
  syncSource: SyncSource = 'web'
): Promise<LeagueRefreshResponse> {
  const syncState = SyncStateStorage.fromEnvironment(env);

  const refreshOne = async (platform: RefreshPlatform): Promise<[RefreshPlatform, ProviderRefreshResult]> => {
    const useDurableWebHistory = platform === 'espn'
      && syncSource === 'web'
      && durableHistoryEnabledFor(env, userId);
    if (useDurableWebHistory) {
      const active = await activeWebEspnHistoryResult(env, userId);
      if (active) return [platform, active];
    }

    const ownerId = crypto.randomUUID();
    const lease = await syncState.acquireLease(userId, platform, ownerId);
    if (!lease.acquired) {
      logSyncEnvelope({
        provider: platform,
        userId,
        syncSource,
        status: 'cooldown_blocked',
        httpStatus: 429,
        retryAfterSeconds: lease.retryAfterSeconds,
        correlationId,
        ownerId,
      });
      return [platform, cooldownBlockedResult(platform, lease.state, lease.retryAfterSeconds)];
    }

    const startedAt = Date.now();
    let result: ProviderRefreshResult;
    let leaseTransferred = false;
    try {
      if (platform === 'espn') {
        if (useDurableWebHistory) {
          const execution = await refreshEspnLeaguesForWeb(env, userId, ownerId, syncState);
          result = execution.result;
          leaseTransferred = execution.leaseTransferred;
        } else {
          result = await refreshEspnLeagues(env, userId);
        }
      } else if (platform === 'yahoo') {
        result = await refreshYahooLeagues(env as YahooConnectEnv, userId, corsHeaders, correlationId);
      } else {
        result = await refreshSleeperLeagues(env as SleeperConnectEnv, userId);
      }
    } catch (error) {
      result = {
        platform,
        status: 'error',
        httpStatus: 500,
        error: 'refresh_failed',
        error_description: errorDescription(error, `${platform} league refresh failed`),
      };
    }

    const durationMs = Date.now() - startedAt;
    const leagueCount = leagueCountFromResult(result);
    if (!leaseTransferred) {
      await syncState.settle(userId, platform, ownerId, {
        status: result.status,
        // Skipped providers (no credentials) did no upstream work; don't make a
        // user who connects a platform right after a sync wait out a cooldown.
        cooldownSeconds: result.status === 'skipped' ? 1 : cooldownSecondsForResult(result),
        syncSource,
        errorCode: result.error,
        errorMessage: result.error_description,
        leagueCount,
        durationMs,
      });
    }
    logSyncEnvelope({
      provider: platform,
      userId,
      syncSource,
      status: result.status,
      httpStatus: result.httpStatus,
      durationMs,
      leagueCount,
      errorCode: result.error,
      ...(result.retryAfter ? { retryAfterSeconds: Number(result.retryAfter) || undefined } : {}),
      correlationId,
      ownerId,
    });
    return [platform, result];
  };

  const entries = await Promise.all(platforms.map(refreshOne));
  const results = Object.fromEntries(entries) as Partial<Record<RefreshPlatform, ProviderRefreshResult>>;

  return {
    success: Object.values(results).some((result) => result?.status === 'success'),
    requestedPlatforms: platforms,
    results,
  };
}

/**
 * When every requested provider was blocked by an active cooldown/in-flight
 * lease, the whole response should be a 429 rather than a 200 with only
 * cooldown errors inside. Returns the Retry-After seconds to advertise
 * (the longest remaining cooldown), or null when any provider actually ran.
 */
export function allProvidersCooldownRetryAfter(response: LeagueRefreshResponse): number | null {
  const results = Object.values(response.results);
  if (results.length === 0) return null;
  let maxRetryAfter = 0;
  for (const result of results) {
    if (!result || result.error !== 'refresh_cooldown') return null;
    maxRetryAfter = Math.max(maxRetryAfter, Number(result.retryAfter) || 0);
  }
  return maxRetryAfter > 0 ? maxRetryAfter : NORMAL_REFRESH_COOLDOWN_SECONDS;
}
