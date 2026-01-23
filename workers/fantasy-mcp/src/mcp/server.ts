// workers/fantasy-mcp/src/mcp/server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Env } from '../types';
import { getUnifiedTools } from './tools';

export interface McpContext {
  env: Env;
  authHeader: string | null;
  correlationId?: string;
}

/**
 * Create and configure the MCP server with all unified fantasy tools registered.
 * Uses closure capture to make env/authHeader available to tool handlers.
 */
export function createFantasyMcpServer(ctx: McpContext): McpServer {
  const { env, authHeader, correlationId } = ctx;

  const server = new McpServer({
    name: 'fantasy-mcp',
    version: '1.0.0',
  });

  const tools = getUnifiedTools();
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: true },
      },
      async (args) => tool.handler(args, env, authHeader || undefined, correlationId)
    );
  }

  return server;
}
