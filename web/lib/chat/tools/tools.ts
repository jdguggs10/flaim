import useToolsStore from "@/stores/chat/useToolsStore";
import { WebSearchConfig, McpConfig } from "@/stores/chat/useToolsStore";
import { getUnifiedMcpServer } from "@/lib/chat/league-mapper";
import { DISABLE_ALL_TOOLS_SENTINEL } from "@/lib/chat/tools/mcp-constants";

interface WebSearchTool extends WebSearchConfig {
  type: "web_search";
}

interface MultiMcpState {
  mcpEnabled: boolean;
  mcpConfig: McpConfig;
  selectedPlatform: string;
  isAuthenticated: boolean;
  clerkUserId: string;
  clerkToken: string;
  mcpAvailableToolsByServer: Record<string, string[]>;
  disabledMcpToolsByServer: Record<string, string[]>;
}

/**
 * Validate MCP server URL scheme
 */
const isValidMcpUrl = (url: string): boolean => {
  return url.startsWith("http://") || url.startsWith("https://");
};

/**
 * Build MCP tools for all configured ESPN servers
 * Returns an array of MCP tool objects, one per server
 */
export const buildMcpToolsFromState = (state: MultiMcpState): any[] => {
  // Allow disabling MCP entirely via env flag
  const mcpGloballyDisabled = process.env.NEXT_PUBLIC_DISABLE_MCP === "true";

  if (mcpGloballyDisabled || !state.mcpEnabled) {
    return [];
  }

  // Only mount MCP servers when authenticated
  if (!state.isAuthenticated) {
    return [];
  }

  const server = getUnifiedMcpServer();
  const servers = server ? [server] : [];
  if (servers.length === 0) {
    return [];
  }

  const headers = {
    "Content-Type": "application/json",
    ...(state.clerkToken ? { Authorization: `Bearer ${state.clerkToken}` } : {}),
  };

  // Filter out servers with invalid URLs and map to MCP tool objects
  return servers
    .filter((server) => {
      if (!isValidMcpUrl(server.server_url)) {
        console.error(`[ERROR] Invalid MCP server URL for ${server.server_label}:`, server.server_url);
        return false;
      }
      return true;
    })
    .map((server) => {
      const mcpTool: any = {
        type: "mcp",
        server_label: server.server_label,
        server_url: server.server_url,
        headers,
      };

      // Set approval requirement
      if (state.mcpConfig.skip_approval) {
        mcpTool.require_approval = "never";
      } else {
        mcpTool.require_approval = "manual";
      }

      // Compute allowed_tools for this server
      const availableTools = state.mcpAvailableToolsByServer[server.server_label] || [];
      const disabledTools = state.disabledMcpToolsByServer[server.server_label] || [];
      const disableAll = disabledTools.includes(DISABLE_ALL_TOOLS_SENTINEL);

      if (disableAll) {
        mcpTool.allowed_tools = [];
      } else if (availableTools.length > 0 && disabledTools.length > 0) {
        const allowed = availableTools.filter(
          (tool) => !disabledTools.includes(tool)
        );
        mcpTool.allowed_tools = allowed;
      }
      // If no available/disabled tools, omit allowed_tools (means no restriction)

      return mcpTool;
    });
};

export const getTools = () => {
  const {
    webSearchEnabled,
    codeInterpreterEnabled,
    webSearchConfig,
    mcpEnabled,
    mcpConfig,
    selectedPlatform,
    isAuthenticated,
    clerkUserId,
    clerkToken,
    mcpAvailableToolsByServer,
    disabledMcpToolsByServer,
  } = useToolsStore.getState();

  const tools = [];

  if (webSearchEnabled) {
    const webSearchTool: WebSearchTool = {
      type: "web_search",
    };
    if (
      webSearchConfig.user_location &&
      (webSearchConfig.user_location.country !== "" ||
        webSearchConfig.user_location.region !== "" ||
        webSearchConfig.user_location.city !== "")
    ) {
      webSearchTool.user_location = webSearchConfig.user_location;
    }

    tools.push(webSearchTool);
  }

  if (codeInterpreterEnabled) {
    tools.push({ type: "code_interpreter", container: { type: "auto" } });
  }

  // Build MCP tools for all configured ESPN servers
  const mcpTools = buildMcpToolsFromState({
    mcpEnabled,
    mcpConfig,
    selectedPlatform,
    isAuthenticated,
    clerkUserId,
    clerkToken,
    mcpAvailableToolsByServer,
    disabledMcpToolsByServer,
  });

  // Debug logging for MCP auth troubleshooting
  if (useToolsStore.getState().debugMode) {
    const serverCount = mcpTools.length;
    console.log(`[MCP Config] Platform: ${selectedPlatform}, Authenticated: ${isAuthenticated}, Servers: ${serverCount}`);
    console.log(`[MCP Auth] User ID: ${clerkUserId ? 'present' : 'MISSING'}, Token: ${clerkToken ? 'present' : 'MISSING'}`);
  }

  if (mcpTools.length > 0 && (!clerkUserId || !clerkToken)) {
    console.warn(
      "[WARN] MCP enabled but missing Clerk authentication. User ID:",
      !!clerkUserId,
      "Token:",
      !!clerkToken
    );
    console.warn("[WARN] MCP calls may fail - user should refresh the page to get a fresh token");
  }

  // Add all MCP tools to the tools array
  tools.push(...mcpTools);

  return tools;
};
