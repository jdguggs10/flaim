import { MODEL } from "@/lib/chat/constants";
import { NextRequest, NextResponse } from "next/server";
import { requireChatAccess } from '@/lib/chat/auth';
import type { TurnResponseRequest } from '@/types/api-responses';
import OpenAI from "openai";
import { isAllowedUrl } from '@/lib/mcp-url-allowlist';

export async function POST(request: NextRequest) {
  try {
    // Check auth
    const authResult = await requireChatAccess();
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { userId } = authResult;
    const { messages, tools, previous_response_id } = await request.json() as TurnResponseRequest;

    if (!messages) {
      return NextResponse.json(
        { error: "Messages are required" },
        { status: 400 }
      );
    }

    let validatedTools: any[] = [];
    if (tools !== undefined && !Array.isArray(tools)) {
      return NextResponse.json(
        { error: "Invalid tools payload" },
        { status: 400 }
      );
    }

    // SSRF protection: validate MCP tool URLs against allowlist and sanitize headers
    if (Array.isArray(tools)) {
      validatedTools = [];
      for (const tool of tools) {
        if (!tool || typeof tool !== "object") {
          return NextResponse.json(
            { error: "Invalid tool entry in request payload" },
            { status: 400 }
          );
        }

        if (tool.type !== "mcp") {
          validatedTools.push(tool);
          continue;
        }

        if (typeof tool.server_url !== "string" || !tool.server_url) {
          return NextResponse.json(
            { error: "MCP tool requires a valid server_url" },
            { status: 400 }
          );
        }

        if (!isAllowedUrl(tool.server_url)) {
          return NextResponse.json(
            { error: "MCP server URL not allowed" },
            { status: 400 }
          );
        }

        const sanitizedHeaders: Record<string, string> = {};
        if (tool.headers && typeof tool.headers === "object") {
          for (const [key, value] of Object.entries(tool.headers as Record<string, unknown>)) {
            if (typeof value !== "string") continue;
            const normalized = key.toLowerCase();
            if (normalized === "authorization" || normalized === "content-type") {
              sanitizedHeaders[key] = value;
              continue;
            }
            return NextResponse.json(
              { error: `Unexpected MCP header: ${key}` },
              { status: 400 }
            );
          }
        }

        validatedTools.push({
          ...tool,
          headers: sanitizedHeaders,
        });
      }
    }

    // Debug: Log tool configuration (without sensitive headers)
    if (validatedTools.length > 0) {
      const sanitizedTools = validatedTools.map(tool => {
        if (tool.type === 'mcp') {
          return {
            type: tool.type,
            server_label: tool.server_label,
            server_url: tool.server_url,
            has_auth: !!tool.headers?.Authorization,
            allowed_tools: tool.allowed_tools,
            require_approval: tool.require_approval
          };
        }
        return { type: tool.type };
      });
      console.log(`[DEBUG] User ${userId} sending ${validatedTools.length} tools:`, JSON.stringify(sanitizedTools));
    }

    const openai = new OpenAI();

    let events;
    try {
      // Use stored-responses flow: store: true enables response storage,
      // previous_response_id links to prior turn (avoids rebuilding conversation history
      // and the "missing reasoning item" error when tool calls are involved)
      events = await openai.responses.create({
        model: MODEL,
        input: messages,
        tools: validatedTools,
        stream: true,
        store: true,
        parallel_tool_calls: false,
        reasoning: { summary: "auto" },
        ...(previous_response_id ? { previous_response_id } : {}),
      });
    } catch (error: any) {
      const statusCode =
        typeof error?.status === "number" && error.status >= 100
          ? error.status
          : 500;
      const message = error?.message || "Unknown error";
      console.error(`[ERROR] OpenAI API call failed for user ${userId}:`, {
        message,
        status: statusCode,
        type: error?.type,
        code: error?.code,
      });
      return NextResponse.json(
        {
          error: "Failed to process request",
          details: process.env.NODE_ENV === "development" ? message : "An error occurred while processing your request",
          debug: process.env.NODE_ENV === "development" ? error : undefined,
        },
        { status: statusCode }
      );
    }

    // Create a ReadableStream that emits SSE data (ReadableStream expects Uint8Array chunks)
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of events) {
            // Sending all events to the client
            const data = JSON.stringify({
              event: event.type,
              data: event,
            });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }
          // End of stream
          controller.close();
        } catch (error) {
          console.error("Error in streaming loop:", error);
          controller.error(error);
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache"
      },
    });
  } catch (error) {
    console.error("Error in POST handler:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
