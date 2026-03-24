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
  LockKeyhole,
  Radio,
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
import { PublicToolCall } from "./public-tool-call";

type PublicRunStatus = "idle" | "running" | "completed" | "error";

interface PublicToolCallState {
  id: string;
  name?: string | null;
  status: "in_progress" | "completed";
  arguments: string;
  parsedArguments?: Record<string, unknown>;
}

const DEMO_SIGNALS = [
  {
    title: "Gerry's actual leagues",
    description: "Every run reads from Gerry's real connected leagues, not mocked data.",
    icon: Database,
  },
  {
    title: "Tool calls in public",
    description: "Visitors watch the actual MCP sequence unfold instead of a canned screenshot.",
    icon: Eye,
  },
  {
    title: "Locked down on purpose",
    description: "Preset prompts keep the demo fast, safe, and repeatable while still feeling live.",
    icon: LockKeyhole,
  },
] as const;

const DEMO_STEPS = [
  {
    step: "01",
    title: "Pick a scenario",
    description: "Choose a curated live prompt that shows off a different part of Flaim.",
  },
  {
    step: "02",
    title: "Watch the tools fire",
    description: "The demo streams league reads and tool activity while the answer is being built.",
  },
  {
    step: "03",
    title: "See the grounded answer",
    description: "The final response is based on Gerry's live leagues, not static content.",
  },
] as const;

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
  const [thinkingText, setThinkingText] = useState("");
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
  const heroPreset = selectedPreset ?? PUBLIC_CHAT_PRESETS[0];
  const HeroIcon = PRESET_ICONS[heroPreset.id];
  const runStatusLabel =
    runStatus === "running"
      ? "Running live"
      : runStatus === "completed"
        ? "Completed"
        : runStatus === "error"
          ? "Needs retry"
          : "Ready";

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [assistantText, thinkingText, toolCalls.length, runStatus]);

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
    setThinkingText("");
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
            const delta = typeof data.delta === "string" ? data.delta : "";
            if (delta) {
              setThinkingText((current) => current + delta);
            }
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

      <div className="relative mx-auto flex min-h-full w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <div className="rounded-[1.75rem] border border-border bg-card p-3 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-primary text-primary-foreground">
                <Image
                  src="/flaim-mark-hero-dark.png"
                  alt="Flaim"
                  width={26}
                  height={26}
                />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-muted-foreground">
                  Public Chat
                </p>
                <p className="text-sm font-medium text-foreground">
                  Live fantasy data. Real tool calls. No sign-in required.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="gap-2 px-3 py-1 text-xs font-semibold">
                <span className="h-2 w-2 rounded-full bg-foreground" />
                Gerry&apos;s leagues
              </Badge>
              <Button
                asChild
                variant="outline"
                className="rounded-full"
              >
                <Link href="/">
                  Back home
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>

        <section className="grid gap-5 pb-6 pt-5 lg:grid-cols-[minmax(0,1.2fr)_24rem] lg:items-start lg:pb-8 lg:pt-6">
          <div>
            <Badge variant="outline" className="gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" />
              Live on real league data
            </Badge>

            <h1 className="mt-4 max-w-4xl text-3xl font-semibold leading-[0.96] tracking-[-0.05em] text-foreground sm:mt-5 sm:text-5xl lg:text-7xl">
              Watch Flaim work
              <span className="block text-muted-foreground">on my actual leagues</span>
              <span className="block">right now.</span>
            </h1>

            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:mt-5 sm:text-lg sm:leading-7">
              This page runs against my actual leagues and streams the actual tool
              chain in public. Pick a scenario, watch the MCP reads happen, and see
              the answer come together in real time.
            </p>

            <div className="mt-4 flex flex-wrap gap-2 sm:mt-6 sm:gap-3">
              <div className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground">
                My real league data
              </div>
              <div className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground">
                Preset live prompts
              </div>
              <div className="rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground">
                Streaming MCP activity
              </div>
            </div>

            <div className="mt-8 hidden gap-3 sm:grid sm:grid-cols-3">
              {DEMO_SIGNALS.map((signal) => {
                const Icon = signal.icon;
                return (
                  <div
                    key={signal.title}
                    className="rounded-[1.5rem] border border-border bg-card p-4 shadow-sm"
                  >
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-muted text-foreground">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h2 className="mt-4 text-base font-semibold text-foreground">
                      {signal.title}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {signal.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <Card className="hidden overflow-hidden rounded-[2rem] border-border bg-primary text-primary-foreground shadow-sm lg:block">
            <div className="h-full p-6">
              <div className="rounded-[1.6rem] border border-primary-foreground/20 bg-primary p-5">
                <div className="flex items-center justify-between gap-3">
                  <Badge variant="secondary" className="gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em]">
                    <Radio className="h-3.5 w-3.5" />
                    Sunday Edition
                  </Badge>
                  <div className="text-xs font-medium text-primary-foreground/70">
                    {runStatusLabel}
                  </div>
                </div>

                <div className="mt-5 rounded-[1.4rem] border border-primary-foreground/15 bg-primary p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-primary-foreground/15 bg-primary-foreground text-primary">
                      <HeroIcon className="h-6 w-6" />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary-foreground/60">
                        Featured prompt
                      </p>
                      <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                        {heroPreset.title}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-primary-foreground/80">
                        {heroPreset.description}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  {DEMO_STEPS.map((step) => (
                    <div
                      key={step.step}
                      className="grid grid-cols-[3rem_minmax(0,1fr)] gap-3 rounded-[1.2rem] border border-primary-foreground/15 bg-primary p-3"
                    >
                      <div className="text-lg font-semibold text-primary-foreground/60">{step.step}</div>
                      <div>
                        <p className="text-sm font-semibold text-primary-foreground">{step.title}</p>
                        <p className="mt-1 text-sm leading-6 text-primary-foreground/75">
                          {step.description}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        </section>

        <div className="grid gap-5 lg:min-h-0 lg:flex-1 lg:grid-cols-[24rem_minmax(0,1fr)]">
          <Card className="order-2 h-fit rounded-[1.6rem] border-border bg-card p-4 shadow-sm lg:order-1 lg:sticky lg:top-6 lg:rounded-[2rem] lg:p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl border border-border bg-muted p-3 text-foreground">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                  Demo menu
                </p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground lg:text-2xl">
                  Pick a live scenario
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Each prompt is intentionally curated to show a different slice of
                  Flaim using my actual leagues.
                </p>
              </div>
            </div>

            <div className="mt-4 -mx-4 overflow-x-auto px-4 pb-2 lg:mx-0 lg:overflow-visible lg:px-0 lg:pb-0">
              <div className="flex snap-x snap-mandatory gap-3 lg:grid lg:gap-3">
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
                      "group relative min-w-[17rem] snap-start overflow-hidden rounded-[1.35rem] border p-4 text-left transition-all duration-200 lg:min-w-0 lg:rounded-[1.6rem]",
                      isSelected
                        ? "border-primary bg-primary text-primary-foreground shadow-sm"
                        : "border-border bg-background text-foreground hover:-translate-y-0.5 hover:bg-muted",
                      runStatus === "running" && !isSelected
                        ? "cursor-not-allowed opacity-70"
                        : ""
                    )}
                  >
                    <div className="relative">
                      <div className="flex items-start justify-between gap-3">
                        <div
                          className={cn(
                            "flex h-11 w-11 items-center justify-center rounded-2xl",
                            isSelected
                              ? "border border-primary-foreground/15 bg-primary text-primary-foreground"
                              : "border border-border bg-muted text-foreground"
                          )}
                        >
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className={cn(
                          "rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em]",
                          isSelected
                            ? "border-primary-foreground/15 text-primary-foreground/80"
                            : "border-border text-muted-foreground"
                        )}>
                          {preset.eyebrow}
                        </div>
                      </div>
                      <h3 className="mt-4 text-lg font-semibold tracking-tight">
                        {preset.title}
                      </h3>
                      <p
                        className={cn(
                          "mt-2 text-sm leading-6",
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

            <div className="mt-3 rounded-[1.35rem] border border-dashed border-border bg-muted p-4 text-sm leading-6 text-muted-foreground lg:mt-5 lg:rounded-[1.6rem]">
              <span className="font-semibold text-foreground">Data source:</span>{" "}
              Gerry&apos;s leagues and teams
              <br />
              <span className="font-semibold text-foreground">Scope:</span> read-only
              fantasy data with no visitor sign-in required.
            </div>
          </Card>

          <Card className="order-1 flex min-h-[30rem] flex-col overflow-hidden rounded-[1.6rem] border-border bg-card p-0 shadow-sm lg:order-2 lg:min-h-0 lg:rounded-[2rem]">
            <div className="border-b border-border bg-card px-4 py-4 lg:px-5 lg:py-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                    Live run
                  </p>
                  <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground lg:text-2xl">
                    Watch the answer get assembled
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Tool activity and response generation stream in real time from my
                    actual leagues.
                  </p>
                </div>
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
                    <Badge variant="outline" className="px-3 py-1 text-xs font-medium">
                      {selectedPreset.title}
                    </Badge>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex-1 bg-muted/40 p-3 lg:p-5">
              <div className="h-full rounded-[1.35rem] border border-border bg-background p-3 lg:rounded-[1.7rem] lg:p-4 lg:overflow-hidden">
                <div className="flex h-full flex-col gap-4 pr-1 lg:overflow-y-auto">
                  {selectedPreset ? (
                    <PublicMessage role="user" text={selectedPreset.userMessage} />
                  ) : (
                    <div className="flex h-full min-h-[20rem] items-center justify-center lg:min-h-[26rem]">
                      <div className="max-w-xl text-center">
                        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[1.5rem] border border-border bg-primary text-primary-foreground lg:h-20 lg:w-20 lg:rounded-[2rem]">
                          <Image
                            src="/flaim-mark-hero-dark.png"
                            alt="Flaim"
                            width={32}
                            height={32}
                          />
                        </div>
                        <h3 className="mt-5 text-2xl font-semibold tracking-tight text-foreground lg:mt-6 lg:text-3xl">
                          Pick a prompt and watch Flaim think out loud
                        </h3>
                        <p className="mt-3 text-sm leading-6 text-muted-foreground lg:text-base lg:leading-7">
                          This is a public-facing proof point: my actual leagues, live
                          MCP reads, and an answer assembled in front of you.
                        </p>
                      </div>
                    </div>
                  )}

                  {runStatus === "running" ? (
                    <div className="overflow-hidden rounded-[1.75rem] border border-border bg-muted px-5 py-4 text-sm text-foreground">
                      <div className="flex items-center gap-2 font-semibold">
                        <LoaderCircle className="h-4 w-4 animate-spin" />
                        Working through the live data
                      </div>
                      <p className="mt-2 leading-6 text-muted-foreground">
                        {thinkingText || "Inspecting Gerry's leagues and preparing a response."}
                      </p>
                    </div>
                  ) : null}

                  {toolCalls.length > 0 ? (
                    <div className="space-y-3">
                      {toolCalls.map((toolCall) => (
                        <PublicToolCall
                          key={toolCall.id}
                          name={toolCall.name}
                          status={toolCall.status}
                          parsedArguments={toolCall.parsedArguments}
                        />
                      ))}
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

                  <div ref={transcriptEndRef} />
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
