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
  // RFC 6750 §3.1: if the request lacks any authentication information, the
  // challenge SHOULD NOT include an error code — that bare header is the
  // known-good shape for ChatGPT's initial connect. When credentials WERE
  // presented and failed (invalid/expired token, failed introspection), append
  // error/error_description after the discovery params so clients classify the
  // 401 as a token problem and start the OAuth flow.
  const credentialsPresented = request.headers.get('Authorization') !== null;
  const errorParams = credentialsPresented
    ? ', error="invalid_token", error_description="Authentication required"'
    : '';
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
        'WWW-Authenticate': `Bearer realm="fantasy-mcp", resource="${resource}", resource_metadata="${resourceMetadata}"${errorParams}`,
        ...corsHeaders,
      },
    }
  );
}
