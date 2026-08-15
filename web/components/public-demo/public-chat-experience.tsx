"use client";
import {
  PhoneDemoFrame,
  PhoneFlaimMark,
} from "@/components/site/phone-demo-frame";
import {
  type PublicChatDemoPlatform,
  type PublicChatDemoSport,
  type PublicChatPreset,
} from "@/lib/public-chat";
import {
  INITIAL_PUBLIC_DEMO_STATE,
  PUBLIC_DEMO_PLATFORM_LABELS,
  buildPublicDemoCacheRequestUrl,
  canStartPublicDemoRun,
  loadPublicDemoCapabilities,
  publicDemoReducer,
  selectPublicDemoPlatformOptions,
  selectPublicDemoRequestPlatform,
  selectPublicDemoSportOptions,
  selectPublicDemoVisiblePresets,
  type PublicDemoAnswerMeta,
} from "@/lib/public-demo-client";
import { cn } from "@/lib/utils";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { IconBallBaseball, IconBallAmericanFootball } from "@tabler/icons-react";
import {
  ArrowUp,
  Copy,
  LoaderCircle,
  Menu,
  MoreHorizontal,
  Plus,
  Share,
  ThumbsUp,
  Volume2,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  PhoneEducationPanel,
  type PhoneEducationPanelId,
} from "./phone-education-panel";
import { PublicMessage } from "./public-message";
import { PublicToolCall } from "./public-tool-call";

type PublicDemoToolTraceSummary = {
  byName?: Record<
    string,
    {
      count?: number;
    }
  >;
};

type PublicDemoRefreshFailure = {
  status?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
};

const PUBLIC_PRE_TOOL_STEPS = [
  { label: "Thinking...", durationMs: 1250 },
  { label: "Reading Flaim Fantasy...", durationMs: 1250 },
  { label: "Using Flaim tools...", durationMs: 1000 },
] as const;

const PUBLIC_TOOL_CARD_IN_PROGRESS_MS = 650;
const PUBLIC_TOOL_CARD_COMPLETED_PAUSE_MS = 220;
/** Seconds of ticker travel per prepared question; ~45px/s at pill width. */
const PUBLIC_PROMPT_TICKER_SECONDS_PER_PROMPT = 4;

const PUBLIC_SPORT_COPY: Record<
  PublicChatDemoSport,
  { icon: React.ReactNode; label: string }
> =
  {
    baseball: { icon: <IconBallBaseball className="h-5 w-5" stroke={1.5} />, label: "baseball" },
    football: { icon: <IconBallAmericanFootball className="h-5 w-5" stroke={1.5} />, label: "football" },
  };

function formatRelativeUpdateTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return "Updated recently";
  }

  const deltaMs = Date.now() - timestamp;
  if (deltaMs < 60_000) {
    return "Updated just now";
  }

  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 60) {
    return `Updated ${minutes}m ago`;
  }

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `Updated ${hours}h ago`;
  }

  const days = Math.round(hours / 24);
  return `Updated ${days}d ago`;
}

function getPublicDemoFailureCopy(
  failure: PublicDemoRefreshFailure | null | undefined,
) {
  if (!failure) {
    return "The latest refresh failed before a new answer could be stored.";
  }

  switch (failure.errorCode) {
    case "missing_mcp_grounding":
      return "The latest refresh did not successfully use Gerry's league data, so the answer was rejected.";
    case "empty_answer":
      return "The latest refresh returned an empty answer, so nothing new was stored.";
    case "provider_failed":
      return "The latest refresh failed while talking to the AI provider.";
    case "cache_write_failed":
      return "The latest refresh generated an answer but failed while writing it to cache.";
    default:
      return (
        failure.errorMessage ||
        "The latest refresh failed before a new answer could be stored."
      );
  }
}

