// workers/fantasy-mcp/src/mcp/create-mcp-handler.ts
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getUnifiedTools, type ToolSecuritySchemes } from './tools';

export interface McpHandlerOptions {
  route?: string;
  enableJsonResponse?: boolean;
  sessionIdGenerator?: (() => string) | undefined;
}

/**
 * Inject top-level per-tool securitySchemes into a tools/list JSON-RPC result
 * (FLA-177). Current OpenAI plugin docs read a top-level tool field:
 *   "securitySchemes": [{"type": "oauth2", "scopes": ["mcp:read"]}]
 * The MCP SDK has no such field, so this is additive post-processing at the
 * transport boundary: only messages whose result carries a tools array are
 * touched (only tools/list produces one), only the securitySchemes key is
 * added, and everything else in the response passes through untouched. The
 * _meta.securitySchemes mirror registered in server.ts stays as-is.
 */
function injectToolsListSecuritySchemes(message: unknown): void {
  const result = (message as { result?: { tools?: unknown } } | null)?.result;
  if (!result || !Array.isArray(result.tools)) {
    return;
  }

  const schemesByTool = new Map<string, ToolSecuritySchemes>(
    getUnifiedTools().map((tool) => [tool.name, tool.securitySchemes])
  );

  for (const tool of result.tools) {
    if (!tool || typeof tool !== 'object') continue;
    const name = (tool as { name?: unknown }).name;
    if (typeof name !== 'string') continue;
    const schemes = schemesByTool.get(name);
    if (!schemes) continue;
    (tool as Record<string, unknown>).securitySchemes = schemes.map((scheme) => ({
      ...scheme,
      scopes: [...scheme.scopes],
    }));
  }
}

export function createMcpHandler(server: McpServer, options: McpHandlerOptions = {}) {
  const { enableJsonResponse = true, sessionIdGenerator = undefined } = options;

  return async (_request: Request, _env?: unknown, _ctx?: ExecutionContext): Promise<Response> => {
    void _env;
    void _ctx;
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator,
      enableJsonResponse,
    });

    // Transport-boundary post-processing: every outbound JSON-RPC message flows
    // through transport.send in both JSON and SSE modes.
    const originalSend = transport.send.bind(transport);
    transport.send = async (message, sendOptions) => {
      injectToolsListSecuritySchemes(message);
      return originalSend(message, sendOptions);
    };

    await server.connect(transport);
    return transport.handleRequest(_request);
  };
}
