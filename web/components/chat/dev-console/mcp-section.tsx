"use client";

import { useState } from "react";
import { Zap, Check, X, Loader2, ExternalLink } from "lucide-react";
import useToolsStore from "@/stores/chat/useToolsStore";
import useLeaguesStore from "@/stores/chat/useLeaguesStore";
import { getSportConfig } from "@/lib/chat/league-mapper";
import { CollapsibleSection } from "./collapsible-section";
import { CopyButton } from "./copy-button";
import { Switch } from "@/components/ui";
import { Button } from "@/components/ui/button";

type ConnectionStatus = "unknown" | "connected" | "error" | "testing";

export function McpSection() {
  const {
    mcpEnabled,
    setMcpEnabled,
    mcpConfig,
    isAuthenticated,
  } = useToolsStore();

  const { leagues, getActiveLeague } = useLeaguesStore();
  const activeLeague = getActiveLeague();

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>("unknown");
  const [isTesting, setIsTesting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Check if MCP should be available
  const shouldShowMcp = leagues.length > 0 && isAuthenticated;

  if (!shouldShowMcp) {
    return null;
  }

  const sportConfig = activeLeague ? getSportConfig(activeLeague.sport as any) : null;

  const testConnection = async () => {
    setIsTesting(true);
    setConnectionStatus("testing");
    setErrorMessage(null);
    try {
      const res = await fetch("/api/debug/test-mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverUrl: mcpConfig.server_url }),
      });
      const data = await res.json() as { connected: boolean; error?: string };
      if (data.connected) {
        setConnectionStatus("connected");
      } else {
        setConnectionStatus("error");
        setErrorMessage(data.error || "Connection failed");
      }
    } catch {
      setConnectionStatus("error");
      setErrorMessage("Network error");
    } finally {
      setIsTesting(false);
    }
  };

  const generateCurl = () => {
    const curl = `curl -X POST "${mcpConfig.server_url}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer YOUR_TOKEN" \\
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'`;
    navigator.clipboard.writeText(curl);
  };

  const StatusBadge = () => {
    switch (connectionStatus) {
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
          <span className="text-xs text-muted-foreground">
            Not tested
          </span>
        );
    }
  };

  return (
    <CollapsibleSection
      title={`MCP: ${sportConfig?.name || "Sports"}`}
      icon={<Zap size={16} />}
      defaultExpanded={false}
      rightElement={
        <Switch
          checked={mcpEnabled}
          onCheckedChange={setMcpEnabled}
        />
      }
    >
      <div className="space-y-3">
        {/* Connection Status */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Status:</span>
          <StatusBadge />
        </div>

        {/* Server Label */}
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">Server:</div>
          <code className="text-xs bg-secondary px-2 py-1 rounded font-mono block truncate">
            {mcpConfig.server_label || "Not configured"}
          </code>
        </div>

        {/* Server URL */}
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">URL:</div>
          <div className="flex items-center gap-1">
            <code className="text-xs bg-secondary px-2 py-1 rounded font-mono flex-1 truncate">
              {mcpConfig.server_url || "Not configured"}
            </code>
            {mcpConfig.server_url && (
              <>
                <CopyButton value={mcpConfig.server_url} />
                <a
                  href={mcpConfig.server_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                  title="Open in new tab"
                >
                  <ExternalLink className="h-3 w-3" />
                </a>
              </>
            )}
          </div>
        </div>

        {/* Error message */}
        {errorMessage && (
          <div className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded">
            {errorMessage}
          </div>
        )}

        {/* Auto-approve toggle */}
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">Auto-approve tools:</span>
          <Switch
            checked={mcpConfig.skip_approval}
            onCheckedChange={(checked) =>
              useToolsStore.getState().setMcpConfig({ ...mcpConfig, skip_approval: checked })
            }
            disabled={!mcpEnabled}
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={testConnection}
            disabled={isTesting || !mcpConfig.server_url}
            className="flex-1 text-xs"
          >
            {isTesting ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Testing...
              </>
            ) : (
              "Test Connection"
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={generateCurl}
            disabled={!mcpConfig.server_url}
            className="text-xs"
            title="Copy cURL command"
          >
            cURL
          </Button>
        </div>
      </div>
    </CollapsibleSection>
  );
}
