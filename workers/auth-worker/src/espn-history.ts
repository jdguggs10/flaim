import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import { getLeagueInfo } from './v3/get-league-info';
import { getLeagueTeams } from './v3/get-league-teams';
import { EspnApiError, EspnAuthenticationFailed, EspnCredentialsRequired, EspnLeagueNotFound, gameIdToSport, type DiscoveredEspnLeague } from './espn-types';
import { toPlatformYear } from './season-utils';
import {
  NORMAL_REFRESH_COOLDOWN_SECONDS,
  SyncStateStorage,
  UPSTREAM_BACKOFF_COOLDOWN_SECONDS,
} from './sync-state';

export const ESPN_HISTORY_SCAN_VERSION = 1;

export type EspnHistoryJobStatus = 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | 'superseded' | 'cancelled';
export type EspnHistoryMode = 'full' | 'incremental';
export type EspnHistoryUpstreamClass = 'auth' | 'permanent' | 'retryable';

export function classifyEspnHistoryUpstreamError(error: unknown): EspnHistoryUpstreamClass {
  const message = error instanceof Error ? error.message : '';
  if (
    error instanceof EspnAuthenticationFailed
    || error instanceof EspnCredentialsRequired
    || /authentication|unauthori[sz]ed|forbidden|credentials? (?:changed|required|expired|need)/i.test(message)
  ) {
    return 'auth';
  }
  if (error instanceof EspnLeagueNotFound) return 'permanent';
  if (error instanceof EspnApiError) {
    if (error.status === 401 || error.status === 403) return 'auth';
    if (error.status === undefined || error.status === 408 || error.status === 425 || error.status === 429 || error.status >= 500) return 'retryable';
    return error.status >= 400 && error.status < 500 ? 'permanent' : 'retryable';
  }
  return 'retryable';
}

export interface EspnHistoryPlanItem {
  leagueId: string;
  gameId: string;
  sport: 'football' | 'baseball' | 'basketball' | 'hockey';
  seasonYear: number;
  teamId: string;
  teamName: string;
  leagueName: string;
}

export function historyKey(
  item: Pick<EspnHistoryPlanItem, 'sport' | 'leagueId' | 'seasonYear'>
): string {
  return `${item.sport}:${item.leagueId}:${item.seasonYear}`;
}

export function dedupeHistoryPlan(items: EspnHistoryPlanItem[]): EspnHistoryPlanItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = historyKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export interface EspnHistoryJob {
  id: string;
  clerk_user_id: string;
  status: EspnHistoryJobStatus;
  workflow_instance_id: string | null;
  credential_updated_at: string;
  scan_version: number;
  mode: EspnHistoryMode;
  current_leagues: DiscoveredEspnLeague[];
  plan: EspnHistoryPlanItem[];
  cursor: number;
  planned_count: number;
  completed_count: number;
  skipped_count: number;
  failed_count: number;
  failures: Array<{ index: number; code: string; message: string }>;
  last_error_code: string | null;
  last_error_message: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface EspnHistoryEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  ESPN_DURABLE_HISTORY_ENABLED?: string;
  ESPN_DURABLE_HISTORY_USERS?: string;
  ESPN_HISTORY_REFRESH: { create(options: { id: string; params: { jobId: string } }): Promise<{ id: string }> };
}

interface EspnHistoryProgress {
  status: EspnHistoryJobStatus;
  cursor: number;
  planned_count: number;
  failed_count: number;
}

export interface HistoryStop {
  status: Extract<EspnHistoryJobStatus, 'failed' | 'superseded' | 'cancelled'>;
  code: string;
  message: string;
}

interface HistoryChunkResult {
  stop?: HistoryStop;
}

class HistoryLeaseLostError extends Error {
  constructor(message = 'ESPN history lease lost') {
    super(message);
    this.name = 'HistoryLeaseLostError';
  }
}

function asJob(value: unknown): EspnHistoryJob | null {
  if (!value || typeof value !== 'object') return null;
  return value as EspnHistoryJob;
}

function isUniqueViolation(error: { code?: string } | null): boolean {
  return error?.code === '23505';
}

