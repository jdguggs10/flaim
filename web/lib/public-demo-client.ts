/**
 * Client state for the homepage public demo phone.
 *
 * The state model is pure: capability parsing, platform/sport selection,
 * request construction, and the single reducer that owns run state. The one
 * deliberate exception is `loadPublicDemoCapabilities`, which owns the
 * capabilities fetch, its deadline timer, and its failure logging; it takes an
 * injectable `fetchImpl` so the bounded-load rules stay testable alongside the
 * pure ones. The React component in `components/public-demo` only wires effects
 * and markup to this module, which keeps the concurrency rules (run tokens,
 * atomic target resets) deterministically testable without a DOM.
 *
 * Two modes exist:
 * - **Target mode** — `/api/public-chat/capabilities` advertised at least one
 *   platform/sport target, so the client sends `platform` on every cache read.
 * - **Legacy mode** — capabilities were empty or unreachable. The client keeps
 *   the pre-FLA-247 ESPN baseball behavior and omits `platform`, which the
 *   cache route still serves for the one-release fallback window.
 */

import {
  PUBLIC_CHAT_PRESETS,
  PUBLIC_CHAT_TARGET_MATRIX,
  getPublicChatTarget,
  isPublicChatDemoPlatform,
  isPublicChatDemoSport,
  type PublicChatDemoPlatform,
  type PublicChatDemoSport,
  type PublicChatPreset,
} from "@/lib/public-chat";

/* ------------------------------------------------------------------ */
/*  Labels and ordering                                                */
/* ------------------------------------------------------------------ */

export const PUBLIC_DEMO_PLATFORM_ORDER = [
  "espn",
  "yahoo",
  "sleeper",
] as const satisfies readonly PublicChatDemoPlatform[];

export const PUBLIC_DEMO_PLATFORM_LABELS: Record<
  PublicChatDemoPlatform,
  string
> = {
  espn: "ESPN",
  yahoo: "Yahoo",
  sleeper: "Sleeper",
};

export const PUBLIC_DEMO_SPORT_ORDER = [
  "baseball",
  "football",
] as const satisfies readonly PublicChatDemoSport[];

export const PUBLIC_DEMO_SPORT_LABELS: Record<PublicChatDemoSport, string> = {
  baseball: "Baseball",
  football: "Football",
};

/**
 * The single target the demo served before capabilities existed. Legacy mode
 * pins the client here and omits `platform` from cache requests.
 */
export const PUBLIC_DEMO_LEGACY_PLATFORM: PublicChatDemoPlatform = "espn";
export const PUBLIC_DEMO_LEGACY_SPORT: PublicChatDemoSport = "baseball";

/* ------------------------------------------------------------------ */
/*  Capabilities DTO                                                   */
/* ------------------------------------------------------------------ */

/**
 * One advertised target, parsed from the allowlisted capabilities response.
 * `freshness` is deliberately dropped: it is rollout/gating state, not
 * something the public phone should render.
 */
export interface PublicDemoCapabilityTarget {
  platform: PublicChatDemoPlatform;
  sport: PublicChatDemoSport;
  presetIds: readonly string[];
  isDefault: boolean;
}

function matrixIndex(platform: string, sport: string): number {
  return PUBLIC_CHAT_TARGET_MATRIX.findIndex(
    (target) => target.platform === platform && target.sport === sport,
  );
}

/**
 * Parses `/api/public-chat/capabilities` defensively. Every field is validated
 * against the static matrix and the known preset list, so a malformed or
 * unexpected response can only ever narrow the client surface, never widen it.
 * Anything unparseable yields an empty list, which means legacy mode.
 */
