"use client";
import { Card } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  PUBLIC_CHAT_PRESETS,
  type PublicChatDemoSport,
  type PublicChatPreset,
  type PublicChatPresetId,
} from "@/lib/public-chat";
import { cn } from "@/lib/utils";
import { IconBallBaseball, IconBallAmericanFootball } from "@tabler/icons-react";
import { ArrowUp, LoaderCircle, Plus } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PublicMessage } from "./public-message";
import { PublicToolCall } from "./public-tool-call";

type PublicRunStatus = "idle" | "running" | "completed" | "error";
type PublicDemoAnswerMeta = {
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
};

interface PublicToolCallState {
  id: string;
  name?: string | null;
  status: "in_progress" | "completed";
}

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

const PUBLIC_SPORT_COPY: Record<
  PublicChatDemoSport,
  { icon: React.ReactNode; label: string }
> =
  {
    baseball: { icon: <IconBallBaseball className="h-4 w-4" stroke={1.5} />, label: "baseball" },
    football: { icon: <IconBallAmericanFootball className="h-4 w-4" stroke={1.5} />, label: "football" },
  };

function getEasternMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);

  const month = Number(parts.find((part) => part.type === "month")?.value);

  return { month };
}

function getDefaultPublicSport(now = new Date()): PublicChatDemoSport {
  const { month } = getEasternMonth(now);
  return month >= 2 && month <= 9 ? "baseball" : "football";
}

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

