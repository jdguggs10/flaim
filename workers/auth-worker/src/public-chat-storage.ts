import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type AcquirePublicChatRunRow = {
  allowed: boolean;
  run_id: string | null;
  rejection_reason: string | null;
  concurrent_count: number;
};

export type AcquirePublicChatRunResult = {
  allowed: boolean;
  runId: string | null;
  rejectionReason: string | null;
  concurrentCount: number;
};

export type CompletePublicChatRunInput = {
  runId: string;
  status: 'completed' | 'error' | 'aborted';
  durationMs: number | null;
  errorCode?: string | null;
};

export type RecordRejectedPublicChatRunInput = {
  visitorKey: string;
  presetId: string;
  model: string;
  status: 'rate_limited' | 'concurrency_rejected';
  errorCode?: string | null;
};

export interface PublicChatStorageEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

export class PublicChatStorage {
  private supabase: SupabaseClient;

  constructor(env: PublicChatStorageEnv) {
    this.supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  static fromEnvironment(env: PublicChatStorageEnv): PublicChatStorage {
    return new PublicChatStorage(env);
  }

  async acquireRun(input: {
    visitorKey: string;
    presetId: string;
    model: string;
    maxConcurrent: number;
  }): Promise<AcquirePublicChatRunResult> {
    const { data, error } = await this.supabase.rpc('acquire_public_chat_run', {
      p_visitor_key: input.visitorKey,
      p_preset_id: input.presetId,
      p_model: input.model,
      p_max_concurrent: input.maxConcurrent,
    });

    if (error) {
      throw new Error(`Failed to acquire public chat run: ${error.message}`);
    }

    const row = (Array.isArray(data) ? data[0] : data) as AcquirePublicChatRunRow | null;
    if (!row) {
      throw new Error('Failed to acquire public chat run: missing response row');
    }

    return {
      allowed: row.allowed,
      runId: row.run_id,
      rejectionReason: row.rejection_reason,
      concurrentCount: row.concurrent_count,
    };
  }

  async completeRun(input: CompletePublicChatRunInput): Promise<void> {
    const { error } = await this.supabase.rpc('complete_public_chat_run', {
      p_run_id: input.runId,
      p_status: input.status,
      p_duration_ms: input.durationMs,
      p_error_code: input.errorCode ?? null,
    });

    if (error) {
      throw new Error(`Failed to complete public chat run: ${error.message}`);
    }
  }

  async recordRejectedRun(input: RecordRejectedPublicChatRunInput): Promise<void> {
    const { error } = await this.supabase
      .from('chat_runs')
      .insert({
        visitor_key: input.visitorKey,
        preset_id: input.presetId,
        model: input.model,
        status: input.status,
        error_code: input.errorCode ?? null,
      });

    if (error) {
      throw new Error(`Failed to record rejected public chat run: ${error.message}`);
    }
  }
}
