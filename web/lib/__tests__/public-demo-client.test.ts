import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PUBLIC_CHAT_ALLOWED_TOOLS,
  PUBLIC_CHAT_FALLBACK_STATUS_LABEL,
  PUBLIC_CHAT_PRESETS,
  PUBLIC_CHAT_TARGET_PRESET_IDS,
  PUBLIC_CHAT_TOOL_STATUS_LABELS,
  getPublicChatStepStatusLabel,
} from "../public-chat";
import {
  INITIAL_PUBLIC_DEMO_STATE,
  buildPublicChatStepSequence,
  buildPublicDemoCacheRequestUrl,
  buildPublicDemoSportMenuRows,
  PUBLIC_DEMO_CAPABILITIES_TIMEOUT_MS,
  buildPublicDemoSportSwitchNote,
  buildPublicDemoSportTransitionAnnouncement,
  canStartPublicDemoRun,
  isPublicDemoTargetMode,
  loadPublicDemoCapabilities,
  normalizePublicChatTraceToolName,
  parsePublicDemoCapabilities,
  publicDemoReducer,
  resolveSportForPlatform,
  selectPublicDemoPlatformOptions,
  selectPublicDemoRequestPlatform,
  selectPublicDemoSportOptions,
  selectPublicDemoVisiblePresets,
  type PublicDemoAction,
  type PublicDemoAnswerMeta,
  type PublicDemoCapabilityTarget,
  type PublicDemoState,
} from "../public-demo-client";

const TARGET_PRESET_IDS = [...PUBLIC_CHAT_TARGET_PRESET_IDS];

/** Shape the capabilities route actually returns, including `freshness`. */
function capabilityDto(
  platform: string,
  sport: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    platform,
    sport,
    presets: TARGET_PRESET_IDS,
    default: false,
    freshness: "fresh",
    ...overrides,
  };
}

const ANSWER_META: PublicDemoAnswerMeta = {
  generatedAt: "2026-08-12T00:00:00.000Z",
  expiresAt: "2026-08-13T00:00:00.000Z",
  staleAfter: "2026-08-12T12:00:00.000Z",
  provider: "test-provider",
  providerModel: "test-model",
  isExpired: false,
  isStale: false,
  status: "ready",
  failureCode: null,
  failureMessage: null,
};

function reduceAll(
  state: PublicDemoState,
  actions: readonly PublicDemoAction[],
): PublicDemoState {
  return actions.reduce(publicDemoReducer, state);
}

/** Resolves capabilities exactly as the component does on mount. */
function withCapabilities(
  targets: readonly PublicDemoCapabilityTarget[],
  token = 1,
): PublicDemoState {
  return publicDemoReducer(INITIAL_PUBLIC_DEMO_STATE, {
    type: "capabilities_resolved",
    targets,
    token,
  });
}

const ESPN_BASEBALL = capabilityDto("espn", "baseball", { default: true });
const ESPN_FOOTBALL = capabilityDto("espn", "football");
const SLEEPER_FOOTBALL = capabilityDto("sleeper", "football");
const YAHOO_BASEBALL = capabilityDto("yahoo", "baseball");
const ESPN_HOCKEY = capabilityDto("espn", "hockey");
const YAHOO_HOCKEY = capabilityDto("yahoo", "hockey");
const YAHOO_FOOTBALL = capabilityDto("yahoo", "football");

describe("parsePublicDemoCapabilities", () => {
  it("parses an advertised target from the allowlisted DTO", () => {
    const targets = parsePublicDemoCapabilities({ targets: [ESPN_BASEBALL] });

    expect(targets).toEqual([
      {
        platform: "espn",
        sport: "baseball",
        presetIds: TARGET_PRESET_IDS,
        isDefault: true,
      },
    ]);
    // Rollout/gating state stays server-side; the client never carries it.
    expect(JSON.stringify(targets)).not.toContain("freshness");
  });

  it("orders parsed targets by the static matrix, not response order", () => {
    const targets = parsePublicDemoCapabilities({
      targets: [SLEEPER_FOOTBALL, ESPN_FOOTBALL, ESPN_BASEBALL],
    });

    expect(targets.map((target) => [target.platform, target.sport])).toEqual([
      ["espn", "football"],
      ["sleeper", "football"],
      ["espn", "baseball"],
    ]);
  });

  it("accepts ESPN and Yahoo hockey and orders them after the other targets", () => {
    const targets = parsePublicDemoCapabilities({
      targets: [YAHOO_HOCKEY, ESPN_HOCKEY, YAHOO_BASEBALL, ESPN_FOOTBALL],
    });

    expect(targets.map((target) => [target.platform, target.sport])).toEqual([
      ["espn", "football"],
      ["yahoo", "baseball"],
      ["espn", "hockey"],
      ["yahoo", "hockey"],
    ]);
  });

  it("returns an empty list for empty, malformed, or error payloads", () => {
    expect(parsePublicDemoCapabilities({ targets: [] })).toEqual([]);
    expect(parsePublicDemoCapabilities({})).toEqual([]);
    expect(parsePublicDemoCapabilities(null)).toEqual([]);
    expect(parsePublicDemoCapabilities("targets")).toEqual([]);
    expect(parsePublicDemoCapabilities({ targets: "espn" })).toEqual([]);
    expect(
      parsePublicDemoCapabilities({ error: "Unable to load capabilities." }),
    ).toEqual([]);
  });

  it("drops entries the static matrix does not back", () => {
    const targets = parsePublicDemoCapabilities({
      targets: [
        capabilityDto("draftkings", "baseball"),
        capabilityDto("espn", "basketball"),
        // sleeper-baseball and sleeper-hockey are not in the matrix.
        capabilityDto("sleeper", "baseball"),
        capabilityDto("sleeper", "hockey"),
        null,
        "espn",
        ESPN_BASEBALL,
      ],
    });

    expect(targets.map((target) => target.platform)).toEqual(["espn"]);
  });

  it("keeps only presets the target and the local preset list both know", () => {
    const targets = parsePublicDemoCapabilities({
      targets: [
        capabilityDto("espn", "baseball", {
          // "win-history" is a real preset but not a cross-target one;
          // "made-up" is unknown; "hot-hands" repeats.
          presets: ["hot-hands", "win-history", "made-up", 7, "hot-hands"],
        }),
      ],
    });

    expect(targets).toHaveLength(1);
    expect(targets[0].presetIds).toEqual(["hot-hands"]);
  });

  it("drops a target that advertises no usable preset", () => {
    expect(
      parsePublicDemoCapabilities({
        targets: [capabilityDto("espn", "baseball", { presets: [] })],
      }),
    ).toEqual([]);
    expect(
      parsePublicDemoCapabilities({
        targets: [capabilityDto("espn", "baseball", { presets: ["nope"] })],
      }),
    ).toEqual([]);
  });

  it("keeps the first of duplicate platform/sport entries", () => {
    const targets = parsePublicDemoCapabilities({
      targets: [
        capabilityDto("espn", "baseball", { presets: ["hot-hands"] }),
        capabilityDto("espn", "baseball", { presets: TARGET_PRESET_IDS }),
      ],
    });

    expect(targets).toHaveLength(1);
    expect(targets[0].presetIds).toEqual(["hot-hands"]);
  });
});

