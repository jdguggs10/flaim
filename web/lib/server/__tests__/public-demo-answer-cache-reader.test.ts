import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getCachedPublicDemoAnswer,
  getLatestPublicDemoRefreshFailure,
} from "../public-demo-answer-cache";

const FUTURE_TIMESTAMP = "2100-01-01T00:00:00.000Z";

function answerRow(overrides: Record<string, unknown> = {}) {
  return {
    cache_key: "public-demo-answer:wire-watch:espn:baseball:v8:v3",
    preset_id: "wire-watch",
    sport: "baseball",
    provider: "provider-a",
    provider_model: "model-a",
    context_version: "v3",
    prompt_version: "v8",
    answer_text: "A cached demo answer.",
    generated_at: "2026-01-01T00:00:00.000Z",
    expires_at: FUTURE_TIMESTAMP,
    stale_after: FUTURE_TIMESTAMP,
    status: "ready",
    source_meta: null,
    tool_trace_summary: null,
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function requestedUrl(fetchMock: ReturnType<typeof vi.fn>, callIndex: number) {
  return new URL(String(fetchMock.mock.calls[callIndex]?.[0]));
}

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://supabase.example");
  vi.stubEnv("SUPABASE_SERVICE_KEY", "test-service-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getCachedPublicDemoAnswer with a platform", () => {
  it("looks up the six-segment v8 key with a platform filter", async () => {
    const fetchMock = vi.fn(async () => jsonResponse([answerRow()]));
    vi.stubGlobal("fetch", fetchMock);

    const answer = await getCachedPublicDemoAnswer({
      presetId: "wire-watch",
      sport: "baseball",
      platform: "espn",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = requestedUrl(fetchMock, 0);
    expect(url.pathname).toBe("/rest/v1/demo_answer_cache");
    expect(url.searchParams.get("cache_key")).toBe(
      "eq.public-demo-answer:wire-watch:espn:baseball:v8:v3",
    );
    expect(url.searchParams.get("platform")).toBe("eq.espn");
    expect(answer?.answerText).toBe("A cached demo answer.");
    expect(answer?.cacheKey).toBe(
      "public-demo-answer:wire-watch:espn:baseball:v8:v3",
    );
  });

  it("falls back to the legacy v7 key for espn baseball when no v8 row exists", async () => {
    const legacyRow = answerRow({
      cache_key: "public-demo-answer:wire-watch:baseball:v7:v2",
      context_version: "v2",
      prompt_version: "v7",
      answer_text: "The legacy cached answer.",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([legacyRow]));
    vi.stubGlobal("fetch", fetchMock);

    const answer = await getCachedPublicDemoAnswer({
      presetId: "wire-watch",
      sport: "baseball",
      platform: "espn",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const fallbackUrl = requestedUrl(fetchMock, 1);
    expect(fallbackUrl.searchParams.get("cache_key")).toBe(
      "eq.public-demo-answer:wire-watch:baseball:v7:v2",
    );
    expect(fallbackUrl.searchParams.has("platform")).toBe(false);
    expect(answer?.answerText).toBe("The legacy cached answer.");
  });

  it("does not fall back when a usable v8 row exists for espn baseball", async () => {
    const fetchMock = vi.fn(async () => jsonResponse([answerRow()]));
    vi.stubGlobal("fetch", fetchMock);

    const answer = await getCachedPublicDemoAnswer({
      presetId: "wire-watch",
      sport: "baseball",
      platform: "espn",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(answer?.promptVersion).toBe("v8");
  });

  it("does not fall back for espn football", async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const answer = await getCachedPublicDemoAnswer({
      presetId: "wire-watch",
      sport: "football",
      platform: "espn",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(answer).toBeNull();
  });

  it("does not fall back for non-espn platforms", async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    const answer = await getCachedPublicDemoAnswer({
      presetId: "wire-watch",
      sport: "baseball",
      platform: "yahoo",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(answer).toBeNull();
  });
});

describe("getCachedPublicDemoAnswer without a platform", () => {
  it("keeps the legacy five-segment v7 lookup with no platform filter", async () => {
    const legacyRow = answerRow({
      cache_key: "public-demo-answer:wire-watch:baseball:v7:v2",
      context_version: "v2",
      prompt_version: "v7",
    });
    const fetchMock = vi.fn(async () => jsonResponse([legacyRow]));
    vi.stubGlobal("fetch", fetchMock);

    const answer = await getCachedPublicDemoAnswer({
      presetId: "wire-watch",
      sport: "baseball",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = requestedUrl(fetchMock, 0);
    expect(url.pathname).toBe("/rest/v1/demo_answer_cache");
    expect(url.searchParams.get("cache_key")).toBe(
      "eq.public-demo-answer:wire-watch:baseball:v7:v2",
    );
    expect(url.searchParams.has("platform")).toBe(false);
    expect(answer?.promptVersion).toBe("v7");
  });
});

describe("getLatestPublicDemoRefreshFailure", () => {
  it("filters run history by platform when one is provided", async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await getLatestPublicDemoRefreshFailure({
      presetId: "wire-watch",
      sport: "football",
      platform: "sleeper",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = requestedUrl(fetchMock, 0);
    expect(url.pathname).toBe("/rest/v1/demo_refresh_runs");
    expect(url.searchParams.get("preset_id")).toBe("eq.wire-watch");
    expect(url.searchParams.get("sport")).toBe("eq.football");
    expect(url.searchParams.get("platform")).toBe("eq.sleeper");
  });

  it("keeps the legacy query unchanged when no platform is provided", async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]));
    vi.stubGlobal("fetch", fetchMock);

    await getLatestPublicDemoRefreshFailure({
      presetId: "wire-watch",
      sport: "baseball",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = requestedUrl(fetchMock, 0);
    expect(url.searchParams.has("platform")).toBe(false);
  });
});
