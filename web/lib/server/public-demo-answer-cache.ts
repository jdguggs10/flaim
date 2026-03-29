import {
  PUBLIC_DEMO_CONTEXT_VERSION,
  PUBLIC_DEMO_PROMPT_VERSION,
  type PublicChatDemoSport,
} from "@/lib/public-chat";
import { getSupabaseConfig, hasSupabaseConfig } from "./public-chat-cache";

interface PublicDemoAnswerCacheRow {
  cache_key: string;
  preset_id: string;
  sport: PublicChatDemoSport;
  provider: string;
  provider_model: string;
  context_version: string;
  prompt_version: string;
  answer_text: string;
  generated_at: string;
  expires_at: string;
  stale_after: string;
  status: string;
  source_meta?: unknown;
  tool_trace_summary?: unknown;
  updated_at: string;
}

export interface PublicDemoRefreshFailureSummary {
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  providerAttempted: string | null;
  providerModel: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface PublicDemoCachedAnswer {
  cacheKey: string;
  presetId: string;
  sport: PublicChatDemoSport;
  provider: string;
  providerModel: string;
  contextVersion: string;
  promptVersion: string;
  answerText: string;
  generatedAt: string;
  expiresAt: string;
  staleAfter: string;
  updatedAt: string;
  status: string;
  isExpired: boolean;
  isStale: boolean;
  failureSummary: PublicDemoRefreshFailureSummary | null;
  sourceMeta: unknown;
  toolTraceSummary: unknown;
}

function toTime(value: string) {
  return new Date(value).getTime();
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function extractFailureSummary(
  sourceMeta: unknown,
): PublicDemoRefreshFailureSummary | null {
  if (!sourceMeta || typeof sourceMeta !== "object") {
    return null;
  }

  const lastFailure =
    "lastFailure" in sourceMeta &&
    sourceMeta.lastFailure &&
    typeof sourceMeta.lastFailure === "object"
      ? (sourceMeta.lastFailure as Record<string, unknown>)
      : null;

  if (!lastFailure) {
    return null;
  }

  return {
    status:
      typeof lastFailure.status === "string" ? lastFailure.status : "failed",
    errorCode:
      typeof lastFailure.errorCode === "string" ? lastFailure.errorCode : null,
    errorMessage:
      typeof lastFailure.errorMessage === "string"
        ? lastFailure.errorMessage
        : null,
    providerAttempted:
      typeof lastFailure.providerAttempted === "string"
        ? lastFailure.providerAttempted
        : null,
    providerModel:
      typeof lastFailure.providerModel === "string"
        ? lastFailure.providerModel
        : null,
    startedAt:
      typeof lastFailure.startedAt === "string" ? lastFailure.startedAt : null,
    completedAt:
      typeof lastFailure.completedAt === "string"
        ? lastFailure.completedAt
        : null,
  };
}

export function buildPublicDemoAnswerCacheKey(
  presetId: string,
  sport: PublicChatDemoSport,
  promptVersion = PUBLIC_DEMO_PROMPT_VERSION,
  contextVersion = PUBLIC_DEMO_CONTEXT_VERSION,
) {
  return [
    "public-demo-answer",
    presetId,
    sport,
    promptVersion,
    contextVersion,
  ].join(":");
}

function mapRowToCachedAnswer(
  row: PublicDemoAnswerCacheRow,
): PublicDemoCachedAnswer | null {
  if (!isNonEmptyString(row.answer_text)) {
    return null;
  }

  const expiresAt = toTime(row.expires_at);
  const staleAfter = toTime(row.stale_after);
  const now = Date.now();

  return {
    cacheKey: row.cache_key,
    presetId: row.preset_id,
    sport: row.sport,
    provider: row.provider,
    providerModel: row.provider_model,
    contextVersion: row.context_version,
    promptVersion: row.prompt_version,
    answerText: row.answer_text,
    generatedAt: row.generated_at,
    expiresAt: row.expires_at,
    staleAfter: row.stale_after,
    updatedAt: row.updated_at,
    status: row.status,
    isExpired: Number.isFinite(expiresAt) ? expiresAt <= now : false,
    isStale: Number.isFinite(staleAfter) ? staleAfter <= now : false,
    failureSummary: extractFailureSummary(row.source_meta),
    sourceMeta: row.source_meta ?? null,
    toolTraceSummary: row.tool_trace_summary ?? null,
  };
}

interface PublicDemoRefreshRunRow {
  status: string;
  error_code?: string | null;
  error_message?: string | null;
  provider_attempted?: string | null;
  provider_model?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

function mapRefreshRunToFailureSummary(
  row: PublicDemoRefreshRunRow | null | undefined,
): PublicDemoRefreshFailureSummary | null {
  if (!row || row.status !== "failed") {
    return null;
  }

  return {
    status: row.status,
    errorCode: row.error_code ?? null,
    errorMessage: row.error_message ?? null,
    providerAttempted: row.provider_attempted ?? null,
    providerModel: row.provider_model ?? null,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
  };
}

export async function getCachedPublicDemoAnswer(input: {
  presetId: string;
  sport: PublicChatDemoSport;
}): Promise<PublicDemoCachedAnswer | null> {
  if (!hasSupabaseConfig()) {
    return null;
  }

  const { supabaseUrl, supabaseServiceKey } = getSupabaseConfig();
  const cacheKey = buildPublicDemoAnswerCacheKey(input.presetId, input.sport);
  const url = new URL(`${supabaseUrl}/rest/v1/public_demo_answer_cache`);
  url.searchParams.set("cache_key", `eq.${cacheKey}`);
  url.searchParams.set(
    "select",
    [
      "cache_key",
      "preset_id",
      "sport",
      "provider",
      "provider_model",
      "context_version",
      "prompt_version",
      "answer_text",
      "generated_at",
      "expires_at",
      "stale_after",
      "status",
      "source_meta",
      "tool_trace_summary",
      "updated_at",
    ].join(","),
  );
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Failed to read public demo answer cache (${response.status})`);
  }

  const rows = (await response.json()) as PublicDemoAnswerCacheRow[];
  const row = rows[0];
  if (!row) {
    return null;
  }

  if (row.status === "disabled") {
    return null;
  }

  return mapRowToCachedAnswer(row);
}

export async function getLatestPublicDemoRefreshFailure(input: {
  presetId: string;
  sport: PublicChatDemoSport;
}): Promise<PublicDemoRefreshFailureSummary | null> {
  if (!hasSupabaseConfig()) {
    return null;
  }

  const { supabaseUrl, supabaseServiceKey } = getSupabaseConfig();
  const url = new URL(`${supabaseUrl}/rest/v1/public_demo_refresh_runs`);
  url.searchParams.set("preset_id", `eq.${input.presetId}`);
  url.searchParams.set("sport", `eq.${input.sport}`);
  url.searchParams.set(
    "select",
    [
      "status",
      "error_code",
      "error_message",
      "provider_attempted",
      "provider_model",
      "started_at",
      "completed_at",
    ].join(","),
  );
  url.searchParams.set("order", "created_at.desc");
  url.searchParams.set("limit", "1");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      apikey: supabaseServiceKey,
      Authorization: `Bearer ${supabaseServiceKey}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(
      `Failed to read public demo refresh runs (${response.status})`,
    );
  }

  const rows = (await response.json()) as PublicDemoRefreshRunRow[];
  return mapRefreshRunToFailureSummary(rows[0]);
}
