"use client";

import { useMemo, useState } from "react";
import { ClipboardList } from "lucide-react";
import useConversationStore from "@/stores/chat/useConversationStore";
import { CollapsibleSection } from "./collapsible-section";
import { CopyButton } from "./copy-button";

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString();
}

function buildPromptPayload(entry: {
  previousResponseId?: string | null;
  inputItems: unknown[];
  toolsSnapshot: unknown[];
}) {
  const payload: Record<string, unknown> = {
    messages: entry.inputItems,
    tools: entry.toolsSnapshot,
  };

  if (entry.previousResponseId) {
    payload.previous_response_id = entry.previousResponseId;
  }

  return payload;
}

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[unserializable]";
  }
}

function formatTokens(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function LlmTraceSection() {
  const traceEntries = useConversationStore((state) => state.traceEntries);
  const [openEntryIds, setOpenEntryIds] = useState<Record<string, boolean>>({});

  const entries = useMemo(() => [...traceEntries].reverse(), [traceEntries]);

  const sessionTotals = useMemo(() => {
    let input = 0;
    let output = 0;
    for (const e of traceEntries) {
      if (e.usage) {
        input += e.usage.input_tokens;
        output += e.usage.output_tokens;
      }
    }
    return input + output > 0 ? { input, output, total: input + output } : null;
  }, [traceEntries]);

  const toggleEntry = (id: string) => {
    setOpenEntryIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <CollapsibleSection
      title={`LLM Trace${entries.length > 0 ? ` (${entries.length})` : ""}`}
      icon={<ClipboardList size={16} />}
      defaultExpanded={false}
      rightElement={
        sessionTotals ? (
          <span className="text-[10px] text-muted-foreground font-mono">
            {formatTokens(sessionTotals.input)} in / {formatTokens(sessionTotals.output)} out
          </span>
        ) : undefined
      }
    >
      {entries.length === 0 ? (
        <div className="text-xs text-muted-foreground">No trace entries yet.</div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry, index) => {
            const assistantOutput = entry.assistantOutput || "";
            const userSnippet = entry.userMessage || "(no user message)";
            const toolCount = entry.toolEvents.length;
            const isOpen = openEntryIds[entry.id] ?? index === 0;
            const promptPayload = isOpen ? buildPromptPayload(entry) : null;
            const promptText = promptPayload ? formatJson(promptPayload) : "";

            return (
              <div
                key={entry.id}
                className="border border-border rounded-lg overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => toggleEntry(entry.id)}
                  className="w-full flex items-center justify-between gap-3 p-2 text-left hover:bg-secondary/40 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-foreground truncate">
                      {userSnippet}
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {formatTimestamp(entry.sentAt)} · {toolCount} tool{toolCount === 1 ? "" : "s"}
                      {entry.usage && (
                        <> · <span className="font-mono">{formatTokens(entry.usage.input_tokens)} in / {formatTokens(entry.usage.output_tokens)} out</span></>
                      )}
                    </div>
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {isOpen ? "Hide" : "Show"}
                  </div>
                </button>

                {isOpen && (
                  <div className="border-t border-border px-3 py-2 space-y-3">
                    {entry.error && (
                      <div className="text-xs text-destructive bg-destructive/10 px-2 py-1 rounded space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-destructive">Trace Error</span>
                          <CopyButton value={entry.error} />
                        </div>
                        <div className="break-words">{entry.error}</div>
                      </div>
                    )}

                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-foreground">Prompt Sent</span>
                        <CopyButton value={promptText} />
                      </div>
                      <pre className="text-[11px] leading-snug font-mono bg-secondary/40 px-2 py-2 rounded max-h-48 overflow-y-auto whitespace-pre-wrap">
                        {promptText}
                      </pre>
                    </div>

                    {entry.usage && (
                      <div className="space-y-1">
                        <span className="text-xs font-medium text-foreground">Token Usage</span>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-[10px] font-mono bg-secondary/40 px-2 py-1.5 rounded">
                          <span className="text-muted-foreground">Input</span>
                          <span className="text-foreground">{entry.usage.input_tokens.toLocaleString()}</span>
                          {entry.usage.input_tokens_details?.cached_tokens != null && entry.usage.input_tokens_details.cached_tokens > 0 && (
                            <>
                              <span className="text-muted-foreground pl-2">└ cached</span>
                              <span className="text-foreground">{entry.usage.input_tokens_details.cached_tokens.toLocaleString()}</span>
                            </>
                          )}
                          <span className="text-muted-foreground">Output</span>
                          <span className="text-foreground">{entry.usage.output_tokens.toLocaleString()}</span>
                          {entry.usage.output_tokens_details?.reasoning_tokens != null && entry.usage.output_tokens_details.reasoning_tokens > 0 && (
                            <>
                              <span className="text-muted-foreground pl-2">└ reasoning</span>
                              <span className="text-foreground">{entry.usage.output_tokens_details.reasoning_tokens.toLocaleString()}</span>
                            </>
                          )}
                          <span className="text-muted-foreground font-medium">Total</span>
                          <span className="text-foreground font-medium">{entry.usage.total_tokens.toLocaleString()}</span>
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <div className="text-xs font-medium text-foreground">Tools</div>
                      {entry.toolEvents.length === 0 ? (
                        <div className="text-xs text-muted-foreground">No tool calls.</div>
                      ) : (
                        <div className="space-y-2">
                          {entry.toolEvents.map((tool) => {
                            const label = tool.name
                              ? `${tool.tool_type} - ${tool.name}`
                              : tool.tool_type;
                            const argsText = tool.arguments?.trim().length
                              ? tool.arguments
                              : tool.parsedArguments
                                ? formatJson(tool.parsedArguments)
                                : "";
                            const outputText = tool.output ?? "";
                            return (
                              <div
                                key={`${entry.id}-${tool.id}`}
                                className="border border-border rounded-md p-2 space-y-2"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <div className="text-xs font-medium text-foreground">
                                      {label}
                                    </div>
                                    <div className="text-[10px] text-muted-foreground">
                                      {tool.status || "status unknown"}
                                    </div>
                                  </div>
                                  {tool.error && (
                                    <span className="text-[10px] text-destructive">Error</span>
                                  )}
                                </div>

                                {tool.error && (
                                  <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[10px] text-destructive">Error</span>
                                      <CopyButton value={tool.error} />
                                    </div>
                                    <div className="text-[10px] text-destructive break-words">
                                      {tool.error}
                                    </div>
                                  </div>
                                )}

                                {argsText && (
                                  <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[10px] text-muted-foreground">
                                        Arguments
                                      </span>
                                      <CopyButton value={argsText} />
                                    </div>
                                    <pre className="text-[10px] leading-snug font-mono bg-secondary/40 px-2 py-2 rounded max-h-32 overflow-y-auto whitespace-pre-wrap">
                                      {argsText}
                                    </pre>
                                  </div>
                                )}

                                {outputText && (
                                  <div className="space-y-1">
                                    <div className="flex items-center justify-between">
                                      <span className="text-[10px] text-muted-foreground">
                                        Output
                                      </span>
                                      <CopyButton value={outputText} />
                                    </div>
                                    <pre className="text-[10px] leading-snug font-mono bg-secondary/40 px-2 py-2 rounded max-h-32 overflow-y-auto whitespace-pre-wrap">
                                      {outputText}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-foreground">Assistant Output</span>
                        <CopyButton value={assistantOutput} />
                      </div>
                      <pre className="text-[11px] leading-snug font-mono bg-secondary/40 px-2 py-2 rounded max-h-48 overflow-y-auto whitespace-pre-wrap">
                        {assistantOutput || "(no assistant output)"}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </CollapsibleSection>
  );
}
