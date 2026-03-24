import {
  PUBLIC_CHAT_ALLOWED_TOOLS,
  PUBLIC_CHAT_MODEL,
  PUBLIC_CHAT_SYSTEM_PROMPT,
  getPublicChatPreset,
} from "@/lib/public-chat";
import { isAllowedUrl } from "@/lib/mcp-url-allowlist";
import type { PublicChatTurnRequest } from "@/types/api-responses";
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

const PUBLIC_CHAT_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const PUBLIC_CHAT_RATE_LIMIT_MAX_REQUESTS = 5;
const publicChatRequestLog = new Map<string, number[]>();

class PublicChatConfigError extends Error {}

function getPublicChatIpAddress(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || "unknown";
  }

  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function isPublicChatRateLimited(ipAddress: string, now: number) {
  const requestTimestamps = publicChatRequestLog.get(ipAddress) ?? [];
  const activeWindow = requestTimestamps.filter(
    (timestamp) => now - timestamp < PUBLIC_CHAT_RATE_LIMIT_WINDOW_MS
  );

  if (activeWindow.length >= PUBLIC_CHAT_RATE_LIMIT_MAX_REQUESTS) {
    publicChatRequestLog.set(ipAddress, activeWindow);
    return true;
  }

  activeWindow.push(now);
  publicChatRequestLog.set(ipAddress, activeWindow);
  return false;
}

function normalizeMcpUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/mcp") ? trimmed : `${trimmed}/mcp`;
}

function getPublicChatMcpTool() {
  const serverUrl = normalizeMcpUrl(
    process.env.FANTASY_MCP_URL ||
      process.env.NEXT_PUBLIC_FANTASY_MCP_URL ||
      "https://api.flaim.app/mcp"
  );

  if (!isAllowedUrl(serverUrl)) {
    throw new PublicChatConfigError("Configured MCP server URL is not allowed");
  }

  const demoApiKey = process.env.DEMO_API_KEY;
  if (!demoApiKey) {
    throw new PublicChatConfigError("DEMO_API_KEY is not configured");
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

    const ipAddress = getPublicChatIpAddress(request);
    if (isPublicChatRateLimited(ipAddress, Date.now())) {
      return NextResponse.json(
        {
          error:
            "Public chat is temporarily rate limited. Please wait a minute and try again.",
        },
        { status: 429 }
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
      store: false,
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
    console.error("Error in public chat POST handler:", error);

    if (error instanceof PublicChatConfigError) {
      return NextResponse.json(
        { error: "Demo service is temporarily unavailable." },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: "Public chat is temporarily unavailable." },
      { status: 500 }
    );
  }
}
