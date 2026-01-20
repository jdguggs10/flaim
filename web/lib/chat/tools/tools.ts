import { toolsList } from "@/config/tools-list";
import useToolsStore from "@/stores/chat/useToolsStore";
import { WebSearchConfig, McpConfig } from "@/stores/chat/useToolsStore";
import { getAllEspnMcpServers } from "@/lib/chat/league-mapper";
import { DISABLE_ALL_TOOLS_SENTINEL } from "@/lib/chat/tools/mcp-constants";

interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

interface WebSearchTool extends WebSearchConfig {
  type: "web_search";
}

interface McpState {
  mcpEnabled: boolean;
  mcpConfig: McpConfig;
  selectedPlatform: string;
  isAuthenticated: boolean;
  clerkUserId: string;
  clerkToken: string;
  mcpAvailableTools: string[];
  disabledMcpTools: string[];
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

export const buildMcpToolFromState = (state: McpState) => {
  // Allow disabling MCP entirely via env flag
  const mcpGloballyDisabled = process.env.NEXT_PUBLIC_DISABLE_MCP === "true";

  // Enable MCP for authenticated ESPN users when a server is configured
  const shouldEnableMcp =
    state.selectedPlatform === "ESPN" &&
    state.isAuthenticated &&
    !!state.mcpConfig.server_url &&
    !!state.mcpConfig.server_label;

  if (mcpGloballyDisabled || !state.mcpEnabled || !shouldEnableMcp) {
    return null;
  }

  // Validate MCP server URL
  if (
    !state.mcpConfig.server_url.startsWith("http://") &&
    !state.mcpConfig.server_url.startsWith("https://")
  ) {
    console.error("[ERROR] Invalid MCP server URL:", state.mcpConfig.server_url);
    return null;
  }

  // Follow documented pattern from Responses API & MCP Tools docs
  const mcpTool: any = {
    type: "mcp",
    server_label: state.mcpConfig.server_label,
    server_url: state.mcpConfig.server_url,
    headers: {
      "Content-Type": "application/json",
      ...(state.clerkToken ? { Authorization: `Bearer ${state.clerkToken}` } : {}),
    },
  };

  // Set approval requirement (following docs pattern)
  if (state.mcpConfig.skip_approval) {
    mcpTool.require_approval = "never";
  } else {
    mcpTool.require_approval = "manual";
  }

  // Set allowed tools to limit what gets exposed (following docs pattern)
  // Prefer disabledMcpTools list when available; fall back to legacy allowed_tools.
  if (state.mcpAvailableTools.length > 0 && state.disabledMcpTools.length > 0) {
    const allowed = state.mcpAvailableTools.filter(
      (tool) => !state.disabledMcpTools.includes(tool)
    );
    mcpTool.allowed_tools = allowed;
  } else {
    // Legacy support: allowed_tools string
    // Sentinel "none" means disable all tools (different from empty which means "no restriction")
    const allowedTools = (state.mcpConfig.allowed_tools || "").trim();
    if (allowedTools === "none") {
      // Explicitly disable all tools by setting empty array
      mcpTool.allowed_tools = [];
    } else if (allowedTools) {
      mcpTool.allowed_tools = allowedTools.split(",")
        .map((t) => t.trim())
        .filter((t) => t);
    }
    // If allowedTools is empty string, don't set allowed_tools (means no restriction)
  }

  return mcpTool;
};

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

  // Only mount MCP servers for ESPN platform when authenticated
  if (state.selectedPlatform !== "ESPN" || !state.isAuthenticated) {
    return [];
  }

  const servers = getAllEspnMcpServers();
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
    fileSearchEnabled,
    functionsEnabled,
    codeInterpreterEnabled,
    vectorStore,
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

  if (fileSearchEnabled) {
    const fileSearchTool = {
      type: "file_search",
      vector_store_ids: [vectorStore?.id],
    };
    tools.push(fileSearchTool);
  }

  if (codeInterpreterEnabled) {
    tools.push({ type: "code_interpreter", container: { type: "auto" } });
  }

  if (functionsEnabled) {
    // Type assertion to ensure toolsList matches ToolDefinition[]
    const typedToolsList = toolsList as ToolDefinition[];
    tools.push(
      ...typedToolsList.map((tool) => {
        return {
          type: "function",
          name: tool.name,
          description: tool.description,
          parameters: {
            type: "object",
            properties: { ...tool.parameters },
            required: Object.keys(tool.parameters),
            additionalProperties: false,
          },
          strict: true,
        };
      })
    );
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
  const serverCount = mcpTools.length;
  console.log(`[MCP Config] Platform: ${selectedPlatform}, Authenticated: ${isAuthenticated}, Servers: ${serverCount}`);
  console.log(`[MCP Auth] User ID: ${clerkUserId ? 'present' : 'MISSING'}, Token: ${clerkToken ? 'present' : 'MISSING'}`);

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
