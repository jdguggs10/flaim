// workers/fantasy-mcp/src/mcp/server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Env } from '../types';
import { getUnifiedTools, hasRequiredScope, mcpAuthError, type McpToolResponse } from './tools';
import { emitUsageEvent, type UsageStatus } from './usage';
import { USER_SESSION_WIDGET_HTML, USER_SESSION_WIDGET_URI } from '../widgets/user-session-widget';
import { FLAIM_MCP_INSTRUCTIONS } from './instructions';

export interface McpContext {
  env: Env;
  authHeader: string | null;
  tokenScope?: string;
  correlationId?: string;
  evalRunId?: string;
  evalTraceId?: string;
  // Identity + execution context for usage analytics (FLA-156).
  userId?: string;
  authType?: 'clerk' | 'oauth' | 'eval-api-key' | 'demo-api-key';
  clientName?: string | null;
  executionCtx: ExecutionContext;
}

/**
 * Fire the best-effort usage emit without ever influencing the tool call. The
 * emit itself is async-and-swallowed (.catch), but wrapping the waitUntil in a
 * try/catch also guards against a *synchronous* throw from waitUntil (e.g. a
 * disposed ExecutionContext) altering tool-call control flow.
 */
function safeEmit(
  ctx: McpContext,
  toolName: string,
  args: Record<string, unknown>,
  status: UsageStatus,
  latencyMs: number | null,
  result?: McpToolResponse,
): void {
  try {
    ctx.executionCtx.waitUntil(
      emitUsageEvent(ctx, toolName, args, status, latencyMs, result).catch(() => {})
    );
  } catch {
    /* never affect the tool call */
  }
}

/**
 * Create and configure the MCP server with all unified fantasy tools registered.
 * Uses closure capture to make env/authHeader available to tool handlers.
 */
export function createFantasyMcpServer(ctx: McpContext): McpServer {
  const { env, authHeader, tokenScope, correlationId, evalRunId, evalTraceId } = ctx;

  const server = new McpServer(
    {
      name: 'fantasy-mcp',
      version: '1.0.0',
      icons: [
        {
          src: 'https://flaim.app/icon-light.png',
          mimeType: 'image/png',
        },
      ],
    },
    { instructions: FLAIM_MCP_INSTRUCTIONS }
  );

  // Register widget resources
  server.registerResource(
    'user-session-widget',
    USER_SESSION_WIDGET_URI,
    {
      mimeType: 'text/html;profile=mcp-app',
    },
    async () => ({
      contents: [{
        uri: USER_SESSION_WIDGET_URI,
        mimeType: 'text/html;profile=mcp-app',
        text: USER_SESSION_WIDGET_HTML,
        _meta: {
          ui: {
            csp: {
              connectDomains: [],
              resourceDomains: [],
            },
          },
          'openai/widgetCSP': {
            connect_domains: [],
            resource_domains: [],
            // Keep external-link allowlisting without reintroducing a stable widget domain.
            redirect_domains: ['https://flaim.app'],
          },
        },
      }],
    })
  );

  const tools = getUnifiedTools();
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
        _meta: {
          securitySchemes: tool.securitySchemes,
          ...(tool.openaiMeta && {
            'openai/toolInvocation/invoking': tool.openaiMeta.invoking,
            'openai/toolInvocation/invoked': tool.openaiMeta.invoked,
          }),
          ...(tool.widgetUri && {
            ui: {
              resourceUri: tool.widgetUri,
            },
            'openai/outputTemplate': tool.widgetUri,
            'openai/widgetAccessible': true,
            'openai/resultCanProduceWidget': true,
          }),
        },
      },
      async (args) => {
        // Scope-denied path: emit a 'denied' event (no latency timing) before the
        // auth error returns. Its own waitUntil so it never blocks the response.
        if (!hasRequiredScope(tokenScope, tool.requiredScope)) {
          safeEmit(ctx, tool.name, args, 'denied', null);
          return mcpAuthError('https://api.flaim.app/mcp', tool.requiredScope);
        }

        // Time and emit exactly one event per tool call. Default status 'error'
        // covers the throw path (a handler can throw; withToolLogging re-throws).
        // The emit runs in waitUntil AFTER the response, so it adds no latency, and
        // the original throw still propagates out of finally — never swallowed.
        const start = Date.now();
        let status: 'ok' | 'error' = 'error';
        let result: McpToolResponse | undefined;
        try {
          result = await tool.handler(args, env, authHeader || undefined, correlationId, evalRunId, evalTraceId);
          status = result?.isError === true ? 'error' : 'ok';
          return result;
        } finally {
          safeEmit(ctx, tool.name, args, status, Date.now() - start, result);
        }
      }
    );
  }

  return server;
}
