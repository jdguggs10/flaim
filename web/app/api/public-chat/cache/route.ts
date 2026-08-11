import {
  getPublicChatPreset,
  getPublicChatTarget,
  isPublicChatDemoPlatform,
  type PublicChatDemoPlatform,
  type PublicChatDemoSport,
} from "@/lib/public-chat";
import {
  getCachedPublicDemoAnswer,
  getLatestPublicDemoRefreshFailure,
} from "@/lib/server/public-demo-answer-cache";
import { evaluatePublicDemoCapabilities } from "@/lib/server/public-demo-capabilities";
import {
  sanitizePublicDemoRefreshFailure,
  sanitizePublicDemoToolTraceSummary,
} from "@/lib/server/public-demo-cache-response";
import { NextRequest, NextResponse } from "next/server";

function isPublicChatDemoSport(value: string | null): value is PublicChatDemoSport {
  return value === "football" || value === "baseball";
}

export async function GET(request: NextRequest) {
  const presetId = request.nextUrl.searchParams.get("presetId");
  const sport = request.nextUrl.searchParams.get("sport");

  if (!presetId) {
    return NextResponse.json(
      { error: "A preset prompt is required" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (!isPublicChatDemoSport(sport)) {
    return NextResponse.json(
      { error: "Sport must be football or baseball" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const preset = getPublicChatPreset(presetId);
  if (!preset) {
    return NextResponse.json(
      { error: "Unknown public chat preset" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  // Optional platform param for the platform-aware demo targets. When absent,
  // the reader keeps the exact legacy single-platform behavior — the
  // one-release compatibility default while clients migrate to sending it.
  const platformParam = request.nextUrl.searchParams.get("platform");
  let platform: PublicChatDemoPlatform | undefined;
  if (platformParam !== null) {
    if (!isPublicChatDemoPlatform(platformParam)) {
      return NextResponse.json(
        { error: "Unsupported platform for the public demo" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    const target = getPublicChatTarget(platformParam, sport);
    if (!target) {
      // Same generic body as the unknown-platform rejection above.
      return NextResponse.json(
        { error: "Unsupported platform for the public demo" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    // Platform-aware requests serve only the target's eight cross-target
    // presets; the legacy no-platform surface keeps its full preset list.
    if (!(target.presetIds as readonly string[]).includes(preset.id)) {
      return NextResponse.json(
        { error: "Unknown public chat preset" },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    platform = platformParam;
  }

  try {
    if (platform !== undefined) {
      // Live gate: platform-bearing reads are only served for targets the
      // capabilities endpoint would advertise. Disabled, version-mismatched,
      // and partially warmed targets get the exact same generic rejection as
      // unknown combos (and env-unset yields an empty selectable set), so a
      // prober cannot distinguish rollout state from nonexistence. The legacy
      // no-platform path never runs this evaluation.
      const selectableTargets = await evaluatePublicDemoCapabilities();
      const isSelectable = selectableTargets.some(
        (candidate) =>
          candidate.platform === platform && candidate.sport === sport,
      );
      if (!isSelectable) {
        return NextResponse.json(
          { error: "Unsupported platform for the public demo" },
          { status: 400, headers: { "Cache-Control": "no-store" } },
        );
      }
    }

    const cachedAnswer = await getCachedPublicDemoAnswer({
      presetId: preset.id,
      sport,
      platform,
    });
    const latestFailure =
      !cachedAnswer || cachedAnswer.status !== "ready"
        ? await getLatestPublicDemoRefreshFailure({
            presetId: preset.id,
            sport,
            platform,
          }).catch((error) => {
            console.error(
              "Failed to load latest public demo refresh failure:",
              error,
            );
            return null;
          })
        : null;

    return NextResponse.json(
      cachedAnswer
        ? {
            hit: true,
            presetId: preset.id,
            sport,
            answer: {
              text: cachedAnswer.answerText,
              generatedAt: cachedAnswer.generatedAt,
              expiresAt: cachedAnswer.expiresAt,
              staleAfter: cachedAnswer.staleAfter,
              provider: cachedAnswer.provider,
              providerModel: cachedAnswer.providerModel,
              isExpired: cachedAnswer.isExpired,
              isStale: cachedAnswer.isStale,
              status: cachedAnswer.status,
              failure: sanitizePublicDemoRefreshFailure(
                cachedAnswer.failureSummary ?? latestFailure,
              ),
              toolTraceSummary: sanitizePublicDemoToolTraceSummary(
                cachedAnswer.toolTraceSummary,
              ),
            },
          }
        : {
            hit: false,
            presetId: preset.id,
            sport,
            answer: null,
            failure: sanitizePublicDemoRefreshFailure(latestFailure),
          },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("Failed to load public demo cached answer:", error);
    return NextResponse.json(
      { error: "Unable to load the public demo cache right now." },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
