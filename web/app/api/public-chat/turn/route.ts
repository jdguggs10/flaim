import {
  PUBLIC_CHAT_ALLOWED_TOOLS,
  PUBLIC_CHAT_SYSTEM_PROMPT,
  getPublicChatPreset,
} from "@/lib/public-chat";
import { isAllowedUrl } from "@/lib/mcp-url-allowlist";
import type { PublicChatTurnRequest } from "@/types/api-responses";
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const PUBLIC_CHAT_MODEL = "gpt-5-mini-2025-08-07";

function normalizeMcpUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/mcp") ? trimmed : `${trimmed}/mcp`;
}

function getPublicChatMcpTool() {
  const serverUrl = normalizeMcpUrl(
    process.env.NEXT_PUBLIC_FANTASY_MCP_URL || "https://api.flaim.app/mcp"
  );

  if (!isAllowedUrl(serverUrl)) {
    throw new Error("Configured MCP server URL is not allowed");
  }

  const demoApiKey = process.env.DEMO_API_KEY;
  if (!demoApiKey) {
    throw new Error("DEMO_API_KEY is not configured");
  }

  return {
    type: "mcp" as const,
    server_label: "fantasy",
    server_url: serverUrl,
    allowed_tools: [...PUBLIC_CHAT_ALLOWED_TOOLS],
    headers: {
      Authorization: `Bearer ${demoApiKey}`,
      "Content-Type": "application/json",
    },
    require_approval: "never" as const,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { presetId } = (await request.json()) as PublicChatTurnRequest;

    if (!presetId || typeof presetId !== "string") {
      return NextResponse.json(
        { error: "A preset prompt is required" },
        { status: 400 }
      );
    }

    const preset = getPublicChatPreset(presetId);
    if (!preset) {
      return NextResponse.json(
        { error: "Unknown public chat preset" },
        { status: 400 }
      );
    }

    const openai = new OpenAI();
    const events = await openai.responses.create({
      model: PUBLIC_CHAT_MODEL,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: PUBLIC_CHAT_SYSTEM_PROMPT }],
        },
        {
          role: "user",
          content: [{ type: "input_text", text: preset.prompt }],
        },
      ],
      tools: [getPublicChatMcpTool()],
      stream: true,
      store: true,
      parallel_tool_calls: false,
      reasoning: { summary: "auto" },
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of events) {
            const data = JSON.stringify({
              event: event.type,
              data: event,
            });
            controller.enqueue(encoder.encode(`data: ${data}\n\n`));
          }
          controller.close();
        } catch (error) {
          console.error("Error in public chat streaming loop:", error);
          controller.error(error);
        }
      },
    });

    return new NextResponse(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown public chat error";
    console.error("Error in public chat POST handler:", error);

    const status =
      message.includes("DEMO_API_KEY") || message.includes("MCP server URL")
        ? 503
        : 500;

    return NextResponse.json({ error: message }, { status });
  }
}
