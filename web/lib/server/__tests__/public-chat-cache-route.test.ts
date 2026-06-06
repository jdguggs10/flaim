import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCachedPublicDemoAnswer: vi.fn(),
  getLatestPublicDemoRefreshFailure: vi.fn(),
}));

vi.mock("@/lib/server/public-demo-answer-cache", () => ({
  getCachedPublicDemoAnswer: mocks.getCachedPublicDemoAnswer,
  getLatestPublicDemoRefreshFailure: mocks.getLatestPublicDemoRefreshFailure,
}));

import { GET } from "../../../app/api/public-chat/cache/route";
import {
  sanitizePublicDemoRefreshFailure,
  sanitizePublicDemoToolTraceSummary,
} from "../public-demo-cache-response";

function publicCacheRequest() {
  return new NextRequest(
    "https://flaim.app/api/public-chat/cache?presetId=wire-watch&sport=baseball",
  );
}

beforeEach(() => {
  mocks.getCachedPublicDemoAnswer.mockReset();
  mocks.getLatestPublicDemoRefreshFailure.mockReset();
});

describe("sanitizePublicDemoToolTraceSummary", () => {
  it("keeps only a safe public web search signal", () => {
    const summary = sanitizePublicDemoToolTraceSummary({
      source: "antigravity_hooks",
      totalCalls: 4,
      byName: {
        "flaim-fantasy.get_roster": { callCount: 1, errorCount: 0 },
        mcp_flaim_fantasy_get_free_agents: { callCount: 1, errorCount: 0 },
        search_web: { callCount: 2, errorCount: 0 },
        read_file: { callCount: 1, errorCount: 0 },
      },
      calls: [
        {
          rawToolName: "Read",
          toolArgs: { file_path: "/home/ggugger/PiCode/flaim-demo/private.log" },
        },
      ],
    });

    expect(summary).toEqual({
      byName: {
        web_search: { count: 2 },
      },
    });
  });

  it("returns null for null or empty summaries", () => {
    expect(sanitizePublicDemoToolTraceSummary(null)).toBeNull();
    expect(sanitizePublicDemoToolTraceSummary(undefined)).toBeNull();
    expect(sanitizePublicDemoToolTraceSummary({})).toBeNull();
    expect(sanitizePublicDemoToolTraceSummary({ byName: null })).toBeNull();
    expect(sanitizePublicDemoToolTraceSummary({ byName: {} })).toBeNull();
  });

  it("aggregates multiple public web search entries without exposing raw names", () => {
    const summary = sanitizePublicDemoToolTraceSummary({
      byName: {
        search_web: { callCount: 2, errorCount: 0 },
        google_web_search: { count: 3, rawProvider: "internal-provider" },
        web_search_call: { callCount: 1 },
        read_file: { callCount: 9 },
      },
    });

    expect(summary).toEqual({
      byName: {
        web_search: { count: 6 },
      },
    });
    expect(JSON.stringify(summary)).not.toContain("google_web_search");
    expect(JSON.stringify(summary)).not.toContain("rawProvider");
    expect(JSON.stringify(summary)).not.toContain("read_file");
  });

  it("skips recognized web search entries with null or non-object values", () => {
    const summary = sanitizePublicDemoToolTraceSummary({
      byName: {
        search_web: null,
        google_web_search: "present",
        web_search_call: false,
        web_search: { callCount: 2 },
      },
    });

    expect(summary).toEqual({
      byName: {
        web_search: { count: 2 },
      },
    });
  });

  it("skips recognized web search entries with missing or non-numeric counts", () => {
    const summary = sanitizePublicDemoToolTraceSummary({
      byName: {
        search_web: {},
        google_web_search: { callCount: "3" },
        web_search_call: { count: Number.NaN },
        web_search: { callCount: 0 },
        " web_search ": { count: Number.POSITIVE_INFINITY },
        " search_web ": { count: -1 },
      },
    });

    expect(summary).toBeNull();
  });

  it("does not preserve substring matches for private search-like tools", () => {
    const summary = sanitizePublicDemoToolTraceSummary({
      byName: {
        private_web_search_wrapper: { callCount: 1 },
        search_web_private: { callCount: 1 },
        read_file: { callCount: 1 },
      },
    });

    expect(summary).toBeNull();
  });
});

describe("sanitizePublicDemoRefreshFailure", () => {
  it("keeps known public error codes with generic public-safe messages", () => {
    expect(
      sanitizePublicDemoRefreshFailure({
        status: "failed",
        errorCode: "provider_failed",
        errorMessage:
          "Gemini failed in /home/ggugger/PiCode/flaim-demo/private.log",
        providerAttempted: "antigravity-sticky",
        providerModel: "private-provider-model",
        startedAt: "2026-06-06T12:00:00.000Z",
        completedAt: "2026-06-06T12:01:00.000Z",
      }),
    ).toEqual({
      errorCode: "provider_failed",
      errorMessage: "The latest refresh failed while talking to the AI provider.",
    });
  });

  it("drops unknown failure codes and raw failure messages", () => {
    expect(
      sanitizePublicDemoRefreshFailure({
        status: "failed",
        errorCode: "raw_internal_code",
        errorMessage: "Raw stack with /home/ggugger/PiCode and provider data",
        providerAttempted: "internal-provider",
        providerModel: "internal-model",
        startedAt: "2026-06-06T12:00:00.000Z",
        completedAt: "2026-06-06T12:01:00.000Z",
      }),
    ).toEqual({
      errorCode: null,
      errorMessage:
        "The latest refresh failed before a new answer could be stored.",
    });
  });
});

