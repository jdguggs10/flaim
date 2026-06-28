/**
 * Usage analytics storage (FLA-156)
 *
 * Append-only writes of MCP tool-call events into Supabase `mcp_tool_events`.
 * Events arrive at the auth-worker via POST /internal/usage-event from the
 * fantasy-mcp gateway, which has already verified the caller. This module only
 * performs the insert; it does not validate identity.
 *
 * Mirrors the shape of OAuthStorage (private supabase client, constructor via
 * createClient, static fromEnvironment factory) without overloading it.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface UsageStorageEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
}

/**
 * Raw usage event payload.
 *
 * Mirrors the `mcp_tool_events` table columns (migration 026). `ts` is omitted
 * intentionally so the DB default (now()) populates it. `correlation_id` is
 * accepted on the wire for log joining but is NOT a column on the table, so it
 * is never inserted.
 */
export interface UsageEvent {
  env: string;
  user_id: string;
  auth_type: string;
  client_name?: string | null;
  tool_name: string;
  platform?: string | null;
  sport?: string | null;
  status: string;
  error_code?: string | null;
  latency_ms?: number | null;
  league_hash?: string | null;
  // Accepted but not stored (no column on mcp_tool_events).
  correlation_id?: string | null;
}

export class UsageStorage {
  private supabase: SupabaseClient;

  constructor(supabaseUrl: string, supabaseKey: string) {
    this.supabase = createClient(supabaseUrl, supabaseKey);
  }

  /**
   * Append a single tool-call event to mcp_tool_events.
   * `ts` is left to the DB default. `correlation_id` is intentionally dropped
   * because the table has no such column.
   */
  async insertEvent(e: UsageEvent): Promise<{ error: unknown }> {
    const { error } = await this.supabase.from('mcp_tool_events').insert({
      env: e.env,
      user_id: e.user_id,
      auth_type: e.auth_type,
      client_name: e.client_name ?? null,
      tool_name: e.tool_name,
      platform: e.platform ?? null,
      sport: e.sport ?? null,
      status: e.status,
      error_code: e.error_code ?? null,
      latency_ms: e.latency_ms ?? null,
      league_hash: e.league_hash ?? null,
    });

    if (error) {
      console.error('[usage-storage] Failed to insert tool event:', error);
    }

    return { error };
  }

  /**
   * Create instance from environment variables
   */
  static fromEnvironment(env: UsageStorageEnv): UsageStorage {
    return new UsageStorage(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
  }
}