function normalizeTraceToolName(name: string) {
  if (name.startsWith("mcp_fantasy_")) {
    return name.slice("mcp_fantasy_".length);
  }

  if (
    name === "google_web_search" ||
    name === "web_search" ||
    name === "web_search_call"
  ) {
    return "web_search";
  }

  return name;
}

function buildSimulatedToolNames(
  preset: PublicChatPreset,
  toolTraceSummary: PublicDemoToolTraceSummary | null | undefined,
) {
  const byName = toolTraceSummary?.byName ?? {};
  const tracedNames = Object.keys(byName)
    .map(normalizeTraceToolName)
    .filter((value, index, array) => array.indexOf(value) === index);

  const plannedTools = [...preset.allowedTools];
  const usedWebSearch = tracedNames.includes("web_search");

  return usedWebSearch ? [...plannedTools, "web_search"] : plannedTools;
}

async function waitFor(ms: number, signal: AbortSignal) {
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    const handleAbort = () => {
      window.clearTimeout(timeoutId);
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    const cleanup = () => {
      signal.removeEventListener("abort", handleAbort);
    };

    signal.addEventListener("abort", handleAbort, { once: true });
  });
}

/* ------------------------------------------------------------------ */
/*  Idle state — easter egg: auto-cycling logo animations              */
/* ------------------------------------------------------------------ */

const IDLE_ANIM_STYLES = ["rock", "bounce", "spin"] as const;

