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
  ArrowRight,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
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
          case "response.reasoning_summary_text.delta": {
            const delta = typeof data.delta === "string" ? data.delta : "";
            if (delta) {
              setThinkingText((current) => current + delta);
            }
            break;
          }
          case "response.output_item.added": {
            const item = data.item as
              | {
                  id?: string;
                  type?: string;
                  name?: string | null;
                  arguments?: string;
                }
              | undefined;

            if (item?.type === "mcp_call" && item.id) {
              const itemId = item.id;
              setToolCalls((current) => [
                ...current,
                {
                  id: itemId,
                  name: item.name,
                  status: "in_progress",
                  arguments: item.arguments || "",
                  parsedArguments: safeParseArguments(item.arguments || ""),
                },
              ]);
            }
            break;
          }
          case "response.mcp_call_arguments.delta":
          case "response.mcp_call_arguments.done": {
            const itemId =
              typeof data.item_id === "string" ? data.item_id : undefined;
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
                  event === "response.mcp_call_arguments.delta"
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
          case "response.output_text.delta": {
            const delta = typeof data.delta === "string" ? data.delta : "";
            if (delta) {
              hasStreamedAssistantTextRef.current = true;
              setAssistantText((current) => current + delta);
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

            if (item?.type === "mcp_call" && item.id) {
              setToolCalls((current) =>
                current.map((toolCall) =>
                  toolCall.id === item.id
                    ? { ...toolCall, status: "completed" }
                    : toolCall
                )
              );
            }

            if (item?.type === "message" && !hasStreamedAssistantTextRef.current) {
              const fallbackText = extractAssistantText(item);
              if (fallbackText) {
                hasStreamedAssistantTextRef.current = true;
                setAssistantText(fallbackText);
              }
            }
            break;
          }
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
    <div className="relative min-h-full overflow-hidden bg-background">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(59,130,246,0.12),_transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(16,185,129,0.12),_transparent_28%)]" />

      <div className="relative mx-auto flex h-full w-full max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-muted-foreground">
              Live demo
            </p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              Watch Flaim work against a real linked account
            </h1>
          </div>
          <Button asChild variant="outline" className="shrink-0">
            <Link href="/">
              Back home
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>

        <div className="mt-5 grid flex-1 gap-5 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <Card className="border-border/70 bg-background/85 p-4 backdrop-blur">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-primary/10 p-2 text-primary">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div className="space-y-2">
                <h2 className="text-lg font-semibold text-foreground">
                  Preset live prompts
                </h2>
                <p className="text-sm text-muted-foreground">
                  Each run uses a server-owned demo account and live MCP calls. This
                  first version is preset-only on purpose.
                </p>
              </div>
            </div>

            <div className="mt-4 grid gap-3">
              {PUBLIC_CHAT_PRESETS.map((preset) => {
                const isSelected = preset.id === selectedPresetId;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => void handleRunPreset(preset)}
                    disabled={runStatus === "running"}
                    aria-pressed={isSelected}
                    className={cn(
                      "rounded-2xl border p-4 text-left transition-colors",
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card/80 hover:border-primary/40 hover:bg-card",
                      runStatus === "running" && !isSelected
                        ? "cursor-not-allowed opacity-70"
                        : ""
                    )}
                  >
                    <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                      {preset.eyebrow}
                    </p>
                    <h3 className="mt-2 text-base font-semibold text-foreground">
                      {preset.title}
                    </h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {preset.description}
                    </p>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 rounded-2xl border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
              Demo identity: <span className="font-medium text-foreground">demo@flaim.app</span>
              <br />
              Scope: read-only fantasy data, no visitor sign-in required.
            </div>
          </Card>

          <Card className="flex min-h-[38rem] flex-col border-border/70 bg-background/85 p-4 backdrop-blur">
            <div className="flex items-center justify-between gap-3 border-b border-border/70 pb-4">
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  Live run
                </h2>
                <p className="text-sm text-muted-foreground">
                  Streaming tool activity and answer generation in real time.
                </p>
              </div>
              {selectedPreset ? (
                <div className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                  {selectedPreset.title}
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex-1 space-y-4 overflow-y-auto pr-1">
              {selectedPreset ? (
                <PublicMessage role="user" text={selectedPreset.prompt} />
              ) : (
                <div className="flex h-full min-h-[26rem] items-center justify-center">
                  <div className="max-w-md text-center">
                    <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      <Sparkles className="h-7 w-7" />
                    </div>
                    <h3 className="mt-4 text-xl font-semibold text-foreground">
                      Pick a prompt to start the demo
                    </h3>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Flaim will run the prompt against a live demo account and show
                      the MCP activity as it happens.
                    </p>
                  </div>
                </div>
              )}

              {runStatus === "running" ? (
                <div className="rounded-2xl border border-border bg-card/90 px-4 py-3 text-sm text-muted-foreground shadow-sm">
                  <div className="flex items-center gap-2 font-medium text-foreground">
                    <LoaderCircle className="h-4 w-4 animate-spin text-primary" />
                    Working through the live data
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {thinkingText || "Inspecting the demo account and preparing a response."}
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
                <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                  <div className="font-medium">Public chat run failed</div>
                  <p className="mt-2">{error || "Unknown public chat error."}</p>
                </div>
              ) : null}

              {runStatus === "completed" && selectedPreset ? (
                <div className="flex items-center justify-between rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
                  <span>That run used live data from the shared demo account.</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleRunPreset(selectedPreset)}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Run again
                  </Button>
                </div>
              ) : null}

              <div ref={transcriptEndRef} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