export function isMissingEspnHistoryTableError(
  error: { code?: string; message?: string } | null
): boolean {
  if (!error) return false;
  if (error.code === '42P01' || error.code === 'PGRST205') return true;
  return /espn_history_jobs/i.test(error.message ?? '')
    && /(does not exist|schema cache|could not find)/i.test(error.message ?? '');
}

export function durableHistoryEnabledFor(env: Pick<EspnHistoryEnv, 'ESPN_DURABLE_HISTORY_ENABLED' | 'ESPN_DURABLE_HISTORY_USERS'>, userId: string): boolean {
  if (env.ESPN_DURABLE_HISTORY_ENABLED !== 'true') return false;
  // The allowlist is a private environment value. Do not log it or its size.
  return (env.ESPN_DURABLE_HISTORY_USERS ?? '').split(',').map(value => value.trim()).includes(userId);
}

export function publicHistoryStatus(job: EspnHistoryJob | null) {
  if (!job) return null;
  return {
    jobId: job.id,
    state: job.status,
    counts: {
      planned: job.planned_count,
      completed: job.completed_count,
      skipped: job.skipped_count,
      failed: job.failed_count,
    },
    createdAt: job.created_at,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
    retryable: job.status === 'failed' || job.status === 'partial',
    errors: Array.isArray(job.failures)
      ? job.failures.map(({ code, message }) => ({ code, message }))
      : [],
  };
}

export class EspnHistoryJobStorage {
  private constructor(private readonly supabase: SupabaseClient) {}