function IdleState({ platformLabel }: { platformLabel: string }) {
  const [styleIndex, setStyleIndex] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const animStyle = IDLE_ANIM_STYLES[styleIndex % IDLE_ANIM_STYLES.length];
  const animClass = {
    rock: "public-chat-idle-rock",
    bounce: "public-chat-idle-bounce",
    spin: "public-chat-idle-spin",
  }[animStyle];

  // Checked inside the interval callback so toggling the OS setting takes
  // effect without a remount.
  const advanceUnlessReducedMotion = useCallback(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return;
    }
    setStyleIndex((i) => i + 1);
  }, []);

  // Auto-cycle every 6s
  useEffect(() => {
    timerRef.current = setInterval(advanceUnlessReducedMotion, 6000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [advanceUnlessReducedMotion]);

  // Tap to advance + restart timer
  const handleTap = useCallback(() => {
    setStyleIndex((i) => i + 1);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(advanceUnlessReducedMotion, 6000);
  }, [advanceUnlessReducedMotion]);

  return (
    <div className="flex min-h-[15rem] flex-1 flex-col items-center justify-center px-4 text-center">
      <p className="text-[clamp(1.125rem,6.1cqw,1.3rem)] font-semibold leading-tight tracking-[-0.025em] text-[var(--phone-text)]">
        Ask about the league
      </p>
      <p className="mt-2 max-w-[16rem] text-[length:var(--phone-type-secondary)] leading-[1.4] text-[var(--phone-muted)]">
        Real answers from Gerry&apos;s actual {platformLabel} league
      </p>
      {/* Tap logo to cycle animation — easter egg */}
      <button
        onClick={handleTap}
        className="mt-5 inline-flex h-11 w-11 cursor-default items-center justify-center rounded-full"
        aria-label="Toggle animation"
      >
        <span key={`mark-${styleIndex}`} className={cn("inline-flex", animClass)}>
          <PhoneFlaimMark size={32} />
        </span>
      </button>
      <span className="mt-2 text-lg text-[var(--phone-muted)]" aria-hidden>
        ↓
      </span>
    </div>
  );
}

export function PublicChatExperience({
  initialPresetId = null,
  id,
  followTranscript = true,
}: {
  initialPresetId?: string | null;
  id?: string;
  followTranscript?: boolean;
}) {
  const [state, dispatch] = useReducer(
    publicDemoReducer,
    INITIAL_PUBLIC_DEMO_STATE,
  );
  const {
    answerMeta,
    assistantText,
    capabilitiesStatus,
    error,
    preToolStatusIndex,
    runStatus,
    selectedPresetId,
    sportTransitionAnnouncement,
    toolCalls,
  } = state;
  // Single generator for run tokens. Every async run and every target change
  // takes the next value; the reducer drops actions whose token went stale.
  const runTokenRef = useRef(0);
  const [educationPanel, setEducationPanel] =
    useState<PhoneEducationPanelId | null>(null);
  const [phonePanelContainer, setPhonePanelContainer] =
    useState<HTMLDivElement | null>(null);
  const educationTriggerRef = useRef<HTMLButtonElement | null>(null);
  const openEducationPanel = useCallback(
    (panel: PhoneEducationPanelId, trigger: HTMLButtonElement) => {
      educationTriggerRef.current = trigger;
      setEducationPanel(panel);
    },
    [],
  );
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
  const activeRunAbortControllerRef = useRef<AbortController | null>(null);
  const autoRunPresetIdRef = useRef<string | null>(null);

  const demoSport = state.sport;
  // Prompts stay inert until capabilities answer: a run started while loading
  // would issue a legacy, platform-less cache read that target-mode activation
  // has to throw away. `capabilitiesLoading` is the reason for the current
  // block, which is what the prompt controls expose to assistive tech.
  const capabilitiesLoading = capabilitiesStatus !== "resolved";
  const canRun = canStartPublicDemoRun(state);
  const requestPlatform = selectPublicDemoRequestPlatform(state);
  const platformOptions = selectPublicDemoPlatformOptions(state);
  const sportOptions = selectPublicDemoSportOptions(state);
  const visiblePresets = selectPublicDemoVisiblePresets(state);
  const demoTarget = useMemo(
    () => ({
      platformLabel: PUBLIC_DEMO_PLATFORM_LABELS[state.platform],
      sport: state.sport,
    }),
    [state.platform, state.sport],
  );

  const selectedPreset = useMemo(
    () =>
      selectedPresetId
        ? (visiblePresets.find((preset) => preset.id === selectedPresetId) ??
          null)
        : null,
    [selectedPresetId, visiblePresets],
  );
  const hasAssistantText = assistantText.trim().length > 0;
  const showPreToolStatus =
    runStatus === "running" && !hasAssistantText && toolCalls.length === 0;
  const preToolStatusCopy =
    PUBLIC_PRE_TOOL_STEPS[preToolStatusIndex]?.label ?? "Thinking...";
  // Single polite live region: pre-tool status while running, then the
  // ready/freshness line on completion. Errors announce via role="alert".
  const liveAnnouncement =
    runStatus === "running"
      ? preToolStatusCopy
      : runStatus === "completed"
        ? answerMeta
          ? `Answer ready. ${formatRelativeUpdateTime(answerMeta.generatedAt)}`
          : "Answer ready"
        : "";
  // Deep links wait for capabilities so the auto-run happens against the real
  // target, and only run when the target still advertises that preset.
  const initialQueryPreset = useMemo(
    () =>
      initialPresetId && capabilitiesStatus === "resolved"
        ? (visiblePresets.find((preset) => preset.id === initialPresetId) ??
          null)
        : null,
    [capabilitiesStatus, initialPresetId, visiblePresets],
  );

  useEffect(() => {
    if (!followTranscript || !transcriptScrollRef.current) {
      return;
    }

    const scrollContainer = transcriptScrollRef.current;
    const frame = window.requestAnimationFrame(() => {
      // Checked at scroll time so an OS-level toggle applies immediately.
      const prefersReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      const nextBehavior: ScrollBehavior =
        !prefersReducedMotion &&
        (assistantText.trim().length > 0 || toolCalls.length > 0)
          ? "smooth"
          : "auto";
      scrollContainer.scrollTo({
        top: scrollContainer.scrollHeight,
        behavior: nextBehavior,
      });
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [assistantText, followTranscript, runStatus, toolCalls.length]);

  useEffect(() => {
    return () => {
      activeRunAbortControllerRef.current?.abort();
    };
  }, []);

  // Capabilities are progressive enhancement: any failure, an empty advertised
  // set, or the load deadline leaves the phone in legacy ESPN baseball mode,
  // which omits `platform` from cache reads. Because prompts stay inert until
  // this settles, the deadline inside the loader is what guarantees it settles.
  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      const targets = await loadPublicDemoCapabilities({
        signal: controller.signal,
      });
      // null means this component unmounted mid-load; nobody is listening.
      if (targets === null) {
        return;
      }

      if (targets.length === 0) {
        dispatch({ type: "capabilities_unavailable" });
        return;
      }

      dispatch({
        type: "capabilities_resolved",
        targets,
        token: (runTokenRef.current += 1),
      });
    })();

    return () => {
      controller.abort();
    };
  }, []);

  // Single place that stops in-flight work: any move out of "running" —
  // including a reducer-initiated target reset — releases the request and its
  // pacing timers. The run token already prevents a late response repainting
  // the new target, so this only frees resources.
  useEffect(() => {
    if (runStatus !== "running") {
      activeRunAbortControllerRef.current?.abort();
    }
  }, [runStatus]);

  const handleRunPreset = useCallback(
    async (preset: PublicChatPreset) => {
      if (!canRun) {
        return;
      }

      // Every dispatch below carries this token; the reducer drops all of them
      // once a newer run or a target change has taken over.
      const token = (runTokenRef.current += 1);
      dispatch({ type: "run_started", presetId: preset.id, token });
      activeRunAbortControllerRef.current?.abort();
      const abortController = new AbortController();
      activeRunAbortControllerRef.current = abortController;

      try {
        const response = await fetch(
          buildPublicDemoCacheRequestUrl({
            presetId: preset.id,
            sport: demoSport,
            platform: requestPlatform,
          }),
          {
            method: "GET",
            cache: "no-store",
            signal: abortController.signal,
          },
        );

        if (!response.ok) {
          let message = `${response.status} ${response.statusText}`;
          try {
            const payload = (await response.json()) as { error?: string };
            if (payload.error) {
              message = payload.error;
            }
          } catch (jsonError) {
            console.error("Failed to parse error response JSON:", jsonError);
          }
          throw new Error(message);
        }

        const payload = (await response.json()) as {
          hit?: boolean;
          answer?: {
            text?: string;
            generatedAt?: string;
            expiresAt?: string;
            staleAfter?: string;
            provider?: string;
            providerModel?: string;
            isExpired?: boolean;
            isStale?: boolean;
            status?: string;
            failure?: PublicDemoRefreshFailure | null;
            toolTraceSummary?: PublicDemoToolTraceSummary | null;
          } | null;
          failure?: PublicDemoRefreshFailure | null;
        };

        if (!payload.hit || !payload.answer?.text) {
          throw new Error(
            payload.failure
              ? getPublicDemoFailureCopy(payload.failure)
              : "This prompt does not have a cached answer yet. Try another preset or check back soon.",
          );
        }

        const nextAnswerMeta: PublicDemoAnswerMeta = {
          generatedAt: payload.answer.generatedAt || new Date().toISOString(),
          expiresAt: payload.answer.expiresAt || new Date().toISOString(),
          staleAfter: payload.answer.staleAfter || new Date().toISOString(),
          provider: payload.answer.provider || "unknown",
          providerModel: payload.answer.providerModel || "unknown",
          isExpired: Boolean(payload.answer.isExpired),
          isStale: Boolean(payload.answer.isStale),
          status: payload.answer.status || "ready",
          failureCode: payload.answer.failure?.errorCode || null,
          failureMessage: payload.answer.failure?.errorMessage || null,
        };
        const simulatedToolNames = buildSimulatedToolNames(
          preset,
          payload.answer.toolTraceSummary,
        );

        for (let index = 0; index < PUBLIC_PRE_TOOL_STEPS.length; index += 1) {
          dispatch({ type: "pre_tool_step_advanced", index, token });
          await waitFor(PUBLIC_PRE_TOOL_STEPS[index].durationMs, abortController.signal);
        }

        for (let index = 0; index < simulatedToolNames.length; index += 1) {
          const toolName = simulatedToolNames[index];
          const toolCallId = `${toolName}-${index}`;

          dispatch({
            type: "tool_call_started",
            toolCall: {
              id: toolCallId,
              name: toolName,
              status: "in_progress",
            },
            token,
          });
          await waitFor(PUBLIC_TOOL_CARD_IN_PROGRESS_MS, abortController.signal);
          dispatch({ type: "tool_call_completed", toolCallId, token });
          await waitFor(PUBLIC_TOOL_CARD_COMPLETED_PAUSE_MS, abortController.signal);
        }

        dispatch({
          type: "run_completed",
          assistantText: payload.answer.text,
          answerMeta: nextAnswerMeta,
          token,
        });
      } catch (runError) {
        if (abortController.signal.aborted) {
          dispatch({ type: "run_aborted", token });
          return;
        }

        const message =
          runError instanceof Error
            ? runError.message
            : "Unable to run the public chat demo.";
        dispatch({ type: "run_failed", message, token });
      } finally {
        if (activeRunAbortControllerRef.current === abortController) {
          activeRunAbortControllerRef.current = null;
        }
      }
    },
    [canRun, demoSport, requestPlatform],
  );

  const handleSelectPlatform = useCallback(
    (platform: PublicChatDemoPlatform) => {
      dispatch({
        type: "platform_selected",
        platform,
        token: (runTokenRef.current += 1),
      });
    },
    [],
  );

  const handleSelectSport = useCallback((sport: PublicChatDemoSport) => {
    dispatch({
      type: "sport_selected",
      sport,
      token: (runTokenRef.current += 1),
    });
  }, []);

  useEffect(() => {
    if (!initialQueryPreset) {
      return;
    }

    if (autoRunPresetIdRef.current === initialQueryPreset.id) {
      return;
    }

    // Claim the deep link only when the run can actually start, so a blocked
    // attempt retries on the next render instead of being silently consumed.
    if (!canRun) {
      return;
    }

    autoRunPresetIdRef.current = initialQueryPreset.id;
    void handleRunPreset(initialQueryPreset);
  }, [canRun, handleRunPreset, initialQueryPreset]);

  // The prepared questions scroll continuously like a ticker. The track holds
  // the list twice so the CSS loop is seamless; the second copy is decorative
  // (hidden from assistive tech, not focusable, and removed entirely under
  // reduced motion, where the row becomes a still, scrollable list instead).
  const renderPromptTicker = (presets: readonly PublicChatPreset[]) => {
    const tickerPaused = runStatus === "running" || educationPanel !== null;
    const tickerDurationSeconds = Math.max(
      12,
      presets.length * PUBLIC_PROMPT_TICKER_SECONDS_PER_PROMPT,
    );

    const renderPill = (preset: PublicChatPreset, clone: boolean) => {
      const isSelected = preset.id === selectedPresetId;

      return (
        <button
          key={clone ? `${preset.id}-clone` : preset.id}
          type="button"
          onClick={() => {
            // Guard instead of `disabled` so the clicked pill keeps
            // keyboard focus when a run starts, and so a pill pressed
            // while capabilities load stays focusable rather than
            // dropping focus to the body mid-load.
            if (!canRun) {
              return;
            }
            void handleRunPreset(preset);
          }}
          aria-disabled={canRun ? undefined : true}
          aria-pressed={clone ? undefined : isSelected}
          aria-hidden={clone || undefined}
          tabIndex={clone ? -1 : undefined}
          className={cn(
            "group relative min-h-11 w-max overflow-hidden rounded-full border px-3 py-2 text-left transition-colors duration-200",
            clone ? "public-chat-ticker-clone" : "",
            isSelected
              ? "border-[var(--phone-accent)] bg-[var(--phone-user-bubble)] text-[var(--phone-user-text)]"
              : "border-[var(--phone-border)] bg-[var(--phone-panel)] text-[var(--phone-text)] hover:bg-[var(--phone-panel-strong)]",
            !canRun && !isSelected ? "cursor-not-allowed opacity-65" : "",
          )}
        >
          <h3 className="whitespace-nowrap text-[length:var(--phone-type-caption)] font-medium leading-[1.25] tracking-[-0.015em] text-[var(--phone-text)]">
            {preset.title}
          </h3>
        </button>
      );
    };

    return (
      <div
        role="region"
        aria-busy={capabilitiesLoading || undefined}
        aria-label={
          capabilitiesLoading
            ? "Loading prepared demo questions."
            : "Prepared demo questions. The list scrolls on its own and pauses while a question has keyboard focus."
        }
        data-paused={tickerPaused ? "true" : undefined}
        className="public-chat-ticker -mx-1 px-1 pb-1"
      >
        <div
          className="public-chat-ticker-track flex w-max gap-2 py-0.5"
          style={
            {
              "--public-chat-ticker-duration": `${tickerDurationSeconds}s`,
            } as React.CSSProperties
          }
        >
          {presets.map((preset) => renderPill(preset, false))}
          {presets.map((preset) => renderPill(preset, true))}
        </div>
      </div>
    );
  };

  const chipActive =
    runStatus === "running" ||
    runStatus === "completed" ||
    Boolean(selectedPreset);

  return (
    <section
      id={id}
      className="relative scroll-mt-24 bg-background px-4 pb-12 sm:px-6 lg:px-8 lg:pb-16"
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0,transparent_23px,var(--border)_24px)] bg-[length:100%_24px] opacity-20" />

      <div className="relative mx-auto max-w-5xl">
        <PhoneDemoFrame label="Interactive phone preview of Flaim Fantasy in ChatGPT">
          <DialogPrimitive.Root
            open={educationPanel !== null}
            onOpenChange={(open) => {
              if (!open) {
                setEducationPanel(null);
              }
            }}
          >
          <div
            ref={setPhonePanelContainer}
            className="relative flex h-full min-h-0 flex-col bg-[var(--phone-screen)] text-[var(--phone-text)]"
          >
            <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-1.5 px-3 pb-3 pt-11 min-[350px]:gap-2 min-[350px]:px-4">
              <button
                type="button"
                onClick={(event) =>
                  openEducationPanel("about", event.currentTarget)
                }
                aria-label="About this demo"
                aria-haspopup="dialog"
                aria-expanded={educationPanel === "about"}
                className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[var(--phone-border)] bg-[var(--phone-panel)] text-[var(--phone-text)] transition-[background-color,box-shadow,transform] hover:-translate-y-0.5 hover:bg-[var(--phone-panel-strong)] hover:shadow-sm active:translate-y-0 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--phone-accent)]"
              >
                <Menu className="h-5 w-5" />
              </button>

              <div
                className="inline-flex min-w-0 items-center overflow-hidden rounded-full border border-[var(--phone-border)] bg-[var(--phone-panel)] p-0.5 text-[length:var(--phone-type-control)] font-medium"
                role="group"
                aria-label="Demo platform"
              >
                {platformOptions.map((option) => (
                  <button
                    key={option.platform}
                    type="button"
                    disabled={!option.available}
                    aria-pressed={option.selected}
                    aria-label={
                      option.available
                        ? `${option.label} demo`
                        : `${option.label} demo coming soon`
                    }
                    onClick={() => handleSelectPlatform(option.platform)}
                    className={cn(
                      "h-11 min-w-0 flex-1 rounded-full px-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--phone-accent)]",
                      option.selected
                        ? "bg-[var(--phone-panel-strong)] text-[var(--phone-text)]"
                        : "text-[var(--phone-muted)]",
                      option.available
                        ? "cursor-pointer"
                        : "cursor-not-allowed opacity-45",
                    )}
                  >
                    {option.label}
                  </button>
                ))}
              </div>

              <button
                type="button"
                onClick={(event) =>
                  openEducationPanel("sport", event.currentTarget)
                }
                aria-label={`Demo sport: ${PUBLIC_SPORT_COPY[demoSport].label}`}
                aria-haspopup="dialog"
                aria-expanded={educationPanel === "sport"}
                className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[var(--phone-border)] bg-[var(--phone-panel)] text-[var(--phone-text)] transition-[background-color,box-shadow,transform] hover:-translate-y-0.5 hover:bg-[var(--phone-panel-strong)] hover:shadow-sm active:translate-y-0 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--phone-accent)]"
              >
                {PUBLIC_SPORT_COPY[demoSport].icon}
              </button>
            </div>

            <div role="status" aria-live="polite" className="sr-only">
              {liveAnnouncement}
            </div>

            {/* Separate region so an automatic sport switch is announced
                without competing with the run-status line above. */}
            <div role="status" aria-live="polite" className="sr-only">
              {sportTransitionAnnouncement}
            </div>

            <div
              ref={transcriptScrollRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-auto px-4 pb-5 pt-2"
            >
              <div className="mx-auto flex flex-col gap-5">
                {!selectedPreset && runStatus === "idle" ? (
                  <IdleState platformLabel={demoTarget.platformLabel} />
                ) : null}

                {selectedPreset ? (
                  <PublicMessage
                    role="user"
                    text={selectedPreset.userMessage}
                  />
                ) : null}

                {selectedPreset ? (
                  <div className="flex items-center gap-2 pt-1 text-[length:var(--phone-type-secondary)] font-medium leading-5 text-[var(--phone-muted)]">
                    <PhoneFlaimMark />
                    <span>Flaim Fantasy</span>
                  </div>
                ) : null}

                {showPreToolStatus ? (
                  <div className="flex items-center gap-2 text-[length:var(--phone-type-secondary)] leading-5 text-[var(--phone-muted)]">
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    <span>{preToolStatusCopy}</span>
                  </div>
                ) : null}

                {toolCalls.length > 0 ? (
                  <div className="space-y-2">
                    {toolCalls.map((toolCall) => (
                      <PublicToolCall
                        key={toolCall.id}
                        name={toolCall.name}
                        status={toolCall.status}
                      />
                    ))}
                  </div>
                ) : null}

                {assistantText ? (
                  <PublicMessage role="assistant" text={assistantText} />
                ) : null}

                {assistantText && runStatus === "completed" ? (
                  <div
                    className="flex items-center gap-3 text-[var(--phone-muted)]"
                    aria-hidden="true"
                  >
                    <Copy className="h-4 w-4" />
                    <Volume2 className="h-4 w-4" />
                    <ThumbsUp className="h-4 w-4" />
                    <Share className="h-4 w-4" />
                    <MoreHorizontal className="h-4 w-4" />
                  </div>
                ) : null}

                {runStatus === "completed" ? (
                  <div className="space-y-2 pt-2 text-center text-[length:var(--phone-type-caption)] leading-[1.45] text-[var(--phone-muted)]">
                    {answerMeta ? (
                      <div>
                        {formatRelativeUpdateTime(answerMeta.generatedAt)}
                        {answerMeta.status === "degraded"
                          ? " • showing last good answer"
                          : answerMeta.isStale
                            ? " • refresh overdue"
                            : answerMeta.isExpired
                              ? " • refreshing soon"
                              : ""}
                      </div>
                    ) : null}
                    {answerMeta?.status === "degraded" ? (
                      <div className="text-destructive">
                        Latest refresh failed.{" "}
                        {getPublicDemoFailureCopy({
                          errorCode: answerMeta.failureCode,
                          errorMessage: answerMeta.failureMessage,
                        })}
                      </div>
                    ) : null}
                    <div>
                      That&apos;s Gerry&apos;s league.{" "}
                      <Link
                        href="/leagues"
                        className="font-medium text-[var(--phone-text)] underline underline-offset-4"
                      >
                        Want to connect yours?
                      </Link>
                    </div>
                  </div>
                ) : null}

                {runStatus === "error" ? (
                  <div
                    role="alert"
                    className="rounded-[1.4rem] border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                  >
                    <div className="font-semibold">Demo answer unavailable</div>
                    <p className="mt-2 leading-6">
                      {error || "Unknown public chat error."}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="border-t border-[var(--phone-border)] bg-[var(--phone-screen)] px-3 pb-4 pt-3">
              {renderPromptTicker(visiblePresets)}

              <div className="mx-2 mb-1 mt-2 flex items-center gap-1.5 rounded-[1.75rem] border border-[var(--phone-border)] bg-[var(--phone-panel)] p-1.5">
                <button
                  type="button"
                  onClick={(event) =>
                    openEducationPanel("drawer", event.currentTarget)
                  }
                  aria-label="How to add Flaim in ChatGPT"
                  aria-haspopup="dialog"
                  aria-expanded={educationPanel === "drawer"}
                  className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-[var(--phone-text)] transition-[background-color,transform] hover:-translate-y-0.5 hover:bg-[var(--phone-panel-strong)] active:translate-y-0 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--phone-accent)]"
                >
                  <Plus className="h-5 w-5" />
                </button>

                <span className="min-w-0 flex-1 truncate text-[length:var(--phone-type-body)] leading-5 text-[var(--phone-muted)]">
                  {selectedPreset ? "Follow up" : "Ask Chat…"}
                </span>

                <button
                  type="button"
                  onClick={(event) =>
                    openEducationPanel("activation", event.currentTarget)
                  }
                  aria-label="What the Flaim badge means"
                  aria-haspopup="dialog"
                  aria-expanded={educationPanel === "activation"}
                  className={cn(
                    "inline-flex h-11 shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-[length:var(--phone-type-caption)] font-medium transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-sm active:translate-y-0 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--phone-accent)]",
                    chipActive
                      ? "public-chat-chip-active border-[var(--phone-accent)] bg-[var(--phone-accent)] text-[var(--phone-accent-text)]"
                      : "border-[var(--phone-border)] bg-[var(--phone-panel-strong)] text-[var(--phone-text)]",
                  )}
                >
                  <PhoneFlaimMark size={16} />
                  <span className="hidden min-[370px]:inline">Flaim</span>
                </button>

                <button
                  type="button"
                  onClick={(event) =>
                    openEducationPanel("ask", event.currentTarget)
                  }
                  className={cn(
                    "inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[var(--phone-text)] text-[var(--phone-screen)] transition-[box-shadow,transform] hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--phone-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--phone-screen)]",
                    runStatus === "running" ? "public-chat-send-running" : "",
                  )}
                  aria-label="Why the public demo uses prepared prompts"
                  aria-haspopup="dialog"
                  aria-expanded={educationPanel === "ask"}
                >
                  {runStatus === "running" ? (
                    <LoaderCircle className="h-4.5 w-4.5 animate-spin" />
                  ) : (
                    <ArrowUp className="h-4.5 w-4.5" />
                  )}
                </button>
              </div>
            </div>
          </div>
          <PhoneEducationPanel
            container={phonePanelContainer}
            demoTarget={demoTarget}
            sportOptions={sportOptions}
            onSelectSport={handleSelectSport}
            panel={educationPanel}
            onPanelChange={setEducationPanel}
            returnFocusRef={educationTriggerRef}
          />
          </DialogPrimitive.Root>
        </PhoneDemoFrame>

      </div>
    </section>
  );
}