export function parsePublicDemoCapabilities(
  payload: unknown,
): PublicDemoCapabilityTarget[] {
  if (!payload || typeof payload !== "object") {
    return [];
  }

  const rawTargets = (payload as { targets?: unknown }).targets;
  if (!Array.isArray(rawTargets)) {
    return [];
  }

  const parsed: PublicDemoCapabilityTarget[] = [];
  for (const raw of rawTargets) {
    if (!raw || typeof raw !== "object") {
      continue;
    }

    const entry = raw as Record<string, unknown>;
    const { platform, sport } = entry;
    if (!isPublicChatDemoPlatform(platform) || !isPublicChatDemoSport(sport)) {
      continue;
    }

    const matrixTarget = getPublicChatTarget(platform, sport);
    if (!matrixTarget) {
      continue;
    }

    if (
      parsed.some(
        (existing) =>
          existing.platform === platform && existing.sport === sport,
      )
    ) {
      continue;
    }

    // Presets must be advertised, in the target's matrix list, and renderable
    // from the local preset metadata; anything else is silently dropped.
    const seen = new Set<string>();
    const presetIds = (Array.isArray(entry.presets) ? entry.presets : []).filter(
      (presetId): presetId is string => {
        if (typeof presetId !== "string" || seen.has(presetId)) {
          return false;
        }
        if (!(matrixTarget.presetIds as readonly string[]).includes(presetId)) {
          return false;
        }
        if (!PUBLIC_CHAT_PRESETS.some((preset) => preset.id === presetId)) {
          return false;
        }
        seen.add(presetId);
        return true;
      },
    );

    if (presetIds.length === 0) {
      continue;
    }

    parsed.push({
      platform,
      sport,
      presetIds,
      isDefault: entry.default === true,
    });
  }

  return parsed.sort(
    (a, b) =>
      matrixIndex(a.platform, a.sport) - matrixIndex(b.platform, b.sport),
  );
}

/** Advertised sports for one platform, in matrix order. */
export function listAdvertisedSports(
  targets: readonly PublicDemoCapabilityTarget[],
  platform: PublicChatDemoPlatform,
): PublicChatDemoSport[] {
  return targets
    .filter((target) => target.platform === platform)
    .map((target) => target.sport);
}

/**
 * The sport to show for `platform`. Keeps `preferredSport` when the platform
 * advertises it, otherwise falls back to the sport last shown for that
 * platform, then to the platform's matrix default, then to its first
 * advertised sport. Sleeper therefore lands on football naturally.
 */
export function resolveSportForPlatform(
  targets: readonly PublicDemoCapabilityTarget[],
  platform: PublicChatDemoPlatform,
  preferredSport: PublicChatDemoSport | undefined,
  lastSport: PublicChatDemoSport | undefined,
): PublicChatDemoSport | null {
  const sports = listAdvertisedSports(targets, platform);
  if (sports.length === 0) {
    return null;
  }

  if (preferredSport && sports.includes(preferredSport)) {
    return preferredSport;
  }
  if (lastSport && sports.includes(lastSport)) {
    return lastSport;
  }

  const matrixDefault = sports.find(
    (sport) => getPublicChatTarget(platform, sport)?.isDefaultSport,
  );
  return matrixDefault ?? sports[0];
}

/** The target to open on: the advertised default, else the first advertised. */
export function resolveDefaultTarget(
  targets: readonly PublicDemoCapabilityTarget[],
): PublicDemoCapabilityTarget | null {
  return targets.find((target) => target.isDefault) ?? targets[0] ?? null;
}

/* ------------------------------------------------------------------ */
/*  Reducer state                                                      */
/* ------------------------------------------------------------------ */

export type PublicDemoRunStatus = "idle" | "running" | "completed" | "error";

export interface PublicDemoAnswerMeta {
  generatedAt: string;
  expiresAt: string;
  staleAfter: string;
  provider: string;
  providerModel: string;
  isExpired: boolean;
  isStale: boolean;
  status: string;
  failureCode: string | null;
  failureMessage: string | null;
}

export interface PublicDemoToolCallState {
  id: string;
  name?: string | null;
  status: "in_progress" | "completed";
}