  static fromEnvironment(env: Pick<EspnHistoryEnv, 'SUPABASE_URL' | 'SUPABASE_SERVICE_KEY'>): EspnHistoryJobStorage {
    return new EspnHistoryJobStorage(createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } }));
  }

  async credentials(userId: string): Promise<{ swid: string; s2: string; updatedAt: string } | null> {
    const { data, error } = await this.supabase.from('espn_credentials')
      .select('swid, s2, updated_at').eq('clerk_user_id', userId).maybeSingle();
    if (error) throw new Error('Unable to read ESPN credentials');
    if (!data?.swid || !data.s2 || !data.updated_at) return null;
    return { swid: data.swid, s2: data.s2, updatedAt: data.updated_at };
  }

  async activeForUser(userId: string): Promise<EspnHistoryJob | null> {
    await this.failStaleQueuedJob(userId);
    const { data, error } = await this.supabase.from('espn_history_jobs').select('*')
      .eq('clerk_user_id', userId).in('status', ['queued', 'running']).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error('Unable to read active ESPN history job');
    return asJob(data);
  }

  async latestForUser(userId: string): Promise<EspnHistoryJob | null> {
    await this.failStaleQueuedJob(userId);
    const { data, error } = await this.supabase.from('espn_history_jobs').select('*')
      .eq('clerk_user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (isMissingEspnHistoryTableError(error)) return null;
    if (error) throw new Error('Unable to read latest ESPN history job');
    return asJob(data);
  }

  async get(id: string): Promise<EspnHistoryJob | null> {
    const { data, error } = await this.supabase.from('espn_history_jobs').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error('Unable to read ESPN history job');
    return asJob(data);
  }

  async progress(id: string): Promise<EspnHistoryProgress | null> {
    const { data, error } = await this.supabase
      .from('espn_history_jobs')
      .select('status,cursor,planned_count,failed_count')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error('Unable to read ESPN history progress');
    return data ? data as EspnHistoryProgress : null;
  }

  private async failStaleQueuedJob(userId: string): Promise<void> {
    const staleBefore = new Date(Date.now() - 10 * 60_000).toISOString();
    const now = new Date().toISOString();
    const { error } = await this.supabase
      .from('espn_history_jobs')
      .update({
        status: 'failed',
        last_error_code: 'workflow_start_interrupted',
        last_error_message: 'The history refresh did not start. Run sync again.',
        finished_at: now,
        updated_at: now,
      })
      .eq('clerk_user_id', userId)
      .eq('status', 'queued')
      .lt('updated_at', staleBefore);
    if (isMissingEspnHistoryTableError(error)) return;
    if (error) throw new Error('Unable to recover a stale ESPN history job');
  }

  async createOrCoalesce(userId: string, credentialUpdatedAt: string, attempt = 0): Promise<{ job: EspnHistoryJob; created: boolean }> {
    await this.failStaleQueuedJob(userId);
    const { data: repaired, error: repairedError } = await this.supabase
      .from('espn_history_jobs')
      .select('id')
      .eq('clerk_user_id', userId)
      .eq('scan_version', ESPN_HISTORY_SCAN_VERSION)
      .eq('mode', 'full')
      .in('status', ['succeeded', 'partial'])
      .not('finished_at', 'is', null)
      .limit(1)
      .maybeSingle();
    if (repairedError) throw new Error('Unable to read ESPN history repair marker');
    const mode: EspnHistoryMode = repaired ? 'incremental' : 'full';
    const { data, error } = await this.supabase.from('espn_history_jobs').insert({
      clerk_user_id: userId, credential_updated_at: credentialUpdatedAt, scan_version: ESPN_HISTORY_SCAN_VERSION, mode,
    }).select('*').single();
    if (!error && data) return { job: data as EspnHistoryJob, created: true };
    if (!isUniqueViolation(error)) throw new Error('Unable to create ESPN history job');
    const active = await this.activeForUser(userId);
    if (active) return { job: active, created: false };
    if (attempt === 0) return this.createOrCoalesce(userId, credentialUpdatedAt, 1);
    throw new Error('Unable to coalesce ESPN history job');
  }

  async setWorkflowInstance(id: string, workflowInstanceId: string): Promise<boolean> {
    const { data, error } = await this.supabase.from('espn_history_jobs').update({ workflow_instance_id: workflowInstanceId, updated_at: new Date().toISOString() })
      .eq('id', id).is('workflow_instance_id', null).select('id');
    return !error && (data?.length ?? 0) === 1;
  }

  async start(id: string): Promise<boolean> {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase.from('espn_history_jobs').update({ status: 'running', started_at: now, updated_at: now })
      .eq('id', id).eq('status', 'queued').select('id');
    if (error) throw new Error('Unable to start ESPN history job');
    return (data?.length ?? 0) === 1;
  }

  async setPlan(id: string, plan: EspnHistoryPlanItem[]): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('espn_history_jobs')
      .update({ plan, planned_count: plan.length, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'running')
      .eq('cursor', 0)
      .select('id');
    return !error && (data?.length ?? 0) === 1;
  }

  async setCurrentLeagues(id: string, currentLeagues: DiscoveredEspnLeague[]): Promise<boolean> {
    const { error } = await this.supabase.from('espn_history_jobs').update({ current_leagues: currentLeagues, updated_at: new Date().toISOString() }).eq('id', id);
    return !error;
  }

  async terminal(
    id: string,
    status: Extract<EspnHistoryJobStatus, 'succeeded' | 'partial' | 'failed' | 'superseded' | 'cancelled'>,
    errorCode?: string,
    errorMessage?: string
  ): Promise<string> {
    const { data, error } = await this.supabase.rpc('finish_espn_history_job', {
      p_job_id: id,
      p_status: status,
      p_error_code: errorCode ?? null,
      p_error_message: errorMessage ?? null,
    });
    if (error) throw new Error('Unable to finish ESPN history job');
    const row = Array.isArray(data) ? data[0] : data;
    const outcome = typeof row?.outcome === 'string' ? row.outcome : 'unknown';
    if (!['finished', 'job_not_active', 'credential_changed', 'lease_lost'].includes(outcome)) {
      throw new Error(`ESPN history job rejected terminal state: ${outcome}`);
    }
    return outcome;
  }

  async advance(index: number, job: EspnHistoryJob, action: 'persist' | 'skip' | 'fail', item?: EspnHistoryPlanItem, failure?: { code: string; message: string }): Promise<string> {
    const { data, error } = await this.supabase.rpc('advance_espn_history_job', {
      p_job_id: job.id, p_credential_updated_at: job.credential_updated_at, p_plan_index: index, p_action: action,
      p_league_id: item?.leagueId ?? null, p_sport: item?.sport ?? null, p_season_year: item?.seasonYear ?? null,
      p_team_id: item?.teamId ?? null, p_team_name: item?.teamName ?? null, p_league_name: item?.leagueName ?? null,
      p_failure_code: failure?.code ?? null, p_failure_message: failure?.message ?? null,
    });
    if (error) throw new Error('History persistence fence failed');
    const row = Array.isArray(data) ? data[0] : data;
    return typeof row?.outcome === 'string' ? row.outcome : 'unknown';
  }

  async existingKeys(userId: string): Promise<Set<string>> {
    const keys = new Set<string>();
    let afterId = 0;
    while (true) {
      const { data, error } = await this.supabase
        .from('espn_leagues')
        .select('id,league_id,sport,season_year')
        .eq('clerk_user_id', userId)
        .gt('id', afterId)
        .order('id', { ascending: true })
        .limit(500);
      if (error || !data) throw new Error('Unable to load saved ESPN leagues');
      for (const row of data) {
        if (row.season_year !== null) {
          keys.add(`${row.sport}:${row.league_id}:${row.season_year}`);
        }
      }
      if (data.length < 500) return keys;
      afterId = data[data.length - 1].id;
    }
  }
}

