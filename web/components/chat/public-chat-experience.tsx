"use client";

import { Button } from "@/components/ui/button";
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

const PRESET_VISUALS: Record<
  PublicChatPresetId,
  {
    icon: LucideIcon;
    accent: string;
    glow: string;
    chip: string;
  }
> = {
  "show-leagues": {
    icon: Database,
    accent: "from-cyan-500/25 via-sky-500/10 to-transparent",
    glow: "shadow-[0_18px_60px_rgba(14,165,233,0.18)]",
    chip: "bg-cyan-500/12 text-cyan-700",
  },
  "roster-breakdown": {
    icon: BarChart3,
    accent: "from-emerald-500/25 via-teal-500/10 to-transparent",
    glow: "shadow-[0_18px_60px_rgba(16,185,129,0.18)]",
    chip: "bg-emerald-500/12 text-emerald-700",
  },
  "standings-check": {
    icon: Sparkles,
    accent: "from-amber-500/25 via-yellow-500/10 to-transparent",
    glow: "shadow-[0_18px_60px_rgba(245,158,11,0.18)]",
    chip: "bg-amber-500/12 text-amber-700",
  },
  "weekly-matchup": {
    icon: Search,
    accent: "from-rose-500/25 via-orange-500/10 to-transparent",
    glow: "shadow-[0_18px_60px_rgba(244,63,94,0.18)]",
    chip: "bg-rose-500/12 text-rose-700",
  },
  "waiver-wire": {
    icon: ShieldCheck,
    accent: "from-violet-500/25 via-fuchsia-500/10 to-transparent",
    glow: "shadow-[0_18px_60px_rgba(139,92,246,0.18)]",
    chip: "bg-violet-500/12 text-violet-700",
  },
  "transactions-watch": {
    icon: Eye,
    accent: "from-slate-500/30 via-slate-400/12 to-transparent",
    glow: "shadow-[0_18px_60px_rgba(51,65,85,0.18)]",
    chip: "bg-slate-500/12 text-slate-700",
  },
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

function extractAssistantText(item: unknown) {
  if (!item || typeof item !== "object" || !("content" in item)) {
    return "";
  }

  const content = (item as { content?: Array<{ type?: string; text?: string }> })
    .content;
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((entry) => entry?.type === "output_text" && typeof entry.text === "string")
    .map((entry) => entry.text)
    .join("");
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

  return JSON.parse(dataLine.slice(6)) as {
    event: string;
    data: Record<string, unknown>;
  };
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

  const selectedPreset = useMemo(
    () =>
      selectedPresetId
        ? PUBLIC_CHAT_PRESETS.find((preset) => preset.id === selectedPresetId) ?? null
        : null,
    [selectedPresetId]
  );
  const heroPreset = selectedPreset ?? PUBLIC_CHAT_PRESETS[0];
  const heroVisual = PRESET_VISUALS[heroPreset.id];
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
          case "response.output_item.done": {
            const item = data.item as
              | {
                  id?: string;
                  type?: string;
                }
              | undefined;

            if (item?.type === "message" && !hasStreamedAssistantTextRef.current) {
              const fallbackText = extractAssistantText(item);
              if (fallbackText) {
                hasStreamedAssistantTextRef.current = true;
                setAssistantText(fallbackText);
              }
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
      const message =
        runError instanceof Error
          ? runError.message
          : "Unable to run the public chat demo.";
      setError(message);
      setRunStatus("error");
    }
  };

  return (
    <div className="relative h-full overflow-y-auto bg-[#f7f8f4] text-slate-950">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_28%),radial-gradient(circle_at_85%_15%,_rgba(244,114,182,0.14),_transparent_22%),radial-gradient(circle_at_bottom_right,_rgba(245,158,11,0.16),_transparent_28%),linear-gradient(180deg,_rgba(255,255,255,0.96),_rgba(247,248,244,0.98))]" />
      <div className="absolute inset-x-0 top-0 h-[26rem] bg-[linear-gradient(135deg,rgba(15,23,42,0.06),transparent_55%)]" />

      <div className="relative mx-auto flex min-h-full w-full max-w-7xl flex-col px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <div className="rounded-[1.75rem] border border-white/70 bg-white/65 p-3 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 shadow-[0_12px_30px_rgba(15,23,42,0.28)]">
                <Image
                  src="/flaim-mark-hero-dark.png"
                  alt="Flaim"
                  width={26}
                  height={26}
                />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">
                  Public Chat
                </p>
                <p className="text-sm font-medium text-slate-900">
                  Live fantasy data. Real tool calls. No sign-in required.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-700">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Gerry&apos;s leagues
              </div>
              <Button
                asChild
                variant="outline"
                className="rounded-full border-slate-900/10 bg-white/70"
              >
                <Link href="/">
                  Back home
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
            </div>
          </div>
        </div>

        <section className="grid gap-6 pb-8 pt-6 lg:grid-cols-[minmax(0,1.2fr)_24rem] lg:items-start">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-900/10 bg-white/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-600 shadow-sm backdrop-blur">
              <Sparkles className="h-3.5 w-3.5 text-amber-500" />
              Live on real league data
            </div>

            <h1 className="mt-5 max-w-4xl text-4xl font-semibold leading-[0.95] tracking-[-0.04em] text-slate-950 sm:text-5xl lg:text-7xl">
              Watch Flaim work
              <span className="block text-slate-500">on my actual leagues</span>
              <span className="block">right now.</span>
            </h1>

            <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600 sm:text-lg">
              This page runs against my actual leagues and streams the actual tool
              chain in public. Pick a scenario, watch the MCP reads happen, and see
              the answer come together in real time.
            </p>

            <div className="mt-6 flex flex-wrap gap-3">
              <div className="rounded-full border border-slate-900/10 bg-white/75 px-4 py-2 text-sm font-medium text-slate-700 shadow-sm">
                My real league data
              </div>
              <div className="rounded-full border border-slate-900/10 bg-white/75 px-4 py-2 text-sm font-medium text-slate-700 shadow-sm">
                Preset live prompts
              </div>
              <div className="rounded-full border border-slate-900/10 bg-white/75 px-4 py-2 text-sm font-medium text-slate-700 shadow-sm">
                Streaming MCP activity
              </div>
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-3">
              {DEMO_SIGNALS.map((signal) => {
                const Icon = signal.icon;
                return (
                  <div
                    key={signal.title}
                    className="rounded-[1.5rem] border border-white/70 bg-white/72 p-4 shadow-[0_20px_70px_rgba(15,23,42,0.06)] backdrop-blur"
                  >
                    <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-950 text-white">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h2 className="mt-4 text-base font-semibold text-slate-950">
                      {signal.title}
                    </h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {signal.description}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          <Card className="overflow-hidden rounded-[2rem] border-0 bg-slate-950 p-0 text-white shadow-[0_30px_120px_rgba(15,23,42,0.28)]">
            <div className={cn("h-full bg-gradient-to-br p-6", heroVisual.accent)}>
              <div className="rounded-[1.6rem] border border-white/10 bg-white/6 p-5 backdrop-blur">
                <div className="flex items-center justify-between gap-3">
                  <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-200">
                    <Radio className="h-3.5 w-3.5 text-emerald-300" />
                    Demo Flow
                  </div>
                  <div className="text-xs font-medium text-slate-300">
                    {runStatusLabel}
                  </div>
                </div>

                <div className={cn("mt-5 rounded-[1.4rem] border border-white/10 bg-white/5 p-4", heroVisual.glow)}>
                  <div className="flex items-start gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10">
                      <heroVisual.icon className="h-6 w-6 text-white" />
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-slate-400">
                        Featured prompt
                      </p>
                      <h2 className="mt-2 text-2xl font-semibold tracking-tight">
                        {heroPreset.title}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-slate-300">
                        {heroPreset.description}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-5 space-y-3">
                  {DEMO_STEPS.map((step) => (
                    <div
                      key={step.step}
                      className="grid grid-cols-[3rem_minmax(0,1fr)] gap-3 rounded-[1.2rem] border border-white/10 bg-white/[0.04] p-3"
                    >
                      <div className="text-lg font-semibold text-slate-400">{step.step}</div>
                      <div>
                        <p className="text-sm font-semibold text-white">{step.title}</p>
                        <p className="mt-1 text-sm leading-6 text-slate-300">
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

        <div className="grid gap-6 lg:min-h-0 lg:flex-1 lg:grid-cols-[24rem_minmax(0,1fr)]">
          <Card className="h-fit rounded-[2rem] border-white/70 bg-white/70 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)] backdrop-blur lg:sticky lg:top-6">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-slate-950 p-3 text-white">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                  Demo menu
                </p>
                <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                  Pick a live scenario
                </h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Each prompt is intentionally curated to show a different slice of
                  Flaim using my actual leagues.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-3">
              {PUBLIC_CHAT_PRESETS.map((preset) => {
                const isSelected = preset.id === selectedPresetId;
                const visual = PRESET_VISUALS[preset.id];
                const Icon = visual.icon;

                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => void handleRunPreset(preset)}
                    disabled={runStatus === "running"}
                    aria-pressed={isSelected}
                    className={cn(
                      "group relative overflow-hidden rounded-[1.6rem] border p-4 text-left transition-all duration-200",
                      isSelected
                        ? "border-slate-900/15 bg-slate-950 text-white shadow-[0_24px_80px_rgba(15,23,42,0.18)]"
                        : "border-white/70 bg-white/80 text-slate-950 hover:-translate-y-0.5 hover:border-slate-900/10 hover:bg-white",
                      runStatus === "running" && !isSelected
                        ? "cursor-not-allowed opacity-70"
                        : ""
                    )}
                  >
                    <div
                      className={cn(
                        "absolute inset-0 opacity-100",
                        isSelected
                          ? "bg-[linear-gradient(145deg,rgba(255,255,255,0.1),transparent_55%)]"
                          : `bg-gradient-to-br ${visual.accent}`
                      )}
                    />
                    <div className="relative">
                      <div className="flex items-start justify-between gap-3">
                        <div
                          className={cn(
                            "flex h-11 w-11 items-center justify-center rounded-2xl",
                            isSelected ? "bg-white/10 text-white" : "bg-slate-950 text-white"
                          )}
                        >
                          <Icon className="h-5 w-5" />
                        </div>
                        <div
                          className={cn(
                            "rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.2em]",
                            isSelected ? "bg-white/10 text-slate-200" : visual.chip
                          )}
                        >
                          {preset.eyebrow}
                        </div>
                      </div>
                      <h3 className="mt-4 text-lg font-semibold tracking-tight">
                        {preset.title}
                      </h3>
                      <p
                        className={cn(
                          "mt-2 text-sm leading-6",
                          isSelected ? "text-slate-300" : "text-slate-600"
                        )}
                      >
                        {preset.description}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="mt-5 rounded-[1.6rem] border border-dashed border-slate-900/12 bg-slate-900/[0.03] p-4 text-sm leading-6 text-slate-600">
              <span className="font-semibold text-slate-950">Data source:</span>{" "}
              Gerry&apos;s leagues and teams
              <br />
              <span className="font-semibold text-slate-950">Scope:</span> read-only
              fantasy data with no visitor sign-in required.
            </div>
          </Card>

          <Card className="flex min-h-[42rem] flex-col overflow-hidden rounded-[2rem] border-white/70 bg-white/72 p-0 shadow-[0_30px_100px_rgba(15,23,42,0.1)] backdrop-blur lg:min-h-0">
            <div className="border-b border-slate-900/8 bg-white/70 px-5 py-5 backdrop-blur">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
                    Live run
                  </p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">
                    Watch the answer get assembled
                  </h2>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Tool activity and response generation stream in real time from the
                    shared demo account.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-semibold",
                      runStatus === "running"
                        ? "bg-amber-500/12 text-amber-700"
                        : runStatus === "completed"
                          ? "bg-emerald-500/12 text-emerald-700"
                          : runStatus === "error"
                            ? "bg-rose-500/12 text-rose-700"
                            : "bg-slate-900/6 text-slate-600"
                    )}
                  >
                    {runStatusLabel}
                  </div>
                  {selectedPreset ? (
                    <div className="rounded-full border border-slate-900/10 bg-white px-3 py-1 text-xs font-medium text-slate-600">
                      {selectedPreset.title}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex-1 bg-[linear-gradient(180deg,rgba(255,255,255,0.45),rgba(248,250,252,0.9))] p-5">
              <div className="h-full rounded-[1.7rem] border border-slate-900/8 bg-white/55 p-4 shadow-inner lg:overflow-hidden">
                <div className="flex h-full flex-col gap-4 pr-1 lg:overflow-y-auto">
                  {selectedPreset ? (
                    <PublicMessage role="user" text={selectedPreset.userMessage} />
                  ) : (
                    <div className="flex h-full min-h-[26rem] items-center justify-center">
                      <div className="max-w-xl text-center">
                        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-[2rem] bg-slate-950 text-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
                          <Sparkles className="h-9 w-9 text-amber-300" />
                        </div>
                        <h3 className="mt-6 text-3xl font-semibold tracking-tight text-slate-950">
                          Pick a prompt and watch Flaim think out loud
                        </h3>
                      <p className="mt-3 text-base leading-7 text-slate-600">
                          This is a public-facing proof point: my actual leagues, live
                          MCP reads, and an answer assembled in front of you.
                        </p>
                      </div>
                    </div>
                  )}

                  {runStatus === "running" ? (
                    <div className="overflow-hidden rounded-[1.75rem] border border-amber-500/20 bg-amber-50/90 px-5 py-4 text-sm text-amber-900 shadow-[0_18px_50px_rgba(245,158,11,0.08)]">
                      <div className="flex items-center gap-2 font-semibold">
                        <LoaderCircle className="h-4 w-4 animate-spin text-amber-600" />
                        Working through the live data
                      </div>
                      <p className="mt-2 leading-6 text-amber-800/80">
                        {thinkingText || "Inspecting Gerry&apos;s leagues and preparing a response."}
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
                    <div className="rounded-[1.75rem] border border-rose-500/20 bg-rose-50/90 px-5 py-4 text-sm text-rose-900 shadow-[0_18px_50px_rgba(244,63,94,0.08)]">
                      <div className="font-semibold">Public chat run failed</div>
                      <p className="mt-2 leading-6">
                        {error || "Unknown public chat error."}
                      </p>
                    </div>
                  ) : null}

                  {runStatus === "completed" && selectedPreset ? (
                    <div className="flex flex-col gap-3 rounded-[1.75rem] border border-slate-900/8 bg-slate-950 px-5 py-4 text-sm text-slate-300 sm:flex-row sm:items-center sm:justify-between">
                      <span>
                        That run used live data from Gerry&apos;s actual leagues.
                      </span>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => void handleRunPreset(selectedPreset)}
                        className="rounded-full bg-white text-slate-950 hover:bg-slate-100"
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