export interface PublicDemoState {
  capabilitiesStatus: "loading" | "resolved";
  targets: readonly PublicDemoCapabilityTarget[];
  platform: PublicChatDemoPlatform;
  sport: PublicChatDemoSport;
  /** Per-platform memory so returning to a platform restores its last sport. */
  lastSportByPlatform: Readonly<
    Partial<Record<PublicChatDemoPlatform, PublicChatDemoSport>>
  >;
  selectedPresetId: string | null;
  runStatus: PublicDemoRunStatus;
  preToolStatusIndex: number;
  toolCalls: readonly PublicDemoToolCallState[];
  assistantText: string;
  answerMeta: PublicDemoAnswerMeta | null;
  error: string | null;
  /**
   * Monotonically increasing. Bumped by every run start and every target
   * change; async work carries the token it started with, and the reducer
   * drops any late action whose token no longer matches.
   */
  runToken: number;
  /** aria-live copy for an automatic sport transition; "" when there is none. */
  sportTransitionAnnouncement: string;
}

export const INITIAL_PUBLIC_DEMO_STATE: PublicDemoState = {
  capabilitiesStatus: "loading",
  targets: [],
  platform: PUBLIC_DEMO_LEGACY_PLATFORM,
  sport: PUBLIC_DEMO_LEGACY_SPORT,
  lastSportByPlatform: {},
  selectedPresetId: null,
  runStatus: "idle",
  preToolStatusIndex: 0,
  toolCalls: [],
  assistantText: "",
  answerMeta: null,
  error: null,
  runToken: 0,
  sportTransitionAnnouncement: "",
};

export type PublicDemoAction =
  | {
      type: "capabilities_resolved";
      targets: readonly PublicDemoCapabilityTarget[];
      token: number;
    }
  | { type: "capabilities_unavailable" }
  | { type: "platform_selected"; platform: PublicChatDemoPlatform; token: number }
  | { type: "sport_selected"; sport: PublicChatDemoSport; token: number }
  | { type: "run_started"; presetId: string; token: number }
  | { type: "pre_tool_step_advanced"; index: number; token: number }
  | {
      type: "tool_call_started";
      toolCall: PublicDemoToolCallState;
      token: number;
    }
  | { type: "tool_call_completed"; toolCallId: string; token: number }
  | {
      type: "run_completed";
      assistantText: string;
      answerMeta: PublicDemoAnswerMeta;
      token: number;
    }
  | { type: "run_failed"; message: string; token: number }
  | { type: "run_aborted"; token: number };

/* ------------------------------------------------------------------ */
/*  Selectors                                                          */
/* ------------------------------------------------------------------ */

export function isPublicDemoTargetMode(state: PublicDemoState): boolean {
  return state.targets.length > 0;
}

/**
 * Whether a prepared prompt may start a cache read right now.
 *
 * Runs are inert until capabilities resolve. Before that the request identity
 * is still unknown — a run started while loading would issue a legacy read
 * that omits `platform`, and resolving into target mode would immediately
 * invalidate it. Waiting is what makes "every cache read in target mode sends
 * `platform`" true rather than merely likely. Once capabilities have resolved,
 * both modes are runnable; only an already-running demo blocks a new one.
 */
export function canStartPublicDemoRun(state: PublicDemoState): boolean {
  return (
    state.capabilitiesStatus === "resolved" && state.runStatus !== "running"
  );
}

/** The current advertised target, or null in legacy mode. */
export function selectPublicDemoTarget(
  state: PublicDemoState,
): PublicDemoCapabilityTarget | null {
  return (
    state.targets.find(
      (target) =>
        target.platform === state.platform && target.sport === state.sport,
    ) ?? null
  );
}

/**
 * The `platform` value for a cache request: the selected platform in target
 * mode, and `null` in legacy mode so the parameter is omitted entirely.
 */
export function selectPublicDemoRequestPlatform(
  state: PublicDemoState,
): PublicChatDemoPlatform | null {
  return isPublicDemoTargetMode(state) ? state.platform : null;
}

/**
 * Presets to show. Target mode shows only the selected target's advertised
 * presets, in the local display order; legacy mode keeps the full list.
 */
export function selectPublicDemoVisiblePresets(
  state: PublicDemoState,
): readonly PublicChatPreset[] {
  const target = selectPublicDemoTarget(state);
  if (!target) {
    return PUBLIC_CHAT_PRESETS;
  }

  return PUBLIC_CHAT_PRESETS.filter((preset) =>
    target.presetIds.includes(preset.id),
  );
}