describe("GET /api/public-chat/cache", () => {
  it("does not expose raw tool traces or raw source metadata", async () => {
    mocks.getCachedPublicDemoAnswer.mockResolvedValue({
      cacheKey: "public-demo-answer:wire-watch:baseball:v5:v2",
      presetId: "wire-watch",
      sport: "baseball",
      provider: "gemini",
      providerModel: "gemini-2.5-flash",
      contextVersion: "v2",
      promptVersion: "v5",
      answerText: "Add the useful player and drop the risky player.",
      generatedAt: "2026-06-06T12:00:00.000Z",
      expiresAt: "2026-06-06T18:00:00.000Z",
      staleAfter: "2026-06-06T15:00:00.000Z",
      updatedAt: "2026-06-06T12:00:00.000Z",
      status: "ready",
      isExpired: false,
      isStale: false,
      failureSummary: {
        status: "failed",
        errorCode: "provider_failed",
        errorMessage:
          "Gemini failed in /home/ggugger/PiCode/flaim-demo/private.log",
        providerAttempted: "antigravity-sticky",
        providerModel: "private-provider-model",
        startedAt: "2026-06-06T12:00:00.000Z",
        completedAt: "2026-06-06T12:01:00.000Z",
      },
      sourceMeta: {
        antigravityRunLogFile:
          "/home/ggugger/PiCode/flaim-demo/logs/gemini-runs/run.json",
        providerMeta: { source: "source_meta" },
      },
      toolTraceSummary: {
        source: "antigravity_hooks",
        totalCalls: 3,
        byName: {
          "flaim-fantasy.get_roster": { callCount: 1, errorCount: 0 },
          search_web: { callCount: 2, errorCount: 0 },
        },
        calls: [
          {
            stepIdx: 1,
            toolName: "get_roster",
            rawToolName: "mcp__flaim-fantasy__get_roster",
            toolArgs: {
              platform: "espn",
              sport: "baseball",
              league_id: "12345",
              team_id: "67890",
            },
            error: null,
          },
          {
            stepIdx: 2,
            toolName: "search_web",
            rawToolName: "search_web",
            toolArgs: {
              query: "private player search query",
              cwd: "/home/ggugger/PiCode/flaim-demo",
            },
            error: null,
          },
        ],
      },
    });

    const response = await GET(publicCacheRequest());
    const body = await response.json();
    const serializedBody = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.answer.toolTraceSummary).toEqual({
      byName: {
        web_search: { count: 2 },
      },
    });
    expect(body.answer.failure).toEqual({
      errorCode: "provider_failed",
      errorMessage: "The latest refresh failed while talking to the AI provider.",
    });
    expect(serializedBody).not.toContain("calls");
    expect(serializedBody).not.toContain("toolArgs");
    expect(serializedBody).not.toContain("rawToolName");
    expect(serializedBody).not.toContain("league_id");
    expect(serializedBody).not.toContain("team_id");
    expect(serializedBody).not.toContain("12345");
    expect(serializedBody).not.toContain("67890");
    expect(serializedBody).not.toContain("private player search query");
    expect(serializedBody).not.toContain("/home/ggugger/PiCode");
    expect(serializedBody).not.toContain("antigravity_hooks");
    expect(serializedBody).not.toContain("source_meta");
    expect(serializedBody).not.toContain("antigravityRunLogFile");
    expect(serializedBody).not.toContain("antigravity-sticky");
    expect(serializedBody).not.toContain("private-provider-model");
    expect(serializedBody).not.toContain("2026-06-06T12:01:00.000Z");
  });

  it("sanitizes top-level cache miss failure details", async () => {
    mocks.getCachedPublicDemoAnswer.mockResolvedValue(null);
    mocks.getLatestPublicDemoRefreshFailure.mockResolvedValue({
      status: "failed",
      errorCode: "raw_internal_code",
      errorMessage:
        "Raw failure at /home/ggugger/PiCode/flaim-demo/logs/run.json",
      providerAttempted: "antigravity-sticky",
      providerModel: "private-provider-model",
      startedAt: "2026-06-06T12:00:00.000Z",
      completedAt: "2026-06-06T12:01:00.000Z",
    });

    const response = await GET(publicCacheRequest());
    const body = await response.json();
    const serializedBody = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.failure).toEqual({
      errorCode: null,
      errorMessage:
        "The latest refresh failed before a new answer could be stored.",
    });
    expect(serializedBody).not.toContain("raw_internal_code");
    expect(serializedBody).not.toContain("Raw failure");
    expect(serializedBody).not.toContain("/home/ggugger/PiCode");
    expect(serializedBody).not.toContain("antigravity-sticky");
    expect(serializedBody).not.toContain("private-provider-model");
    expect(serializedBody).not.toContain("2026-06-06T12:01:00.000Z");
  });
});
