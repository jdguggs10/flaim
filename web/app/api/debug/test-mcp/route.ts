import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';

/**
 * Allowlist of valid MCP server host patterns.
 * Only these hosts can be tested to prevent SSRF attacks.
 */
const ALLOWED_MCP_HOST_PATTERNS = [
  // Flaim production domains
  'flaim.app',
  // Cloudflare Workers (any account - for contributors and preview)
  'workers.dev',
  // Localhost for development
  'localhost',
  '127.0.0.1',
];

/**
 * Validate that a URL is safe to fetch (SSRF protection)
 */
function isAllowedUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString);

    // Must be HTTPS in production, allow HTTP for localhost
    const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (!isLocalhost && url.protocol !== 'https:') {
      return false;
    }

    // Check against allowlist patterns
    return ALLOWED_MCP_HOST_PATTERNS.some(pattern =>
      url.hostname === pattern || url.hostname.endsWith(`.${pattern}`)
    );
  } catch {
    return false;
  }
}

/**
 * POST /api/debug/test-mcp
 * -----------------------------------------------------------
 * Tests MCP server connection by making a tools/list request.
 * Only allows requests to known MCP server hosts (SSRF protection).
 */
export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  const respond = (body: Record<string, unknown>, status = 200) => (
    NextResponse.json({
      ...body,
      elapsedMs: Date.now() - startedAt,
      fetchedAt: new Date().toISOString(),
    }, { status })
  );

  try {
    const { userId, getToken } = await auth();

    if (!userId) {
      return respond({ connected: false, error: 'Not authenticated' }, 401);
    }

    const body = await req.json() as { serverUrl?: string };
    const { serverUrl } = body;

    if (!serverUrl) {
      return respond({ connected: false, error: 'No server URL provided' });
    }

    // SSRF protection: validate URL against allowlist
    if (!isAllowedUrl(serverUrl)) {
      return respond({
        connected: false,
        error: 'URL not allowed. Only known MCP servers can be tested.'
      }, 403);
    }

    const bearer = (await getToken?.()) || undefined;

    // Try to make a tools/list request to the MCP server
    const mcpRes = await fetch(serverUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Clerk-User-ID': userId,
        ...(bearer ? { 'Authorization': `Bearer ${bearer}` } : {})
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1,
      }),
    });

    if (!mcpRes.ok) {
      return respond({
        connected: false,
        error: `Server returned ${mcpRes.status}`,
      }, mcpRes.status);
    }

    const data = await mcpRes.json() as { result?: { tools?: unknown[] }; error?: { message?: string } };

    if (data.error) {
      return respond({
        connected: false,
        error: data.error.message || 'MCP error',
      });
    }

    const tools = data.result?.tools || [];

    return respond({
      connected: true,
      toolCount: Array.isArray(tools) ? tools.length : 0,
      tools: Array.isArray(tools) ? tools : [],
    });
  } catch (error) {
    console.error('MCP test route error', error);
    return respond({
      connected: false,
      error: error instanceof Error ? error.message : 'Connection failed',
    }, 500);
  }
}