export interface PublicDemoPlatformOption {
  platform: PublicChatDemoPlatform;
  label: string;
  available: boolean;
  selected: boolean;
}

export function selectPublicDemoPlatformOptions(
  state: PublicDemoState,
): PublicDemoPlatformOption[] {
  const targetMode = isPublicDemoTargetMode(state);

  return PUBLIC_DEMO_PLATFORM_ORDER.map((platform) => ({
    platform,
    label: PUBLIC_DEMO_PLATFORM_LABELS[platform],
    available: targetMode
      ? state.targets.some((target) => target.platform === platform)
      : platform === PUBLIC_DEMO_LEGACY_PLATFORM,
    selected: platform === state.platform,
  }));
}

export interface PublicDemoSportOption {
  sport: PublicChatDemoSport;
  label: string;
  available: boolean;
  selected: boolean;
}

export function selectPublicDemoSportOptions(
  state: PublicDemoState,
): PublicDemoSportOption[] {
  const advertised = isPublicDemoTargetMode(state)
    ? listAdvertisedSports(state.targets, state.platform)
    : [PUBLIC_DEMO_LEGACY_SPORT];

  return PUBLIC_DEMO_SPORT_ORDER.map((sport) => ({
    sport,
    label: PUBLIC_DEMO_SPORT_LABELS[sport],
    available: advertised.includes(sport),
    selected: sport === state.sport,
  }));
}

/**
 * Copy announced when switching platforms forces a different sport. Names only
 * user-visible platform and sport labels — never a target ID or gate state.
 */
export function buildPublicDemoSportTransitionAnnouncement(input: {
  platform: PublicChatDemoPlatform;
  fromSport: PublicChatDemoSport;
  toSport: PublicChatDemoSport;
}): string {
  const platformLabel = PUBLIC_DEMO_PLATFORM_LABELS[input.platform];
  const fromLabel = PUBLIC_DEMO_SPORT_LABELS[input.fromSport];
  const toLabel = PUBLIC_DEMO_SPORT_LABELS[input.toSport].toLowerCase();

  return `${fromLabel} is not available for ${platformLabel}. Showing the ${platformLabel} ${toLabel} demo.`;
}

/* ------------------------------------------------------------------ */
/*  Request construction                                               */
/* ------------------------------------------------------------------ */

export const PUBLIC_DEMO_CACHE_ENDPOINT = "/api/public-chat/cache";
export const PUBLIC_DEMO_CAPABILITIES_ENDPOINT =
  "/api/public-chat/capabilities";

/**
 * How long the client waits for capabilities before giving up on them.
 *
 * Prompts are inert until this request settles, so a response that stalls
 * without ever failing would disable the demo for the whole visit. `fetch` has
 * no timeout of its own, and neither a proxy holding headers open nor a body
 * that never finishes streaming would abort on its own. Conservative on
 * purpose: long enough that a slow phone connection still gets real targets,
 * short enough that nobody stares at dead prompts.
 */
export const PUBLIC_DEMO_CAPABILITIES_TIMEOUT_MS = 8_000;

/**
 * Builds the cache read URL. `platform` is included for every platform-aware
 * request and omitted entirely when null, which is what keeps the legacy
 * one-release fallback reachable.
 */
export function buildPublicDemoCacheRequestUrl(input: {
  presetId: string;
  sport: PublicChatDemoSport;
  platform: PublicChatDemoPlatform | null;
}): string {
  const query = new URLSearchParams({
    presetId: input.presetId,
    sport: input.sport,
  });
  if (input.platform !== null) {
    query.set("platform", input.platform);
  }

  return `${PUBLIC_DEMO_CACHE_ENDPOINT}?${query.toString()}`;
}

