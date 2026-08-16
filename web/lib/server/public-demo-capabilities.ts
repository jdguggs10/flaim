import {
  PUBLIC_CHAT_TARGET_MATRIX,
  PUBLIC_DEMO_TARGET_CONTEXT_VERSION,
  PUBLIC_DEMO_TARGET_PROMPT_VERSION,
  type PublicChatDemoPlatform,
  type PublicChatDemoSport,
  type PublicChatTarget,
  type PublicChatTargetPresetId,
} from "@/lib/public-chat";
import { buildPublicDemoTargetAnswerCacheKey } from "./public-demo-answer-cache";
import { getSupabaseConfig, hasSupabaseConfig } from "./public-chat-cache";

export type PublicDemoTargetFreshness = "fresh" | "stale" | "degraded";

/**
 * A platform/sport target that passed every live gate: present in the static
 * matrix, explicitly public-enabled at the expected v8/v3 versions, and fully
 * warmed (every one of its presets has a usable cache row). This is the single
 * source of truth for what the public demo advertises AND serves — the
 * capabilities endpoint reports exactly this set, and the answer route
 * refuses platform-bearing reads outside it.
 */
export interface PublicDemoSelectableTarget {
  platform: PublicChatDemoPlatform;
  sport: PublicChatDemoSport;
  presetIds: readonly PublicChatTargetPresetId[];
  freshness: PublicDemoTargetFreshness;
}

/** Untrusted PostgREST rows; every field is validated before use. */
type UnknownRow = Record<string, unknown>;

