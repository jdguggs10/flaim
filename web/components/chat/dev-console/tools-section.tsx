"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Wrench, Square, CheckSquare, RefreshCw, Loader2, Check, X, ChevronDown, ChevronRight } from "lucide-react";
import useToolsStore from "@/stores/chat/useToolsStore";
import useLeaguesStore from "@/stores/chat/useLeaguesStore";
import { getAllEspnMcpServers, getSportConfig, McpServerInfo } from "@/lib/chat/league-mapper";
import { DISABLE_ALL_TOOLS_SENTINEL } from "@/lib/chat/tools/mcp-constants";
import { CollapsibleSection } from "./collapsible-section";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface McpTool {
  name: string;
  description?: string;
  input_schema?: unknown;
}

interface ServerToolsState {
  tools: McpTool[];
  status: "idle" | "loading" | "connected" | "error";
  error: string | null;
  latencyMs: number | null;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
}

interface ServerToolsGroupProps {
  server: McpServerInfo;
  toolsState: ServerToolsState;
  disabledTools: string[];
  onToggleTool: (toolName: string) => void;
  onEnableAll: () => void;
  onDisableAll: () => void;
  onRefresh: () => void;
}

function ServerToolsGroup({
  server,
  toolsState,
  disabledTools,
  onToggleTool,
  onEnableAll,
  onDisableAll,
  onRefresh,
}: ServerToolsGroupProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const sportConfig = getSportConfig(server.sport);
  const disableAll = disabledTools.includes(DISABLE_ALL_TOOLS_SENTINEL);
  const disabledSet = new Set(disabledTools);
  const toolNames = toolsState.tools.map((t) => t.name);
  const enabledCount = disableAll
    ? 0
    : toolNames.filter((name) => !disabledSet.has(name)).length;

  const effectiveAllowedTools = disableAll
    ? []
    : disabledSet.size > 0
      ? toolNames.filter((name) => !disabledSet.has(name))
      : null;

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Server header */}
      <div className="w-full flex items-center justify-between p-3 bg-secondary/30 hover:bg-secondary/50 transition-colors">
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 flex-1 text-left"
          aria-expanded={isExpanded}
        >
          {isExpanded ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span>{sportConfig?.emoji || "🎮"}</span>
          <span className="font-medium text-sm">{sportConfig?.name || server.sport}</span>
          <span className="text-xs text-muted-foreground">
            ({enabledCount}/{toolsState.tools.length})
          </span>
        </button>

        <div className="flex items-center gap-2">
          {/* Status indicator */}
          {toolsState.status === "loading" ? (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          ) : toolsState.status === "connected" ? (
            <Check className="h-3 w-3 text-green-600" />
          ) : toolsState.status === "error" ? (
            <X className="h-3 w-3 text-red-600" />
          ) : null}

          {/* Refresh button */}
          <button
            type="button"
            onClick={onRefresh}
            disabled={toolsState.status === "loading"}
            className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="Refresh tools"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="p-3 space-y-3">
          {/* Connection info */}
          {(toolsState.latencyMs !== null || toolsState.lastSuccessAt || toolsState.lastAttemptAt) && (
            <div className="space-y-1 text-xs text-muted-foreground">
              {toolsState.latencyMs !== null && (
                <div>Latency: {toolsState.latencyMs}ms</div>
              )}
              {toolsState.lastSuccessAt && (
                <div>Last success: {new Date(toolsState.lastSuccessAt).toLocaleTimeString()}</div>
              )}
            </div>
          )}

          {/* Error message */}
          {toolsState.error && (
            <div className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded">
              {toolsState.error}
            </div>
          )}

          {/* Empty state */}
          {!toolsState.error && toolsState.status !== "loading" && toolsState.tools.length === 0 && (
            <div className="text-xs text-muted-foreground px-2 py-1">
              No tools returned. Check server status or auth.
            </div>
          )}

          {/* Tool list */}
          {toolsState.tools.length > 0 && (
            <div className="space-y-1">
              {toolsState.tools.map((tool) => {
                const isEnabled = !disableAll && !disabledSet.has(tool.name);
                const description = tool.description || "No description";
                const schemaText = tool.input_schema
                  ? JSON.stringify(tool.input_schema, null, 2)
                  : null;

                return (
                  <TooltipProvider key={tool.name} delayDuration={300}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => onToggleTool(tool.name)}
                          className="w-full flex items-center gap-2 p-2 rounded hover:bg-secondary/50 transition-colors text-left"
                        >
                          {isEnabled ? (
                            <CheckSquare className="h-4 w-4 text-primary flex-shrink-0" />
                          ) : (
                            <Square className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                          )}
                          <span className={`text-xs font-mono truncate ${isEnabled ? "text-foreground" : "text-muted-foreground"}`}>
                            {tool.name}
                          </span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="max-w-xs">
                        <div className="space-y-2">
                          <p className="text-xs">{description}</p>
                          {schemaText && (
                            <div className="space-y-1">
                              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
                                Input schema
                              </div>
                              <pre className="text-[10px] leading-snug font-mono bg-secondary/50 px-2 py-2 rounded max-h-40 overflow-y-auto whitespace-pre-wrap">
                                {schemaText}
                              </pre>
                            </div>
                          )}
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                );
              })}
            </div>
          )}

          {/* Effective allowlist */}
          {toolsState.tools.length > 0 && (
            <div className="pt-2 border-t border-border space-y-2">
            <div className="text-xs text-muted-foreground">
              Allowlist: {effectiveAllowedTools ? `${effectiveAllowedTools.length} tools` : "All enabled"}
            </div>
            </div>
          )}

          {/* Bulk actions */}
          {toolsState.tools.length > 0 && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={onEnableAll}
                className="flex-1 text-xs"
              >
                Enable All
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={onDisableAll}
                className="flex-1 text-xs"
              >
                Disable All
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ToolsSection() {
  const {
    mcpEnabled,
    mcpConfig,
    setMcpConfig,
    isAuthenticated,
    mcpAvailableTools,
    disabledMcpTools,
    setMcpAvailableToolsByServer,
    disabledMcpToolsByServer,
    setDisabledMcpToolsByServer,
  } = useToolsStore();
  const { leagues } = useLeaguesStore();

  // Get all configured ESPN MCP servers
  const servers = useMemo(() => getAllEspnMcpServers(), []);

  // Track tools state per server
  const [toolsStateByServer, setToolsStateByServer] = useState<Record<string, ServerToolsState>>({});

  // Check if section should be visible
  const shouldShow = leagues.length > 0 && isAuthenticated && mcpEnabled;

  // Fetch tools for a specific server
  const fetchToolsForServer = useCallback(async (server: McpServerInfo) => {
    const serverLabel = server.server_label;

    setToolsStateByServer((prev) => ({
      ...prev,
      [serverLabel]: {
        ...prev[serverLabel],
        status: "loading",
        error: null,
        lastAttemptAt: new Date().toISOString(),
      },
    }));

    try {
      const res = await fetch("/api/debug/test-mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverUrl: server.server_url }),
      });

      const data = await res.json() as {
        connected: boolean;
        tools?: McpTool[];
        error?: string;
        elapsedMs?: number;
        fetchedAt?: string;
      };

      const now = data.fetchedAt || new Date().toISOString();

      if (data.connected) {
        const tools = data.tools || [];
        setToolsStateByServer((prev) => ({
          ...prev,
          [serverLabel]: {
            tools,
            status: "connected",
            error: null,
            latencyMs: data.elapsedMs || null,
            lastSuccessAt: now,
            lastAttemptAt: now,
          },
        }));

        // Sync to store using functional setter to avoid race conditions
        setMcpAvailableToolsByServer((prev) => ({
          ...prev,
          [serverLabel]: tools.map((t) => t.name),
        }));
      } else {
        setToolsStateByServer((prev) => ({
          ...prev,
          [serverLabel]: {
            ...prev[serverLabel],
            tools: [],
            status: "error",
            error: data.error || "Connection failed",
            latencyMs: data.elapsedMs || null,
            lastAttemptAt: now,
          },
        }));
      }
    } catch {
      setToolsStateByServer((prev) => ({
        ...prev,
        [serverLabel]: {
          ...prev[serverLabel],
          tools: [],
          status: "error",
          error: "Failed to fetch tools",
          lastAttemptAt: new Date().toISOString(),
        },
      }));
    }
  }, [setMcpAvailableToolsByServer]);

  // Fetch all servers on mount
  useEffect(() => {
    if (!shouldShow) return;

    // Initialize state for all servers
    const initialState: Record<string, ServerToolsState> = {};
    servers.forEach((server) => {
      initialState[server.server_label] = {
        tools: [],
        status: "idle",
        error: null,
        latencyMs: null,
        lastSuccessAt: null,
        lastAttemptAt: null,
      };
    });
    setToolsStateByServer(initialState);

    // Fetch tools for each server
    servers.forEach((server) => {
      fetchToolsForServer(server);
    });
  }, [shouldShow, servers.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Migration: Move legacy single-server tools to first configured server
  // Only migrates when tools have been fetched for the target server
  useEffect(() => {
    if (servers.length === 0) return;

    // Check if we have legacy data to migrate
    const hasLegacyAvailable = mcpAvailableTools.length > 0;
    const hasLegacyDisabled = disabledMcpTools.length > 0;
    const hasLegacyConfig = (mcpConfig.allowed_tools || "").trim() !== "";

    if (!hasLegacyAvailable && !hasLegacyDisabled && !hasLegacyConfig) return;

    // Use the first server or find the server matching mcpConfig.server_label
    const targetServer = mcpConfig.server_label
      ? servers.find((s) => s.server_label === mcpConfig.server_label) || servers[0]
      : servers[0];

    const serverLabel = targetServer.server_label;

    // Wait for tools to be fetched before migrating allowed_tools config
    // This prevents clearing restrictions before we know what tools exist
    const serverToolsState = toolsStateByServer[serverLabel];
    const serverToolsLoaded = serverToolsState?.status === "connected" && serverToolsState.tools.length > 0;

    // Migrate mcpAvailableTools (can happen immediately)
    if (hasLegacyAvailable) {
      setMcpAvailableToolsByServer((prev) => {
        const existing = prev[serverLabel] || [];
        if (existing.length === 0) {
          return { ...prev, [serverLabel]: mcpAvailableTools };
        }
        return prev;
      });
      // Clear legacy
      useToolsStore.getState().setMcpAvailableTools([]);
    }

    // Migrate disabledMcpTools (can happen immediately)
    if (hasLegacyDisabled) {
      setDisabledMcpToolsByServer((prev) => {
        const existing = prev[serverLabel] || [];
        if (existing.length === 0) {
          return { ...prev, [serverLabel]: disabledMcpTools };
        }
        return prev;
      });
      // Clear legacy
      useToolsStore.getState().setDisabledMcpTools([]);
    }

    // Migrate allowed_tools config - only after tools are loaded
    if (hasLegacyConfig && serverToolsLoaded) {
      const legacy = mcpConfig.allowed_tools!.trim();
      const availableForServer = serverToolsState.tools.map((t) => t.name);

      if (legacy === "none") {
        // Disable all tools
        setDisabledMcpToolsByServer((prev) => ({
          ...prev,
          [serverLabel]: availableForServer,
        }));
      } else {
        const allowed = legacy.split(",").map((t) => t.trim()).filter(Boolean);
        if (allowed.length > 0) {
          const disabled = availableForServer.filter((name) => !allowed.includes(name));
          setDisabledMcpToolsByServer((prev) => ({
            ...prev,
            [serverLabel]: disabled,
          }));
        }
      }
      // Clear legacy config only after successful migration
      setMcpConfig({ ...mcpConfig, allowed_tools: "" });
    }

    // If tools are not yet loaded but legacy config disables all, set sentinel.
    if (hasLegacyConfig && !serverToolsLoaded && (mcpConfig.allowed_tools || "").trim() === "none") {
      setDisabledMcpToolsByServer((prev) => {
        const existing = prev[serverLabel] || [];
        if (existing.includes(DISABLE_ALL_TOOLS_SENTINEL)) return prev;
        if (existing.length > 0) return prev;
        return { ...prev, [serverLabel]: [DISABLE_ALL_TOOLS_SENTINEL] };
      });
      // Clear legacy config once sentinel is applied
      setMcpConfig({ ...mcpConfig, allowed_tools: "" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers.length, toolsStateByServer, mcpAvailableTools, disabledMcpTools, mcpConfig, setMcpConfig, setMcpAvailableToolsByServer, setDisabledMcpToolsByServer]);

  // If a server was marked "disable all" before tools loaded, expand to full list once available.
  useEffect(() => {
    servers.forEach((server) => {
      const state = toolsStateByServer[server.server_label];
      if (!state || state.tools.length === 0) return;
      const disabled = disabledMcpToolsByServer[server.server_label] || [];
      if (!disabled.includes(DISABLE_ALL_TOOLS_SENTINEL)) return;

      const allToolNames = state.tools.map((t) => t.name);
      setDisabledMcpToolsByServer((prev) => ({
        ...prev,
        [server.server_label]: allToolNames,
      }));
    });
  }, [servers, toolsStateByServer, disabledMcpToolsByServer, setDisabledMcpToolsByServer]);

  // Tool toggle handlers - use functional setters to avoid race conditions
  const toggleToolForServer = useCallback((serverLabel: string, toolName: string) => {
    setDisabledMcpToolsByServer((prev) => {
      const current = prev[serverLabel] || [];
      if (current.includes(DISABLE_ALL_TOOLS_SENTINEL)) {
        const serverTools = toolsStateByServer[serverLabel]?.tools || [];
        const allToolNames = serverTools.map((t) => t.name);
        const nextDisabled = allToolNames.filter((name) => name !== toolName);
        return { ...prev, [serverLabel]: nextDisabled };
      }
      const next = current.includes(toolName)
        ? current.filter((t) => t !== toolName)
        : [...current, toolName];
      return { ...prev, [serverLabel]: next };
    });
  }, [setDisabledMcpToolsByServer, toolsStateByServer]);

  const enableAllForServer = useCallback((serverLabel: string) => {
    setDisabledMcpToolsByServer((prev) => ({
      ...prev,
      [serverLabel]: [],
    }));
  }, [setDisabledMcpToolsByServer]);

  const disableAllForServer = useCallback((serverLabel: string) => {
    const tools = toolsStateByServer[serverLabel]?.tools || [];
    setDisabledMcpToolsByServer((prev) => ({
      ...prev,
      [serverLabel]: tools.map((t) => t.name),
    }));
  }, [setDisabledMcpToolsByServer, toolsStateByServer]);

  // Count total tools
  const totalTools = useMemo(() => {
    return Object.values(toolsStateByServer).reduce(
      (sum, state) => sum + state.tools.length,
      0
    );
  }, [toolsStateByServer]);

  const totalEnabled = useMemo(() => {
    return servers.reduce((sum, server) => {
      const state = toolsStateByServer[server.server_label];
      if (!state) return sum;
      const disabled = disabledMcpToolsByServer[server.server_label] || [];
      return sum + state.tools.filter((t) => !disabled.includes(t.name)).length;
    }, 0);
  }, [servers, toolsStateByServer, disabledMcpToolsByServer]);

  if (!shouldShow) {
    return null;
  }

  return (
    <CollapsibleSection
      title={`Available Tools (${totalEnabled}/${totalTools})`}
      icon={<Wrench size={16} />}
      defaultExpanded={false}
      rightElement={
        <button
          type="button"
          onClick={() => servers.forEach((s) => fetchToolsForServer(s))}
          className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
          title="Refresh all tools"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      }
    >
      <div className="space-y-3">
        {servers.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-4">
            No MCP servers configured.
          </div>
        ) : (
          servers.map((server) => (
            <ServerToolsGroup
              key={server.server_label}
              server={server}
              toolsState={toolsStateByServer[server.server_label] || {
                tools: [],
                status: "idle",
                error: null,
                latencyMs: null,
                lastSuccessAt: null,
                lastAttemptAt: null,
              }}
              disabledTools={disabledMcpToolsByServer[server.server_label] || []}
              onToggleTool={(toolName) => toggleToolForServer(server.server_label, toolName)}
              onEnableAll={() => enableAllForServer(server.server_label)}
              onDisableAll={() => disableAllForServer(server.server_label)}
              onRefresh={() => fetchToolsForServer(server)}
            />
          ))
        )}
      </div>
    </CollapsibleSection>
  );
}
