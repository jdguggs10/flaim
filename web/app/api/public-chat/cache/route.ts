import {
  getPublicChatPreset,
  type PublicChatDemoSport,
} from "@/lib/public-chat";
import {
  getCachedPublicDemoAnswer,
  getLatestPublicDemoRefreshFailure,
  type PublicDemoRefreshFailureSummary,
} from "@/lib/server/public-demo-answer-cache";
import { NextRequest, NextResponse } from "next/server";

function isPublicChatDemoSport(value: string | null): value is PublicChatDemoSport {
  return value === "football" || value === "baseball";
}

interface PublicDemoToolTraceSummary {
  byName: {
    web_search: {
      count: number;
    };
  };
}

interface PublicDemoRefreshFailure {
  errorCode: string | null;
  errorMessage: string;
}

const PUBLIC_DEMO_REFRESH_FAILURE_MESSAGE =
  "The latest refresh failed before a new answer could be stored.";

const PUBLIC_DEMO_REFRESH_FAILURE_MESSAGES = {
  missing_mcp_grounding:
    "The latest refresh did not successfully use Gerry's league data, so the answer was rejected.",
  empty_answer:
    "The latest refresh returned an empty answer, so nothing new was stored.",
  provider_failed: "The latest refresh failed while talking to the AI provider.",
  cache_write_failed:
    "The latest refresh generated an answer but failed while writing it to cache.",
} as const;

const PUBLIC_WEB_SEARCH_TRACE_NAMES = new Set([
  "web_search",
  "web_search_call",
  "google_web_search",
  "search_web",
]);

function isPublicDemoRefreshFailureCode(
  value: string | null,
): value is keyof typeof PUBLIC_DEMO_REFRESH_FAILURE_MESSAGES {
  return Boolean(value && value in PUBLIC_DEMO_REFRESH_FAILURE_MESSAGES);
}

function isPublicWebSearchTraceName(name: string) {
  const normalizedName = name.trim().toLowerCase();
  return PUBLIC_WEB_SEARCH_TRACE_NAMES.has(normalizedName);
}

export function sanitizePublicDemoToolTraceSummary(
  toolTraceSummary: unknown,
): PublicDemoToolTraceSummary | null {
  if (!toolTraceSummary || typeof toolTraceSummary !== "object") {
    return null;
  }

  const traceRecord = toolTraceSummary as Record<string, unknown>;
  const byName =
    traceRecord.byName && typeof traceRecord.byName === "object"
      ? (traceRecord.byName as Record<string, unknown>)
      : null;

  if (!byName) {
    return null;
  }

  for (const rawName of Object.keys(byName)) {
    if (!isPublicWebSearchTraceName(rawName)) {
      continue;
    }

    return {
      byName: {
        web_search: {
          count: 1,
        },
      },
    };
  }

  return null;
}

export function sanitizePublicDemoRefreshFailure(
  failure: PublicDemoRefreshFailureSummary | null | undefined,
): PublicDemoRefreshFailure | null {
  if (!failure) {
    return null;
  }

  if (!isPublicDemoRefreshFailureCode(failure.errorCode)) {
    return {
      errorCode: null,
      errorMessage: PUBLIC_DEMO_REFRESH_FAILURE_MESSAGE,
    };
  }

  return {
    errorCode: failure.errorCode,
    errorMessage: PUBLIC_DEMO_REFRESH_FAILURE_MESSAGES[failure.errorCode],
  };
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
