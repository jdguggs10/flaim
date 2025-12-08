import { MODEL } from "@/config/constants";
import { NextRequest, NextResponse } from "next/server";
import { auth } from '@clerk/nextjs/server';
import type { TurnResponseRequest } from '@/types/api-responses';
import OpenAI from "openai";

// Simple usage tracking (shared with usage route)
interface UserUsage {
  userId: string;
  messageCount: number;
  resetDate: string;
  plan: 'free' | 'paid';
}

const userUsageStore = new Map<string, UserUsage>();
const FREE_TIER_LIMIT = 100; // 100 messages per month
const RESET_INTERVAL_DAYS = 30;

class SimpleUsageTracker {
  private static getResetDate(): string {
    const date = new Date();
    date.setDate(date.getDate() + RESET_INTERVAL_DAYS);
    return date.toISOString();
  }

  private static isResetNeeded(resetDate: string): boolean {
    return new Date(resetDate) <= new Date();
  }

  static getUserUsage(userId: string): UserUsage {
    let usage = userUsageStore.get(userId);
    
    if (!usage) {
      usage = {
        userId,
        messageCount: 0,
        resetDate: this.getResetDate(),
        plan: 'free'
      };
      userUsageStore.set(userId, usage);
    }

    if (this.isResetNeeded(usage.resetDate)) {
      usage.messageCount = 0;
      usage.resetDate = this.getResetDate();
      userUsageStore.set(userId, usage);
    }

    return usage;
  }

  static canSendMessage(userId: string): { allowed: boolean; remaining?: number } {
    const usage = this.getUserUsage(userId);
    
    if (usage.plan === 'paid') {
      return { allowed: true };
    }

    const allowed = usage.messageCount < FREE_TIER_LIMIT;
    const remaining = Math.max(0, FREE_TIER_LIMIT - usage.messageCount);
    
    return { allowed, remaining };
  }

  static incrementUsage(userId: string): UserUsage {
    const usage = this.getUserUsage(userId);
    
    if (usage.plan === 'free') {
      usage.messageCount++;
      userUsageStore.set(userId, usage);
    }
    
    return usage;
  }
}

// Auth and usage helper
async function requireAuthWithUsage(): Promise<{ userId: string } | NextResponse> {
  try {
    const { userId } = await auth();
    
    if (!userId) {
      return NextResponse.json(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    // Check usage limits
    const usageCheck = SimpleUsageTracker.canSendMessage(userId);
    if (!usageCheck.allowed) {
      return NextResponse.json(
        { 
          error: "Usage limit exceeded", 
          remaining: usageCheck.remaining || 0,
          limit: FREE_TIER_LIMIT 
        },
        { status: 429 }
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
    // Check auth and usage limits
    const authResult = await requireAuthWithUsage();
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { userId } = authResult;
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

    // Increment usage after successful API call setup
    SimpleUsageTracker.incrementUsage(userId);

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
