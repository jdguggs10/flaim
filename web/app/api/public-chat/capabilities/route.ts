import {
  PUBLIC_CHAT_TARGET_MATRIX,
  PUBLIC_DEMO_TARGET_CONTEXT_VERSION,
  PUBLIC_DEMO_TARGET_PROMPT_VERSION,
  type PublicChatTarget,
} from "@/lib/public-chat";
import { buildPublicDemoTargetAnswerCacheKey } from "@/lib/server/public-demo-answer-cache";
import {
  getSupabaseConfig,
  hasSupabaseConfig,
} from "@/lib/server/public-chat-cache";
import { NextResponse } from "next/server";

// This GET takes no request input, so Next.js would otherwise prerender it at
// build time and bake in a stale snapshot. Force per-request evaluation; the
// Cache-Control header below still provides cheap CDN-level abuse damping.
export const dynamic = "force-dynamic";

const CAPABILITIES_CACHE_CONTROL =
  "public, s-maxage=60, stale-while-revalidate=300";

type PublicDemoTargetFreshness = "fresh" | "stale" | "degraded";

/**
 * Hand-built, allowlisted response shape. This endpoint is publicly reachable,
 * so nothing from the database rows is ever spread or echoed into the
 * response — only these fixed keys, with platform/sport/presets sourced from
 * the static PUBLIC_CHAT_TARGET_MATRIX, never from row data.
 */
interface PublicDemoCapabilityTarget {
  platform: string;
  sport: string;
  presets: string[];
  default: boolean;
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
        (candidate.status === "ready" || candidate.status === "degraded"),
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

export async function GET() {
  // Without Supabase configuration there is nothing to report; the UI treats
  // an empty target list as legacy single-platform mode.
  if (!hasSupabaseConfig()) {
    return NextResponse.json(
      { targets: [] },
      { headers: { "Cache-Control": CAPABILITIES_CACHE_CONTROL } },
    );
  }

  try {
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
    if (stateRows.length === 0) {
      return NextResponse.json(
        { targets: [] },
        { headers: { "Cache-Control": CAPABILITIES_CACHE_CONTROL } },
      );
    }

    // One query for every v8/v3 row across all targets, grouped in code.
    // Minimal column projection on purpose: nothing else from the cache rows
    // is needed, so nothing else can leak.
    const cacheRows = await fetchPostgrestRows("demo_answer_cache", {
      select: [
        "cache_key",
        "preset_id",
        "platform",
        "sport",
        "status",
        "stale_after",
        "expires_at",
      ].join(","),
      prompt_version: `eq.${PUBLIC_DEMO_TARGET_PROMPT_VERSION}`,
      context_version: `eq.${PUBLIC_DEMO_TARGET_CONTEXT_VERSION}`,
    });

    const targets: PublicDemoCapabilityTarget[] = [];
    for (const target of PUBLIC_CHAT_TARGET_MATRIX) {
      if (!isTargetEnabled(stateRows, target)) {
        continue;
      }

      const freshness = evaluateTarget(cacheRows, target);
      if (freshness === null) {
        continue;
      }

      targets.push({
        platform: target.platform,
        sport: target.sport,
        presets: [...target.presetIds],
        // Exactly one default overall: the first selectable target in matrix
        // order. espn-baseball is first in the matrix, so it stays the default
        // while it is the only enabled lane.
        default: targets.length === 0,
        freshness,
      });
    }

    return NextResponse.json(
      { targets },
      { headers: { "Cache-Control": CAPABILITIES_CACHE_CONTROL } },
    );
  } catch (error) {
    console.error("Failed to load public demo capabilities:", error);
    return NextResponse.json(
      { error: "Unable to load the public demo capabilities right now." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