async function fetchPostgrestRows(
  table: string,
  params: Record<string, string>,
): Promise<UnknownRow[]> {
  const { supabaseUrl, supabaseServiceKey } = getSupabaseConfig();
  const url = new URL(`${supabaseUrl}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(params)) {
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
    throw new Error(`Failed to read ${table} (${response.status})`);
  }

  const rows: unknown = await response.json();
  if (!Array.isArray(rows)) {
    throw new Error(`Unexpected ${table} response shape`);
  }

  return rows.filter(
    (row): row is UnknownRow => Boolean(row) && typeof row === "object",
  );
}

/**
 * A target-state row makes its target eligible only when it is explicitly
 * public-enabled AND its expected versions exactly match the deployed
 * constants. Any disagreement (older or newer) fails closed: the runner and
 * the web app must agree on v8/v3 before a target becomes selectable.
 */
function isTargetEnabled(
  stateRows: UnknownRow[],
  target: PublicChatTarget,
): boolean {
  return stateRows.some(
    (row) =>
      row.platform === target.platform &&
      row.sport === target.sport &&
      row.public_enabled === true &&
      row.expected_prompt_version === PUBLIC_DEMO_TARGET_PROMPT_VERSION &&
      row.expected_context_version === PUBLIC_DEMO_TARGET_CONTEXT_VERSION,
  );
}

/**
 * The answer route refuses to serve a row whose answer_text is blank, so the
 * gate must not advertise a target on the strength of such a row.
 */
function hasRenderableAnswer(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** A timestamp column past `now`, missing, or unparseable counts as passed. */
function timestampPassed(value: unknown, now: number): boolean {
  if (typeof value !== "string") {
    return true;
  }
  const time = new Date(value).getTime();
  return !Number.isFinite(time) || time <= now;
}

/**
 * Evaluates one matrix target against the v8/v3 cache rows. Returns the
 * freshness when every one of the target's presets has a usable row, or null
 * when the target is not selectable.
 */
function evaluateTarget(
  cacheRows: UnknownRow[],
  target: PublicChatTarget,
): PublicDemoTargetFreshness | null {
  const now = Date.now();
  let anyStale = false;
  let anyDegraded = false;

  for (const presetId of target.presetIds) {
    // Defense in depth: the row must match on platform/sport/preset columns
    // AND carry the exact six-segment cache key those columns imply.
    const expectedCacheKey = buildPublicDemoTargetAnswerCacheKey(
      presetId,
      target.platform,
      target.sport,
    );
    const row = cacheRows.find(
      (candidate) =>
        candidate.cache_key === expectedCacheKey &&
        candidate.preset_id === presetId &&
        candidate.platform === target.platform &&
        candidate.sport === target.sport &&
        (candidate.status === "ready" || candidate.status === "degraded") &&
        hasRenderableAnswer(candidate.answer_text),
    );

    if (!row) {
      return null;
    }

    if (row.status === "degraded") {
      anyDegraded = true;
    }
    // Rows past stale_after (or expires_at, or with unparseable timestamps)
    // count as stale; the target stays selectable but is reported as such.
    if (
      timestampPassed(row.stale_after, now) ||
      timestampPassed(row.expires_at, now)
    ) {
      anyStale = true;
    }
  }

  if (anyDegraded) {
    return "degraded";
  }
  return anyStale ? "stale" : "fresh";
}

/**
 * Evaluates every matrix target against the live gate table and v8/v3 cache
 * rows, returning the selectable targets in matrix order with their
 * freshness. Returns an empty list when Supabase is not configured or the
 * gate table is empty — callers treat that as legacy single-platform mode.
 * PostgREST failures throw; callers decide how to fail.
 *
 * Results are memoized in-process for 60 seconds: both public routes consult
 * this on every request, and the answer route would otherwise pay two
 * uncached reads per platform-bearing request. Combined with the
 * capabilities route's edge cache, an emergency-disabled target can remain
 * visible for at most ~2 minutes. Errors are never memoized.
 */
const CAPABILITIES_MEMO_TTL_MS = 60_000;

let capabilitiesMemo: {
  at: number;
  targets: PublicDemoSelectableTarget[];
} | null = null;

/** Test hook: clears the in-process memo between test cases. */
export function resetPublicDemoCapabilitiesMemo(): void {
  capabilitiesMemo = null;
}

export async function evaluatePublicDemoCapabilities(): Promise<
  PublicDemoSelectableTarget[]
> {
  const now = Date.now();
  if (capabilitiesMemo && now - capabilitiesMemo.at < CAPABILITIES_MEMO_TTL_MS) {
    return capabilitiesMemo.targets;
  }

  if (!hasSupabaseConfig()) {
    return [];
  }

  const stateRows = await fetchPostgrestRows("demo_target_state", {
    select: [
      "platform",
      "sport",
      "public_enabled",
      "expected_prompt_version",
      "expected_context_version",
    ].join(","),
  });

  // An empty gate table means the platform-aware demo is not rolled out yet.
  // Memoized too: this is the dormant steady state, and the answer route has
  // no edge cache shielding it from repeated probes.
  if (stateRows.length === 0) {
    capabilitiesMemo = { at: now, targets: [] };
    return [];
  }

  // One query for every v8/v3 row across all targets, grouped in code.
  // Minimal column projection on purpose: answer_text is read only to prove
  // the row is renderable and never leaves this module; nothing else from
  // the cache rows is needed, so nothing else can leak.
  const cacheRows = await fetchPostgrestRows("demo_answer_cache", {
    select: [
      "cache_key",
      "preset_id",
      "platform",
      "sport",
      "status",
      "stale_after",
      "expires_at",
      "answer_text",
    ].join(","),
    prompt_version: `eq.${PUBLIC_DEMO_TARGET_PROMPT_VERSION}`,
    context_version: `eq.${PUBLIC_DEMO_TARGET_CONTEXT_VERSION}`,
  });

  const selectableTargets: PublicDemoSelectableTarget[] = [];
  for (const target of PUBLIC_CHAT_TARGET_MATRIX) {
    if (!isTargetEnabled(stateRows, target)) {
      continue;
    }

    const freshness = evaluateTarget(cacheRows, target);
    if (freshness === null) {
      continue;
    }

    selectableTargets.push({
      platform: target.platform,
      sport: target.sport,
      presetIds: target.presetIds,
      freshness,
    });
  }

  capabilitiesMemo = { at: now, targets: selectableTargets };
  return selectableTargets;
}
