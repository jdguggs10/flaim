// workers/fantasy-mcp/src/mcp/server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Env } from '../types';
import { getUnifiedTools, hasRequiredScope, mcpAuthError } from './tools';

export interface McpContext {
  env: Env;
  authHeader: string | null;
  tokenScope?: string;
  correlationId?: string;
  evalRunId?: string;
  evalTraceId?: string;
}

/**
 * Create and configure the MCP server with all unified fantasy tools registered.
 * Uses closure capture to make env/authHeader available to tool handlers.
 */
export function createFantasyMcpServer(ctx: McpContext): McpServer {
  const { env, authHeader, tokenScope, correlationId, evalRunId, evalTraceId } = ctx;

  const server = new McpServer({
    name: 'fantasy-mcp',
    version: '1.0.0',
    icons: [
      {
        src: 'https://flaim.app/icon-light.png',
        mimeType: 'image/png',
      },
    ],
  });

  const tools = getUnifiedTools();
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        // OpenAI/Anthropic reviewer-safe annotation profile for read-only external data tools.
        annotations: { readOnlyHint: true, openWorldHint: true, destructiveHint: false, idempotentHint: true },
        _meta: {
          securitySchemes: tool.securitySchemes,
          ...(tool.openaiMeta && {
            'openai/toolInvocation/invoking': tool.openaiMeta.invoking,
            'openai/toolInvocation/invoked': tool.openaiMeta.invoked,
          }),
        },
      },
      async (args) => {
        if (!hasRequiredScope(tokenScope, tool.requiredScope)) {
          return mcpAuthError('https://api.flaim.app/mcp');
        }
        return tool.handler(args, env, authHeader || undefined, correlationId, evalRunId, evalTraceId);
      }
    );
  }

  return server;
}
