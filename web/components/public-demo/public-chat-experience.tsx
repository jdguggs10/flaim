"use client";

import type { ReactNode } from "react";
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
import { ArrowRight, LoaderCircle } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
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
  leadingSlot,
  followTranscript = true,
}: {
  initialPresetId?: string | null;
  id?: string;
  leadingSlot?: ReactNode;
  followTranscript?: boolean;
}) {
  const [runStatus, setRunStatus] = useState<PublicRunStatus>("idle");
  const [selectedPresetId, setSelectedPresetId] =
    useState<PublicChatPresetId | null>(null);
  const [assistantText, setAssistantText] = useState("");
  const [toolCalls, setToolCalls] = useState<PublicToolCallState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
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
  const showFocusedPromptStage = runStatus === "running" && selectedPreset;
  const hasToolCalls = toolCalls.length > 0;
  const hasAssistantText = assistantText.trim().length > 0;
  const allToolCallsCompleted =
    hasToolCalls && toolCalls.every((toolCall) => toolCall.status === "completed");
  const showPreToolStatus = runStatus === "running" && !hasToolCalls;
  const showRespondingStatus =
    runStatus === "running" && allToolCallsCompleted && !hasAssistantText;
  const preToolStatusCopy = [
    "Thinking...",
    "Using Flaim Fantasy plugin...",
    "Calling Flaim Fantasy tools...",
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
    if (!followTranscript) {
      return;
    }

    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
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
    const pluginTimer = window.setTimeout(() => setPreToolStatusIndex(1), 1000);
    const toolsTimer = window.setTimeout(() => setPreToolStatusIndex(2), 1750);

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

  const renderPromptTicker = (
    presets: readonly PublicChatPreset[],
    speedClassName: string
  ) => {
    const repeatedPresets = [...presets, ...presets];

    return (
      <div className="-mx-3 overflow-hidden px-3 sm:mx-0 sm:px-0">
        <div
          className={cn(
            "public-chat-ticker-track flex w-max gap-2.5 pb-1 sm:gap-3",
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
                  "group relative w-max max-w-none overflow-hidden rounded-full border px-3 py-2 text-left transition-all duration-200 sm:px-4 sm:py-2.5",
                  isSelected
                    ? "border-primary bg-primary text-primary-foreground shadow-sm"
                    : "border-border bg-background text-foreground hover:bg-muted",
                  runStatus === "running" && !isSelected
                    ? "cursor-not-allowed opacity-70"
                    : ""
                )}
              >
                <div className="relative">
                  <h3
                    className={cn(
                      "whitespace-nowrap text-[0.8rem] font-semibold leading-none tracking-tight sm:text-[0.9rem]",
                      isSelected ? "text-primary-foreground" : "text-foreground"
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
          // Keep the HTTP status fallback.
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
  }, [initialQueryPreset, handleRunPreset]);

  const resolvedLeadingSlot = leadingSlot ?? (
    <Button
      asChild
      variant="ghost"
      size="sm"
      className="h-8 rounded-full px-2 text-muted-foreground sm:px-3"
    >
      <Link href="/">
        <ArrowRight className="mr-1 h-4 w-4 rotate-180 sm:mr-2" />
        <span className="sm:hidden">Home</span>
        <span className="hidden sm:inline">Back home</span>
      </Link>
    </Button>
  );

  return (
    <div id={id} className="relative min-h-[100dvh] bg-background">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0,transparent_23px,var(--border)_24px)] bg-[length:100%_24px] opacity-25" />

      <div className="relative mx-auto flex min-h-[100dvh] w-full max-w-5xl flex-col px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
        <section className="pb-3 sm:pb-4">
          <div className="flex items-center justify-between gap-3">
            {resolvedLeadingSlot}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  aria-label="Show demo context"
                  className="inline-flex h-8 items-center gap-2 rounded-full border border-border bg-background px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-foreground shadow-sm transition-colors hover:bg-muted"
                >
                  <span className="text-sm leading-none" aria-hidden="true">
                    {PUBLIC_SPORT_COPY[demoSport].emoji}
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
                  This demo is currently running on Gerry&apos;s ESPN{" "}
                  {PUBLIC_SPORT_COPY[demoSport].label} league.
                </p>
                <p className="mt-2 text-muted-foreground">
                  Flaim supports ESPN, Yahoo, and Sleeper for football, baseball,
                  basketball, and hockey.
                </p>
              </PopoverContent>
            </Popover>
          </div>
          <h1 className="mt-3 w-full text-[2rem] font-semibold leading-[0.96] tracking-[-0.05em] text-foreground sm:mt-4 sm:text-5xl">
            Watch Flaim work on my actual leagues right now.
          </h1>
        </section>

        <Card className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.45rem] border-border bg-card p-0 shadow-sm sm:rounded-[1.6rem] lg:rounded-[2rem]">
          <div className="border-b border-border bg-card px-3 py-3 sm:px-4">
            {showFocusedPromptStage && selectedPreset ? (
              <div className="flex min-h-[5.75rem] items-center justify-center sm:min-h-[6.5rem]">
                <div className="public-chat-selected-prompt group relative max-w-full overflow-hidden rounded-full border border-primary bg-primary px-5 py-3 text-center text-primary-foreground shadow-sm sm:px-7 sm:py-3.5">
                  <div className="absolute inset-0 bg-[linear-gradient(110deg,transparent_0%,rgba(255,255,255,0.06)_35%,rgba(255,255,255,0.22)_50%,rgba(255,255,255,0.06)_65%,transparent_100%)]" />
                  <div className="relative">
                    <p className="truncate text-[0.92rem] font-semibold tracking-tight sm:text-base">
                      {selectedPreset.title}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {renderPromptTicker(topRailPresets, "public-chat-ticker-track--top")}
                {renderPromptTicker(bottomRailPresets, "public-chat-ticker-track--bottom")}
              </div>
            )}
          </div>

          <div className="min-h-0 flex-1 bg-muted/40 p-2.5 sm:p-3 lg:p-4">
            <div className="flex h-full min-h-0 flex-col rounded-[1.2rem] border border-border bg-background p-3 sm:rounded-[1.35rem] lg:rounded-[1.7rem] lg:p-4 lg:overflow-hidden">
              <div className="flex h-full min-h-0 flex-col gap-4 pr-1 lg:overflow-y-auto">
                  {selectedPreset ? (
                    <PublicMessage role="user" text={selectedPreset.userMessage} />
                  ) : (
                    <div className="flex h-full min-h-[12rem] items-center justify-center lg:min-h-[18rem]">
                      <div className="max-w-xl text-center">
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[1.2rem] border border-border bg-primary text-primary-foreground sm:h-16 sm:w-16 sm:rounded-[1.5rem]">
                          <Image
                            src="/icon-dark.png"
                            alt="Flaim"
                            width={28}
                            height={28}
                            className="dark:hidden"
                          />
                          <Image
                            src="/icon-light.png"
                            alt="Flaim"
                            width={28}
                            height={28}
                            className="hidden dark:block"
                          />
                        </div>
                        <h3 className="mt-4 text-lg font-semibold tracking-tight text-foreground sm:mt-5 sm:text-2xl">
                          Pick a prompt to start
                        </h3>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">
                          Choose one above and Flaim will run on Gerry&apos;s actual leagues live.
                        </p>
                      </div>
                    </div>
                  )}

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
                    <div className="flex flex-col gap-3 rounded-[1.75rem] border border-border bg-primary px-5 py-4 text-sm text-primary-foreground">
                      <div className="flex flex-col gap-3">
                        <span className="text-primary-foreground">
                          That run used live data from Gerry&apos;s actual league.
                        </span>
                        <Button
                          asChild
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="w-full justify-center rounded-full sm:w-fit"
                        >
                          <Link href="/leagues">
                            Set up your leagues
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </Link>
                        </Button>
                      </div>
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="w-fit text-left text-xs text-primary-foreground/80 underline decoration-primary-foreground/35 underline-offset-4 transition-colors hover:text-primary-foreground"
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
                            I&apos;m running this custom demo on my personal OpenAI account. Want
                            Flaim for your own leagues? Connect your Flaim account to your own AI app.
                          </p>
                        </PopoverContent>
                      </Popover>
                    </div>
                  ) : null}

                  <div ref={transcriptEndRef} />
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
