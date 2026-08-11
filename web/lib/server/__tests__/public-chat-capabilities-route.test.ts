import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "../../../app/api/public-chat/capabilities/route";
import {
  PUBLIC_CHAT_TARGET_PRESET_IDS,
  PUBLIC_DEMO_TARGET_CONTEXT_VERSION,
  PUBLIC_DEMO_TARGET_PROMPT_VERSION,
} from "../../public-chat";

const FUTURE_TIMESTAMP = "2100-01-01T00:00:00.000Z";
const PAST_TIMESTAMP = "2000-01-01T00:00:00.000Z";

const EXPECTED_PRESET_IDS = [
  "hot-hands",
  "league-format",
  "this-matchup",
  "my-moves",
  "best-team",
  "wire-watch",
  "league-moves",
  "roster-hole",
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function stubPostgrest(handlers: {
  targetState?: unknown;
  answerCache?: unknown;
}) {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = new URL(String(input));
    if (url.pathname === "/rest/v1/demo_target_state") {
      return jsonResponse(handlers.targetState ?? []);
    }
    if (url.pathname === "/rest/v1/demo_answer_cache") {
      return jsonResponse(handlers.answerCache ?? []);
    }
    throw new Error(`Unexpected fetch: ${url.toString()}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function enabledTargetState(
  platform: string,
  sport: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    platform,
    sport,
    public_enabled: true,
    expected_prompt_version: PUBLIC_DEMO_TARGET_PROMPT_VERSION,
    expected_context_version: PUBLIC_DEMO_TARGET_CONTEXT_VERSION,
    ...overrides,
  };
}

function readyCacheRows(
  platform: string,
  sport: string,
  overridesByPreset: Record<string, Record<string, unknown>> = {},
) {
  return PUBLIC_CHAT_TARGET_PRESET_IDS.map((presetId) => ({
    cache_key: [
      "public-demo-answer",
      presetId,
      platform,
      sport,
      PUBLIC_DEMO_TARGET_PROMPT_VERSION,
      PUBLIC_DEMO_TARGET_CONTEXT_VERSION,
    ].join(":"),
    preset_id: presetId,
    platform,
    sport,
    status: "ready",
    stale_after: FUTURE_TIMESTAMP,
    expires_at: FUTURE_TIMESTAMP,
    ...(overridesByPreset[presetId] ?? {}),
  }));
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

describe("GET /api/public-chat/capabilities", () => {
  it("reports a target with all eight ready presets as selectable and fresh", async () => {
    stubPostgrest({
      targetState: [enabledTargetState("espn", "baseball")],
      answerCache: readyCacheRows("espn", "baseball"),
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, s-maxage=60, stale-while-revalidate=300",
    );
    expect(body).toEqual({
      targets: [
        {
          platform: "espn",
          sport: "baseball",
          presets: EXPECTED_PRESET_IDS,
          default: true,
          freshness: "fresh",
        },
      ],
    });
  });

  it("does not select a target when only seven of eight presets have rows", async () => {
    stubPostgrest({
      targetState: [enabledTargetState("espn", "baseball")],
      answerCache: readyCacheRows("espn", "baseball").slice(0, 7),
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ targets: [] });
  });

  it("does not select a target whose state row is not public-enabled", async () => {
    stubPostgrest({
      targetState: [
        enabledTargetState("espn", "baseball", { public_enabled: false }),
      ],
      answerCache: readyCacheRows("espn", "baseball"),
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ targets: [] });
  });

  it("fails closed on any expected-version disagreement in demo_target_state", async () => {
    stubPostgrest({
      targetState: [
        enabledTargetState("espn", "baseball", {
          expected_prompt_version: "v7",
        }),
      ],
      answerCache: readyCacheRows("espn", "baseball"),
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ targets: [] });
  });

  it("keeps a target selectable but stale when any row passed stale_after", async () => {
    stubPostgrest({
      targetState: [enabledTargetState("espn", "baseball")],
      answerCache: readyCacheRows("espn", "baseball", {
        "wire-watch": { stale_after: PAST_TIMESTAMP },
      }),
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.targets).toHaveLength(1);
    expect(body.targets[0].freshness).toBe("stale");
    expect(body.targets[0].default).toBe(true);
  });

  it("reports degraded when any preset row has degraded status", async () => {
    stubPostgrest({
      targetState: [enabledTargetState("espn", "baseball")],
      answerCache: readyCacheRows("espn", "baseball", {
        "hot-hands": { status: "degraded" },
      }),
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.targets).toHaveLength(1);
    expect(body.targets[0].freshness).toBe("degraded");
  });

  it("returns empty targets when demo_target_state is empty", async () => {
    const fetchMock = stubPostgrest({ targetState: [], answerCache: [] });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ targets: [] });
    // Only the gate table is read when it is empty.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns empty targets without any fetch when Supabase env is unset", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_KEY", "");
    const fetchMock = stubPostgrest({});

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ targets: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks exactly one default target: the first selectable in matrix order", async () => {
    stubPostgrest({
      targetState: [
        enabledTargetState("sleeper", "football"),
        enabledTargetState("espn", "baseball"),
      ],
      answerCache: [
        ...readyCacheRows("espn", "baseball"),
        ...readyCacheRows("sleeper", "football"),
      ],
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(
      body.targets.map((target: { platform: string; default: boolean }) => [
        target.platform,
        target.default,
      ]),
    ).toEqual([
      ["espn", true],
      ["sleeper", false],
    ]);
  });

  it("moves the default to the first selectable target when espn-baseball is not selectable", async () => {
    stubPostgrest({
      targetState: [enabledTargetState("sleeper", "football")],
      answerCache: readyCacheRows("sleeper", "football"),
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.targets).toEqual([
      {
        platform: "sleeper",
        sport: "football",
        presets: EXPECTED_PRESET_IDS,
        default: true,
        freshness: "fresh",
      },
    ]);
  });

  it("returns a generic 500 body when PostgREST fails", async () => {
    const fetchMock = vi.fn(async () => new Response("boom", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: "Unable to load the public demo capabilities right now.",
    });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(consoleError).toHaveBeenCalled();
  });

  it("never leaks database row contents beyond the allowlisted DTO", async () => {
    const CANARY_LEAGUE_ID = "canary-league-1234567890";
    const CANARY_TOKEN = "sk-canary-token-XYZZY";
    const CANARY_PATH = "/home/canary/PiCode/private-run.log";
    const canaries = [CANARY_LEAGUE_ID, CANARY_TOKEN, CANARY_PATH];

    // Valid selectable rows that also carry canary values in extra columns
    // the query should never project, plus a canary in a projected timestamp
    // column (unparseable timestamps fail closed to stale).
    const validRows = readyCacheRows("espn", "baseball", {
      "wire-watch": { stale_after: CANARY_PATH },
    }).map((row) => ({
      ...row,
      answer_text: `League ${CANARY_LEAGUE_ID} answer`,
      provider: CANARY_TOKEN,
      source_meta: { runLogFile: CANARY_PATH, leagueId: CANARY_LEAGUE_ID },
      tool_trace_summary: { token: CANARY_TOKEN },
    }));

    // A junk row carrying canaries in every projected column; it matches no
    // matrix target and must be ignored entirely.
    const junkRow = {
      cache_key: `public-demo-answer:${CANARY_LEAGUE_ID}:espn:baseball:v8:v3`,
      preset_id: CANARY_LEAGUE_ID,
      platform: CANARY_TOKEN,
      sport: CANARY_PATH,
      status: CANARY_LEAGUE_ID,
      stale_after: CANARY_TOKEN,
      expires_at: CANARY_PATH,
    };

    stubPostgrest({
      targetState: [
        {
          ...enabledTargetState("espn", "baseball"),
          notes: CANARY_PATH,
          service_token: CANARY_TOKEN,
          league_id: CANARY_LEAGUE_ID,
        },
        // A state row with canary values in the columns the query projects.
        {
          platform: CANARY_LEAGUE_ID,
          sport: CANARY_TOKEN,
          public_enabled: true,
          expected_prompt_version: CANARY_PATH,
          expected_context_version: CANARY_LEAGUE_ID,
        },
      ],
      answerCache: [...validRows, junkRow],
    });

    const response = await GET();
    const body = await response.json();
    const serializedBody = JSON.stringify(body);

    expect(response.status).toBe(200);
    for (const canary of canaries) {
      expect(serializedBody).not.toContain(canary);
    }
    expect(serializedBody).not.toContain("test-service-key");
    expect(serializedBody).not.toContain("canary");

    // Only the allowlisted DTO keys appear, nothing spread from rows.
    expect(Object.keys(body)).toEqual(["targets"]);
    expect(body.targets).toHaveLength(1);
    expect(Object.keys(body.targets[0]).sort()).toEqual([
      "default",
      "freshness",
      "platform",
      "presets",
      "sport",
    ]);
    expect(body.targets[0]).toMatchObject({
      platform: "espn",
      sport: "baseball",
      freshness: "stale",
    });
  });
});