export async function startQueuedEspnHistoryJob(env: EspnHistoryEnv, result: { job: EspnHistoryJob; created: boolean }): Promise<{ job: EspnHistoryJob; created: boolean }> {
  const storage = EspnHistoryJobStorage.fromEnvironment(env);
  if (!result.created || result.job.workflow_instance_id) return result;
  const workflowId = `espn-history-${result.job.id}`;
  try {
    const instance = await env.ESPN_HISTORY_REFRESH.create({ id: workflowId, params: { jobId: result.job.id } });
    if (!await storage.setWorkflowInstance(result.job.id, instance.id)) throw new Error('Failed to attach ESPN history workflow');
    return { ...result, job: { ...result.job, workflow_instance_id: instance.id } };
  } catch (error) {
    await storage.terminal(
      result.job.id,
      'failed',
      'workflow_start_failed',
      'Unable to start history refresh'
    );
    throw error;
  }
}

export async function buildPlan(
  storage: EspnHistoryJobStorage,
  job: EspnHistoryJob,
  credentials: { swid: string; s2: string },
  current: DiscoveredEspnLeague[],
  checkpoint?: () => Promise<boolean>
): Promise<EspnHistoryPlanItem[]> {
  const plan: EspnHistoryPlanItem[] = [];
  const existing = job.mode === 'incremental' ? await storage.existingKeys(job.clerk_user_id) : new Set<string>();
  for (const league of current) {
    if (checkpoint && !await checkpoint()) {
      throw new HistoryLeaseLostError('ESPN history lease lost during planning');
    }
    const sport = gameIdToSport(league.gameId);
    if (!sport) continue;
    const info = await getLeagueInfo(credentials.swid, credentials.s2, league.leagueId, league.seasonId, league.gameId);
    for (const seasonYear of [...new Set(info.status?.previousSeasons ?? [])].sort((a, b) => b - a)) {
      const item: EspnHistoryPlanItem = {
        leagueId: league.leagueId,
        gameId: league.gameId,
        sport,
        seasonYear,
        teamId: String(league.teamId),
        teamName: league.teamName,
        leagueName: league.leagueName,
      };
      if (job.mode === 'incremental' && existing.has(historyKey(item))) continue;
      plan.push(item);
    }
  }
  return dedupeHistoryPlan(plan);
}

export function stopForHistoryAdvanceOutcome(outcome: string): HistoryStop | null {
  if (['persisted', 'skipped', 'failed', 'already_processed'].includes(outcome)) return null;
  if (outcome === 'credential_changed') {
    return {
      status: 'superseded',
      code: 'credentials_changed',
      message: 'ESPN credentials changed during history refresh. Run sync again.',
    };
  }
  if (outcome === 'lease_lost' || outcome === 'job_not_active') {
    return {
      status: 'cancelled',
      code: 'history_lease_lost',
      message: 'The history refresh lost its ownership fence. Run sync again.',
    };
  }
  return {
    status: 'failed',
    code: 'history_fence_rejected',
    message: `The history refresh rejected an unsafe state transition (${outcome}).`,
  };
}

