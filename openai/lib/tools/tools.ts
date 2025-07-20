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
    selectedSport,
    selectedPlatform,
    isAuthenticated,
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

  // Only enable MCP when both Baseball and ESPN are selected AND user is authenticated
  const shouldEnableMcp = selectedSport === "baseball" && selectedPlatform === "ESPN" && isAuthenticated;
  
  if (mcpEnabled && shouldEnableMcp && mcpConfig.server_url && mcpConfig.server_label) {
    // Follow documented pattern from Responses API & MCP Tools docs
    const mcpTool: any = {
      type: "mcp",
      server_label: mcpConfig.server_label,
      server_url: mcpConfig.server_url,
      // Add headers for authentication if needed (following docs pattern)
      headers: {
        "Content-Type": "application/json"
      }
    };
    
    // Set approval requirement (following docs pattern)
    if (mcpConfig.skip_approval) {
      mcpTool.require_approval = "never";
    } else {
      mcpTool.require_approval = "manual";
    }
    
    // Set allowed tools to limit what gets exposed (following docs pattern)
    if (mcpConfig.allowed_tools.trim()) {
      mcpTool.allowed_tools = mcpConfig.allowed_tools
        .split(",")
        .map((t) => t.trim())
        .filter((t) => t);
    }
    
    console.log("MCP Tool Configuration:", JSON.stringify(mcpTool, null, 2));
    tools.push(mcpTool);
  }

  console.log("tools", tools);

  return tools;
};
