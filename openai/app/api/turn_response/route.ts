import { MODEL } from "@/config/constants";
import { NextRequest, NextResponse } from "next/server";
import { withAuthAndUsage } from '@flaim/auth/web/server';
import type { TurnResponseRequest } from '@/types/api-responses';
import OpenAI from "openai";

export const runtime = 'edge';

export const POST = withAuthAndUsage(async (userId: string, request: NextRequest) => {
  try {

    const { messages, tools } = await request.json() as TurnResponseRequest;
    console.log("Received messages:", messages);
    console.log(`User ${userId} making API call`);

    if (!messages) {
      return NextResponse.json(
        { error: "Messages are required" },
        { status: 400 }
      );
    }

    const openai = new OpenAI();

    const events = await openai.responses.create({
      model: MODEL,
      input: messages,
      tools: tools || [],
      stream: true,
      parallel_tool_calls: false,
    });

    // Create a ReadableStream that emits SSE data
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of events) {
            // Sending all events to the client
            const data = JSON.stringify({
              event: event.type,
              data: event,
            });
            controller.enqueue(`data: ${data}\n\n`);
          }
          // End of stream
          controller.close();
        } catch (error) {
          console.error("Error in streaming loop:", error);
          controller.error(error);
        }
      },
    });

    // Return the ReadableStream as SSE (usage increment handled by withAuthAndUsage)
    
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
});