export function stopForHistoryTerminalOutcome(outcome: string): HistoryStop | null {
  if (outcome === 'finished') return null;
  if (outcome === 'credential_changed') {
    return {
      status: 'superseded',
      code: 'credentials_changed',
      message: 'ESPN credentials changed before history completion. Run sync again.',
    };
  }
  if (outcome === 'lease_lost' || outcome === 'job_not_active') {
    return {
      status: 'cancelled',
      code: outcome === 'job_not_active' ? 'history_job_not_active' : 'history_lease_lost',
      message: outcome === 'job_not_active'
        ? 'The ESPN history job is no longer active.'
        : 'The history refresh lost its ownership fence. Run sync again.',
    };
  }
  return {
    status: 'failed',
    code: 'history_terminal_fence_rejected',
    message: `The history refresh rejected an unsafe terminal state (${outcome}).`,
  };
}

export async function ensureEspnHistoryJobStarted(
  storage: Pick<EspnHistoryJobStorage, 'start' | 'get'>,
  jobId: string
): Promise<boolean> {
  if (await storage.start(jobId)) return true;
  return (await storage.get(jobId))?.status === 'running';
}

export async function beginEspnLeagueMutation(
  storage: Pick<EspnHistoryJobStorage, 'activeForUser' | 'terminal'> | null,
  lease: Pick<SyncStateStorage, 'takeoverLeaseForMutation'>,
  userId: string
): Promise<{ jobId: string | null; ownerId: string }> {
  const active = storage ? await storage.activeForUser(userId) : null;
  if (active) {
    await storage!.terminal(
      active.id,
      'cancelled',
      'league_data_changed',
      'History refresh cancelled because saved ESPN leagues changed.'
    );
  }
  const ownerId = `league-mutation:${crypto.randomUUID()}`;
  if (!await lease.takeoverLeaseForMutation(userId, 'espn', ownerId)) {
    throw new Error('Unable to fence ESPN league mutation');
  }
  return { jobId: active?.id ?? null, ownerId };
}

