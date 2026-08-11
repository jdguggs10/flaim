import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCachedPublicDemoAnswer: vi.fn(),
  getLatestPublicDemoRefreshFailure: vi.fn(),
  evaluatePublicDemoCapabilities: vi.fn(),
}));

vi.mock("@/lib/server/public-demo-answer-cache", () => ({
  getCachedPublicDemoAnswer: mocks.getCachedPublicDemoAnswer,
  getLatestPublicDemoRefreshFailure: mocks.getLatestPublicDemoRefreshFailure,
}));

vi.mock("@/lib/server/public-demo-capabilities", () => ({
  evaluatePublicDemoCapabilities: mocks.evaluatePublicDemoCapabilities,
}));

import { GET } from "../../../app/api/public-chat/cache/route";
import {
  sanitizePublicDemoRefreshFailure,
  sanitizePublicDemoToolTraceSummary,
} from "../public-demo-cache-response";

function publicCacheRequest(query = "presetId=wire-watch&sport=baseball") {
  return new NextRequest(`https://flaim.app/api/public-chat/cache?${query}`);
}

const TARGET_PRESET_IDS = [
  "hot-hands",
  "league-format",
  "this-matchup",
  "my-moves",
  "best-team",
  "wire-watch",
  "league-moves",
  "roster-hole",
] as const;

function selectableTarget(
  platform: string,
  sport: string,
  freshness = "fresh",
) {
  return { platform, sport, presetIds: TARGET_PRESET_IDS, freshness };
}

