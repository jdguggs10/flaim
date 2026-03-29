import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

import {
  PUBLIC_CHAT_PRESETS,
  PUBLIC_DEMO_CONTEXT_VERSION,
  PUBLIC_DEMO_PROMPT_VERSION,
} from "../lib/public-chat.ts";

export const DEFAULT_SCHEDULER_PROVIDER = "gemini";
export const DEFAULT_SCHEDULER_INTERVAL_MINUTES = 15;
export const DEFAULT_SCHEDULER_EXPIRES_MINUTES = 240;
export const DEFAULT_SCHEDULER_STALE_MINUTES = 720;
export const DEFAULT_GEMINI_BIN =
  process.env.PUBLIC_DEMO_GEMINI_BIN?.trim() || "gemini";

export function getProjectRoot(scriptUrl = import.meta.url) {
  const scriptDir = path.dirname(fileURLToPath(scriptUrl));
  return path.resolve(scriptDir, "..");
}

export function loadProjectEnv(projectRoot) {
  const envFiles = [
    path.join(projectRoot, ".env.local"),
    path.join(projectRoot, ".env"),
  ];

  for (const filePath of envFiles) {
    try {
      process.loadEnvFile(filePath);
    } catch {
      // Ignore missing env files so remote runners can use process env directly.
    }
  }
}

export function parsePositiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }

  return parsed;
}

export function isPublicChatDemoSport(value) {
  return value === "baseball" || value === "football";
}

export function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim().replace(/\/+$/, "");
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY?.trim();

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error("SUPABASE_URL or SUPABASE_SERVICE_KEY is not configured");
  }

  return { supabaseUrl, supabaseServiceKey };
}

export async function supabaseSelect(tableName, searchParams) {
  const { supabaseUrl, supabaseServiceKey } = getSupabaseConfig();
  const url = new URL(`${supabaseUrl}/rest/v1/${tableName}`);

  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value);
  }

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
    const body = await response.text().catch(() => "");
    throw new Error(`Failed to read ${tableName} (${response.status}): ${body}`);
  }

  return response.json();
}

export function buildPublicDemoAnswerCacheKey(presetId, sport) {
  return [
    "public-demo-answer",
    presetId,
    sport,
    PUBLIC_DEMO_PROMPT_VERSION,
    PUBLIC_DEMO_CONTEXT_VERSION,
  ].join(":");
}

export function getPublicDemoPresetIds() {
  return PUBLIC_CHAT_PRESETS.map((preset) => preset.id);
}

export async function fetchCurrentPublicDemoAnswerRows(sport) {
  const rows = await supabaseSelect("public_demo_answer_cache", {
    sport: `eq.${sport}`,
    prompt_version: `eq.${PUBLIC_DEMO_PROMPT_VERSION}`,
    context_version: `eq.${PUBLIC_DEMO_CONTEXT_VERSION}`,
    select: [
      "cache_key",
      "preset_id",
      "sport",
      "provider",
      "provider_model",
      "answer_text",
      "generated_at",
      "expires_at",
      "stale_after",
      "status",
      "source_meta",
      "tool_trace_summary",
      "updated_at",
    ].join(","),
    order: "generated_at.asc.nullslast",
  });

  return Array.isArray(rows) ? rows : [];
}

export async function fetchRecentPublicDemoRefreshRuns(sport, limit = 200) {
  const rows = await supabaseSelect("public_demo_refresh_runs", {
    sport: `eq.${sport}`,
    select: [
      "preset_id",
      "status",
      "error_code",
      "error_message",
      "provider_attempted",
      "provider_model",
      "started_at",
      "completed_at",
      "created_at",
    ].join(","),
    order: "created_at.desc",
    limit: String(limit),
  });

  return Array.isArray(rows) ? rows : [];
}

export function toTime(value) {
  if (typeof value !== "string") {
    return Number.NaN;
  }

  return new Date(value).getTime();
}

export function formatRelativeAge(timestamp) {
  const time = toTime(timestamp);
  if (!Number.isFinite(time)) {
    return "n/a";
  }

  const deltaMinutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (deltaMinutes < 1) {
    return "just now";
  }

  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }

  const hours = Math.floor(deltaMinutes / 60);
  const minutes = deltaMinutes % 60;
  if (hours < 24) {
    return minutes === 0 ? `${hours}h ago` : `${hours}h ${minutes}m ago`;
  }

  const days = Math.floor(hours / 24);
  const remainderHours = hours % 24;
  return remainderHours === 0
    ? `${days}d ago`
    : `${days}d ${remainderHours}h ago`;
}

export function truncateText(text, maxLength = 96) {
  if (typeof text !== "string" || text.length <= maxLength) {
    return text ?? "";
  }

  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}