export class EspnHistoryRefreshWorkflow extends WorkflowEntrypoint<EspnHistoryEnv, { jobId: string }> {
  async run(event: Readonly<WorkflowEvent<{ jobId: string }>>, step: WorkflowStep): Promise<void> {
    const storage = EspnHistoryJobStorage.fromEnvironment(this.env);
    const initial = await step.do(
      'load job',
      { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' } },
      async () => storage.get(event.payload.jobId)
    );
    if (!initial) return;

    const lease = SyncStateStorage.fromEnvironment(this.env);
    const owner = `history:${initial.id}`;
    const finish = async (
      status: Extract<EspnHistoryJobStatus, 'succeeded' | 'partial' | 'failed' | 'superseded' | 'cancelled'>,
      code?: string,
      message?: string,
      upstreamBackoff = false
    ): Promise<void> => {
      let effectiveStatus = status;
      let effectiveCode = code;
      let effectiveMessage = message;

      if (status === 'succeeded' || status === 'partial') {
        const renewed = await step.do(
          'renew history lease before completion',
          async () => lease.extendLease(initial.clerk_user_id, 'espn', owner)
        );
        if (!renewed) {
          effectiveStatus = 'cancelled';
          effectiveCode = 'history_lease_lost';
          effectiveMessage = 'The history refresh lost its ownership fence. Run sync again.';
        }
      }

      const outcome = await step.do(
        'finish history job',
        { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' } },
        async () => storage.terminal(initial.id, effectiveStatus, effectiveCode, effectiveMessage)
      );
      const stop = stopForHistoryTerminalOutcome(outcome);
      if (stop && outcome !== 'job_not_active') {
        effectiveStatus = stop.status;
        effectiveCode = stop.code;
        effectiveMessage = stop.message;
        const recoveryOutcome = await step.do(
          'finish history job after completion fence rejection',
          { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' } },
          async () => storage.terminal(initial.id, stop.status, stop.code, stop.message)
        );
        if (recoveryOutcome !== 'finished' && recoveryOutcome !== 'job_not_active') {
          throw new Error(`ESPN history job rejected terminal recovery: ${recoveryOutcome}`);
        }
      } else if (stop) {
        effectiveStatus = stop.status;
        effectiveCode = stop.code;
        effectiveMessage = stop.message;
      }
      await step.do(
        'settle history lease',
        { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' } },
        async () => lease.settle(initial.clerk_user_id, 'espn', owner, {
          status: effectiveStatus === 'succeeded' ? 'success'
            : effectiveStatus === 'failed' || effectiveStatus === 'partial' ? 'error'
              : 'skipped',
          cooldownSeconds: effectiveStatus === 'superseded' || effectiveStatus === 'cancelled'
            ? 1
            : upstreamBackoff
              ? UPSTREAM_BACKOFF_COOLDOWN_SECONDS
              : NORMAL_REFRESH_COOLDOWN_SECONDS,
          syncSource: 'web',
          errorCode: effectiveCode,
          errorMessage: effectiveMessage,
          durationMs: initial.started_at
            ? Math.max(0, Date.now() - new Date(initial.started_at).getTime())
            : undefined,
        }, { failOnError: true })
      );
    };

    if (!durableHistoryEnabledFor(this.env, initial.clerk_user_id)) {
      await finish('cancelled', 'history_disabled', 'ESPN history refresh is disabled');
      return;
    }
    const started = await step.do(
      'start job',
      { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' } },
      async () => ensureEspnHistoryJobStarted(storage, initial.id)
    );
    if (!started) return;

    const job = await step.do(
      'load started job',
      { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' } },
      async () => storage.get(initial.id)
    );
    if (!job) return;
    const credentialsMatch = await step.do(
      'verify credential snapshot',
      async () => {
        const candidate = await storage.credentials(job.clerk_user_id);
        return candidate?.updatedAt === job.credential_updated_at;
      }
    );
    if (!credentialsMatch) {
      await finish(
        'superseded',
        'credentials_changed',
        'ESPN credentials changed before history refresh started. Run sync again.'
      );
      return;
    }
    if (!await lease.extendLease(job.clerk_user_id, 'espn', owner)) {
      await finish(
        'cancelled',
        'history_lease_lost',
        'The history refresh lost its ownership fence. Run sync again.'
      );
      return;
    }

    // The request writes current rows first. Its current leagues are all that
    // need history planning; the compact plan remains server-side.
    const current = await step.do(
      'load current leagues',
      async () => Array.isArray(job.current_leagues)
        ? job.current_leagues
        : [] as DiscoveredEspnLeague[]
    );

    let plan: EspnHistoryPlanItem[];
    try {
      plan = await step.do(
        'plan history',
        { retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' }, timeout: '10 minutes' },
        async () => {
          const planCredentials = await storage.credentials(job.clerk_user_id);
          if (!planCredentials || planCredentials.updatedAt !== job.credential_updated_at) {
            throw new EspnAuthenticationFailed('ESPN credentials changed during history planning');
          }
          return buildPlan(
            storage,
            job,
            planCredentials,
            current,
            async () => {
              if (!await lease.extendLease(job.clerk_user_id, 'espn', owner)) return false;
              const candidate = await storage.credentials(job.clerk_user_id);
              if (!candidate || candidate.updatedAt !== job.credential_updated_at) {
                throw new EspnAuthenticationFailed('ESPN credentials changed during history planning');
              }
              return true;
            }
          );
        }
      );
    } catch (error) {
      if (error instanceof HistoryLeaseLostError) {
        await finish(
          'cancelled',
          'history_lease_lost',
          'The history refresh lost its ownership fence. Run sync again.'
        );
      } else if (classifyEspnHistoryUpstreamError(error) === 'auth') {
        await finish(
          'superseded',
          'espn_auth_failed',
          'ESPN credentials need to be refreshed. Reconnect ESPN and sync again.'
        );
      } else {
        await finish(
          'failed',
          'history_plan_failed',
          'ESPN history planning failed after retries. Run sync again.',
          true
        );
      }
      return;
    }

    const storedPlan = await step.do(
      'store history plan',
      { retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' } },
      async () => storage.setPlan(job.id, plan)
    );
    if (!storedPlan) {
      await finish(
        'failed',
        'history_plan_store_failed',
        'Unable to store the ESPN history plan. Run sync again.'
      );
      return;
    }

    for (let start = 0; start < plan.length; start += 5) {
      if (!durableHistoryEnabledFor(this.env, job.clerk_user_id)) {
        await finish('cancelled', 'history_disabled', 'ESPN history refresh was disabled');
        return;
      }

      let result: HistoryChunkResult;
      try {
        result = await step.do(
          `history chunk ${start / 5 + 1}`,
          { retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' }, timeout: '2 minutes' },
          async (): Promise<HistoryChunkResult> => {
            const currentCredentials = await storage.credentials(job.clerk_user_id);
            if (!currentCredentials || currentCredentials.updatedAt !== job.credential_updated_at) {
              return {
                stop: {
                  status: 'superseded',
                  code: 'credentials_changed',
                  message: 'ESPN credentials changed during history refresh. Run sync again.',
                },
              };
            }

            for (let index = start; index < Math.min(start + 5, plan.length); index++) {
              const progress = await storage.progress(job.id);
              if (!progress) throw new Error('Unable to read ESPN history progress');
              if (progress.status !== 'running') {
                return {
                  stop: {
                    status: 'cancelled',
                    code: 'history_job_not_active',
                    message: 'The ESPN history job is no longer active.',
                  },
                };
              }
              // A Workflow step may retry after the RPC committed but before
              // the runtime observed the response. Never refetch that season.
              if (progress.cursor > index) continue;
              if (progress.cursor < index) {
                return {
                  stop: {
                    status: 'failed',
                    code: 'history_cursor_out_of_order',
                    message: 'The ESPN history cursor is out of order.',
                  },
                };
              }
              if (!await lease.extendLease(job.clerk_user_id, 'espn', owner)) {
                return {
                  stop: {
                    status: 'cancelled',
                    code: 'history_lease_lost',
                    message: 'The history refresh lost its ownership fence. Run sync again.',
                  },
                };
              }

              const item = plan[index];
              let historicalInfo;
              let teams;
              try {
                const platformYear = toPlatformYear(item.seasonYear, item.sport, 'espn');
                historicalInfo = await getLeagueInfo(
                  currentCredentials.swid,
                  currentCredentials.s2,
                  item.leagueId,
                  platformYear,
                  item.gameId
                );
                teams = await getLeagueTeams(
                  currentCredentials.swid,
                  currentCredentials.s2,
                  item.leagueId,
                  platformYear,
                  item.gameId
                );
              } catch (error) {
                const failureClass = classifyEspnHistoryUpstreamError(error);
                if (failureClass === 'auth') {
                  return {
                    stop: {
                      status: 'superseded',
                      code: 'espn_auth_failed',
                      message: 'ESPN credentials need to be refreshed. Reconnect ESPN and sync again.',
                    },
                  };
                }
                if (failureClass === 'retryable') throw error;
                const outcome = await storage.advance(index, job, 'fail', undefined, {
                  code: 'season_unavailable',
                  message: error instanceof Error ? error.message : 'Historical season is unavailable',
                });
                const stop = stopForHistoryAdvanceOutcome(outcome);
                if (stop) return { stop };
                continue;
              }

              const team = teams.find(candidate => candidate.teamId === item.teamId);
              if (!team) {
                const outcome = await storage.advance(index, job, 'skip');
                const stop = stopForHistoryAdvanceOutcome(outcome);
                if (stop) return { stop };
                continue;
              }

              const outcome = await storage.advance(index, job, 'persist', {
                ...item,
                leagueName: historicalInfo.leagueName || item.leagueName,
                teamName: team.teamName || item.teamName,
              });
              const stop = stopForHistoryAdvanceOutcome(outcome);
              if (stop) return { stop };
            }
            return {};
          }
        );
      } catch {
        await finish(
          'failed',
          'history_chunk_retries_exhausted',
          'ESPN history refresh failed after retries. Run sync again.',
          true
        );
        return;
      }

      if (result.stop) {
        await finish(result.stop.status, result.stop.code, result.stop.message);
        return;
      }
    }

    const completed = await step.do('load completed job', async () => storage.progress(job.id));
    if (!completed || completed.cursor !== plan.length || completed.planned_count !== plan.length) {
      await finish(
        'failed',
        'history_incomplete',
        'ESPN history refresh stopped before all planned seasons were processed.'
      );
      return;
    }
    if (completed.failed_count > 0) {
      await finish(
        'partial',
        'history_partial',
        'ESPN history refreshed, but some unavailable seasons were skipped.'
      );
      return;
    }
    await finish('succeeded');
  }
}
