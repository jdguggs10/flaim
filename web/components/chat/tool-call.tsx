"use client";
import React, { useState } from "react";

import { ToolCallItem } from "@/lib/chat/assistant";
import useToolsStore from "@/stores/chat/useToolsStore";
import { BookOpenText, Clock, Globe, Zap, Code2, Download, Timer, Copy, Check, ChevronDown, ChevronRight, AlertTriangle, ExternalLink } from "lucide-react";
import Link from "next/link";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { coy } from "react-syntax-highlighter/dist/esm/styles/prism";

interface ToolCallProps {
  toolCall: ToolCallItem;
}

// Format duration for display
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

// Timing badge component
function TimingBadge({ durationMs }: { durationMs?: number }) {
  if (!durationMs) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full ml-2">
      <Timer size={12} />
      {formatDuration(durationMs)}
    </span>
  );
}

// Copy button component
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
      title={copied ? "Copied!" : "Copy to clipboard"}
    >
      {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
    </button>
  );
}

// Get error suggestion based on error content
function getErrorSuggestion(error?: string): { message: string; link?: string; linkText?: string } | null {
  if (!error) return null;

  const errorLower = error.toLowerCase();

  if (errorLower.includes('401') || errorLower.includes('unauthorized') || errorLower.includes('authentication')) {
    return { message: 'ESPN credentials may be expired', link: '/leagues', linkText: 'Check credentials' };
  }
  if (errorLower.includes('429') || errorLower.includes('rate limit')) {
    return { message: 'Rate limit exceeded. Wait a moment before retrying.', link: undefined, linkText: undefined };
  }
  if (errorLower.includes('500') || errorLower.includes('internal server')) {
    return { message: 'MCP server error. Check worker logs in Cloudflare.', link: undefined, linkText: undefined };
  }
  if (errorLower.includes('timeout') || errorLower.includes('timed out')) {
    return { message: 'Request timed out. The MCP server may be slow or unavailable.', link: undefined, linkText: undefined };
  }
  if (errorLower.includes('not found') || errorLower.includes('404')) {
    return { message: 'Resource not found. Check league ID or team ID.', link: '/leagues', linkText: 'Verify leagues' };
  }

  return null;
}

