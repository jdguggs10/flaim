import { MODEL } from "@/config/constants";
import { NextRequest, NextResponse } from "next/server";
import { auth } from '@clerk/nextjs/server';
import type { TurnResponseRequest } from '@/types/api-responses';
import OpenAI from "openai";

// Simple auth helper
async function requireAuth(): Promise<{ userId: string } | NextResponse> {
  try {
    const { userId } = await auth();

    if (!userId) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    return { userId };
  } catch (error) {
    console.error('Auth error:', error);
    return NextResponse.json(
      { error: "Authentication failed" },
      { status: 401 }
    );
  }
}

export const runtime = 'edge';

export async function POST(request: NextRequest) {
  try {
    // Check auth
    const authResult = await requireAuth();
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { userId } = authResult;
    const { messages, tools } = await request.json() as TurnResponseRequest;

    if (!messages) {
      return NextResponse.json(
        { error: "Messages are required" },
        { status: 400 }
      );
    }

    // Debug: Log tool configuration (without sensitive headers)
    if (tools && tools.length > 0) {
      const sanitizedTools = tools.map(tool => {
        if (tool.type === 'mcp') {
          return {
            type: tool.type,
            server_label: tool.server_label,
            server_url: tool.server_url,
            has_auth: !!tool.headers?.Authorization,
            has_user_id: !!tool.headers?.['X-Clerk-User-ID'],
            allowed_tools: tool.allowed_tools,
            require_approval: tool.require_approval
          };
        }
        return { type: tool.type };
      });
      console.log(`[DEBUG] User ${userId} sending ${tools.length} tools:`, JSON.stringify(sanitizedTools));
    }

    const openai = new OpenAI();

    let events;
    try {
      events = await openai.responses.create({
        model: MODEL,
        input: messages,
        tools: tools || [],
        stream: true,
        parallel_tool_calls: false,
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
          details: message,
          debug: process.env.NODE_ENV === "development" ? error : undefined,
        },
        { status: statusCode }
      );
    }

    // Create a ReadableStream that emits SSE data (edge runtime requires Uint8Array)
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
