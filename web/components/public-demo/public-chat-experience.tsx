"use client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  PUBLIC_CHAT_PRESETS,
  type PublicChatPreset,
  type PublicChatPresetId,
} from "@/lib/public-chat";
import { cn } from "@/lib/utils";
import { parse } from "partial-json";
import {
  ArrowUp,
  LoaderCircle,
  Mic,
  Plus,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PublicToolCall } from "./public-tool-call";
import { PublicMessage } from "./public-message";

type PublicRunStatus = "idle" | "running" | "completed" | "error";
type PublicSport = "football" | "baseball";

const PUBLIC_SPORT_COPY: Record<PublicSport, { emoji: string; label: string }> = {
  baseball: { emoji: "⚾", label: "baseball" },
  football: { emoji: "🏈", label: "football" },
};

interface PublicToolCallState {
  id: string;
  name?: string | null;
  status: "in_progress" | "completed";
  arguments: string;
  parsedArguments?: Record<string, unknown>;
}

function getEasternMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
  }).formatToParts(now);

  const month = Number(parts.find((part) => part.type === "month")?.value);

  return { month };
}

function getDefaultPublicSport(now = new Date()): PublicSport {
  const { month } = getEasternMonth(now);
  return month >= 2 && month <= 9 ? "baseball" : "football";
}

