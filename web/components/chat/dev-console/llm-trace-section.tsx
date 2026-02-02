"use client";

import { useMemo, useState } from "react";
import { Activity, ChevronDown, ChevronRight } from "lucide-react";
import useConversationStore from "@/stores/chat/useConversationStore";
import { CollapsibleSection } from "./collapsible-section";
import { CopyButton } from "./copy-button";
import { LlmTraceEntry, TraceToolEvent } from "@/lib/chat/trace-types";

const formatTimestamp = (value: string) => {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
};

const formatJson = (value: unknown) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    try {
      return String(value);
    } catch {
      return "[unserializable]";
    }
  }
};

const formatMaybeJsonString = (value: string) => {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  ) {
    try {
      return JSON.stringify(JSON.parse(trimmed), null, 2);
    } catch {
      return value;
    }
  }
  return value;
};

const formatValue = (value: unknown) => {
  if (value == null) return null;
  if (typeof value === "string") {
    return formatMaybeJsonString(value);
  }
  return formatJson(value);
};

const hasParsedArguments = (value: unknown) => {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.length > 0;
  return Object.keys(value as Record<string, unknown>).length > 0;
};

const getToolLabel = (event: TraceToolEvent) => {
  if (event.name) {
    return `${event.tool_type} · ${event.name}`;
  }
  return event.tool_type;
};

const statusClass = (status?: string) => {
  if (status === "completed") return "text-success";
  if (status === "failed") return "text-destructive";
  if (status === "in_progress") return "text-muted-foreground";
  return "text-muted-foreground";
};

function TraceEntryCard({ entry }: { entry: LlmTraceEntry }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const toolCount = entry.toolEvents.length;
  const promptPayload = useMemo(
    () => ({
      sentAt: entry.sentAt,
      previousResponseId: entry.previousResponseId ?? null,
      inputItems: entry.inputItems,
      systemPrompt: entry.systemPrompt,
      leagueContext: entry.leagueContext ?? null,
      userMessage: entry.userMessage ?? null,
      toolsSnapshot: entry.toolsSnapshot,
    }),
    [
      entry.sentAt,
      entry.previousResponseId,
      entry.inputItems,
      entry.systemPrompt,
      entry.leagueContext,
      entry.userMessage,
      entry.toolsSnapshot,
    ],
  );
  const promptJson = useMemo(() => formatJson(promptPayload), [promptPayload]);
  const assistantOutput = entry.assistantOutput ?? "";
  const assistantOutputLabel = assistantOutput
    ? assistantOutput
    : "No assistant output recorded.";

  return (
    <div className="border border-border rounded-lg overflow-hidden bg-card">
      <button
        type="button"
        onClick={() => setIsExpanded((prev) => !prev)}
        className="w-full flex items-start justify-between gap-3 p-3 bg-secondary/30 hover:bg-secondary/50 transition-colors text-left"
        aria-expanded={isExpanded}
      >
        <div className="flex items-start gap-2 min-w-0">
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground mt-0.5" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground mt-0.5" />
          )}
          <div className="min-w-0">
            <div className="text-xs font-medium text-foreground">
              Request · {formatTimestamp(entry.sentAt)}
            </div>
            <div className="text-[11px] text-muted-foreground truncate">
              {entry.userMessage ? entry.userMessage : "No user message recorded."}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
          <span>{toolCount} tool{toolCount === 1 ? "" : "s"}</span>
          {entry.error && (
            <span className="text-destructive">Error</span>
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="p-3 space-y-3 border-t border-border">
          <div className="border border-border rounded-md overflow-hidden bg-secondary/20">
            <div className="flex items-center justify-between px-2 py-1 border-b border-border">
              <span className="text-xs text-muted-foreground">Prompt Sent</span>
              <CopyButton value={promptJson} />
            </div>
            <pre className="text-[11px] leading-snug font-mono whitespace-pre-wrap break-words p-2 max-h-64 overflow-y-auto">
              {promptJson}
            </pre>
          </div>

          <div className="border border-border rounded-md overflow-hidden bg-secondary/20">
            <div className="flex items-center justify-between px-2 py-1 border-b border-border">
              <span className="text-xs text-muted-foreground">Tools</span>
              <span className="text-[11px] text-muted-foreground">
                {toolCount === 0 ? "No tool calls" : `${toolCount} call${toolCount === 1 ? "" : "s"}`}
              </span>
            </div>
            <div className="p-2 space-y-2">
              {toolCount === 0 ? (
                <div className="text-[11px] text-muted-foreground">
                  No tools were invoked for this request.
                </div>
              ) : (
                entry.toolEvents.map((event) => {
                  const argsValue = hasParsedArguments(event.parsedArguments)
                    ? event.parsedArguments
                    : event.arguments;
                  const argsText = formatValue(argsValue);
                  const outputText = formatValue(event.output ?? null);

                  return (
                    <div
                      key={event.id}
                      className="border border-border rounded-md overflow-hidden bg-background"
                    >
                      <div className="flex items-center justify-between px-2 py-1 bg-secondary/40">
                        <div className="text-[11px] font-mono text-foreground truncate">
                          {getToolLabel(event)}
                        </div>
                        <div className={`text-[11px] ${statusClass(event.status)}`}>
                          {event.status ?? "unknown"}
                        </div>
                      </div>
                      <div className="p-2 space-y-2">
                        {argsText ? (
                          <div className="space-y-1">
                            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                              Args
                            </div>
                            <pre className="text-[11px] leading-snug font-mono whitespace-pre-wrap break-words bg-secondary/30 p-2 rounded">
                              {argsText}
                            </pre>
                          </div>
                        ) : (
                          <div className="text-[11px] text-muted-foreground">
                            No arguments recorded.
                          </div>
                        )}
                        {outputText ? (
                          <div className="space-y-1">
                            <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                              Output
                            </div>
                            <pre className="text-[11px] leading-snug font-mono whitespace-pre-wrap break-words bg-secondary/30 p-2 rounded">
                              {outputText}
                            </pre>
                          </div>
                        ) : (
                          <div className="text-[11px] text-muted-foreground">
                            No output recorded.
                          </div>
                        )}
                        {event.error && (
                          <div className="text-[11px] text-destructive break-words">
                            Error: {event.error}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="border border-border rounded-md overflow-hidden bg-secondary/20">
            <div className="flex items-center justify-between px-2 py-1 border-b border-border">
              <span className="text-xs text-muted-foreground">Assistant Output</span>
              <CopyButton value={assistantOutput} />
            </div>
            <pre className="text-[11px] leading-snug font-mono whitespace-pre-wrap break-words p-2 max-h-64 overflow-y-auto">
              {assistantOutputLabel}
            </pre>
          </div>

          {entry.error && (
            <div className="text-[11px] text-destructive bg-destructive/10 px-2 py-1 rounded">
              Request error: {entry.error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function LlmTraceSection() {
  const traceEntries = useConversationStore((state) => state.traceEntries);

  const sortedEntries = useMemo(
    () => [...traceEntries].reverse(),
    [traceEntries],
  );

  return (
    <CollapsibleSection
      title={`LLM Trace (${traceEntries.length})`}
      icon={<Activity size={16} />}
      defaultExpanded={false}
    >
      <div className="space-y-3">
        {sortedEntries.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-4">
            No trace entries yet.
          </div>
        ) : (
          sortedEntries.map((entry) => (
            <TraceEntryCard key={entry.id} entry={entry} />
          ))
        )}
      </div>
    </CollapsibleSection>
  );
}