// Error banner component for failed tool calls
function ErrorBanner({ error, output }: { error?: string; output?: string | null }) {
  // Try to extract error from output if no explicit error
  const errorMessage = error || (output && output.includes('error') ? output : null);
  if (!errorMessage) return null;

  const suggestion = getErrorSuggestion(errorMessage);

  return (
    <div className="mx-6 mb-2 p-3 bg-red-50 border border-red-200 rounded-lg">
      <div className="flex items-start gap-2">
        <AlertTriangle size={16} className="text-red-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-red-800 font-medium">Error</p>
          <p className="text-xs text-red-700 mt-1 break-words">{errorMessage}</p>
          {suggestion && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-red-600">{suggestion.message}</span>
              {suggestion.link && (
                <Link
                  href={suggestion.link}
                  className="inline-flex items-center gap-1 text-xs text-red-700 hover:text-red-900 underline"
                >
                  {suggestion.linkText}
                  <ExternalLink size={10} />
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Server URL display for debug mode
function ServerUrlBadge({ serverUrl }: { serverUrl?: string }) {
  if (!serverUrl) return null;

  return (
    <div className="mx-6 mb-2 px-2 py-1 bg-slate-100 border border-slate-200 rounded text-xs text-slate-600 font-mono truncate">
      → {serverUrl}
    </div>
  );
}

function ApiCallCell({ toolCall }: ToolCallProps) {
  const { debugMode } = useToolsStore();
  const [expanded, setExpanded] = useState(true);

  const requestJson = JSON.stringify(toolCall.parsedArguments, null, 2);
  const responseJson = toolCall.output
    ? (() => {
        try {
          return JSON.stringify(JSON.parse(toolCall.output), null, 2);
        } catch {
          return toolCall.output;
        }
      })()
    : null;

  return (
    <div className="flex flex-col w-[70%] relative mb-[-8px]">
      <div>
        <div className="flex flex-col text-sm rounded-[16px]">
          <div className="font-semibold p-3 pl-0 text-gray-700 rounded-b-none flex gap-2">
            <div className="flex gap-2 items-center text-blue-500 ml-[-8px]">
              <button
                onClick={() => setExpanded(!expanded)}
                className="p-0.5 rounded hover:bg-muted transition-colors"
                title={expanded ? "Collapse" : "Expand"}
              >
                {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
              <Zap size={16} />
              <div className="text-sm font-medium">
                {toolCall.status === "completed"
                  ? `Called ${toolCall.name}`
                  : `Calling ${toolCall.name}...`}
              </div>
              {toolCall.status === "completed" && (
                <TimingBadge durationMs={toolCall.metadata?.durationMs} />
              )}
            </div>
          </div>

          {expanded && (
            <div className="bg-[#fafafa] rounded-xl py-2 ml-4 mt-2">
              <div className="max-h-96 overflow-y-scroll text-xs border-b mx-6 p-2">
                {debugMode && (
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Request
                    </span>
                    <CopyButton text={requestJson} />
                  </div>
                )}
                <SyntaxHighlighter
                  customStyle={{
                    backgroundColor: "#fafafa",
                    padding: "8px",
                    paddingLeft: "0px",
                    marginTop: 0,
                    marginBottom: 0,
                  }}
                  language="json"
                  style={coy}
                >
                  {requestJson}
                </SyntaxHighlighter>
              </div>
              <div className="max-h-96 overflow-y-scroll mx-6 p-2 text-xs">
                {debugMode && (
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Response
                    </span>
                    {responseJson && <CopyButton text={responseJson} />}
                  </div>
                )}
                {responseJson ? (
                  <SyntaxHighlighter
                    customStyle={{
                      backgroundColor: "#fafafa",
                      padding: "8px",
                      paddingLeft: "0px",
                      marginTop: 0,
                    }}
                    language="json"
                    style={coy}
                  >
                    {responseJson}
                  </SyntaxHighlighter>
                ) : (
                  <div className="text-zinc-500 flex items-center gap-2 py-2">
                    <Clock size={16} /> Waiting for result...
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FileSearchCell({ toolCall }: ToolCallProps) {
  return (
    <div className="flex gap-2 items-center text-blue-500 mb-[-16px] ml-[-8px]">
      <BookOpenText size={16} />
      <div className="text-sm font-medium mb-0.5">
        {toolCall.status === "completed"
          ? "Searched files"
          : "Searching files..."}
      </div>
      {toolCall.status === "completed" && (
        <TimingBadge durationMs={toolCall.metadata?.durationMs} />
      )}
    </div>
  );
}

function WebSearchCell({ toolCall }: ToolCallProps) {
  return (
    <div className="flex gap-2 items-center text-blue-500 mb-[-16px] ml-[-8px]">
      <Globe size={16} />
      <div className="text-sm font-medium">
        {toolCall.status === "completed"
          ? "Searched the web"
          : "Searching the web..."}
      </div>
      {toolCall.status === "completed" && (
        <TimingBadge durationMs={toolCall.metadata?.durationMs} />
      )}
    </div>
  );
}

function McpCallCell({ toolCall }: ToolCallProps) {
  const { debugMode, mcpConfig } = useToolsStore();
  const [expanded, setExpanded] = useState(true);

  const requestJson = JSON.stringify(toolCall.parsedArguments, null, 2);
  const responseJson = toolCall.output
    ? (() => {
        try {
          return JSON.stringify(JSON.parse(toolCall.output), null, 2);
        } catch {
          return toolCall.output;
        }
      })()
    : null;

  const isFailed = toolCall.status === "failed";
  const hasError = isFailed || toolCall.metadata?.error;

  return (
    <div className="flex flex-col w-[70%] relative mb-[-8px]">
      <div>
        <div className="flex flex-col text-sm rounded-[16px]">
          <div className="font-semibold p-3 pl-0 text-gray-700 rounded-b-none flex gap-2">
            <div className={`flex gap-2 items-center ml-[-8px] ${hasError ? 'text-red-500' : 'text-blue-500'}`}>
              <button
                onClick={() => setExpanded(!expanded)}
                className="p-0.5 rounded hover:bg-muted transition-colors"
                title={expanded ? "Collapse" : "Expand"}
              >
                {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
              {hasError ? <AlertTriangle size={16} /> : <Zap size={16} />}
              <div className="text-sm font-medium">
                {isFailed
                  ? `Failed: ${toolCall.name}`
                  : toolCall.status === "completed"
                  ? `Called ${toolCall.name} via MCP tool`
                  : `Calling ${toolCall.name} via MCP tool...`}
              </div>
              {toolCall.status === "completed" && (
                <TimingBadge durationMs={toolCall.metadata?.durationMs} />
              )}
            </div>
          </div>

          {expanded && (
            <div className={`rounded-xl py-2 ml-4 mt-2 ${hasError ? 'bg-red-50 border border-red-200' : 'bg-[#fafafa]'}`}>
              {/* Server URL in debug mode */}
              {debugMode && mcpConfig?.server_url && (
                <ServerUrlBadge serverUrl={mcpConfig.server_url} />
              )}
              {/* Error banner for failed calls */}
              {hasError && (
                <ErrorBanner error={toolCall.metadata?.error} output={toolCall.output} />
              )}
              <div className="max-h-96 overflow-y-scroll text-xs border-b mx-6 p-2">
                {debugMode && (
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Request
                    </span>
                    <CopyButton text={requestJson} />
                  </div>
                )}
                <SyntaxHighlighter
                  customStyle={{
                    backgroundColor: "#fafafa",
                    padding: "8px",
                    paddingLeft: "0px",
                    marginTop: 0,
                    marginBottom: 0,
                  }}
                  language="json"
                  style={coy}
                >
                  {requestJson}
                </SyntaxHighlighter>
              </div>
              <div className="max-h-96 overflow-y-scroll mx-6 p-2 text-xs">
                {debugMode && (
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Response
                    </span>
                    {responseJson && <CopyButton text={responseJson} />}
                  </div>
                )}
                {responseJson ? (
                  <SyntaxHighlighter
                    customStyle={{
                      backgroundColor: "#fafafa",
                      padding: "8px",
                      paddingLeft: "0px",
                      marginTop: 0,
                    }}
                    language="json"
                    style={coy}
                  >
                    {responseJson}
                  </SyntaxHighlighter>
                ) : (
                  <div className="text-zinc-500 flex items-center gap-2 py-2">
                    <Clock size={16} /> Waiting for result...
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CodeInterpreterCell({ toolCall }: ToolCallProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="flex flex-col w-[70%] relative mb-[-8px]">
      <div className="flex flex-col text-sm rounded-[16px]">
        <div className="font-semibold p-3 pl-0 text-gray-700 rounded-b-none flex gap-2">
          <div
            className="flex gap-2 items-center text-blue-500 ml-[-8px] cursor-pointer"
            onClick={() => setOpen(!open)}
          >
            <Code2 size={16} />
            <div className="text-sm font-medium">
              {toolCall.status === "completed"
                ? "Code executed"
                : "Running code interpreter..."}
            </div>
            {toolCall.status === "completed" && (
              <TimingBadge durationMs={toolCall.metadata?.durationMs} />
            )}
          </div>
        </div>
        <div className="bg-[#fafafa] rounded-xl py-2 ml-4 mt-2">
          <div className="mx-6 p-2 text-xs">
            <SyntaxHighlighter
              customStyle={{
                backgroundColor: "#fafafa",
                padding: "8px",
                paddingLeft: "0px",
                marginTop: 0,
              }}
              language="python"
              style={coy}
            >
              {toolCall.code || ""}
            </SyntaxHighlighter>
          </div>
        </div>
        {toolCall.files && toolCall.files.length > 0 && (
          <div className="flex gap-2 mt-2 ml-4 flex-wrap">
            {toolCall.files.map((f) => (
              <a
                key={f.file_id}
                href={`/api/chat/container_files/content?file_id=${f.file_id}${f.container_id ? `&container_id=${f.container_id}` : ""}${f.filename ? `&filename=${encodeURIComponent(f.filename)}` : ""}`}
                download
                className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[#ededed] text-xs text-zinc-500"
              >
                {f.filename || f.file_id}
                <Download size={12} />
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ToolCall({ toolCall }: ToolCallProps) {
  return (
    <div className="flex justify-start pt-2">
      {(() => {
        switch (toolCall.tool_type) {
          case "function_call":
            return <ApiCallCell toolCall={toolCall} />;
          case "file_search_call":
            return <FileSearchCell toolCall={toolCall} />;
          case "web_search_call":
            return <WebSearchCell toolCall={toolCall} />;
          case "mcp_call":
            return <McpCallCell toolCall={toolCall} />;
          case "code_interpreter_call":
            return <CodeInterpreterCell toolCall={toolCall} />;
          default:
            return null;
        }
      })()}
    </div>
  );
}