/**
 * Reads capabilities under a deadline.
 *
 * Resolves to the advertised targets, or to an empty list meaning "fall back to
 * legacy mode" — which is the answer for every failure, including the deadline.
 * Resolves to `null` only when the caller's own signal aborts (unmount), the
 * one case where the caller must not touch state.
 *
 * Collapsing timeout and error into the same empty list is deliberate: the
 * client's contract is that capabilities are progressive enhancement, so any
 * outcome except a usable payload leaves the phone runnable on legacy ESPN
 * baseball rather than stuck behind an inert prompt list.
 */
export async function loadPublicDemoCapabilities(options: {
  /** Aborts the load without reporting a result — unmount, not failure. */
  signal: AbortSignal;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<readonly PublicDemoCapabilityTarget[] | null> {
  const {
    signal,
    timeoutMs = PUBLIC_DEMO_CAPABILITIES_TIMEOUT_MS,
    fetchImpl = fetch,
  } = options;

  if (signal.aborted) {
    return null;
  }

  // Internal controller so the deadline and the caller can both stop the
  // request while staying distinguishable afterwards.
  const controller = new AbortController();
  const abortForCaller = () => controller.abort();
  signal.addEventListener("abort", abortForCaller, { once: true });

  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetchImpl(PUBLIC_DEMO_CAPABILITIES_ENDPOINT, {
      method: "GET",
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    const payload: unknown = await response.json();
    // A payload that arrived just as the deadline fired is still good; only the
    // caller's abort means nobody is listening any more.
    if (signal.aborted) {
      return null;
    }

    return parsePublicDemoCapabilities(payload);
  } catch (capabilitiesError) {
    if (signal.aborted) {
      return null;
    }

    if (timedOut) {
      console.error(
        `Public demo capabilities timed out after ${timeoutMs}ms; using legacy mode.`,
      );
    } else {
      console.error(
        "Failed to load public demo capabilities:",
        capabilitiesError,
      );
    }

    return [];
  } finally {
    // Every settled path, including the caller's abort, releases the timer.
    clearTimeout(timeoutId);
    signal.removeEventListener("abort", abortForCaller);
  }
}

/* ------------------------------------------------------------------ */
/*  Reducer                                                            */
/* ------------------------------------------------------------------ */

const CLEARED_RUN_STATE = {
  selectedPresetId: null,
  runStatus: "idle",
  preToolStatusIndex: 0,
  toolCalls: [],
  assistantText: "",
  answerMeta: null,
  error: null,
} as const satisfies Partial<PublicDemoState>;

/**
 * Applies a target selection. Clears transcript and run state atomically and
 * adopts the new token whenever the effective target moved, the selected preset
 * stopped being advertised, or the caller declares the request identity itself
 * changed; otherwise the in-flight run keeps its token and continues.
 */
function applyTargetSelection(
  state: PublicDemoState,
  next: {
    targets?: readonly PublicDemoCapabilityTarget[];
    platform: PublicChatDemoPlatform;
    sport: PublicChatDemoSport;
    announcement?: string;
    /**
     * Forces the reset even when the visible target and preset are unchanged.
     * Used when the request shape moved, not just the selection.
     */
    requestIdentityChanged?: boolean;
  },
  token: number,
): PublicDemoState {
  const settled: PublicDemoState = {
    ...state,
    targets: next.targets ?? state.targets,
    platform: next.platform,
    sport: next.sport,
    lastSportByPlatform: {
      ...state.lastSportByPlatform,
      [next.platform]: next.sport,
    },
    sportTransitionAnnouncement: next.announcement ?? "",
  };

  const targetMoved =
    next.platform !== state.platform || next.sport !== state.sport;
  const presetStillVisible =
    settled.selectedPresetId === null ||
    selectPublicDemoVisiblePresets(settled).some(
      (preset) => preset.id === settled.selectedPresetId,
    );

  if (!next.requestIdentityChanged && !targetMoved && presetStillVisible) {
    return settled;
  }

  return { ...settled, ...CLEARED_RUN_STATE, runToken: token };
}

/** Late async updates only apply while their own run is still the active one. */
function isActiveRun(state: PublicDemoState, token: number): boolean {
  return state.runToken === token && state.runStatus === "running";
}

export function publicDemoReducer(
  state: PublicDemoState,
  action: PublicDemoAction,
): PublicDemoState {
  switch (action.type) {
    case "capabilities_resolved": {
      // One-shot: capabilities are fetched once per mount.
      if (state.capabilitiesStatus === "resolved") {
        return state;
      }

      const defaultTarget = resolveDefaultTarget(action.targets);
      if (!defaultTarget) {
        // Nothing advertised, so legacy mode is now confirmed rather than
        // assumed. A run that started while capabilities loaded already had
        // the right identity — `platform` omitted — and is left running.
        return { ...state, capabilitiesStatus: "resolved", targets: [] };
      }

      // Anything on screen here started before capabilities resolved, so it
      // carries the legacy identity: a cache read with `platform` omitted.
      // Target mode cannot adopt that run even when the default target happens
      // to be the legacy ESPN/baseball pair and the preset is still advertised,
      // because the request it issued is one target mode never makes. Reset it
      // and take the new token, which also strands its late response.
      const hasPreResolutionRun =
        state.runStatus !== "idle" || state.selectedPresetId !== null;

      return applyTargetSelection(
        { ...state, capabilitiesStatus: "resolved" },
        {
          targets: action.targets,
          platform: defaultTarget.platform,
          sport: defaultTarget.sport,
          requestIdentityChanged: hasPreResolutionRun,
        },
        action.token,
      );
    }

    case "capabilities_unavailable": {
      if (state.capabilitiesStatus === "resolved") {
        return state;
      }
      return { ...state, capabilitiesStatus: "resolved" };
    }

    case "platform_selected": {
      if (action.token <= state.runToken || !isPublicDemoTargetMode(state)) {
        return state;
      }

      const sport = resolveSportForPlatform(
        state.targets,
        action.platform,
        state.sport,
        state.lastSportByPlatform[action.platform],
      );
      if (sport === null) {
        return state;
      }

      return applyTargetSelection(
        state,
        {
          platform: action.platform,
          sport,
          announcement:
            sport === state.sport
              ? ""
              : buildPublicDemoSportTransitionAnnouncement({
                  platform: action.platform,
                  fromSport: state.sport,
                  toSport: sport,
                }),
        },
        action.token,
      );
    }

    case "sport_selected": {
      if (action.token <= state.runToken || !isPublicDemoTargetMode(state)) {
        return state;
      }
      if (
        !listAdvertisedSports(state.targets, state.platform).includes(
          action.sport,
        )
      ) {
        return state;
      }

      return applyTargetSelection(
        state,
        { platform: state.platform, sport: action.sport },
        action.token,
      );
    }

    case "run_started": {
      if (action.token <= state.runToken) {
        return state;
      }

      return {
        ...state,
        ...CLEARED_RUN_STATE,
        runToken: action.token,
        selectedPresetId: action.presetId,
        runStatus: "running",
      };
    }

    case "pre_tool_step_advanced": {
      if (!isActiveRun(state, action.token)) {
        return state;
      }
      return { ...state, preToolStatusIndex: action.index };
    }

    case "tool_call_started": {
      if (!isActiveRun(state, action.token)) {
        return state;
      }
      return { ...state, toolCalls: [...state.toolCalls, action.toolCall] };
    }

    case "tool_call_completed": {
      if (!isActiveRun(state, action.token)) {
        return state;
      }
      return {
        ...state,
        toolCalls: state.toolCalls.map((toolCall) =>
          toolCall.id === action.toolCallId
            ? { ...toolCall, status: "completed" }
            : toolCall,
        ),
      };
    }

    case "run_completed": {
      if (!isActiveRun(state, action.token)) {
        return state;
      }
      return {
        ...state,
        runStatus: "completed",
        assistantText: action.assistantText,
        answerMeta: action.answerMeta,
        error: null,
      };
    }

    case "run_failed": {
      if (!isActiveRun(state, action.token)) {
        return state;
      }
      return { ...state, runStatus: "error", error: action.message };
    }

    case "run_aborted": {
      if (!isActiveRun(state, action.token)) {
        return state;
      }
      return { ...state, runStatus: "idle" };
    }

    default:
      return state;
  }
}
