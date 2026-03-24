import {
  PUBLIC_CHAT_ALLOWED_TOOLS,
  PUBLIC_CHAT_MODEL,
  PUBLIC_CHAT_SYSTEM_PROMPT,
  getPublicChatPreset,
} from "@/lib/public-chat";
import { isAllowedUrl } from "@/lib/mcp-url-allowlist";
import {
  acquirePublicChatRun,
  completePublicChatRun,
} from "@/lib/server/public-chat-guard";
import { getCachedPublicChatContext } from "@/lib/server/public-chat-context";
import { getCachedSportsTodayPulse } from "@/lib/server/public-chat-sports-pulse";
import type { PublicChatTurnRequest } from "@/types/api-responses";
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

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

  const demoApiKey = process.env.DEMO_API_KEY?.trim();
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

function getPublicChatWebSearchTool() {
  return {
    type: "web_search_preview" as const,
    user_location: {
      type: "approximate" as const,
      country: "US",
      region: "New York",
      city: "Rochester",
    },
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

    const startedAt = Date.now();
    const { runId } = await acquirePublicChatRun({
      visitorIp: getPublicChatIpAddress(request),
      presetId,
      model: PUBLIC_CHAT_MODEL,
      signal: request.signal,
    }).catch((error: Error & { status?: number; code?: string }) => {
      if (error.status === 429 || error.code === "rate_limit_exceeded") {
        throw new Response(
          JSON.stringify({
            error:
              "Public chat is temporarily rate limited. Please wait about a minute and try again.",
          }),
          {
            status: 429,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      if (error.status === 409 || error.code === "concurrency_limited") {
        throw new Response(
          JSON.stringify({
            error:
              "A public chat run is already in progress for this visitor. Please wait for it to finish and try again.",
          }),
          {
            status: 409,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      throw error;
    });

    let finalized = false;
    const finalizeRun = async (
      status: "completed" | "error" | "aborted",
      errorCode?: string
    ) => {
      if (finalized) {
        return;
      }

      finalized = true;
      await completePublicChatRun({
        runId,
        status,
        durationMs: Date.now() - startedAt,
        errorCode: errorCode ?? null,
      });
    };

    const [publicChatContext, sportsTodayPulse] = await Promise.all([
      getCachedPublicChatContext(),
      getCachedSportsTodayPulse(),
    ]);
    const todayInEastern = new Intl.DateTimeFormat("en-US", {
      dateStyle: "full",
      timeZone: "America/New_York",
    }).format(new Date());
    const openai = new OpenAI();
    let events: Awaited<ReturnType<typeof openai.responses.create>>;

    try {
      events = await openai.responses.create({
        // Keep the public demo on the same model/reasoning pairing as the internal chat
        // surface until Phase 4 hardening deliberately revisits cost and latency tradeoffs.
        model: PUBLIC_CHAT_MODEL,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: PUBLIC_CHAT_SYSTEM_PROMPT }],
          },
          ...(publicChatContext
            ? [
                {
                  role: "developer" as const,
                  content: [{ type: "input_text" as const, text: publicChatContext }],
                },
              ]
            : []),
          ...(sportsTodayPulse
            ? [
                {
                  role: "developer" as const,
                  content: [{ type: "input_text" as const, text: sportsTodayPulse }],
                },
              ]
            : []),
          {
            role: "developer",
            content: [
              {
                type: "input_text",
                text: `Today in Gerry's timezone is ${todayInEastern}. Use this as the reference date for "today" when deciding what current sports context to mention from web search.`,
              },
            ],
          },
          {
            role: "user",
            content: [{ type: "input_text", text: preset.prompt }],
          },
        ],
        tools: [getPublicChatWebSearchTool(), getPublicChatMcpTool()],
        stream: true,
        store: false,
        parallel_tool_calls: true,
        tool_choice: "auto",
        reasoning: { summary: "auto" },
      }, {
        signal: request.signal,
      });
    } catch (error) {
      await finalizeRun(
        request.signal.aborted ? "aborted" : "error",
        request.signal.aborted ? "request_aborted" : "openai_create_failed"
      ).catch((finalizeError) => {
        console.error("Failed to finalize public chat run after create error:", finalizeError);
      });
      throw error;
    }

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
                  (eventWithOptionalItem.item?.type === "mcp_call" ||
                    eventWithOptionalItem.item?.type === "web_search_call") &&
                  eventWithOptionalItem.item.id
                ) {
                  enqueueSse(controller, encoder, "tool_start", {
                    itemId: eventWithOptionalItem.item.id,
                    name:
                      eventWithOptionalItem.item.name ??
                      eventWithOptionalItem.item.type ??
                      null,
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
                  (eventWithOptionalItem.item?.type === "mcp_call" ||
                    eventWithOptionalItem.item?.type === "web_search_call") &&
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
              case "response.web_search_call.completed":
                if (typeof eventWithStringFields.item_id === "string") {
                  enqueueSse(controller, encoder, "tool_done", {
                    itemId: eventWithStringFields.item_id,
                  });
                }
                break;
              case "response.completed":
                enqueueSse(controller, encoder, "completed");
                break;
              default:
                break;
            }
          }
          await finalizeRun("completed").catch((finalizeError) => {
            console.error("Failed to finalize completed public chat run:", finalizeError);
          });
          controller.close();
        } catch (error) {
          await finalizeRun(
            request.signal.aborted ? "aborted" : "error",
            request.signal.aborted ? "request_aborted" : "stream_error"
          ).catch((finalizeError) => {
            console.error("Failed to finalize errored public chat run:", finalizeError);
          });
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
    if (error instanceof Response) {
      return error;
    }

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
