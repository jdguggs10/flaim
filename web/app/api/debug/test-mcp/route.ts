import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { isAllowedUrl } from '@/lib/mcp-url-allowlist';

/**
 * POST /api/debug/test-mcp
 * -----------------------------------------------------------
 * Tests MCP server connection by making a tools/list request.
 * Only allows requests to known MCP server hosts (SSRF protection).
 */
export async function POST(req: NextRequest) {
  // Environment gate: only available in development or when explicitly enabled
  if (process.env.NODE_ENV !== "development" && process.env.ENABLE_DEBUG_ROUTES !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

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

    const bearer = await getToken?.();
    if (!bearer) {
      return respond({ connected: false, error: 'Authentication token unavailable' }, 401);
    }

    // Try to make a tools/list request to the MCP server
    const mcpRes = await fetch(serverUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // MCP SDK rejects requests without an explicit Accept header (406)
        'Accept': 'application/json, text/event-stream',
        'Authorization': `Bearer ${bearer}`,
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