describe("capability resolution", () => {
  it("enters target mode on the advertised default target", () => {
    const state = withCapabilities(
      parsePublicDemoCapabilities({
        targets: [SLEEPER_FOOTBALL, ESPN_BASEBALL],
      }),
    );

    expect(state.capabilitiesStatus).toBe("resolved");
    expect(isPublicDemoTargetMode(state)).toBe(true);
    expect(state.platform).toBe("espn");
    expect(state.sport).toBe("baseball");
  });

  it("falls back to the first advertised target when none is marked default", () => {
    const state = withCapabilities(
      parsePublicDemoCapabilities({
        targets: [SLEEPER_FOOTBALL, ESPN_FOOTBALL],
      }),
    );

    // Matrix order puts espn-football first for the 2026 NFL season.
    expect(state.platform).toBe("espn");
    expect(state.sport).toBe("football");
  });

  it("stays in legacy ESPN baseball mode when capabilities are empty", () => {
    const state = withCapabilities(parsePublicDemoCapabilities({ targets: [] }));

    expect(state.capabilitiesStatus).toBe("resolved");
    expect(isPublicDemoTargetMode(state)).toBe(false);
    expect(state.platform).toBe("espn");
    expect(state.sport).toBe("baseball");
  });

  it("stays in legacy mode when the capabilities fetch fails", () => {
    const state = publicDemoReducer(INITIAL_PUBLIC_DEMO_STATE, {
      type: "capabilities_unavailable",
    });

    expect(state.capabilitiesStatus).toBe("resolved");
    expect(isPublicDemoTargetMode(state)).toBe(false);
    expect(selectPublicDemoRequestPlatform(state)).toBeNull();
  });

  it("ignores a second capabilities resolution", () => {
    const legacy = publicDemoReducer(INITIAL_PUBLIC_DEMO_STATE, {
      type: "capabilities_unavailable",
    });
    const after = publicDemoReducer(legacy, {
      type: "capabilities_resolved",
      targets: parsePublicDemoCapabilities({ targets: [SLEEPER_FOOTBALL] }),
      token: 5,
    });

    expect(after).toBe(legacy);
  });

  it("clears a run whose preset the resolved target no longer advertises", () => {
    // "win-history" is only in the legacy list, so resolving into target mode
    // must drop it even though the platform and sport did not move.
    const running = publicDemoReducer(INITIAL_PUBLIC_DEMO_STATE, {
      type: "run_started",
      presetId: "win-history",
      token: 1,
    });
    const resolved = publicDemoReducer(running, {
      type: "capabilities_resolved",
      targets: parsePublicDemoCapabilities({ targets: [ESPN_BASEBALL] }),
      token: 2,
    });

    expect(resolved.selectedPresetId).toBeNull();
    expect(resolved.runStatus).toBe("idle");
    expect(resolved.runToken).toBe(2);
  });

  it("resets a legacy run when activation lands on the same target and preset", () => {
    // The worst case for the client: ESPN baseball with a still-advertised
    // preset, so nothing user-visible moves. The run is still impossible — it
    // was issued without `platform` — so target mode must not inherit it.
    const running = publicDemoReducer(INITIAL_PUBLIC_DEMO_STATE, {
      type: "run_started",
      presetId: "hot-hands",
      token: 1,
    });
    expect(selectPublicDemoRequestPlatform(running)).toBeNull();

    const resolved = publicDemoReducer(running, {
      type: "capabilities_resolved",
      targets: parsePublicDemoCapabilities({ targets: [ESPN_BASEBALL] }),
      token: 2,
    });

    expect(resolved.platform).toBe("espn");
    expect(resolved.sport).toBe("baseball");
    expect(resolved.selectedPresetId).toBeNull();
    expect(resolved.runStatus).toBe("idle");
    expect(resolved.assistantText).toBe("");
    expect(resolved.runToken).toBe(2);
    // And the next request the client can make now carries the platform.
    expect(selectPublicDemoRequestPlatform(resolved)).toBe("espn");
  });

  it("strands the legacy run's late response behind the activation token", () => {
    const resolved = reduceAll(INITIAL_PUBLIC_DEMO_STATE, [
      { type: "run_started", presetId: "hot-hands", token: 1 },
      {
        type: "capabilities_resolved",
        targets: parsePublicDemoCapabilities({ targets: [ESPN_BASEBALL] }),
        token: 2,
      },
    ]);

    // The platform-less request settles after activation and must not paint.
    const stale = reduceAll(resolved, [
      { type: "pre_tool_step_advanced", index: 2, token: 1 },
      {
        type: "tool_call_started",
        toolCall: { id: "get_roster-0", status: "in_progress" },
        token: 1,
      },
      {
        type: "run_completed",
        assistantText: "Legacy answer with no platform.",
        answerMeta: ANSWER_META,
        token: 1,
      },
      { type: "run_failed", message: "Legacy failure.", token: 1 },
    ]);

    expect(stale).toBe(resolved);
    expect(stale.assistantText).toBe("");
    expect(stale.error).toBeNull();
    expect(stale.toolCalls).toEqual([]);
  });

  it("resets a completed legacy transcript on activation", () => {
    const completed = reduceAll(INITIAL_PUBLIC_DEMO_STATE, [
      { type: "run_started", presetId: "hot-hands", token: 1 },
      {
        type: "run_completed",
        assistantText: "Legacy answer with no platform.",
        answerMeta: ANSWER_META,
        token: 1,
      },
    ]);

    const resolved = publicDemoReducer(completed, {
      type: "capabilities_resolved",
      targets: parsePublicDemoCapabilities({ targets: [ESPN_BASEBALL] }),
      token: 2,
    });

    expect(resolved.assistantText).toBe("");
    expect(resolved.answerMeta).toBeNull();
    expect(resolved.runStatus).toBe("idle");
    expect(resolved.runToken).toBe(2);
  });

  it("leaves an untouched phone alone when capabilities activate", () => {
    const resolved = publicDemoReducer(INITIAL_PUBLIC_DEMO_STATE, {
      type: "capabilities_resolved",
      targets: parsePublicDemoCapabilities({ targets: [ESPN_BASEBALL] }),
      token: 2,
    });

    // No run to invalidate, so activation does not consume the token.
    expect(resolved.runToken).toBe(0);
    expect(resolved.runStatus).toBe("idle");
  });

  it("keeps a legacy run when capabilities resolve to nothing advertised", () => {
    const running = publicDemoReducer(INITIAL_PUBLIC_DEMO_STATE, {
      type: "run_started",
      presetId: "win-history",
      token: 1,
    });

    for (const resolution of [
      {
        type: "capabilities_resolved",
        targets: parsePublicDemoCapabilities({ targets: [] }),
        token: 2,
      },
      { type: "capabilities_unavailable" },
    ] satisfies readonly PublicDemoAction[]) {
      const resolved = publicDemoReducer(running, resolution);

      // Legacy is now confirmed, so the platform-less run was right all along.
      expect(resolved.selectedPresetId).toBe("win-history");
      expect(resolved.runStatus).toBe("running");
      expect(resolved.runToken).toBe(1);
      expect(selectPublicDemoRequestPlatform(resolved)).toBeNull();

      // Its response still lands, because its token was never superseded.
      expect(
        publicDemoReducer(resolved, {
          type: "run_completed",
          assistantText: "Legacy answer.",
          answerMeta: ANSWER_META,
          token: 1,
        }).assistantText,
      ).toBe("Legacy answer.");
    }
  });
});

