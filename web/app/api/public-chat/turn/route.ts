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
// Temporary per-instance limiter for the public demo.
// The March 24 plan's Phase 4 hardening work calls for durable controls:
// per-IP caps, cooldowns, and a predictable cost ceiling.
const publicChatRequestLog = new Map<string, number[]>();

class PublicChatConfigError extends Error {}

function extractAssistantText(item: unknown) {
  if (!item || typeof item !== "object" || !("content" in item)) {
    return "";
  }

  const content = (
    item as { content?: Array<{ type?: string; text?: string }> }
  ).content;
  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .filter((entry) => entry?.type === "output_text" && typeof entry.text === "string")
    .map((entry) => entry.text)
    .join("");
}

function enqueueSse(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: string,
  data: Record<string, unknown> = {}
) {
  controller.enqueue(
    encoder.encode(`data: ${JSON.stringify({ event, data })}\n\n`)
  );
}

function getPublicChatIpAddress(request: NextRequest) {
  // Safe here because Vercel terminates the request and sets x-forwarded-for.
  // If this route ever moves behind a different proxy layer, revisit the trust model.
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
    process.env.FANTASY_MCP_URL || "https://api.flaim.app/mcp"
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
      // Keep the public demo on the same model/reasoning pairing as the internal chat
      // surface until Phase 4 hardening deliberately revisits cost and latency tradeoffs.
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
    }, {
      signal: request.signal,
    });

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of events) {
            const eventType = event.type as string;
            const eventWithOptionalItem = event as {
              item?: {
                type?: string;
                id?: string;
                name?: string | null;
                arguments?: string;
              };
            };
            const eventWithStringFields = event as {
              delta?: string;
              item_id?: string;
              arguments?: string;
            };

            switch (eventType) {
              case "response.reasoning_summary_text.delta":
                if (
                  typeof eventWithStringFields.delta === "string" &&
                  eventWithStringFields.delta
                ) {
                  enqueueSse(controller, encoder, "reasoning_delta", {
                    delta: eventWithStringFields.delta,
                  });
                }
                break;
              case "response.output_item.added":
                if (
                  eventWithOptionalItem.item?.type === "mcp_call" &&
                  eventWithOptionalItem.item.id
                ) {
                  enqueueSse(controller, encoder, "tool_start", {
                    itemId: eventWithOptionalItem.item.id,
                    name: eventWithOptionalItem.item.name ?? null,
                    arguments:
                      typeof eventWithOptionalItem.item.arguments === "string"
                        ? eventWithOptionalItem.item.arguments
                        : "",
                  });
                }
                break;
              case "response.mcp_call_arguments.delta":
                if (
                  typeof eventWithStringFields.item_id === "string" &&
                  typeof eventWithStringFields.delta === "string"
                ) {
                  enqueueSse(controller, encoder, "tool_args_delta", {
                    itemId: eventWithStringFields.item_id,
                    delta: eventWithStringFields.delta,
                  });
                }
                break;
              case "response.mcp_call_arguments.done":
                if (
                  typeof eventWithStringFields.item_id === "string" &&
                  typeof eventWithStringFields.arguments === "string"
                ) {
                  enqueueSse(controller, encoder, "tool_args_done", {
                    itemId: eventWithStringFields.item_id,
                    arguments: eventWithStringFields.arguments,
                  });
                }
                break;
              case "response.output_text.delta":
                if (
                  typeof eventWithStringFields.delta === "string" &&
                  eventWithStringFields.delta
                ) {
                  enqueueSse(controller, encoder, "assistant_delta", {
                    delta: eventWithStringFields.delta,
                  });
                }
                break;
              case "response.output_item.done":
                if (
                  eventWithOptionalItem.item?.type === "mcp_call" &&
                  eventWithOptionalItem.item.id
                ) {
                  enqueueSse(controller, encoder, "tool_done", {
                    itemId: eventWithOptionalItem.item.id,
                  });
                }

                if (eventWithOptionalItem.item?.type === "message") {
                  const text = extractAssistantText(eventWithOptionalItem.item);
                  if (text) {
                    enqueueSse(controller, encoder, "assistant_message", {
                      text,
                    });
                  }
                }
                break;
              case "response.completed":
                enqueueSse(controller, encoder, "completed");
                break;
              default:
                break;
            }
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
