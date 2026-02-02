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
  return {
    previous_response_id: entry.previousResponseId ?? null,
    input_items: entry.inputItems,
    tools_snapshot: entry.toolsSnapshot,
  };
}

function formatJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[unserializable]";
  }
}

export function LlmTraceSection() {
  const { traceEntries } = useConversationStore();
  const [openEntryIds, setOpenEntryIds] = useState<Record<string, boolean>>({});

  const entries = useMemo(() => [...traceEntries].reverse(), [traceEntries]);

  const toggleEntry = (id: string) => {
    setOpenEntryIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <CollapsibleSection
      title={`LLM Trace${entries.length > 0 ? ` (${entries.length})` : ""}`}
      icon={<ClipboardList size={16} />}
      defaultExpanded={false}
    >
      {entries.length === 0 ? (
        <div className="text-xs text-muted-foreground">No trace entries yet.</div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry, index) => {
            const promptPayload = buildPromptPayload(entry);
            const promptText = formatJson(promptPayload);
            const assistantOutput = entry.assistantOutput || "";
            const userSnippet = entry.userMessage || "(no user message)";
            const toolCount = entry.toolEvents.length;
            const isOpen = openEntryIds[entry.id] ?? index === 0;

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
                      {formatTimestamp(entry.sentAt)} - {toolCount} tool{toolCount === 1 ? "" : "s"}
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
                            const argsText = tool.arguments?.length
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