beforeEach(() => {
  mocks.getCachedPublicDemoAnswer.mockReset();
  mocks.getLatestPublicDemoRefreshFailure.mockReset();
  mocks.evaluatePublicDemoCapabilities.mockReset();
  // Platform-bearing tests override this; the empty set is the fail-closed
  // default (no target is live).
  mocks.evaluatePublicDemoCapabilities.mockResolvedValue([]);
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
          "Antigravity failed in /home/ggugger/PiCode/flaim-demo/private.log",
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
      cacheKey: "public-demo-answer:wire-watch:baseball:v7:v2",
      presetId: "wire-watch",
      sport: "baseball",
      provider: "antigravity",
      providerModel: "gemini-2.5-flash",
      contextVersion: "v2",
      promptVersion: "v7",
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
          "Antigravity failed in /home/ggugger/PiCode/flaim-demo/private.log",
        providerAttempted: "antigravity-sticky",
        providerModel: "private-provider-model",
        startedAt: "2026-06-06T12:00:00.000Z",
        completedAt: "2026-06-06T12:01:00.000Z",
      },
      sourceMeta: {
        antigravityRunLogFile:
          "/home/ggugger/PiCode/flaim-demo/logs/antigravity-runs/run.json",
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

  it("keeps the legacy reader behavior when no platform param is sent", async () => {
    mocks.getCachedPublicDemoAnswer.mockResolvedValue(null);
    mocks.getLatestPublicDemoRefreshFailure.mockResolvedValue(null);

    const response = await GET(publicCacheRequest());

    expect(response.status).toBe(200);
    expect(mocks.getCachedPublicDemoAnswer).toHaveBeenCalledTimes(1);
    expect(
      mocks.getCachedPublicDemoAnswer.mock.calls[0][0].platform,
    ).toBeUndefined();
    expect(
      mocks.getLatestPublicDemoRefreshFailure.mock.calls[0][0].platform,
    ).toBeUndefined();
    // The legacy path must never run the live capabilities evaluation.
    expect(mocks.evaluatePublicDemoCapabilities).not.toHaveBeenCalled();
  });

  it("serves legacy presets outside the eight-target set when no platform is sent", async () => {
    mocks.getCachedPublicDemoAnswer.mockResolvedValue(null);
    mocks.getLatestPublicDemoRefreshFailure.mockResolvedValue(null);

    const response = await GET(
      publicCacheRequest("presetId=trade-grades&sport=baseball"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.presetId).toBe("trade-grades");
    expect(mocks.evaluatePublicDemoCapabilities).not.toHaveBeenCalled();
  });

  it("passes a live selectable platform through to the reader and failure lookup", async () => {
    mocks.evaluatePublicDemoCapabilities.mockResolvedValue([
      selectableTarget("espn", "baseball"),
    ]);
    mocks.getCachedPublicDemoAnswer.mockResolvedValue(null);
    mocks.getLatestPublicDemoRefreshFailure.mockResolvedValue(null);

    const response = await GET(
      publicCacheRequest("presetId=wire-watch&sport=baseball&platform=espn"),
    );

    expect(response.status).toBe(200);
    expect(mocks.getCachedPublicDemoAnswer).toHaveBeenCalledWith({
      presetId: "wire-watch",
      sport: "baseball",
      platform: "espn",
    });
    expect(mocks.getLatestPublicDemoRefreshFailure).toHaveBeenCalledWith({
      presetId: "wire-watch",
      sport: "baseball",
      platform: "espn",
    });
  });

  it("rejects an unknown platform value without echoing it", async () => {
    const response = await GET(
      publicCacheRequest("presetId=wire-watch&sport=baseball&platform=vibes"),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Unsupported platform for the public demo" });
    expect(JSON.stringify(body)).not.toContain("vibes");
    expect(mocks.evaluatePublicDemoCapabilities).not.toHaveBeenCalled();
    expect(mocks.getCachedPublicDemoAnswer).not.toHaveBeenCalled();
    expect(mocks.getLatestPublicDemoRefreshFailure).not.toHaveBeenCalled();
  });

  it("rejects a platform/sport combo outside the target matrix", async () => {
    const response = await GET(
      publicCacheRequest("presetId=wire-watch&sport=baseball&platform=sleeper"),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Unsupported platform for the public demo" });
    expect(mocks.evaluatePublicDemoCapabilities).not.toHaveBeenCalled();
    expect(mocks.getCachedPublicDemoAnswer).not.toHaveBeenCalled();
    expect(mocks.getLatestPublicDemoRefreshFailure).not.toHaveBeenCalled();
  });

  it("rejects a platform-bearing request for a preset outside the eight-target set", async () => {
    const response = await GET(
      publicCacheRequest("presetId=trade-grades&sport=baseball&platform=espn"),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Unknown public chat preset" });
    expect(mocks.evaluatePublicDemoCapabilities).not.toHaveBeenCalled();
    expect(mocks.getCachedPublicDemoAnswer).not.toHaveBeenCalled();
  });

  it("rejects a matrix combo that is not live-selectable (disabled or env-unset)", async () => {
    // The evaluator returns an empty selectable set for disabled targets and
    // for unset Supabase env alike; both must be indistinguishable from an
    // unknown combo.
    mocks.evaluatePublicDemoCapabilities.mockResolvedValue([]);

    const response = await GET(
      publicCacheRequest("presetId=wire-watch&sport=baseball&platform=espn"),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Unsupported platform for the public demo" });
    expect(mocks.getCachedPublicDemoAnswer).not.toHaveBeenCalled();
    expect(mocks.getLatestPublicDemoRefreshFailure).not.toHaveBeenCalled();
  });

  it("rejects a matrix combo that is enabled but not fully warmed", async () => {
    // Other targets are live, but the requested one is missing from the
    // selectable set (e.g. only seven of eight presets have rows).
    mocks.evaluatePublicDemoCapabilities.mockResolvedValue([
      selectableTarget("espn", "football"),
      selectableTarget("sleeper", "football"),
    ]);

    const response = await GET(
      publicCacheRequest("presetId=wire-watch&sport=baseball&platform=espn"),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Unsupported platform for the public demo" });
    expect(mocks.getCachedPublicDemoAnswer).not.toHaveBeenCalled();
  });

  it("rejects a matrix combo whose target-state versions disagree with the deploy", async () => {
    // A version-mismatched target never enters the selectable set, so the
    // rejection is identical to every other non-live case.
    mocks.evaluatePublicDemoCapabilities.mockResolvedValue([
      selectableTarget("yahoo", "baseball"),
    ]);

    const response = await GET(
      publicCacheRequest("presetId=wire-watch&sport=baseball&platform=espn"),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body).toEqual({ error: "Unsupported platform for the public demo" });
    expect(mocks.getCachedPublicDemoAnswer).not.toHaveBeenCalled();
  });

  it("serializes exactly the allowlisted key sets on a cache hit", async () => {
    mocks.getCachedPublicDemoAnswer.mockResolvedValue({
      cacheKey: "public-demo-answer:wire-watch:baseball:v7:v2",
      presetId: "wire-watch",
      sport: "baseball",
      provider: "provider-a",
      providerModel: "model-a",
      contextVersion: "v2",
      promptVersion: "v7",
      answerText: "A cached answer.",
      generatedAt: "2026-06-06T12:00:00.000Z",
      expiresAt: "2026-06-06T18:00:00.000Z",
      staleAfter: "2026-06-06T15:00:00.000Z",
      updatedAt: "2026-06-06T12:00:00.000Z",
      status: "ready",
      isExpired: false,
      isStale: false,
      failureSummary: null,
      sourceMeta: null,
      toolTraceSummary: null,
    });

    const response = await GET(publicCacheRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual([
      "answer",
      "hit",
      "presetId",
      "sport",
    ]);
    expect(Object.keys(body.answer).sort()).toEqual([
      "expiresAt",
      "failure",
      "generatedAt",
      "isExpired",
      "isStale",
      "provider",
      "providerModel",
      "staleAfter",
      "status",
      "text",
      "toolTraceSummary",
    ]);
  });

  it("serializes exactly the allowlisted key set on a cache miss", async () => {
    mocks.getCachedPublicDemoAnswer.mockResolvedValue(null);
    mocks.getLatestPublicDemoRefreshFailure.mockResolvedValue(null);

    const response = await GET(publicCacheRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual([
      "answer",
      "failure",
      "hit",
      "presetId",
      "sport",
    ]);
    expect(body.answer).toBeNull();
  });

  it("serializes exactly the same allowlisted key sets on a platform-aware hit", async () => {
    // The platform-aware response must not grow any platform-only property; a
    // mutation adding one should fail these exact key-set assertions.
    mocks.evaluatePublicDemoCapabilities.mockResolvedValue([
      selectableTarget("espn", "baseball"),
    ]);
    mocks.getCachedPublicDemoAnswer.mockResolvedValue({
      cacheKey: "public-demo-answer:wire-watch:espn:baseball:v8:v3",
      presetId: "wire-watch",
      sport: "baseball",
      provider: "provider-a",
      providerModel: "model-a",
      contextVersion: "v3",
      promptVersion: "v8",
      answerText: "A cached target answer.",
      generatedAt: "2026-06-06T12:00:00.000Z",
      expiresAt: "2026-06-06T18:00:00.000Z",
      staleAfter: "2026-06-06T15:00:00.000Z",
      updatedAt: "2026-06-06T12:00:00.000Z",
      status: "ready",
      isExpired: false,
      isStale: false,
      failureSummary: null,
      sourceMeta: null,
      toolTraceSummary: null,
    });

    const response = await GET(
      publicCacheRequest("presetId=wire-watch&sport=baseball&platform=espn"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual([
      "answer",
      "hit",
      "presetId",
      "sport",
    ]);
    expect(Object.keys(body.answer).sort()).toEqual([
      "expiresAt",
      "failure",
      "generatedAt",
      "isExpired",
      "isStale",
      "provider",
      "providerModel",
      "staleAfter",
      "status",
      "text",
      "toolTraceSummary",
    ]);
  });

  it("serializes exactly the same allowlisted key set on a platform-aware miss", async () => {
    mocks.evaluatePublicDemoCapabilities.mockResolvedValue([
      selectableTarget("espn", "baseball"),
    ]);
    mocks.getCachedPublicDemoAnswer.mockResolvedValue(null);
    mocks.getLatestPublicDemoRefreshFailure.mockResolvedValue(null);

    const response = await GET(
      publicCacheRequest("presetId=wire-watch&sport=baseball&platform=espn"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual([
      "answer",
      "failure",
      "hit",
      "presetId",
      "sport",
    ]);
    expect(body.answer).toBeNull();
  });
});
