"use client";

import { useMemo, useState, useCallback } from "react";
import { Zap, Check, X, Loader2, ExternalLink } from "lucide-react";
import useToolsStore from "@/stores/chat/useToolsStore";
import useLeaguesStore from "@/stores/chat/useLeaguesStore";
import { getAllEspnMcpServers, getSportConfig, McpServerInfo } from "@/lib/chat/league-mapper";
import { DISABLE_ALL_TOOLS_SENTINEL } from "@/lib/chat/tools/mcp-constants";
import { CollapsibleSection } from "./collapsible-section";
import { CopyButton } from "./copy-button";
import { Switch } from "@/components/ui";
import { Button } from "@/components/ui/button";

type ConnectionStatus = "unknown" | "connected" | "error" | "testing";

interface ServerConnectionState {
  status: ConnectionStatus;
  isTesting: boolean;
  error: string | null;
}

function ServerCard({ server }: { server: McpServerInfo }) {
  const {
    mcpConfig,
    clerkUserId,
    clerkToken,
    mcpAvailableToolsByServer,
    disabledMcpToolsByServer,
  } = useToolsStore();

  const [connectionState, setConnectionState] = useState<ServerConnectionState>({
    status: "unknown",
    isTesting: false,
    error: null,
  });

  const sportConfig = getSportConfig(server.sport);

  const serverHost = useMemo(() => {
    if (!server.server_url) return null;
    try {
      return new URL(server.server_url).host;
    } catch {
      return null;
    }
  }, [server.server_url]);

  // Build the MCP payload for this specific server
  const mcpPayload = useMemo(() => {
    const availableTools = mcpAvailableToolsByServer[server.server_label] || [];
    const disabledTools = disabledMcpToolsByServer[server.server_label] || [];
    const disableAll = disabledTools.includes(DISABLE_ALL_TOOLS_SENTINEL);

    const headers = {
      "Content-Type": "application/json",
      ...(clerkUserId ? { "X-Clerk-User-ID": clerkUserId } : {}),
      ...(clerkToken ? { Authorization: `Bearer ${clerkToken}` } : {}),
    };

    const payload: any = {
      type: "mcp",
      server_label: server.server_label,
      server_url: server.server_url,
      headers,
      require_approval: mcpConfig.skip_approval ? "never" : "manual",
    };

    if (disableAll) {
      payload.allowed_tools = [];
    } else if (availableTools.length > 0 && disabledTools.length > 0) {
      payload.allowed_tools = availableTools.filter(
        (tool) => !disabledTools.includes(tool)
      );
    }

    return payload;
  }, [server, mcpConfig.skip_approval, clerkUserId, clerkToken, mcpAvailableToolsByServer, disabledMcpToolsByServer]);

  // Redact sensitive headers for display
  const redactedPayload = useMemo(() => {
    if (!mcpPayload) return null;
    const headers = mcpPayload.headers || {};
    const redactedHeaders: Record<string, string> = {};
    Object.entries(headers).forEach(([key, value]) => {
      if (typeof value !== "string") return;
      if (key.toLowerCase() === "authorization") {
        redactedHeaders[key] = "Bearer ***redacted***";
        return;
      }
      if (key.toLowerCase().includes("clerk")) {
        redactedHeaders[key] = value.length > 8
          ? `${value.slice(0, 6)}…${value.slice(-4)}`
          : "***";
        return;
      }
      redactedHeaders[key] = value;
    });
    return { ...mcpPayload, headers: redactedHeaders };
  }, [mcpPayload]);

  const testConnection = useCallback(async () => {
    setConnectionState({ status: "testing", isTesting: true, error: null });
    try {
      const res = await fetch("/api/debug/test-mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverUrl: server.server_url }),
      });
      const data = await res.json() as { connected: boolean; error?: string };
      if (data.connected) {
        setConnectionState({ status: "connected", isTesting: false, error: null });
      } else {
        setConnectionState({
          status: "error",
          isTesting: false,
          error: data.error || "Connection failed",
        });
      }
    } catch {
      setConnectionState({
        status: "error",
        isTesting: false,
        error: "Network error",
      });
    }
  }, [server.server_url]);

  const generateCurl = useCallback(() => {
    const curl = `curl -X POST "${server.server_url}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'`;
    navigator.clipboard.writeText(curl);
  }, [server.server_url]);

  const StatusBadge = () => {
    switch (connectionState.status) {
      case "connected":
        return (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <Check className="h-3 w-3" />
            Connected
          </span>
        );
      case "error":
        return (
          <span className="flex items-center gap-1 text-xs text-red-600">
            <X className="h-3 w-3" />
            Error
          </span>
        );
      case "testing":
        return (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Testing...
          </span>
        );
      default:
        return (
          <span className="text-xs text-muted-foreground">Not tested</span>
        );
    }
  };

  return (
    <div className="border border-border rounded-lg p-3 space-y-3">
      {/* Server title with sport emoji */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span>{sportConfig?.emoji || "🎮"}</span>
          <span className="font-medium text-sm">{sportConfig?.name || server.sport}</span>
        </div>
        <StatusBadge />
      </div>

      {/* Server Label */}
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">Server label:</div>
        <code className="text-xs bg-secondary px-2 py-1 rounded font-mono block truncate">
          {server.server_label}
        </code>
      </div>

      {/* Server Host */}
      {serverHost && (
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Host:</div>
          <code className="text-xs bg-secondary px-2 py-1 rounded font-mono block truncate">
            {serverHost}
          </code>
        </div>
      )}

      {/* Server URL */}
      <div className="space-y-1">
        <div className="text-xs text-muted-foreground">URL:</div>
        <div className="flex items-center gap-1">
          <code className="text-xs bg-secondary px-2 py-1 rounded font-mono flex-1 truncate">
            {server.server_url}
          </code>
          <CopyButton value={server.server_url} />
          <a
            href={server.server_url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            title="Open in new tab"
          >
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      </div>

      {/* Error message */}
      {connectionState.error && (
        <div className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded">
          {connectionState.error}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={testConnection}
          disabled={connectionState.isTesting}
          className="flex-1 text-xs"
        >
          {connectionState.isTesting ? (
            <>
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              Testing...
            </>
          ) : (
            "Test"
          )}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={generateCurl}
          className="text-xs"
          title="Copy cURL command"
        >
          cURL
        </Button>
      </div>

      {/* LLM payload preview (collapsible) */}
      <details className="pt-2 border-t border-border">
        <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
          LLM payload (redacted)
        </summary>
        <pre className="mt-2 text-[10px] leading-snug font-mono bg-secondary/50 px-2 py-2 rounded max-h-32 overflow-y-auto whitespace-pre-wrap">
          {JSON.stringify(redactedPayload, null, 2)}
        </pre>
      </details>
    </div>
  );
}

export function McpSection() {
  const {
    mcpEnabled,
    setMcpEnabled,
    mcpConfig,
    isAuthenticated,
  } = useToolsStore();

  const { leagues } = useLeaguesStore();

  // Check if MCP should be available
  const shouldShowMcp = leagues.length > 0 && isAuthenticated;

  // Get all configured ESPN MCP servers
  const servers = useMemo(() => getAllEspnMcpServers(), []);

  if (!shouldShowMcp) {
    return null;
  }

  return (
    <CollapsibleSection
      title={`MCP Servers (${servers.length})`}
      icon={<Zap size={16} />}
      defaultExpanded={false}
      rightElement={
        <Switch
          checked={mcpEnabled}
          onCheckedChange={setMcpEnabled}
        />
      }
    >
      <div className="space-y-4">
        {/* Global auto-approve toggle */}
        <div className="flex items-center justify-between pb-2 border-b border-border">
          <span className="text-xs text-muted-foreground">Auto-approve tools (all servers):</span>
          <Switch
            checked={mcpConfig.skip_approval}
            onCheckedChange={(checked) =>
              useToolsStore.getState().setMcpConfig({ ...mcpConfig, skip_approval: checked })
            }
            disabled={!mcpEnabled}
          />
        </div>

        {/* Server cards */}
        {servers.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-4">
            No MCP servers configured. Check environment variables.
          </div>
        ) : (
          <div className="space-y-3">
            {servers.map((server) => (
              <ServerCard key={server.server_label} server={server} />
            ))}
          </div>
        )}
      </div>
    </CollapsibleSection>
  );
}
