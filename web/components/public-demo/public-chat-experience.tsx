"use client";
import {
  PhoneDemoFrame,
  PhoneFlaimMark,
} from "@/components/site/phone-demo-frame";
import { SportIcon } from "@/components/site/sport-icon";
import {
  getPublicChatStepStatusLabel,
  type PublicChatDemoPlatform,
  type PublicChatDemoSport,
  type PublicChatPreset,
  type PublicChatStepName,
} from "@/lib/public-chat";
import {
  INITIAL_PUBLIC_DEMO_STATE,
  PUBLIC_DEMO_PLATFORM_LABELS,
  PUBLIC_DEMO_SPORT_LABELS,
  buildPublicChatStepSequence,
  buildPublicDemoCacheRequestUrl,
  buildPublicDemoSportMenuRows,
  canStartPublicDemoRun,
  loadPublicDemoCapabilities,
  publicDemoReducer,
  selectPublicDemoPlatformOptions,
  selectPublicDemoRequestPlatform,
  selectPublicDemoSportOptions,
  selectPublicDemoVisiblePresets,
  type PublicDemoAnswerMeta,
  type PublicDemoToolTraceSummary,
} from "@/lib/public-demo-client";
import { cn } from "@/lib/utils";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import {
  ArrowUp,
  ChevronRight,
  Copy,
  Globe,
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

type PublicDemoRefreshFailure = {
  status?: string;
  errorCode?: string | null;
  errorMessage?: string | null;
};

/** Simulated "thinking" phase before the first status-line step appears. */
const PUBLIC_CHAT_THINKING_DURATION_MS = 1200;
/** How long each status-line step (a tool, or web search) stays on screen. */
const PUBLIC_CHAT_STEP_DURATION_MS = 860;
/** Seconds of ticker travel per prepared question; ~45px/s at pill width. */
const PUBLIC_PROMPT_TICKER_SECONDS_PER_PROMPT = 4;

const PUBLIC_SPORT_COPY: Record<
  PublicChatDemoSport,
  { icon: React.ReactNode }
> = {
  baseball: { icon: <SportIcon sport="baseball" className="h-5 w-5" /> },
  football: { icon: <SportIcon sport="football" className="h-5 w-5" /> },
  hockey: { icon: <SportIcon sport="hockey" className="h-5 w-5" /> },
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

function IdleState({
  platformLabel,
  sportSwitchNote,
}: {
  platformLabel: string;
  sportSwitchNote: string;
}) {
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
      {/* Visible explanation for an automatic sport switch. The sr-only
          region elsewhere announces the same event to assistive tech, so
          this copy is hidden from it to avoid a duplicate announcement. */}
      {sportSwitchNote ? (
        <p
          aria-hidden
          className="mt-2 max-w-[16rem] text-[length:var(--phone-type-caption)] leading-[1.4] text-[var(--phone-muted)]"
        >
          {sportSwitchNote}
        </p>
      ) : null}
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

/* ------------------------------------------------------------------ */
/*  Off-platform preview — tapping an unavailable platform chip shows  */
/*  this in place of the transcript instead of a disabled chip.        */
/* ------------------------------------------------------------------ */

function PausedPlatformState({
  platform,
}: {
  platform: PublicChatDemoPlatform;
}) {
  const platformLabel = PUBLIC_DEMO_PLATFORM_LABELS[platform];
  // Only Yahoo's pause is caused by a third-party API access restriction;
  // every other platform's copy stays neutral about the actual cause (e.g.
  // Sleeper falling back to legacy mode after a capabilities failure).
  const description =
    platform === "yahoo"
      ? `Previews will return as soon as ${platformLabel} restores third-party API access.`
      : `The ${platformLabel} demo isn't available right now.`;

  return (
    <div className="flex min-h-[15rem] flex-1 flex-col items-center justify-center px-4 text-center">
      <p className="text-[clamp(1.125rem,6.1cqw,1.3rem)] font-semibold leading-tight tracking-[-0.025em] text-[var(--phone-text)]">
        {platformLabel} demo is paused
      </p>
      <p className="mt-2 max-w-[16rem] text-[length:var(--phone-type-secondary)] leading-[1.4] text-[var(--phone-muted)]">
        {description}
      </p>
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
    runStatus,
    selectedPresetId,
    sportSwitchNote,
    sportTransitionAnnouncement,
    toolCalls,
  } = state;
  // Single generator for run tokens. Every async run and every target change
  // takes the next value; the reducer drops actions whose token went stale.
  const runTokenRef = useRef(0);
  const [educationPanel, setEducationPanel] =
    useState<PhoneEducationPanelId | null>(null);
  // Pure view state: previewing an unavailable platform's paused copy in the
  // phone. Never touches the reducer — the real demo target is untouched.
  const [offPlatformPreview, setOffPlatformPreview] =
    useState<PublicChatDemoPlatform | null>(null);
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
  // The collapsed "Used Flaim Fantasy" disclosure line just above the landed
  // answer. The scroll effect below targets this instead of the bottom of
  // the transcript, so a long answer's first line isn't cut off on landing.
  const answerAnchorRef = useRef<HTMLDivElement | null>(null);
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
    }),
    [state.platform],
  );
  // Tapping the sport button opens a dropdown listing all four sports; rows
  // for sports the current platform doesn't advertise (or basketball, which
  // never ships in the demo) render grayed and unselectable.
  const currentSportOption = sportOptions.find((option) => option.selected);
  const currentSportLabel =
    currentSportOption?.label ?? PUBLIC_DEMO_SPORT_LABELS[demoSport];
  const sportButtonAriaLabel = `Change sport, current: ${currentSportLabel}`;
  const sportMenuRows = useMemo(
    () => buildPublicDemoSportMenuRows(sportOptions),
    [sportOptions],
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
  // The status line shows while a run is in flight and no answer text has
  // landed yet: first the simulated "Thinking" phase (no tool call started),
  // then whichever step is currently `in_progress`.
  const activeStatusStep = toolCalls.find(
    (toolCall) => toolCall.status === "in_progress",
  );
  const showStatusLine = runStatus === "running" && !hasAssistantText;
  const isWebSearchStep = activeStatusStep?.name === "web_search";
  const statusLineLabel = activeStatusStep
    ? getPublicChatStepStatusLabel(activeStatusStep.name as PublicChatStepName)
    : "Thinking";
  // Single polite live region announcing coarse phases only — not every
  // individual tool step, since the text only changes when the phase does:
  // "Thinking" while no step has started, "Using Flaim Fantasy" for the
  // whole run of Flaim tool steps, "Searching the web" for that step, then
  // the ready/freshness line on completion. Errors announce via role="alert".
  const liveAnnouncement =
    runStatus === "running"
      ? !activeStatusStep
        ? "Thinking"
        : isWebSearchStep
          ? "Searching the web"
          : "Using Flaim Fantasy"
      : runStatus === "completed"
        ? answerMeta
          ? `Answer ready. ${formatRelativeUpdateTime(answerMeta.generatedAt)}`
          : "Answer ready"
        : "";
  // Announces when an unavailable platform chip opens the paused-state
  // overlay in the transcript.
  const pausedAnnouncement = offPlatformPreview
    ? `${PUBLIC_DEMO_PLATFORM_LABELS[offPlatformPreview]} demo is paused.`
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
      const nextBehavior: ScrollBehavior = prefersReducedMotion
        ? "auto"
        : "smooth";

      // Once the answer has landed, scroll so its start — the "Used Flaim
      // Fantasy" disclosure line directly above it — sits at the top of the
      // visible transcript. Landing at the bottom instead (the general case
      // below) cuts off a long answer's first line.
      const answerAnchor =
        runStatus === "completed" && assistantText.trim().length > 0
          ? answerAnchorRef.current
          : null;
      if (answerAnchor) {
        const containerRect = scrollContainer.getBoundingClientRect();
        const anchorRect = answerAnchor.getBoundingClientRect();
        const nextScrollTop =
          scrollContainer.scrollTop + (anchorRect.top - containerRect.top);
        scrollContainer.scrollTo({
          top: Math.max(nextScrollTop, 0),
          behavior: nextBehavior,
        });
        return;
      }

      scrollContainer.scrollTo({
        top: scrollContainer.scrollHeight,
        behavior:
          !prefersReducedMotion &&
          (assistantText.trim().length > 0 || toolCalls.length > 0)
            ? "smooth"
            : "auto",
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

  // A chip tapped while unavailable can become available later (capabilities
  // resolving, or any future availability change). Clear the preview instead
  // of letting it linger over an now-available platform.
  useEffect(() => {
    if (!offPlatformPreview) {
      return;
    }

    const previewedOption = platformOptions.find(
      (option) => option.platform === offPlatformPreview,
    );
    if (previewedOption?.available) {
      setOffPlatformPreview(null);
    }
  }, [offPlatformPreview, platformOptions]);

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
        const stepSequence = buildPublicChatStepSequence(
          preset,
          payload.answer.toolTraceSummary,
        );

        // Simulated "Thinking" phase: no tool call has started yet, so the
        // status line shows the static "Thinking" copy.
        dispatch({ type: "pre_tool_step_advanced", index: 0, token });
        await waitFor(PUBLIC_CHAT_THINKING_DURATION_MS, abortController.signal);

        for (let index = 0; index < stepSequence.length; index += 1) {
          const stepName = stepSequence[index];
          const toolCallId = `${stepName}-${index}`;

          dispatch({
            type: "tool_call_started",
            toolCall: {
              id: toolCallId,
              name: stepName,
              status: "in_progress",
            },
            token,
          });
          await waitFor(PUBLIC_CHAT_STEP_DURATION_MS, abortController.signal);
          dispatch({ type: "tool_call_completed", toolCallId, token });
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
                className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[var(--phone-border)] bg-[var(--phone-panel)] text-[var(--phone-text)] transition-[background-color,box-shadow,transform] hover:bg-[var(--phone-panel-strong)] hover:shadow-sm active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--phone-accent)]"
              >
                <Menu className="h-5 w-5" />
              </button>

              <div
                className="inline-flex min-w-0 items-center overflow-hidden rounded-full border border-[var(--phone-border)] bg-[var(--phone-panel)] p-0.5 text-[length:var(--phone-type-control)] font-medium"
                role="group"
                aria-label="Demo platform"
              >
                {platformOptions.map((option) => {
                  // While an off-platform preview is active it takes over the
                  // filled "selected" look from the real selection, so the
                  // paused platform reads as the one currently shown.
                  const showAsSelected = offPlatformPreview
                    ? offPlatformPreview === option.platform
                    : option.selected;

                  return (
                    <button
                      key={option.platform}
                      type="button"
                      aria-pressed={showAsSelected}
                      aria-label={
                        option.available
                          ? `${option.label} demo`
                          : `${option.label} demo paused`
                      }
                      onClick={() => {
                        if (option.available) {
                          setOffPlatformPreview(null);
                          handleSelectPlatform(option.platform);
                        } else if (!capabilitiesLoading) {
                          // While capabilities are still loading, "available"
                          // hasn't settled yet — ignore the tap instead of
                          // showing a paused preview that may immediately be
                          // stale once the real answer arrives.
                          setOffPlatformPreview(option.platform);
                        }
                      }}
                      className={cn(
                        "inline-flex h-11 min-w-0 flex-1 cursor-pointer items-center justify-center rounded-full px-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--phone-accent)]",
                        showAsSelected
                          ? "bg-[var(--phone-panel-strong)] text-[var(--phone-text)]"
                          : option.available
                            ? "text-[var(--phone-text)] hover:bg-[var(--phone-panel-strong)]/60"
                            : "text-[var(--phone-muted)] opacity-60 hover:bg-[var(--phone-panel-strong)]/60",
                      )}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>

              {/* Non-modal so the page can still scroll: the menu always
                  drops down inside the phone, and on a short viewport its
                  last rows can sit below the fold. */}
              <DropdownMenuPrimitive.Root modal={false}>
                <DropdownMenuPrimitive.Trigger asChild>
                  <button
                    type="button"
                    aria-label={sportButtonAriaLabel}
                    className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[var(--phone-border)] bg-[var(--phone-panel)] text-[var(--phone-text)] transition-[background-color,box-shadow,transform] hover:bg-[var(--phone-panel-strong)] hover:shadow-sm active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--phone-accent)]"
                  >
                    {PUBLIC_SPORT_COPY[demoSport].icon}
                  </button>
                </DropdownMenuPrimitive.Trigger>
                <DropdownMenuPrimitive.Portal container={phonePanelContainer}>
                  <DropdownMenuPrimitive.Content
                    side="bottom"
                    align="end"
                    sideOffset={8}
                    avoidCollisions={false}
                    className="z-50 flex w-max items-center gap-1 rounded-full border border-[var(--phone-border)] bg-[var(--phone-panel)] p-1.5 text-[var(--phone-text)] shadow-[0_18px_40px_-16px_rgba(0,0,0,0.45)] outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-1 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1"
                  >
                    {/* Icon-only row, mirroring the platform selector's pill:
                        a filled bg-[var(--phone-panel-strong)] tile marks the
                        current sport instead of a check mark or label. A
                        radio group so assistive tech hears which sport is
                        current (menuitemradio + aria-checked) even though
                        there's no visible text; each icon gets its own
                        aria-label since it's the row's only content. */}
                    <DropdownMenuPrimitive.RadioGroup
                      value={demoSport}
                      className="flex items-center gap-1"
                    >
                      {sportMenuRows.map((row) => (
                        <DropdownMenuPrimitive.RadioItem
                          key={row.sport}
                          value={row.sport}
                          disabled={!row.available}
                          aria-label={
                            row.available ? row.label : `${row.label}, not in demo`
                          }
                          onSelect={(event) => {
                            if (!row.available) {
                              event.preventDefault();
                              return;
                            }
                            handleSelectSport(row.sport as PublicChatDemoSport);
                          }}
                          className={cn(
                            "flex h-11 w-11 shrink-0 cursor-pointer select-none items-center justify-center rounded-full outline-none transition-colors",
                            row.selected
                              ? "bg-[var(--phone-panel-strong)] text-[var(--phone-text)]"
                              : row.available
                                ? "text-[var(--phone-text)] data-[highlighted]:bg-[var(--phone-panel-strong)]/60"
                                : "cursor-not-allowed text-[var(--phone-muted)] opacity-60 data-[highlighted]:bg-transparent",
                          )}
                        >
                          <SportIcon sport={row.sport} className="h-5 w-5" />
                        </DropdownMenuPrimitive.RadioItem>
                      ))}
                    </DropdownMenuPrimitive.RadioGroup>
                  </DropdownMenuPrimitive.Content>
                </DropdownMenuPrimitive.Portal>
              </DropdownMenuPrimitive.Root>
            </div>

            <div role="status" aria-live="polite" className="sr-only">
              {/* Suppressed while the paused screen hides the transcript, so
                  this region can't keep announcing run progress or "Answer
                  ready" over the paused-state announcement below. */}
              {offPlatformPreview ? "" : liveAnnouncement}
            </div>

            {/* Separate region so an automatic sport switch is announced
                without competing with the run-status line above. */}
            <div role="status" aria-live="polite" className="sr-only">
              {sportTransitionAnnouncement}
            </div>

            {/* Separate region so tapping a paused platform chip is announced
                without competing with the run-status line above. */}
            <div role="status" aria-live="polite" className="sr-only">
              {pausedAnnouncement}
            </div>

            <div
              ref={transcriptScrollRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-auto px-4 pb-5 pt-2"
            >
              <div className="mx-auto flex flex-col gap-5">
                {offPlatformPreview ? (
                  <PausedPlatformState platform={offPlatformPreview} />
                ) : (
                  <>
                    {!selectedPreset && runStatus === "idle" ? (
                      <IdleState
                        platformLabel={demoTarget.platformLabel}
                        sportSwitchNote={sportSwitchNote}
                      />
                    ) : null}

                    {selectedPreset ? (
                      <PublicMessage
                        role="user"
                        text={selectedPreset.userMessage}
                      />
                    ) : null}

                    {/* One plain-text status line, no card: swaps between
                        "Thinking" and each simulated tool/web-search step in
                        place, with a shimmer sweep (static under reduced
                        motion; see .public-chat-status-shimmer). */}
                    {showStatusLine ? (
                      <div className="flex items-center gap-2 pt-1 text-[length:var(--phone-type-secondary)] leading-5">
                        {activeStatusStep ? (
                          isWebSearchStep ? (
                            <Globe
                              className="h-4 w-4 shrink-0 text-[var(--phone-muted)]"
                              aria-hidden="true"
                            />
                          ) : (
                            <span
                              className="inline-flex h-4 w-4 shrink-0 items-center justify-center"
                              aria-hidden="true"
                            >
                              <PhoneFlaimMark size={14} />
                            </span>
                          )
                        ) : null}
                        <span className="public-chat-status-shimmer">
                          {statusLineLabel}
                        </span>
                      </div>
                    ) : null}

                    {/* Once the answer lands, the status line is replaced by
                        this muted, collapsed disclosure of the raw tool
                        names that ran. It's also the scroll anchor: see the
                        transcript-scroll effect above. */}
                    {assistantText && runStatus === "completed" ? (
                      <div ref={answerAnchorRef} className="pt-1">
                        <details className="group w-fit">
                          <summary className="-mx-1 flex w-fit cursor-pointer list-none items-center gap-1.5 rounded-full px-1 py-0.5 text-[length:var(--phone-type-caption)] text-[var(--phone-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--phone-accent)] [&::-webkit-details-marker]:hidden">
                            <PhoneFlaimMark size={14} />
                            <span>Used Flaim Fantasy</span>
                            <ChevronRight
                              className="h-3 w-3 shrink-0 transition-transform duration-200 group-open:rotate-90"
                              aria-hidden="true"
                            />
                          </summary>
                          <ul className="mt-1.5 space-y-0.5 pl-1 font-mono text-[length:var(--phone-type-control)] text-[var(--phone-muted)]">
                            {toolCalls.map((toolCall) => (
                              <li key={toolCall.id}>{toolCall.name}</li>
                            ))}
                          </ul>
                        </details>
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
                        <div className="font-semibold">
                          Demo answer unavailable
                        </div>
                        <p className="mt-2 leading-6">
                          {error || "Unknown public chat error."}
                        </p>
                      </div>
                    ) : null}
                  </>
                )}
              </div>
            </div>

            <div className="border-t border-[var(--phone-border)] bg-[var(--phone-screen)] px-3 pb-4 pt-3">
              {offPlatformPreview ? null : renderPromptTicker(visiblePresets)}

              {/* The plus and send controls each open a short "Inside
                  ChatGPT" sheet: a title and a sentence or two, no numbered
                  steps. Connector-active state now shows inline in the
                  transcript (the status line while a run is in flight, then
                  the collapsed "Used Flaim Fantasy" disclosure), not as a
                  composer badge. */}
              <div className="mx-2 mb-1 mt-2 flex items-center gap-1.5 rounded-[1.75rem] border border-[var(--phone-border)] bg-[var(--phone-panel)] p-1.5">
                <button
                  type="button"
                  onClick={(event) =>
                    openEducationPanel("drawer", event.currentTarget)
                  }
                  aria-label="How to add Flaim in ChatGPT"
                  aria-haspopup="dialog"
                  aria-expanded={educationPanel === "drawer"}
                  className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full text-[var(--phone-text)] transition-[background-color,transform] hover:bg-[var(--phone-panel-strong)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--phone-accent)]"
                >
                  <Plus className="h-5 w-5" />
                </button>

                <span className="min-w-0 flex-1 truncate text-[length:var(--phone-type-body)] leading-5 text-[var(--phone-muted)]">
                  {selectedPreset ? "Follow up" : "Ask Chat…"}
                </span>

                <button
                  type="button"
                  onClick={(event) =>
                    openEducationPanel("ask", event.currentTarget)
                  }
                  className={cn(
                    "inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-full bg-[var(--phone-text)] text-[var(--phone-screen)] transition-[box-shadow,transform] hover:shadow-md active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--phone-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--phone-screen)]",
                    runStatus === "running" ? "public-chat-send-running" : "",
                  )}
                  aria-label="How to ask in the demo"
                  aria-haspopup="dialog"
                  aria-expanded={educationPanel === "ask"}
                >
                  {runStatus === "running" ? (
                    <LoaderCircle className="h-4.5 w-4.5 motion-safe:animate-spin" />
                  ) : (
                    <ArrowUp className="h-4.5 w-4.5" />
                  )}
                </button>
              </div>
            </div>
          </div>
          <PhoneEducationPanel
            container={phonePanelContainer}
            panel={educationPanel}
            returnFocusRef={educationTriggerRef}
          />
          </DialogPrimitive.Root>
        </PhoneDemoFrame>

      </div>
    </section>
  );
}
