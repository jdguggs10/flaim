import {
  evaluatePublicDemoCapabilities,
  type PublicDemoTargetFreshness,
} from "@/lib/server/public-demo-capabilities";
import { NextResponse } from "next/server";

// This GET takes no request input, so Next.js would otherwise prerender it at
// build time and bake in a stale snapshot. Force per-request evaluation; the
// Cache-Control header below still provides cheap CDN-level abuse damping.
export const dynamic = "force-dynamic";

// Emergency-disablement latency bound: with s-maxage=60 plus
// stale-while-revalidate=60, a target disabled in demo_target_state can remain
// visible to clients for at most ~2 minutes.
const CAPABILITIES_CACHE_CONTROL =
  "public, s-maxage=60, stale-while-revalidate=60";

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

export async function GET() {
  try {
    // The shared evaluator owns every live gate; an empty result (including
    // missing Supabase configuration or an empty gate table) means the UI
    // stays in legacy single-platform mode.
    const selectableTargets = await evaluatePublicDemoCapabilities();

    const targets: PublicDemoCapabilityTarget[] = selectableTargets.map(
      (target, index) => ({
        platform: target.platform,
        sport: target.sport,
        presets: [...target.presetIds],
        // Exactly one default overall: the first selectable target in matrix
        // order. espn-baseball is first in the matrix, so it stays the default
        // while it is the only enabled lane.
        default: index === 0,
        freshness: target.freshness,
      }),
    );

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
