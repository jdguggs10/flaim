import { toolsList } from "../../config/tools-list";
import useToolsStore from "@/stores/useToolsStore";
import { WebSearchConfig } from "@/stores/useToolsStore";

interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

interface WebSearchTool extends WebSearchConfig {
  type: "web_search";
}
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
  } = useToolsStore.getState();

  // Allow disabling MCP entirely via env flag
  const mcpGloballyDisabled = process.env.NEXT_PUBLIC_DISABLE_MCP === "true";

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

  // Enable MCP for authenticated ESPN users when a server is configured
  const shouldEnableMcp =
    selectedPlatform === "ESPN" &&
    isAuthenticated &&
    !!mcpConfig.server_url &&
    !!mcpConfig.server_label;

  // Debug logging for MCP auth troubleshooting (avoid logging token metadata for security)
  console.log(`[MCP Config] Platform: ${selectedPlatform}, Authenticated: ${isAuthenticated}, Server URL: ${mcpConfig.server_url ? 'set' : 'NOT SET'}, Should enable: ${shouldEnableMcp}`);
  console.log(`[MCP Auth] User ID: ${clerkUserId ? 'present' : 'MISSING'}, Token: ${clerkToken ? 'present' : 'MISSING'}`);

  if (!mcpGloballyDisabled && mcpEnabled && shouldEnableMcp) {
    // Validate MCP server URL
    if (
      !mcpConfig.server_url.startsWith("http://") &&
      !mcpConfig.server_url.startsWith("https://")
    ) {
      console.error("[ERROR] Invalid MCP server URL:", mcpConfig.server_url);
      return tools;
    }

    // Validate required auth headers are present
    if (!clerkUserId || !clerkToken) {
      console.warn(
        "[WARN] MCP enabled but missing Clerk authentication. User ID:",
        !!clerkUserId,
        "Token:",
        !!clerkToken
      );
      console.warn("[WARN] MCP calls may fail - user should refresh the page to get a fresh token");
      // Still proceed - some MCP servers might not require auth
    }

    // Follow documented pattern from Responses API & MCP Tools docs
    const mcpTool: any = {
      type: "mcp",
      server_label: mcpConfig.server_label,
      server_url: mcpConfig.server_url,
      headers: {
        "Content-Type": "application/json",
        ...(clerkUserId ? { "X-Clerk-User-ID": clerkUserId } : {}),
        ...(clerkToken ? { Authorization: `Bearer ${clerkToken}` } : {}),
      },
    };

    // Set approval requirement (following docs pattern)
    if (mcpConfig.skip_approval) {
      mcpTool.require_approval = "never";
    } else {
      mcpTool.require_approval = "manual";
    }

    // Set allowed tools to limit what gets exposed (following docs pattern)
    const allowedTools = (mcpConfig.allowed_tools || "").trim();
    if (allowedTools) {
      mcpTool.allowed_tools = allowedTools.split(",")
        .map((t) => t.trim())
        .filter((t) => t);
    }

    tools.push(mcpTool);
  }

  return tools;
};
