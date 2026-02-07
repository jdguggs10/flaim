// workers/fantasy-mcp/src/auth-response.ts
import { createMcpCorsHeaders } from '@flaim/worker-shared';

/**
 * Build MCP-compliant 401 response with WWW-Authenticate header.
 * Resource URL is path-sensitive: /fantasy/* advertises /fantasy/mcp, otherwise /mcp.
 */
export function buildMcpAuthErrorResponse(request: Request): Response {
  const corsHeaders = createMcpCorsHeaders(request);
  const pathname = new URL(request.url).pathname;
  const isFantasy = pathname.startsWith('/fantasy/');
  const resource = isFantasy
    ? 'https://api.flaim.app/fantasy/mcp'
    : 'https://api.flaim.app/mcp';
  const resourceMetadata = isFantasy
    ? 'https://api.flaim.app/fantasy/.well-known/oauth-protected-resource'
    : 'https://api.flaim.app/.well-known/oauth-protected-resource';
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: {
        code: -32001,
        message: 'Authentication required. Please provide a valid Bearer token.',
      },
      id: null,
    }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': `Bearer realm="fantasy-mcp", resource="${resource}", resource_metadata="${resourceMetadata}"`,
        ...corsHeaders,
      },
    }
  );
}