function safeParseArguments(rawArguments: string) {
  if (!rawArguments.trim()) {
    return undefined;
  }

  try {
    return parse(rawArguments) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function extractToolStart(data: Record<string, unknown>) {
  const itemId = typeof data.itemId === "string" ? data.itemId : undefined;
  if (!itemId) {
    return null;
  }

  const argumentsText = typeof data.arguments === "string" ? data.arguments : "";
  return {
    id: itemId,
    name: typeof data.name === "string" ? data.name : null,
    arguments: argumentsText,
    parsedArguments: safeParseArguments(argumentsText),
  };
}

function parseSseChunk(chunk: string) {
  const dataLine = chunk
    .split("\n")
    .find((line) => line.startsWith("data: "));

  if (!dataLine) {
    return null;
  }

  try {
    return JSON.parse(dataLine.slice(6)) as {
      event: string;
      data: Record<string, unknown>;
    };
  } catch (error) {
    console.error("Failed to parse SSE chunk JSON:", error);
    return null;
  }
}

async function* readSse(
  response: Response
): AsyncGenerator<{ event: string; data: Record<string, unknown> }> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Streaming response body is missing");
  }

  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });

    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const payload = parseSseChunk(chunk);
      if (payload) {
        yield payload;
      }
    }

    if (done) {
      break;
    }
  }

  if (buffer.trim()) {
    const payload = parseSseChunk(buffer);
    if (payload) {
      yield payload;
    }
  }
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
  const [error, setError] = useState<string | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null);
  const hasStreamedAssistantTextRef = useRef(false);
  const activeRunAbortControllerRef = useRef<AbortController | null>(null);
  const autoRunPresetIdRef = useRef<PublicChatPresetId | null>(null);
  const demoSport = useMemo<PublicSport>(() => getDefaultPublicSport(), []);
  const [preToolStatusIndex, setPreToolStatusIndex] = useState(0);

  const selectedPreset = useMemo(
    () =>
      selectedPresetId
        ? PUBLIC_CHAT_PRESETS.find((preset) => preset.id === selectedPresetId) ?? null
        : null,
    [selectedPresetId]
  );
  const hasToolCalls = toolCalls.length > 0;
  const hasAssistantText = assistantText.trim().length > 0;
  const allToolCallsCompleted =
    hasToolCalls && toolCalls.every((toolCall) => toolCall.status === "completed");
  const showPreToolStatus = runStatus === "running" && !hasToolCalls;
  const showRespondingStatus =
    runStatus === "running" && allToolCallsCompleted && !hasAssistantText;
  const preToolStatusCopy = [
    "Thinking...",
    "Using Flaim Fantasy...",
    "Running live league tools...",
  ][preToolStatusIndex];
  const topRailPresets = useMemo(() => {
    const presets = PUBLIC_CHAT_PRESETS.filter((preset) => preset.rail === "top");
    return presets.length ? presets : PUBLIC_CHAT_PRESETS;
  }, []);
  const bottomRailPresets = useMemo(() => {
    const presets = PUBLIC_CHAT_PRESETS.filter((preset) => preset.rail === "bottom");
    return presets.length ? presets : PUBLIC_CHAT_PRESETS;
  }, []);
  const initialQueryPreset = useMemo(
    () =>
      initialPresetId
        ? PUBLIC_CHAT_PRESETS.find((preset) => preset.id === initialPresetId) ?? null
        : null,
    [initialPresetId]
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
  }, [assistantText, followTranscript, toolCalls.length, runStatus]);

  useEffect(() => {
    return () => {
      activeRunAbortControllerRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (runStatus !== "running" || toolCalls.length > 0) {
      setPreToolStatusIndex(0);
      return;
    }

    setPreToolStatusIndex(0);
    const pluginTimer = window.setTimeout(() => setPreToolStatusIndex(1), 800);
    const toolsTimer = window.setTimeout(() => setPreToolStatusIndex(2), 1500);

    return () => {
      window.clearTimeout(pluginTimer);
      window.clearTimeout(toolsTimer);
    };
  }, [runStatus, toolCalls.length]);

  useEffect(() => {
    void fetch("/api/public-chat/bootstrap", {
      method: "GET",
      cache: "no-store",
    }).catch(() => {
      // Prewarm is opportunistic. The live turn route still works without it.
    });
  }, []);

  const handleRunPreset = useCallback(async (preset: PublicChatPreset) => {
    if (runStatus === "running") {
      return;
    }

    setSelectedPresetId(preset.id);
    setRunStatus("running");
    setAssistantText("");
    setToolCalls([]);
    setError(null);
    hasStreamedAssistantTextRef.current = false;
    activeRunAbortControllerRef.current?.abort();
    const abortController = new AbortController();
    activeRunAbortControllerRef.current = abortController;

    try {
      const requestBody = {
        presetId: preset.id,
        sport: demoSport,
      };

      const response = await fetch("/api/public-chat/turn", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
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

      for await (const payload of readSse(response)) {
        const { event, data } = payload;

        switch (event) {
          case "reasoning_delta": {
            break;
          }
          case "tool_start": {
            const toolStart = extractToolStart(data);
            if (toolStart) {
              setToolCalls((current) => [
                ...current,
                {
                  id: toolStart.id,
                  name: toolStart.name,
                  status: "in_progress",
                  arguments: toolStart.arguments,
                  parsedArguments: toolStart.parsedArguments,
                },
              ]);
            }
            break;
          }
          case "tool_args_delta":
          case "tool_args_done": {
            const itemId =
              typeof data.itemId === "string" ? data.itemId : undefined;
            const nextArguments =
              typeof data.arguments === "string"
                ? data.arguments
                : typeof data.delta === "string"
                  ? data.delta
                  : "";

            if (!itemId) {
              break;
            }

            setToolCalls((current) =>
              current.map((toolCall) => {
                if (toolCall.id !== itemId) {
                  return toolCall;
                }

                const mergedArguments =
                  event === "tool_args_delta"
                    ? toolCall.arguments + nextArguments
                    : nextArguments;

                return {
                  ...toolCall,
                  arguments: mergedArguments,
                  parsedArguments: safeParseArguments(mergedArguments),
                };
              })
            );
            break;
          }
          case "assistant_delta": {
            const delta = typeof data.delta === "string" ? data.delta : "";
            if (delta) {
              hasStreamedAssistantTextRef.current = true;
              setAssistantText((current) => current + delta);
            }
            break;
          }
          case "tool_done": {
            const itemId =
              typeof data.itemId === "string" ? data.itemId : undefined;
            if (itemId) {
              setToolCalls((current) =>
                current.map((toolCall) =>
                  toolCall.id === itemId
                    ? { ...toolCall, status: "completed" }
                    : toolCall
                )
              );
            }
            break;
          }
          case "assistant_message": {
            const text = typeof data.text === "string" ? data.text : "";
            if (text) {
              hasStreamedAssistantTextRef.current = true;
              setAssistantText(text);
            }
            break;
          }
          case "completed":
          case "response.completed": {
            setRunStatus("completed");
            break;
          }
          case "error": {
            const message =
              typeof data.message === "string"
                ? data.message
                : "Public chat is temporarily unavailable.";
            setError(message);
            setRunStatus("error");
            break;
          }
          default:
            break;
        }
      }

      setRunStatus((current) => {
        if (current !== "running") {
          return current;
        }

        return hasStreamedAssistantTextRef.current ? "completed" : "error";
      });
      setError((current) =>
        current || hasStreamedAssistantTextRef.current
          ? current
          : "The live run finished without producing an answer. Please try again."
      );
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
  }, [demoSport, runStatus]);

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
    speedClassName: string
  ) => {
    const repeatedPresets = [...presets, ...presets];

    return (
      <div className="-mx-1 overflow-hidden px-1">
        <div
          className={cn(
            "public-chat-ticker-track flex w-max gap-2 py-0.5 sm:gap-2.5",
            speedClassName,
            runStatus === "running" ? "public-chat-ticker-track--paused" : ""
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
                    : ""
                )}
              >
                <div className="relative">
                  <h3
                    className={cn(
                      "whitespace-nowrap text-[0.76rem] font-medium leading-none tracking-tight sm:text-[0.84rem]",
                      isSelected ? "text-primary" : "text-foreground"
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

  const chipActive = runStatus === "running" || runStatus === "completed" || Boolean(selectedPreset);

  return (
    <section id={id} className="relative bg-background px-4 pb-12 sm:px-6 lg:px-8 lg:pb-16">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0,transparent_23px,var(--border)_24px)] bg-[length:100%_24px] opacity-20" />

      <div className="relative mx-auto max-w-5xl">
        <section className="pb-4 sm:pb-6">
          <h1 className="w-full max-w-3xl text-[2rem] font-semibold leading-[0.96] tracking-[-0.05em] text-foreground sm:text-5xl">
            Watch Flaim work on my actual leagues right now.
          </h1>
        </section>

        <Card className="overflow-hidden rounded-[2rem] border-border/70 bg-card/95 p-0 shadow-[0_30px_90px_-42px_rgba(15,23,42,0.45)] backdrop-blur dark:shadow-[0_30px_90px_-42px_rgba(0,0,0,0.82)] sm:rounded-[2.3rem]">
          <div className="border-b border-border/70 bg-card px-4 py-3 sm:px-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Live app demo
                </div>
                <p className="mt-1 text-sm text-foreground">
                  Pick a prompt below and watch the live run stream inside the shell.
                </p>
              </div>
              <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-background px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground">
                <span className="text-sm leading-none" aria-hidden="true">
                  {PUBLIC_SPORT_COPY[demoSport].emoji}
                </span>
                <span>ESPN</span>
              </div>
            </div>
          </div>

          <div className="bg-[radial-gradient(circle_at_top,rgba(59,130,246,0.08),transparent_40%),linear-gradient(to_bottom,rgba(248,250,252,0.98),rgba(241,245,249,0.78))] dark:bg-[radial-gradient(circle_at_top,rgba(96,165,250,0.16),transparent_42%),linear-gradient(to_bottom,rgba(17,24,39,0.98),rgba(3,7,18,0.94))]">
            <div
              ref={transcriptScrollRef}
              className="h-[25rem] overflow-y-auto overscroll-contain px-3 py-4 sm:h-[31rem] sm:px-4 sm:py-5"
            >
              <div className="mx-auto flex max-w-3xl flex-col gap-4">
                {!selectedPreset && runStatus === "idle" ? (
                  <div className="flex min-h-[15rem] flex-1 items-center justify-center">
                    <div className="max-w-md text-center">
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-[1.5rem] border border-border bg-background shadow-sm">
                        <Image
                          src="/flaim-mark-hero.png"
                          alt="Flaim"
                          width={28}
                          height={28}
                          className="dark:hidden"
                        />
                        <Image
                          src="/flaim-mark-hero-dark.png"
                          alt="Flaim"
                          width={28}
                          height={28}
                          className="hidden dark:block"
                        />
                      </div>
                      <h3 className="mt-4 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                        Pick a live prompt
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        The input below behaves like a guided AI app composer. Choose
                        a prompt and Flaim runs it live on Gerry&apos;s demo leagues.
                      </p>
                    </div>
                  </div>
                ) : null}

                {showPreToolStatus ? (
                  <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    <span>{preToolStatusCopy}</span>
                  </div>
                ) : null}

                {hasToolCalls ? (
                  <section className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                        What Flaim checked
                      </div>
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        {toolCalls.length} call{toolCalls.length === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="space-y-3">
                      {toolCalls.map((toolCall) => (
                        <PublicToolCall
                          key={toolCall.id}
                          name={toolCall.name}
                          status={toolCall.status}
                        />
                      ))}
                    </div>
                  </section>
                ) : null}

                {showRespondingStatus ? (
                  <div className="flex items-center gap-2 px-1 text-sm text-muted-foreground">
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    <span>Responding...</span>
                  </div>
                ) : null}

                {assistantText ? (
                  <PublicMessage role="assistant" text={assistantText} />
                ) : null}

                {runStatus === "error" ? (
                  <div className="rounded-[1.75rem] border border-destructive/30 bg-destructive/5 px-5 py-4 text-sm text-destructive">
                    <div className="font-semibold">Public chat run failed</div>
                    <p className="mt-2 leading-6">
                      {error || "Unknown public chat error."}
                    </p>
                  </div>
                ) : null}

                {runStatus === "completed" && selectedPreset ? (
                  <div className="flex flex-col gap-3 rounded-[1.75rem] border border-border bg-primary px-5 py-4 text-sm text-primary-foreground dark:bg-card dark:text-card-foreground">
                    <div className="flex flex-col gap-3">
                      <span className="text-primary-foreground dark:text-card-foreground">
                        That run used live data from Gerry&apos;s actual league.
                      </span>
                      <Button
                        asChild
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="w-full justify-center rounded-full sm:w-fit"
                      >
                        <a href="/leagues">
                          Set up your leagues
                          <ArrowUp className="ml-2 h-4 w-4 rotate-45" />
                        </a>
                      </Button>
                    </div>
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="w-fit text-left text-xs text-primary-foreground/80 underline decoration-primary-foreground/35 underline-offset-4 transition-colors hover:text-primary-foreground dark:text-muted-foreground dark:decoration-muted-foreground/35 dark:hover:text-foreground"
                        >
                          Powered by GPT-5.4. Claude and Perplexity are also supported.
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="start"
                        className="w-[19rem] rounded-2xl border-border p-4 text-sm leading-6"
                      >
                        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                          One more thing
                        </div>
                        <p className="mt-2 text-foreground">
                          This is a real run on a dedicated demo account. Want Flaim
                          for your own leagues? Connect your Flaim account to your own AI app.
                        </p>
                      </PopoverContent>
                    </Popover>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="border-t border-border/70 bg-card/95 p-3 sm:p-4">
              <div className="mx-auto max-w-3xl">
                <div className="rounded-[1.9rem] border border-border bg-background p-3 shadow-[0_12px_30px_-24px_rgba(15,23,42,0.5)] sm:rounded-[2.2rem] sm:p-4">
                  <div className="min-h-[4.5rem] rounded-[1.45rem] bg-muted/55 p-4 sm:min-h-[5.25rem]">
                    <div className="flex h-full flex-col justify-center">
                      <div className="text-[1.05rem] text-muted-foreground sm:text-[1.2rem]">
                        Ask anything
                      </div>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        Pick one of the scrolling prompts below to run the live demo.
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 space-y-2">
                    {renderPromptTicker(topRailPresets, "public-chat-ticker-track--top")}
                    {renderPromptTicker(bottomRailPresets, "public-chat-ticker-track--bottom")}
                  </div>

                  <div className="mt-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        disabled
                        aria-hidden="true"
                        className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background text-muted-foreground"
                      >
                        <Plus className="h-4.5 w-4.5" />
                      </button>
                      <div
                        className={cn(
                          "inline-flex h-10 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors",
                          chipActive
                            ? "public-chat-chip-active border-primary/30 bg-primary/10 text-primary"
                            : "border-border bg-background text-foreground"
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
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        disabled
                        aria-hidden="true"
                        className="inline-flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground"
                      >
                        <Mic className="h-4.5 w-4.5" />
                      </button>
                      <div
                        className={cn(
                          "inline-flex h-11 w-11 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm transition-transform",
                          runStatus === "running" ? "public-chat-send-running" : ""
                        )}
                        aria-label="Run selected prompt"
                      >
                        {runStatus === "running" ? (
                          <LoaderCircle className="h-4.5 w-4.5 animate-spin" />
                        ) : (
                          <ArrowUp className="h-4.5 w-4.5" />
                        )}
                      </div>
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
