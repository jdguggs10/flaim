"use client";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  PUBLIC_CHAT_PRESETS,
  type PublicChatPreset,
  type PublicChatPresetId,
} from "@/lib/public-chat";
import type { PublicChatTurnRequest } from "@/types/api-responses";
import { cn } from "@/lib/utils";
import { parse } from "partial-json";
import {
  BarChart3,
  ArrowRight,
  Database,
  Eye,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { PublicMessage } from "./public-message";

type PublicRunStatus = "idle" | "running" | "completed" | "error";

interface PublicToolCallState {
  id: string;
  name?: string | null;
  status: "in_progress" | "completed";
  arguments: string;
  parsedArguments?: Record<string, unknown>;
}

const PRESET_ICONS: Record<PublicChatPresetId, LucideIcon> = {
  "show-leagues": Database,
  "roster-breakdown": BarChart3,
  "standings-check": Sparkles,
  "weekly-matchup": Search,
  "waiver-wire": ShieldCheck,
  "transactions-watch": Eye,
};

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

function getLiveStatusCopy(toolCalls: PublicToolCallState[]) {
  const activeTool = [...toolCalls]
    .reverse()
    .find((toolCall) => toolCall.status === "in_progress") ?? null;
  const latestTool = activeTool ?? toolCalls[toolCalls.length - 1] ?? null;

  switch (latestTool?.name) {
    case "get_user_session":
      return "Checking Gerry's connected leagues.";
    case "get_roster":
      return "Reviewing Gerry's team to find the strong spots and weak links.";
    case "get_standings":
      return "Checking where Gerry sits in the standings right now.";
    case "get_matchups":
      return "Looking at Gerry's current matchup and where it could swing.";
    case "get_free_agents":
      return "Scanning the waiver pool for options that fit Gerry's team.";
    case "get_transactions":
      return "Reviewing the recent league moves that stand out.";
    case "get_league_info":
      return "Pulling league context so the answer has the right frame.";
    case "get_players":
      return "Looking up player details to sharpen the answer.";
    default:
      return "Checking Gerry's leagues and pulling the live details together.";
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

export function PublicChatExperience() {
  const [runStatus, setRunStatus] = useState<PublicRunStatus>("idle");
  const [selectedPresetId, setSelectedPresetId] =
    useState<PublicChatPresetId | null>(null);
  const [assistantText, setAssistantText] = useState("");
  const [toolCalls, setToolCalls] = useState<PublicToolCallState[]>([]);
  const [error, setError] = useState<string | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const hasStreamedAssistantTextRef = useRef(false);
  const activeRunAbortControllerRef = useRef<AbortController | null>(null);

  const selectedPreset = useMemo(
    () =>
      selectedPresetId
        ? PUBLIC_CHAT_PRESETS.find((preset) => preset.id === selectedPresetId) ?? null
        : null,
    [selectedPresetId]
  );
  const runStatusLabel =
    runStatus === "running"
      ? "Running live"
      : runStatus === "completed"
        ? "Completed"
        : runStatus === "error"
          ? "Needs retry"
          : "Ready";
  const liveStatusCopy = getLiveStatusCopy(toolCalls);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [assistantText, toolCalls.length, runStatus]);

  useEffect(() => {
    return () => {
      activeRunAbortControllerRef.current?.abort();
    };
  }, []);

  const handleRunPreset = async (preset: PublicChatPreset) => {
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
      const requestBody: PublicChatTurnRequest = {
        presetId: preset.id,
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
            if (text && !hasStreamedAssistantTextRef.current) {
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
          default:
            break;
        }
      }

      setRunStatus((current) => (current === "running" ? "completed" : current));
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
  };

  return (
    <div className="relative h-full overflow-y-auto bg-background">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,transparent_0,transparent_23px,var(--border)_24px)] bg-[length:100%_24px] opacity-25" />

      <div className="relative mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
        <section className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Live on real league data
              </p>
              <h1 className="mt-3 max-w-4xl text-3xl font-semibold leading-[0.96] tracking-[-0.05em] text-foreground sm:text-5xl">
                Watch Flaim work on my actual leagues right now.
              </h1>
            </div>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="hidden rounded-full px-0 text-muted-foreground sm:inline-flex"
            >
              <Link href="/">
                Back home
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>

        <Card className="flex min-h-[32rem] flex-col overflow-hidden rounded-[1.6rem] border-border bg-card p-0 shadow-sm lg:min-h-[38rem] lg:rounded-[2rem]">
          <div className="border-b border-border bg-card px-3 py-3 sm:px-4">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    runStatus === "completed"
                      ? "default"
                      : runStatus === "running"
                        ? "secondary"
                        : runStatus === "error"
                          ? "destructive"
                          : "outline"
                  }
                  className="px-3 py-1 text-xs font-semibold"
                >
                  {runStatusLabel}
                </Badge>
                {selectedPreset ? (
                  <Badge variant="outline" className="hidden px-3 py-1 text-xs font-medium sm:inline-flex">
                    {selectedPreset.title}
                  </Badge>
                ) : null}
              </div>
            </div>

            <div className="-mx-3 overflow-x-auto px-3 pb-1 pt-3 sm:mx-0 sm:px-0">
              <div className="flex snap-x snap-mandatory gap-3">
                {PUBLIC_CHAT_PRESETS.map((preset) => {
                  const isSelected = preset.id === selectedPresetId;
                  const Icon = PRESET_ICONS[preset.id];

                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => void handleRunPreset(preset)}
                      disabled={runStatus === "running"}
                      aria-pressed={isSelected}
                      className={cn(
                        "group relative min-w-[13rem] snap-start overflow-hidden rounded-[1.1rem] border p-3 text-left transition-all duration-200 sm:min-w-[18rem] sm:p-4",
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground shadow-sm"
                          : "border-border bg-background text-foreground hover:bg-muted",
                        runStatus === "running" && !isSelected
                          ? "cursor-not-allowed opacity-70"
                          : ""
                      )}
                      >
                        <div className="relative">
                          <div className="flex items-center justify-between gap-3">
                          <div
                            className={cn(
                              "flex h-9 w-9 items-center justify-center rounded-xl",
                              isSelected
                                ? "border border-primary-foreground/15 bg-primary text-primary-foreground"
                                : "border border-border bg-muted text-foreground"
                            )}
                          >
                            <Icon className="h-4.5 w-4.5" />
                          </div>
                          <div
                            className={cn(
                              "rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.2em]",
                              isSelected
                                ? "border-primary-foreground/15 text-primary-foreground/80"
                                : "border-border text-muted-foreground"
                            )}
                          >
                            {preset.eyebrow}
                          </div>
                        </div>
                        <h3 className="mt-3 text-sm font-semibold tracking-tight sm:text-base">
                          {preset.title}
                        </h3>
                        <p
                          className={cn(
                            "mt-1.5 hidden text-xs leading-5 sm:block sm:text-sm sm:leading-6",
                            isSelected
                              ? "text-primary-foreground/75"
                              : "text-muted-foreground"
                          )}
                        >
                          {preset.description}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex-1 bg-muted/40 p-3 lg:p-4">
            <div className="h-full rounded-[1.35rem] border border-border bg-background p-3 lg:rounded-[1.7rem] lg:p-4 lg:overflow-hidden">
              <div className="flex h-full flex-col gap-4 pr-1 lg:overflow-y-auto">
                  {selectedPreset ? (
                    <PublicMessage role="user" text={selectedPreset.userMessage} />
                  ) : (
                    <div className="flex h-full min-h-[12rem] items-center justify-center lg:min-h-[18rem]">
                      <div className="max-w-xl text-center">
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[1.2rem] border border-border bg-primary text-primary-foreground sm:h-16 sm:w-16 sm:rounded-[1.5rem]">
                          <Image
                            src="/flaim-mark-hero-dark.png"
                            alt="Flaim"
                            width={28}
                            height={28}
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

                  {runStatus === "running" ? (
                    <div className="overflow-hidden rounded-[1.35rem] border border-border bg-muted px-4 py-4 text-sm text-foreground lg:rounded-[1.75rem] lg:px-5">
                      <div className="flex items-center gap-2 font-semibold">
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                        Checking the live data
                      </div>
                      <p className="mt-2 leading-6 text-muted-foreground">
                        {assistantText
                          ? "Pulling together the answer."
                          : liveStatusCopy}
                      </p>
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
                    <div className="flex flex-col gap-3 rounded-[1.75rem] border border-border bg-primary px-5 py-4 text-sm text-primary-foreground sm:flex-row sm:items-center sm:justify-between">
                      <span>
                        That run used live data from Gerry&apos;s actual leagues.
                      </span>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleRunPreset(selectedPreset)}
                        className="rounded-full"
                      >
                        <RefreshCw className="mr-2 h-4 w-4" />
                        Run again
                      </Button>
                    </div>
                  ) : null}

                  <div className="pt-1 sm:hidden">
                    <Button asChild variant="ghost" size="sm" className="rounded-full px-0 text-muted-foreground">
                      <Link href="/">
                        Back home
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </Link>
                    </Button>
                  </div>

                  <div ref={transcriptEndRef} />
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