describe("capabilities load", () => {
  /** A response object with only the fields the loader touches. */
  function jsonResponse(
    payload: unknown,
    init: { ok?: boolean; status?: number; statusText?: string } = {},
  ) {
    return {
      ok: init.ok ?? true,
      status: init.status ?? 200,
      statusText: init.statusText ?? "OK",
      json: async () => payload,
    } as unknown as Response;
  }

  /**
   * A request that never answers and never fails on its own — the shape the
   * deadline exists for. Records the signal so the test can prove the loader
   * actually released the request rather than merely stopping waiting on it.
   */
  function hangingFetch() {
    const signals: AbortSignal[] = [];
    const impl = ((_input: unknown, init?: { signal?: AbortSignal }) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          return;
        }
        signals.push(signal);
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
      })) as unknown as typeof fetch;

    return { impl, signals };
  }

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses a finite, conservative default deadline", () => {
    expect(Number.isFinite(PUBLIC_DEMO_CAPABILITIES_TIMEOUT_MS)).toBe(true);
    expect(PUBLIC_DEMO_CAPABILITIES_TIMEOUT_MS).toBe(8_000);
  });

  it("returns the advertised targets for a usable response", async () => {
    const targets = await loadPublicDemoCapabilities({
      signal: new AbortController().signal,
      fetchImpl: (async () =>
        jsonResponse({ targets: [ESPN_BASEBALL] })) as unknown as typeof fetch,
    });

    expect(targets).toEqual([
      {
        platform: "espn",
        sport: "baseball",
        presetIds: TARGET_PRESET_IDS,
        isDefault: true,
      },
    ]);
  });

  it("falls back to legacy mode when the response never settles", async () => {
    const { impl, signals } = hangingFetch();

    const targets = await loadPublicDemoCapabilities({
      signal: new AbortController().signal,
      timeoutMs: 10,
      fetchImpl: impl,
    });

    // Empty list, not null: the caller must treat this as a real answer.
    expect(targets).toEqual([]);
    // The stalled request was released, not left hanging behind the deadline.
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(true);
    // Named as a deadline so it is not mistaken for a transport failure.
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("timed out"),
    );
  });

  it("leaves the demo runnable on legacy after the deadline", async () => {
    const { impl } = hangingFetch();

    const targets = await loadPublicDemoCapabilities({
      signal: new AbortController().signal,
      timeoutMs: 10,
      fetchImpl: impl,
    });

    // Exactly what the component does with an empty list.
    const state =
      targets && targets.length === 0
        ? publicDemoReducer(INITIAL_PUBLIC_DEMO_STATE, {
            type: "capabilities_unavailable",
          })
        : INITIAL_PUBLIC_DEMO_STATE;

    // The regression this guards: a hung capabilities response used to leave
    // `capabilitiesStatus` on "loading" forever, so every prompt stayed inert.
    expect(state.capabilitiesStatus).toBe("resolved");
    expect(canStartPublicDemoRun(state)).toBe(true);
    expect(selectPublicDemoRequestPlatform(state)).toBeNull();
    expect(
      buildPublicDemoCacheRequestUrl({
        presetId: "hot-hands",
        sport: state.sport,
        platform: selectPublicDemoRequestPlatform(state),
      }),
    ).toBe("/api/public-chat/cache?presetId=hot-hands&sport=baseball");
  });

  it("reports nothing when the caller aborts mid-load", async () => {
    const { impl, signals } = hangingFetch();
    const controller = new AbortController();

    const pending = loadPublicDemoCapabilities({
      signal: controller.signal,
      timeoutMs: 10_000,
      fetchImpl: impl,
    });
    controller.abort();

    // null, so the unmounted component dispatches nothing at all — an unmount
    // must never be mistaken for the deadline's legacy fallback.
    await expect(pending).resolves.toBeNull();
    expect(signals[0].aborted).toBe(true);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("does not start a load for an already-aborted caller", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn();

    await expect(
      loadPublicDemoCapabilities({
        signal: controller.signal,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("clears the deadline timer on every settled path", async () => {
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    await loadPublicDemoCapabilities({
      signal: new AbortController().signal,
      fetchImpl: (async () =>
        jsonResponse({ targets: [ESPN_BASEBALL] })) as unknown as typeof fetch,
    });
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);

    await loadPublicDemoCapabilities({
      signal: new AbortController().signal,
      fetchImpl: (async () => {
        throw new Error("network down");
      }) as unknown as typeof fetch,
    });
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(2);

    const aborted = new AbortController();
    const { impl } = hangingFetch();
    const pending = loadPublicDemoCapabilities({
      signal: aborted.signal,
      fetchImpl: impl,
    });
    aborted.abort();
    await pending;
    expect(clearTimeoutSpy).toHaveBeenCalledTimes(3);
  });

  it("falls back to legacy for transport, status, and payload failures", async () => {
    const signal = new AbortController().signal;

    await expect(
      loadPublicDemoCapabilities({
        signal,
        fetchImpl: (async () => {
          throw new Error("network down");
        }) as unknown as typeof fetch,
      }),
    ).resolves.toEqual([]);

    await expect(
      loadPublicDemoCapabilities({
        signal,
        fetchImpl: (async () =>
          jsonResponse(
            { error: "Unable to load capabilities." },
            { ok: false, status: 500, statusText: "Internal Server Error" },
          )) as unknown as typeof fetch,
      }),
    ).resolves.toEqual([]);

    await expect(
      loadPublicDemoCapabilities({
        signal,
        fetchImpl: (async () => ({
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => {
            throw new SyntaxError("Unexpected token");
          },
        })) as unknown as typeof fetch,
      }),
    ).resolves.toEqual([]);

    // A well-formed response advertising nothing is legacy too, not a failure.
    await expect(
      loadPublicDemoCapabilities({
        signal,
        fetchImpl: (async () =>
          jsonResponse({ targets: [] })) as unknown as typeof fetch,
      }),
    ).resolves.toEqual([]);
  });
});

describe("run gating", () => {
  it("blocks runs until capabilities resolve", () => {
    expect(INITIAL_PUBLIC_DEMO_STATE.capabilitiesStatus).toBe("loading");
    expect(canStartPublicDemoRun(INITIAL_PUBLIC_DEMO_STATE)).toBe(false);
  });

  it("allows runs in both resolved modes", () => {
    expect(
      canStartPublicDemoRun(
        withCapabilities(
          parsePublicDemoCapabilities({ targets: [ESPN_BASEBALL] }),
        ),
      ),
    ).toBe(true);
    expect(
      canStartPublicDemoRun(
        publicDemoReducer(INITIAL_PUBLIC_DEMO_STATE, {
          type: "capabilities_unavailable",
        }),
      ),
    ).toBe(true);
  });

  it("blocks a second run while one is in flight, and reopens once it settles", () => {
    const running = reduceAll(
      withCapabilities(parsePublicDemoCapabilities({ targets: [ESPN_BASEBALL] })),
      [{ type: "run_started", presetId: "hot-hands", token: 2 }],
    );

    expect(canStartPublicDemoRun(running)).toBe(false);
    expect(
      canStartPublicDemoRun(
        publicDemoReducer(running, {
          type: "run_completed",
          assistantText: "Answer.",
          answerMeta: ANSWER_META,
          token: 2,
        }),
      ),
    ).toBe(true);
    expect(
      canStartPublicDemoRun(
        publicDemoReducer(running, {
          type: "run_failed",
          message: "Nope.",
          token: 2,
        }),
      ),
    ).toBe(true);
    expect(
      canStartPublicDemoRun(
        publicDemoReducer(running, { type: "run_aborted", token: 2 }),
      ),
    ).toBe(true);
  });
});

describe("cache request construction", () => {
  it("sends platform, sport, and presetId in target mode", () => {
    const state = withCapabilities(
      parsePublicDemoCapabilities({ targets: [ESPN_BASEBALL] }),
    );

    const url = buildPublicDemoCacheRequestUrl({
      presetId: "hot-hands",
      sport: state.sport,
      platform: selectPublicDemoRequestPlatform(state),
    });
    const params = new URL(url, "https://demo.example").searchParams;

    expect(params.get("platform")).toBe("espn");
    expect(params.get("sport")).toBe("baseball");
    expect(params.get("presetId")).toBe("hot-hands");
    // Pins the browser release gate: a prepared ESPN baseball prompt must
    // request platform=espn once capabilities advertise that target.
    expect(url).toBe(
      "/api/public-chat/cache?presetId=hot-hands&sport=baseball&platform=espn",
    );
  });

  it("omits platform in legacy mode so the fallback lane stays usable", () => {
    const state = publicDemoReducer(INITIAL_PUBLIC_DEMO_STATE, {
      type: "capabilities_unavailable",
    });

    const url = buildPublicDemoCacheRequestUrl({
      presetId: "hot-hands",
      sport: state.sport,
      platform: selectPublicDemoRequestPlatform(state),
    });

    expect(url).toBe("/api/public-chat/cache?presetId=hot-hands&sport=baseball");
    expect(url).not.toContain("platform");
  });

  it("follows the selected target after a platform switch", () => {
    const state = reduceAll(
      withCapabilities(
        parsePublicDemoCapabilities({
          targets: [ESPN_BASEBALL, SLEEPER_FOOTBALL],
        }),
      ),
      [{ type: "platform_selected", platform: "sleeper", token: 2 }],
    );

    const params = new URL(
      buildPublicDemoCacheRequestUrl({
        presetId: "wire-watch",
        sport: state.sport,
        platform: selectPublicDemoRequestPlatform(state),
      }),
      "https://demo.example",
    ).searchParams;

    expect(params.get("platform")).toBe("sleeper");
    expect(params.get("sport")).toBe("football");
  });
});

describe("preset visibility", () => {
  it("shows the full legacy list when capabilities are unavailable", () => {
    const state = publicDemoReducer(INITIAL_PUBLIC_DEMO_STATE, {
      type: "capabilities_unavailable",
    });

    expect(selectPublicDemoVisiblePresets(state)).toEqual(PUBLIC_CHAT_PRESETS);
  });

  it("shows only the selected target's advertised presets", () => {
    const state = withCapabilities(
      parsePublicDemoCapabilities({
        targets: [
          capabilityDto("espn", "baseball", {
            default: true,
            presets: ["wire-watch", "hot-hands"],
          }),
        ],
      }),
    );

    // Filtered by advertisement, ordered by the local display list.
    expect(
      selectPublicDemoVisiblePresets(state).map((preset) => preset.id),
    ).toEqual(["hot-hands", "wire-watch"]);
  });

  it("re-filters presets when the target changes", () => {
    const state = withCapabilities(
      parsePublicDemoCapabilities({
        targets: [
          capabilityDto("espn", "baseball", {
            default: true,
            presets: TARGET_PRESET_IDS,
          }),
          capabilityDto("sleeper", "football", { presets: ["hot-hands"] }),
        ],
      }),
    );

    expect(selectPublicDemoVisiblePresets(state)).toHaveLength(8);

    const switched = publicDemoReducer(state, {
      type: "platform_selected",
      platform: "sleeper",
      token: 2,
    });

    expect(
      selectPublicDemoVisiblePresets(switched).map((preset) => preset.id),
    ).toEqual(["hot-hands"]);
  });
});

describe("platform and sport selection", () => {
  const MULTI_TARGET = parsePublicDemoCapabilities({
    targets: [ESPN_BASEBALL, ESPN_FOOTBALL, YAHOO_BASEBALL, SLEEPER_FOOTBALL],
  });

  it("moves an unsupported current sport to the platform's default sport", () => {
    const state = publicDemoReducer(withCapabilities(MULTI_TARGET), {
      type: "platform_selected",
      platform: "sleeper",
      token: 2,
    });

    expect(state.platform).toBe("sleeper");
    expect(state.sport).toBe("football");
    expect(state.sportTransitionAnnouncement).toBe(
      "Baseball is not available for Sleeper. Showing the Sleeper football demo.",
    );
  });

  it("keeps the current sport when the new platform supports it", () => {
    const state = reduceAll(withCapabilities(MULTI_TARGET), [
      { type: "sport_selected", sport: "football", token: 2 },
      { type: "platform_selected", platform: "sleeper", token: 3 },
    ]);

    expect(state.sport).toBe("football");
    expect(state.sportTransitionAnnouncement).toBe("");
  });

  it("announces the transition again when returning to an unsupported sport", () => {
    const state = reduceAll(withCapabilities(MULTI_TARGET), [
      { type: "platform_selected", platform: "sleeper", token: 2 },
      // Yahoo has no football demo, so the sport moves back to baseball.
      { type: "platform_selected", platform: "yahoo", token: 3 },
    ]);

    expect(state.platform).toBe("yahoo");
    expect(state.sport).toBe("baseball");
    expect(state.sportTransitionAnnouncement).toBe(
      "Football is not available for Yahoo. Showing the Yahoo baseball demo.",
    );
  });

  it("clears the announcement once a selection needs no transition", () => {
    const state = reduceAll(withCapabilities(MULTI_TARGET), [
      { type: "platform_selected", platform: "sleeper", token: 2 },
      { type: "platform_selected", platform: "espn", token: 3 },
    ]);

    expect(state.sport).toBe("football");
    expect(state.sportTransitionAnnouncement).toBe("");
  });

  it("ignores platform and sport selection in legacy mode", () => {
    const legacy = publicDemoReducer(INITIAL_PUBLIC_DEMO_STATE, {
      type: "capabilities_unavailable",
    });

    expect(
      publicDemoReducer(legacy, {
        type: "platform_selected",
        platform: "sleeper",
        token: 2,
      }),
    ).toBe(legacy);
    expect(
      publicDemoReducer(legacy, {
        type: "sport_selected",
        sport: "football",
        token: 2,
      }),
    ).toBe(legacy);
  });

  it("ignores a sport the selected platform does not advertise", () => {
    const state = withCapabilities(
      parsePublicDemoCapabilities({ targets: [ESPN_BASEBALL] }),
    );

    expect(
      publicDemoReducer(state, {
        type: "sport_selected",
        sport: "football",
        token: 2,
      }),
    ).toBe(state);
  });

  it("ignores a selection carrying a non-advancing token", () => {
    const state = publicDemoReducer(withCapabilities(MULTI_TARGET), {
      type: "run_started",
      presetId: "hot-hands",
      token: 4,
    });

    expect(
      publicDemoReducer(state, {
        type: "platform_selected",
        platform: "sleeper",
        token: 4,
      }),
    ).toBe(state);
    expect(
      publicDemoReducer(state, {
        type: "sport_selected",
        sport: "football",
        token: 3,
      }),
    ).toBe(state);
  });

  it("exposes advertised platforms and sports as selectable options", () => {
    const state = withCapabilities(
      parsePublicDemoCapabilities({ targets: [ESPN_BASEBALL, ESPN_FOOTBALL] }),
    );

    expect(selectPublicDemoPlatformOptions(state)).toEqual([
      { platform: "espn", label: "ESPN", available: true, selected: true },
      { platform: "yahoo", label: "Yahoo", available: false, selected: false },
      {
        platform: "sleeper",
        label: "Sleeper",
        available: false,
        selected: false,
      },
    ]);
    expect(selectPublicDemoSportOptions(state)).toEqual([
      { sport: "baseball", label: "Baseball", available: true, selected: true },
      {
        sport: "football",
        label: "Football",
        available: true,
        selected: false,
      },
      // Hockey stays listed but unavailable until its target is advertised.
      { sport: "hockey", label: "Hockey", available: false, selected: false },
    ]);
  });

  it("offers hockey only on platforms that advertise it", () => {
    const state = withCapabilities(
      parsePublicDemoCapabilities({
        targets: [ESPN_BASEBALL, ESPN_HOCKEY, SLEEPER_FOOTBALL],
      }),
    );

    expect(
      selectPublicDemoSportOptions(state)
        .filter((option) => option.available)
        .map((option) => option.sport),
    ).toEqual(["baseball", "hockey"]);

    const sleeper = publicDemoReducer(state, {
      type: "platform_selected",
      platform: "sleeper",
      token: 2,
    });
    expect(
      selectPublicDemoSportOptions(sleeper)
        .filter((option) => option.available)
        .map((option) => option.sport),
    ).toEqual(["football"]);
  });

  it("offers only the legacy ESPN baseball option in legacy mode", () => {
    const legacy = publicDemoReducer(INITIAL_PUBLIC_DEMO_STATE, {
      type: "capabilities_unavailable",
    });

    expect(
      selectPublicDemoPlatformOptions(legacy).filter(
        (option) => option.available,
      ),
    ).toEqual([
      { platform: "espn", label: "ESPN", available: true, selected: true },
    ]);
    expect(
      selectPublicDemoSportOptions(legacy).filter((option) => option.available),
    ).toEqual([
      { sport: "baseball", label: "Baseball", available: true, selected: true },
    ]);
  });
});

describe("per-platform sport memory and the sport switch note", () => {
  // Mirrors the live matrix: ESPN and Yahoo carry all three sports, Sleeper
  // only football.
  const TARGETS = parsePublicDemoCapabilities({
    targets: [
      ESPN_BASEBALL,
      ESPN_FOOTBALL,
      ESPN_HOCKEY,
      YAHOO_BASEBALL,
      YAHOO_FOOTBALL,
      YAHOO_HOCKEY,
      SLEEPER_FOOTBALL,
    ],
  });

  it("restores a platform's remembered sport, and clears the note, after a forced round trip", () => {
    const onEspnHockey = reduceAll(withCapabilities(TARGETS), [
      { type: "sport_selected", sport: "hockey", token: 2 },
    ]);
    expect(onEspnHockey.platform).toBe("espn");
    expect(onEspnHockey.sport).toBe("hockey");

    const onSleeper = publicDemoReducer(onEspnHockey, {
      type: "platform_selected",
      platform: "sleeper",
      token: 3,
    });
    expect(onSleeper.sport).toBe("football");
    expect(onSleeper.sportSwitchNote).toBe(
      buildPublicDemoSportSwitchNote({
        platform: "sleeper",
        fromSport: "hockey",
        toSport: "football",
      }),
    );
    expect(onSleeper.sportSwitchNote).toBe(
      "No hockey on Sleeper, showing football.",
    );
    expect(onSleeper.sportTransitionAnnouncement).not.toBe("");

    const backOnEspn = publicDemoReducer(onSleeper, {
      type: "platform_selected",
      platform: "espn",
      token: 4,
    });
    expect(backOnEspn.sport).toBe("hockey");
    expect(backOnEspn.sportSwitchNote).toBe("");
    expect(backOnEspn.sportTransitionAnnouncement).toBe("");
  });

  it("keeps hockey across a Yahoo hop when Yahoo also offers it", () => {
    const state = reduceAll(withCapabilities(TARGETS), [
      { type: "sport_selected", sport: "hockey", token: 2 },
      { type: "platform_selected", platform: "yahoo", token: 3 },
    ]);

    expect(state.platform).toBe("yahoo");
    expect(state.sport).toBe("hockey");
    expect(state.sportSwitchNote).toBe("");
    expect(state.sportTransitionAnnouncement).toBe("");
  });

  it("carries football through Sleeper and Yahoo without a forced switch", () => {
    const state = reduceAll(withCapabilities(TARGETS), [
      { type: "sport_selected", sport: "football", token: 2 },
      { type: "platform_selected", platform: "sleeper", token: 3 },
      { type: "platform_selected", platform: "yahoo", token: 4 },
    ]);

    expect(state.platform).toBe("yahoo");
    expect(state.sport).toBe("football");
    expect(state.sportSwitchNote).toBe("");
  });

  it("clears the note once a run starts, leaving the sr-only announcement alone", () => {
    const onSleeper = reduceAll(withCapabilities(TARGETS), [
      { type: "sport_selected", sport: "hockey", token: 2 },
      { type: "platform_selected", platform: "sleeper", token: 3 },
    ]);
    expect(onSleeper.sportSwitchNote).not.toBe("");
    const announcementBefore = onSleeper.sportTransitionAnnouncement;

    const running = publicDemoReducer(onSleeper, {
      type: "run_started",
      presetId: "hot-hands",
      token: 4,
    });

    expect(running.sportSwitchNote).toBe("");
    expect(running.sportTransitionAnnouncement).toBe(announcementBefore);
  });
});

describe("resolveSportForPlatform", () => {
  const TARGETS = parsePublicDemoCapabilities({
    targets: [ESPN_BASEBALL, ESPN_FOOTBALL, SLEEPER_FOOTBALL],
  });

  it("keeps a supported preferred sport", () => {
    expect(resolveSportForPlatform(TARGETS, "espn", "football", undefined)).toBe(
      "football",
    );
  });

  it("prefers the platform's last sport over its matrix default", () => {
    expect(resolveSportForPlatform(TARGETS, "espn", "hockey", "football")).toBe(
      "football",
    );
  });

  it("falls back to the matrix default sport", () => {
    // espn's default sport is football for the 2026 NFL season.
    expect(
      resolveSportForPlatform(TARGETS, "espn", "hockey", undefined),
    ).toBe("football");
  });

  it("returns null for a platform with nothing advertised", () => {
    expect(resolveSportForPlatform(TARGETS, "yahoo", "baseball", undefined)).toBeNull();
  });

  it("never lands on hockey as a platform's default sport", () => {
    const withHockey = parsePublicDemoCapabilities({
      targets: [YAHOO_HOCKEY, YAHOO_BASEBALL],
    });

    expect(
      resolveSportForPlatform(withHockey, "yahoo", "football", undefined),
    ).toBe("baseball");
  });
});

describe("buildPublicDemoSportMenuRows", () => {
  it("orders rows Football, Baseball, Basketball, Hockey and marks all three real sports selectable on ESPN", () => {
    const state = withCapabilities(
      parsePublicDemoCapabilities({
        targets: [ESPN_BASEBALL, ESPN_FOOTBALL, ESPN_HOCKEY],
      }),
    );

    expect(
      buildPublicDemoSportMenuRows(selectPublicDemoSportOptions(state)),
    ).toEqual([
      {
        sport: "football",
        label: "Football",
        available: true,
        selected: false,
      },
      // ESPN_BASEBALL is the advertised default target, so it's selected.
      { sport: "baseball", label: "Baseball", available: true, selected: true },
      {
        sport: "basketball",
        label: "Basketball",
        available: false,
        selected: false,
      },
      { sport: "hockey", label: "Hockey", available: true, selected: false },
    ]);
  });

  it("offers only football on Sleeper, graying baseball, basketball, and hockey", () => {
    const state = withCapabilities(
      parsePublicDemoCapabilities({ targets: [SLEEPER_FOOTBALL] }),
    );

    expect(
      buildPublicDemoSportMenuRows(selectPublicDemoSportOptions(state)),
    ).toEqual([
      {
        sport: "football",
        label: "Football",
        available: true,
        selected: true,
      },
      {
        sport: "baseball",
        label: "Baseball",
        available: false,
        selected: false,
      },
      {
        sport: "basketball",
        label: "Basketball",
        available: false,
        selected: false,
      },
      { sport: "hockey", label: "Hockey", available: false, selected: false },
    ]);
  });

  it("never marks basketball available or selected, on any platform", () => {
    const espn = withCapabilities(
      parsePublicDemoCapabilities({
        targets: [ESPN_BASEBALL, ESPN_FOOTBALL, ESPN_HOCKEY],
      }),
    );
    const sleeper = withCapabilities(
      parsePublicDemoCapabilities({ targets: [SLEEPER_FOOTBALL] }),
    );

    for (const state of [espn, sleeper]) {
      const basketballRow = buildPublicDemoSportMenuRows(
        selectPublicDemoSportOptions(state),
      ).find((row) => row.sport === "basketball");

      expect(basketballRow).toEqual({
        sport: "basketball",
        label: "Basketball",
        available: false,
        selected: false,
      });
    }
  });

  it("flags exactly the current sport as selected", () => {
    const state = withCapabilities(
      parsePublicDemoCapabilities({
        targets: [ESPN_BASEBALL, ESPN_FOOTBALL, ESPN_HOCKEY],
      }),
    );
    const withHockeySelected = publicDemoReducer(state, {
      type: "sport_selected",
      sport: "hockey",
      token: 2,
    });

    const rows = buildPublicDemoSportMenuRows(
      selectPublicDemoSportOptions(withHockeySelected),
    );

    expect(rows.filter((row) => row.selected)).toEqual([
      { sport: "hockey", label: "Hockey", available: true, selected: true },
    ]);
  });

  it("offers only the legacy sport while capabilities load and in legacy mode", () => {
    const legacy = publicDemoReducer(INITIAL_PUBLIC_DEMO_STATE, {
      type: "capabilities_unavailable",
    });

    for (const state of [INITIAL_PUBLIC_DEMO_STATE, legacy]) {
      const rows = buildPublicDemoSportMenuRows(
        selectPublicDemoSportOptions(state),
      );

      expect(rows.map((row) => row.sport)).toEqual([
        "football",
        "baseball",
        "basketball",
        "hockey",
      ]);
      expect(rows.filter((row) => row.available)).toEqual([
        { sport: "baseball", label: "Baseball", available: true, selected: true },
      ]);
    }
  });
});

describe("buildPublicDemoSportTransitionAnnouncement", () => {
  it("names only user-visible platform and sport labels", () => {
    expect(
      buildPublicDemoSportTransitionAnnouncement({
        platform: "sleeper",
        fromSport: "baseball",
        toSport: "football",
      }),
    ).toBe(
      "Baseball is not available for Sleeper. Showing the Sleeper football demo.",
    );
  });
});

describe("run concurrency", () => {
  const TARGETS = parsePublicDemoCapabilities({
    targets: [ESPN_BASEBALL, SLEEPER_FOOTBALL],
  });

  function runningState() {
    return reduceAll(withCapabilities(TARGETS), [
      { type: "run_started", presetId: "hot-hands", token: 2 },
      { type: "pre_tool_step_advanced", index: 2, token: 2 },
      {
        type: "tool_call_started",
        toolCall: { id: "get_roster-0", name: "get_roster", status: "in_progress" },
        token: 2,
      },
    ]);
  }

  it("applies in-flight updates that carry the active token", () => {
    const state = runningState();

    expect(state.runStatus).toBe("running");
    expect(state.preToolStatusIndex).toBe(2);
    expect(state.toolCalls).toHaveLength(1);

    const completed = reduceAll(state, [
      { type: "tool_call_completed", toolCallId: "get_roster-0", token: 2 },
      {
        type: "run_completed",
        assistantText: "Answer for hot-hands.",
        answerMeta: ANSWER_META,
        token: 2,
      },
    ]);

    expect(completed.toolCalls[0].status).toBe("completed");
    expect(completed.runStatus).toBe("completed");
    expect(completed.assistantText).toBe("Answer for hot-hands.");
    expect(completed.answerMeta).toEqual(ANSWER_META);
  });

  it("clears transcript and run state atomically on a platform change", () => {
    const switched = publicDemoReducer(runningState(), {
      type: "platform_selected",
      platform: "sleeper",
      token: 3,
    });

    expect(switched.runToken).toBe(3);
    expect(switched.runStatus).toBe("idle");
    expect(switched.selectedPresetId).toBeNull();
    expect(switched.toolCalls).toEqual([]);
    expect(switched.assistantText).toBe("");
    expect(switched.answerMeta).toBeNull();
    expect(switched.error).toBeNull();
    expect(switched.preToolStatusIndex).toBe(0);
  });

  it("clears transcript and run state atomically on a sport change", () => {
    const state = reduceAll(
      withCapabilities(
        parsePublicDemoCapabilities({ targets: [ESPN_BASEBALL, ESPN_FOOTBALL] }),
      ),
      [
        { type: "run_started", presetId: "hot-hands", token: 2 },
        {
          type: "run_completed",
          assistantText: "Baseball answer.",
          answerMeta: ANSWER_META,
          token: 2,
        },
        { type: "sport_selected", sport: "football", token: 3 },
      ],
    );

    expect(state.sport).toBe("football");
    expect(state.runToken).toBe(3);
    expect(state.runStatus).toBe("idle");
    expect(state.assistantText).toBe("");
    expect(state.answerMeta).toBeNull();
    expect(state.selectedPresetId).toBeNull();
  });

  it("drops a stale response that resolves after a target change", () => {
    const switched = publicDemoReducer(runningState(), {
      type: "platform_selected",
      platform: "sleeper",
      token: 3,
    });

    // The aborted ESPN request settles late and must not repaint Sleeper.
    const stale = reduceAll(switched, [
      { type: "pre_tool_step_advanced", index: 1, token: 2 },
      {
        type: "tool_call_started",
        toolCall: { id: "get_roster-0", status: "in_progress" },
        token: 2,
      },
      {
        type: "run_completed",
        assistantText: "Stale ESPN baseball answer.",
        answerMeta: ANSWER_META,
        token: 2,
      },
      { type: "run_failed", message: "Stale ESPN failure.", token: 2 },
      { type: "run_aborted", token: 2 },
    ]);

    expect(stale).toBe(switched);
    expect(stale.assistantText).toBe("");
    expect(stale.error).toBeNull();
    expect(stale.platform).toBe("sleeper");
    expect(stale.sport).toBe("football");
  });

  it("drops a stale response after a newer run has started", () => {
    const second = publicDemoReducer(runningState(), {
      type: "run_started",
      presetId: "wire-watch",
      token: 3,
    });

    const afterStale = publicDemoReducer(second, {
      type: "run_completed",
      assistantText: "Answer for hot-hands.",
      answerMeta: ANSWER_META,
      token: 2,
    });
    expect(afterStale).toBe(second);

    const afterFresh = publicDemoReducer(second, {
      type: "run_completed",
      assistantText: "Answer for wire-watch.",
      answerMeta: ANSWER_META,
      token: 3,
    });
    expect(afterFresh.assistantText).toBe("Answer for wire-watch.");
    expect(afterFresh.selectedPresetId).toBe("wire-watch");
  });

  it("returns an aborted run to idle without surfacing an error", () => {
    const aborted = publicDemoReducer(runningState(), {
      type: "run_aborted",
      token: 2,
    });

    expect(aborted.runStatus).toBe("idle");
    expect(aborted.error).toBeNull();
    // The user bubble stays until the next run or target change replaces it.
    expect(aborted.selectedPresetId).toBe("hot-hands");
  });

  it("records a failed run without clearing the selected preset", () => {
    const failed = publicDemoReducer(runningState(), {
      type: "run_failed",
      message: "Demo answer unavailable.",
      token: 2,
    });

    expect(failed.runStatus).toBe("error");
    expect(failed.error).toBe("Demo answer unavailable.");
    expect(failed.selectedPresetId).toBe("hot-hands");
  });

  it("ignores run progress once the run has settled", () => {
    const failed = publicDemoReducer(runningState(), {
      type: "run_failed",
      message: "Demo answer unavailable.",
      token: 2,
    });

    expect(
      publicDemoReducer(failed, {
        type: "run_completed",
        assistantText: "Late success.",
        answerMeta: ANSWER_META,
        token: 2,
      }),
    ).toBe(failed);
  });

  it("keeps the run token monotonic", () => {
    const state = reduceAll(withCapabilities(TARGETS), [
      { type: "run_started", presetId: "hot-hands", token: 2 },
      { type: "platform_selected", platform: "sleeper", token: 3 },
      { type: "run_started", presetId: "hot-hands", token: 1 },
      { type: "run_started", presetId: "hot-hands", token: 4 },
    ]);

    expect(state.runToken).toBe(4);
    expect(state.runStatus).toBe("running");
  });
});

describe("normalizePublicChatTraceToolName", () => {
  it("strips the runner's mcp_fantasy_ prefix", () => {
    expect(normalizePublicChatTraceToolName("mcp_fantasy_get_roster")).toBe(
      "get_roster",
    );
  });

  it("folds every web-search trace variant into web_search", () => {
    expect(normalizePublicChatTraceToolName("web_search")).toBe("web_search");
    expect(normalizePublicChatTraceToolName("web_search_call")).toBe(
      "web_search",
    );
    expect(normalizePublicChatTraceToolName("google_web_search")).toBe(
      "web_search",
    );
  });

  it("passes an already-bare name through unchanged", () => {
    expect(normalizePublicChatTraceToolName("get_free_agents")).toBe(
      "get_free_agents",
    );
  });
});

describe("buildPublicChatStepSequence", () => {
  const wireWatch = PUBLIC_CHAT_PRESETS.find(
    (preset) => preset.id === "wire-watch",
  )!;

  it("puts the simulated get_user_session step first, then the preset's allowedTools in order", () => {
    expect(buildPublicChatStepSequence(wireWatch, null)).toEqual([
      "get_user_session",
      "get_roster",
      "get_free_agents",
      "get_players",
    ]);
  });

  it("appends web_search only when the trace shows the runner searched the web", () => {
    expect(
      buildPublicChatStepSequence(wireWatch, {
        byName: { get_roster: { count: 1 } },
      }),
    ).toEqual(["get_user_session", "get_roster", "get_free_agents", "get_players"]);

    expect(
      buildPublicChatStepSequence(wireWatch, {
        byName: { get_roster: { count: 1 }, web_search: { count: 2 } },
      }),
    ).toEqual([
      "get_user_session",
      "get_roster",
      "get_free_agents",
      "get_players",
      "web_search",
    ]);
  });

  it("recognizes a runner-namespaced or provider-native web-search trace name", () => {
    expect(
      buildPublicChatStepSequence(wireWatch, {
        byName: { mcp_fantasy_get_roster: { count: 1 }, google_web_search: { count: 1 } },
      }),
    ).toEqual([
      "get_user_session",
      "get_roster",
      "get_free_agents",
      "get_players",
      "web_search",
    ]);
  });

  it("never duplicates web_search when the trace lists more than one search variant", () => {
    const sequence = buildPublicChatStepSequence(wireWatch, {
      byName: { web_search: { count: 1 }, web_search_call: { count: 1 } },
    });
    expect(sequence.filter((step) => step === "web_search")).toHaveLength(1);
  });

  it("never duplicates get_user_session when a preset already allows it", () => {
    const sequence = buildPublicChatStepSequence(
      { ...wireWatch, allowedTools: ["get_user_session", "get_roster"] },
      null,
    );
    expect(sequence).toEqual(["get_user_session", "get_roster"]);
  });
});

describe("getPublicChatStepStatusLabel", () => {
  it("returns the web-search status line for web_search", () => {
    expect(getPublicChatStepStatusLabel("web_search")).toBe(
      "Searching the web…",
    );
  });

  it("returns a friendly, non-empty status label for get_roster", () => {
    expect(getPublicChatStepStatusLabel("get_roster")).toBe(
      "Fetching roster…",
    );
  });

  it("covers every tool in PUBLIC_CHAT_ALLOWED_TOOLS with a distinct, non-empty label", () => {
    const labels = PUBLIC_CHAT_ALLOWED_TOOLS.map((tool) =>
      getPublicChatStepStatusLabel(tool),
    );
    for (const label of labels) {
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("covers every tool that appears in any preset's allowedTools", () => {
    const toolsInUse = new Set(
      PUBLIC_CHAT_PRESETS.flatMap((preset) => preset.allowedTools),
    );
    for (const tool of toolsInUse) {
      expect(getPublicChatStepStatusLabel(tool)).not.toBe(
        PUBLIC_CHAT_FALLBACK_STATUS_LABEL,
      );
    }
  });

  it("falls back to generic copy for an unknown step name", () => {
    expect(getPublicChatStepStatusLabel("get_something_new")).toBe(
      PUBLIC_CHAT_FALLBACK_STATUS_LABEL,
    );
    expect(getPublicChatStepStatusLabel("constructor")).toBe(
      PUBLIC_CHAT_FALLBACK_STATUS_LABEL,
    );
  });

  it("matches the Worker's openaiMeta.invoking string for every tool", () => {
    const toolsSource = readFileSync(
      fileURLToPath(
        new URL(
          "../../../workers/fantasy-mcp/src/mcp/tools.ts",
          import.meta.url,
        ),
      ),
      "utf8",
    );
    for (const [tool, label] of Object.entries(PUBLIC_CHAT_TOOL_STATUS_LABELS)) {
      const nameIndex = toolsSource.indexOf(`name: '${tool}'`);
      expect(nameIndex, `${tool} not found in tools.ts`).toBeGreaterThan(-1);
      const invoking = /invoking: '([^']*)'/.exec(
        toolsSource.slice(nameIndex),
      )?.[1];
      const decoded = invoking?.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
        String.fromCharCode(parseInt(hex, 16)),
      );
      expect(decoded, tool).toBe(label);
    }
  });
});
