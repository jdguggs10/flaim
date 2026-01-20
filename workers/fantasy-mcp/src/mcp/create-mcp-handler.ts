// workers/fantasy-mcp/src/mcp/create-mcp-handler.ts
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export interface McpHandlerOptions {
  route?: string;
  enableJsonResponse?: boolean;
  sessionIdGenerator?: (() => string) | undefined;
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

    await server.connect(transport);
    return transport.handleRequest(_request);
  };
}
