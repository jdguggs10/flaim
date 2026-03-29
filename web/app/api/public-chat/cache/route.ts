import {
  getPublicChatPreset,
  type PublicChatDemoSport,
} from "@/lib/public-chat";
import {
  getCachedPublicDemoAnswer,
  getLatestPublicDemoRefreshFailure,
} from "@/lib/server/public-demo-answer-cache";
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

  try {
    const cachedAnswer = await getCachedPublicDemoAnswer({
      presetId: preset.id,
      sport,
    });
    const latestFailure =
      !cachedAnswer || cachedAnswer.status !== "ready"
        ? await getLatestPublicDemoRefreshFailure({
            presetId: preset.id,
            sport,
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
              failure: cachedAnswer.failureSummary ?? latestFailure,
              toolTraceSummary: cachedAnswer.toolTraceSummary,
            },
          }
        : {
            hit: false,
            presetId: preset.id,
            sport,
            answer: null,
            failure: latestFailure,
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
