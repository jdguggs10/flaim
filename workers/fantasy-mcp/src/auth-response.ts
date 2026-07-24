// workers/fantasy-mcp/src/auth-response.ts
import { createMcpCorsHeaders } from '@flaim/worker-shared';

/**
 * Build MCP-compliant 401 response with WWW-Authenticate header.
 * Resource URL is path-sensitive: /fantasy/* advertises /fantasy/mcp, otherwise /mcp.
 * The origin is derived from the incoming request (RFC 9728: `resource` must
 * match the URL the client is connecting to), so the preview lane's workers.dev
 * origin advertises itself while production stays byte-identical.
 */
export function buildMcpAuthErrorResponse(request: Request): Response {
  const corsHeaders = createMcpCorsHeaders(request);
  const { origin, pathname } = new URL(request.url);
  const isFantasy = pathname.startsWith('/fantasy/');
  const resource = isFantasy
    ? `${origin}/fantasy/mcp`
    : `${origin}/mcp`;
  const resourceMetadata = isFantasy
    ? `${origin}/fantasy/.well-known/oauth-protected-resource`
    : `${origin}/.well-known/oauth-protected-resource`;
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