export function PublicChatExperience({
  initialPresetId = null,
  id,
  followTranscript = true,
}: {
  initialPresetId?: string | null;
  id?: string;
  followTranscript?: boolean;
}) {
  const [runStatus, setRunStatus] = useState<PublicRunStatus>("idle");
  const [selectedPresetId, setSelectedPresetId] =
    useState<PublicChatPresetId | null>(null);
  const [assistantText, setAssistantText] = useState("");
  const [toolCalls, setToolCalls] = useState<PublicToolCallState[]>([]);
  const [answerMeta, setAnswerMeta] = useState<PublicDemoAnswerMeta | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
  const activeRunAbortControllerRef = useRef<AbortController | null>(null);
  const autoRunPresetIdRef = useRef<PublicChatPresetId | null>(null);
  const demoSport = useMemo<PublicChatDemoSport>(() => getDefaultPublicSport(), []);
  const [preToolStatusIndex, setPreToolStatusIndex] = useState(0);

  const selectedPreset = useMemo(
    () =>
      selectedPresetId
        ? (PUBLIC_CHAT_PRESETS.find(
            (preset) => preset.id === selectedPresetId,
          ) ?? null)
        : null,
    [selectedPresetId],
  );
  const hasAssistantText = assistantText.trim().length > 0;
  const showPreToolStatus =
    runStatus === "running" && !hasAssistantText && toolCalls.length === 0;
  const preToolStatusCopy =
    PUBLIC_PRE_TOOL_STEPS[preToolStatusIndex]?.label ?? "Thinking...";
  const topRailPresets = useMemo(() => {
    const presets = PUBLIC_CHAT_PRESETS.filter(
      (preset) => preset.rail === "top",
    );
    return presets.length ? presets : PUBLIC_CHAT_PRESETS;
  }, []);
  const bottomRailPresets = useMemo(() => {
    const presets = PUBLIC_CHAT_PRESETS.filter(
      (preset) => preset.rail === "bottom",
    );
    return presets.length ? presets : PUBLIC_CHAT_PRESETS;
  }, []);
  const initialQueryPreset = useMemo(
    () =>
      initialPresetId
        ? (PUBLIC_CHAT_PRESETS.find(
            (preset) => preset.id === initialPresetId,
          ) ?? null)
        : null,
    [initialPresetId],
  );

  useEffect(() => {
    if (!followTranscript || !transcriptScrollRef.current) {
      return;
    }

    const scrollContainer = transcriptScrollRef.current;
    const nextBehavior: ScrollBehavior =
      assistantText.trim().length > 0 || toolCalls.length > 0 ? "smooth" : "auto";
    const frame = window.requestAnimationFrame(() => {
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

  const handleRunPreset = useCallback(
    async (preset: PublicChatPreset) => {
      if (runStatus === "running") {
        return;
      }

      setSelectedPresetId(preset.id);
      setRunStatus("running");
      setAssistantText("");
      setToolCalls([]);
      setAnswerMeta(null);
      setError(null);
      setPreToolStatusIndex(0);
      activeRunAbortControllerRef.current?.abort();
      const abortController = new AbortController();
      activeRunAbortControllerRef.current = abortController;

      try {
        const query = new URLSearchParams({
          presetId: preset.id,
          sport: demoSport,
        });
        const response = await fetch(`/api/public-chat/cache?${query.toString()}`, {
          method: "GET",
          cache: "no-store",
          signal: abortController.signal,
        });

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
          setPreToolStatusIndex(index);
          await waitFor(PUBLIC_PRE_TOOL_STEPS[index].durationMs, abortController.signal);
        }

        for (let index = 0; index < simulatedToolNames.length; index += 1) {
          const toolName = simulatedToolNames[index];
          const toolCallId = `${toolName}-${index}`;

          setToolCalls((current) => [
            ...current,
            {
              id: toolCallId,
              name: toolName,
              status: "in_progress",
            },
          ]);
          await waitFor(PUBLIC_TOOL_CARD_IN_PROGRESS_MS, abortController.signal);
          setToolCalls((current) =>
            current.map((toolCall) =>
              toolCall.id === toolCallId
                ? { ...toolCall, status: "completed" }
                : toolCall,
            ),
          );
          await waitFor(PUBLIC_TOOL_CARD_COMPLETED_PAUSE_MS, abortController.signal);
        }

        setAnswerMeta(nextAnswerMeta);
        setAssistantText(payload.answer.text);
        setRunStatus("completed");
      } catch (runError) {
        if (abortController.signal.aborted) {
          setRunStatus((current) => (current === "running" ? "idle" : current));
          return;
        }

        const message =
          runError instanceof Error
            ? runError.message
            : "Unable to run the public chat demo.";
        setError(message);
        setRunStatus("error");
      } finally {
        if (activeRunAbortControllerRef.current === abortController) {
          activeRunAbortControllerRef.current = null;
        }
      }
    },
    [demoSport, runStatus],
  );

  useEffect(() => {
    if (!initialQueryPreset) {
      return;
    }

    if (autoRunPresetIdRef.current === initialQueryPreset.id) {
      return;
    }

    autoRunPresetIdRef.current = initialQueryPreset.id;
    void handleRunPreset(initialQueryPreset);
  }, [handleRunPreset, initialQueryPreset]);

  const renderPromptTicker = (
    presets: readonly PublicChatPreset[],
    speedClassName: string,
  ) => {
    const repeatedPresets = [...presets, ...presets];

    return (
      <div className="-mx-1 overflow-hidden px-1">
        <div
          className={cn(
            "public-chat-ticker-track flex w-max gap-2 py-0.5 sm:gap-2.5",
            speedClassName,
            runStatus === "running" ? "public-chat-ticker-track--paused" : "",
          )}
        >
          {repeatedPresets.map((preset, index) => {
            const isSelected = preset.id === selectedPresetId;

            return (
              <button
                key={`${preset.id}-${index}`}
                type="button"
                onClick={() => void handleRunPreset(preset)}
                disabled={runStatus === "running"}
                aria-pressed={isSelected}
                className={cn(
                  "group relative w-max max-w-none overflow-hidden rounded-full border px-3 py-2 text-left transition-all duration-200 sm:px-4",
                  isSelected
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border/70 bg-background text-foreground hover:bg-muted",
                  runStatus === "running" && !isSelected
                    ? "cursor-not-allowed opacity-65"
                    : "",
                )}
              >
                <div className="relative">
                  <h3
                    className={cn(
                      "whitespace-nowrap text-[0.76rem] font-medium leading-none tracking-tight sm:text-[0.84rem]",
                      isSelected ? "text-primary" : "text-foreground",
                    )}
                  >
                    {preset.title}
                  </h3>
                </div>
              </button>
            );
          })}
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
      className="relative bg-background px-4 pb-12 sm:px-6 lg:px-8 lg:pb-16"
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0,transparent_23px,var(--border)_24px)] bg-[length:100%_24px] opacity-20" />

      <div className="relative mx-auto max-w-2xl">
        <Card className="overflow-hidden rounded-[2rem] border-border/70 bg-card/95 p-0 shadow-[0_30px_90px_-42px_rgba(15,23,42,0.45)] backdrop-blur dark:shadow-[0_30px_90px_-42px_rgba(0,0,0,0.82)] sm:rounded-[2.3rem]">
          <div className="border-b border-border/70 bg-card px-4 py-3 sm:px-5">
            <div className="flex items-center justify-between gap-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                App demo
              </div>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Show demo context"
                    className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground transition-colors hover:bg-muted"
                  >
                    <span className="leading-none" aria-hidden="true">
                      {PUBLIC_SPORT_COPY[demoSport].icon}
                    </span>
                    <span>ESPN</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="end"
                  className="w-[18.5rem] rounded-2xl border-border p-4 text-sm leading-6"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    Demo context
                  </div>
                  <p className="mt-2 text-foreground">
                    These answers refresh from Gerry&apos;s real ESPN{" "}
                    {PUBLIC_SPORT_COPY[demoSport].label} league.
                  </p>
                  <p className="mt-2 text-muted-foreground">
                    Flaim supports ESPN and Yahoo across football, baseball,
                    basketball, and hockey, plus Sleeper for football and
                    basketball.
                  </p>
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.08),transparent_40%),linear-gradient(to_bottom,rgba(248,250,252,0.98),rgba(241,245,249,0.78))] dark:bg-[radial-gradient(circle_at_top,rgba(96,165,250,0.16),transparent_42%),linear-gradient(to_bottom,rgba(17,24,39,0.98),rgba(3,7,18,0.94))]">
            <div
              ref={transcriptScrollRef}
              className="h-[24rem] overflow-y-auto overscroll-contain px-3 py-4 sm:h-[32rem] sm:px-4 sm:py-5"
            >
              <div className="mx-auto flex max-w-2xl flex-col gap-4">
                {!selectedPreset && runStatus === "idle" ? (
                  <div className="flex min-h-[12rem] flex-1 flex-col items-center justify-end pb-4">
                    <p className="text-3xl font-bold tracking-tight text-foreground/80 sm:text-4xl">
                      Pick something
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Real answers from Gerry&apos;s ESPN league
                    </p>
                    <IconBallBaseball className="mt-4 h-7 w-7 text-foreground/70" stroke={1.5} aria-hidden />
                    <span className="mt-1 text-lg text-muted-foreground/60" aria-hidden>
                      ↓
                    </span>
                  </div>
                ) : null}

                {selectedPreset ? (
                  <PublicMessage
                    role="user"
                    text={selectedPreset.userMessage}
                  />
                ) : null}

                {showPreToolStatus ? (
                  <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
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

                {runStatus === "completed" ? (
                  <div className="space-y-2 px-1 pt-2 text-center text-sm text-muted-foreground">
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
                        className="text-primary hover:underline"
                      >
                        Want to connect yours?
                      </Link>
                    </div>
                  </div>
                ) : null}

                {runStatus === "error" ? (
                  <div className="rounded-[1.75rem] border border-destructive/30 bg-destructive/5 px-5 py-4 text-sm text-destructive">
                    <div className="font-semibold">Demo answer unavailable</div>
                    <p className="mt-2 leading-6">
                      {error || "Unknown public chat error."}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="border-t border-border/70 bg-card/95 p-3 sm:p-4">
              <div className="mx-auto max-w-2xl">
                <div className="rounded-[1.9rem] border border-border bg-background p-3 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.5)] sm:rounded-[2.2rem] sm:p-4">
                  <div className="space-y-2">
                    {renderPromptTicker(
                      topRailPresets,
                      "public-chat-ticker-track--top",
                    )}
                    {renderPromptTicker(
                      bottomRailPresets,
                      "public-chat-ticker-track--bottom",
                    )}
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            aria-label="Show how Flaim appears in AI app drawers"
                            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-colors hover:bg-muted"
                          >
                            <Plus className="h-4.5 w-4.5" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          side="top"
                          className="w-[18rem] rounded-2xl border-border p-4 text-sm leading-6"
                        >
                          <p className="text-foreground">
                            Adding and authenticating Flaim to your chatbot puts
                            it in this drawer.
                          </p>
                        </PopoverContent>
                      </Popover>
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className={cn(
                              "inline-flex h-10 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors",
                              chipActive
                                ? "public-chat-chip-active border-primary/30 bg-primary/10 text-primary"
                                : "border-border bg-background text-foreground",
                            )}
                          >
                            <Image
                              src="/flaim-mark-hero.png"
                              alt=""
                              width={16}
                              height={16}
                              className="dark:hidden"
                            />
                            <Image
                              src="/flaim-mark-hero-dark.png"
                              alt=""
                              width={16}
                              height={16}
                              className="hidden dark:block"
                            />
                            <span>Flaim Fantasy</span>
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          side="top"
                          className="w-[19rem] rounded-2xl border-border p-4 text-sm leading-6"
                        >
                          <p className="text-foreground">
                            Some AIs activate Flaim automatically. For others,
                            activate Flaim manually in your drawer and
                            you&apos;ll see a badge here.
                          </p>
                        </PopoverContent>
                      </Popover>
                    </div>

                    <div className="flex items-center">
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className={cn(
                              "inline-flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-transform",
                              runStatus === "running"
                                ? "public-chat-send-running"
                                : "",
                            )}
                            aria-label="Run selected prompt"
                          >
                            {runStatus === "running" ? (
                              <LoaderCircle className="h-4.5 w-4.5 animate-spin" />
                            ) : (
                              <ArrowUp className="h-4.5 w-4.5" />
                            )}
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="end"
                          side="top"
                          className="w-[19rem] rounded-2xl border-border p-4 text-sm leading-6"
                        >
                          <p className="text-foreground">
                            This demo shows recently refreshed answers from
                            Gerry&apos;s actual league. Set up Flaim to ask
                            Claude, ChatGPT, or Perplexity about your own
                            leagues.
                          </p>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </div>
    </section>
  );
}
