// workers/fantasy-mcp/src/mcp/server.ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Env } from '../types';
import { getUnifiedTools, hasRequiredScope, mcpInsufficientScopeError, type McpToolResponse } from './tools';
import { emitUsageEvent, type UsageStatus } from './usage';
import {
  LEGACY_USER_SESSION_WIDGET_HTML,
  LEGACY_USER_SESSION_WIDGET_URI,
  USER_SESSION_WIDGET_HTML,
  USER_SESSION_WIDGET_URI,
} from '../widgets/user-session-widget';
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
  staticResourcesOnly?: boolean;
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
  const {
    env,
    authHeader,
    tokenScope,
    correlationId,
    evalRunId,
    evalTraceId,
    staticResourcesOnly = false,
  } = ctx;

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

  // Keep the published v1 resource readable while current descriptors use a
  // new immutable cache key. Template URIs are cache keys in ChatGPT. The v1
  // body is frozen alongside its _meta; the v2 body adds the provider
  // attribution footer.
  const widgetResources = [
    ['user-session-widget', LEGACY_USER_SESSION_WIDGET_URI, LEGACY_USER_SESSION_WIDGET_HTML],
    ['user-session-widget-v2', USER_SESSION_WIDGET_URI, USER_SESSION_WIDGET_HTML],
  ] as const;

  for (const [name, uri, widgetHtml] of widgetResources) {
    server.registerResource(
      name,
      uri,
      {
        mimeType: 'text/html;profile=mcp-app',
      },
      async () => ({
        contents: [{
          uri,
          mimeType: 'text/html;profile=mcp-app',
          text: widgetHtml,
          // The legacy URI is the frozen published-v1 contract: its read-result
          // _meta must stay byte-identical to the snapshot OpenAI scanned.
          // Descriptor additions (FLA-177) go on the v2 URI only.
          _meta: {
            ui: {
              csp: {
                connectDomains: [],
                resourceDomains: [],
              },
            },
            ...(uri === USER_SESSION_WIDGET_URI && {
              // Plain-language widget summary for directory/host surfaces (v2 only).
              'openai/widgetDescription':
                'Summary card of your connected fantasy leagues, showing league names, sports, and your default league.',
            }),
            'openai/widgetCSP': {
              connect_domains: [],
              resource_domains: [],
              // Keep external-link allowlisting without reintroducing a stable
              // widget domain — the widget is fully self-contained (empty
              // connect/resource CSP), so a dedicated domain adds no capability;
              // revisit only if a portal scan explicitly requires _meta.ui.domain.
              // v2 additionally allowlists the Yahoo Fantasy attribution link
              // target; the v1 _meta stays byte-identical.
              redirect_domains:
                uri === USER_SESSION_WIDGET_URI
                  ? ['https://flaim.app', 'https://sports.yahoo.com']
                  : ['https://flaim.app'],
            },
          },
        }],
      })
    );
  }

  if (staticResourcesOnly) {
    return server;
  }

  const tools = getUnifiedTools();
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
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
        // insufficient-scope error returns. Its own waitUntil so it never blocks
        // the response. The token authenticated (introspection passed), so this
        // is insufficient_scope, not invalid_token.
        if (!hasRequiredScope(tokenScope, tool.requiredScope)) {
          safeEmit(ctx, tool.name, args, 'denied', null);
          return mcpInsufficientScopeError('https://api.flaim.app/mcp', tool.requiredScope);
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
