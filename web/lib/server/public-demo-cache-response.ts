import type { PublicDemoRefreshFailureSummary } from "@/lib/server/public-demo-answer-cache";

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
  return (
    value !== null &&
    Object.prototype.hasOwnProperty.call(
      PUBLIC_DEMO_REFRESH_FAILURE_MESSAGES,
      value,
    )
  );
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

  let webSearchCount = 0;

  for (const [rawName, entry] of Object.entries(byName)) {
    if (!isPublicWebSearchTraceName(rawName)) {
      continue;
    }

    if (!entry || typeof entry !== "object") {
      webSearchCount += 1;
      continue;
    }

    const entryRecord = entry as Record<string, unknown>;
    const count =
      typeof entryRecord.callCount === "number"
        ? entryRecord.callCount
        : typeof entryRecord.count === "number"
          ? entryRecord.count
          : 1;

    if (Number.isFinite(count) && count > 0) {
      webSearchCount += count;
    }
  }

  if (webSearchCount > 0) {
    return {
      byName: {
        web_search: {
          count: webSearchCount,
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
