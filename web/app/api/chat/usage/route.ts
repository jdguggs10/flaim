import { NextRequest, NextResponse } from "next/server";
import { auth } from '@clerk/nextjs/server';
import type { UsageActionRequest } from '@/types/api-responses';

// Simple usage tracking (in-memory for now - in production use a database)
interface UserUsage {
  userId: string;
  messageCount: number;
  resetDate: string;
  plan: 'free' | 'paid';
}

interface UsageStats {
  plan: 'free' | 'paid';
  messageCount: number;
  limit: number | null;
  remaining: number | null;
  resetDate: string;
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

  static upgradeToPaid(userId: string): UserUsage {
    const usage = this.getUserUsage(userId);
    usage.plan = 'paid';
    userUsageStore.set(userId, usage);
    return usage;
  }

  static downgradeToFree(userId: string): UserUsage {
    const usage = this.getUserUsage(userId);
    usage.plan = 'free';
    userUsageStore.set(userId, usage);
    return usage;
  }

  static getUsageStats(userId: string): UsageStats {
    const usage = this.getUserUsage(userId);
    
    if (usage.plan === 'paid') {
      return {
        plan: 'paid',
        messageCount: usage.messageCount,
        limit: null,
        remaining: null,
        resetDate: usage.resetDate
      };
    }

    return {
      plan: 'free',
      messageCount: usage.messageCount,
      limit: FREE_TIER_LIMIT,
      remaining: Math.max(0, FREE_TIER_LIMIT - usage.messageCount),
      resetDate: usage.resetDate
    };
  }
}

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

export async function GET() {
  try {
    const authResult = await requireAuth();
    
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { userId } = authResult;
    const usage = SimpleUsageTracker.getUsageStats(userId);
    
    return NextResponse.json({
      success: true,
      usage
    });
  } catch (error) {
    console.error("Error fetching usage stats:", error);
    return NextResponse.json(
      { error: "Failed to fetch usage stats" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAuth();
    
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { userId } = authResult;
    const { action } = await request.json() as UsageActionRequest;
    
    if (action === "upgrade") {
      SimpleUsageTracker.upgradeToPaid(userId);
      return NextResponse.json({
        success: true,
        message: "Upgraded to paid plan",
        usage: SimpleUsageTracker.getUsageStats(userId)
      });
    }
    
    if (action === "downgrade") {
      SimpleUsageTracker.downgradeToFree(userId);
      return NextResponse.json({
        success: true,
        message: "Downgraded to free plan",
        usage: SimpleUsageTracker.getUsageStats(userId)
      });
    }

    return NextResponse.json(
      { error: "Invalid action" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error updating usage:", error);
    return NextResponse.json(
      { error: "Failed to update usage" },
      { status: 500 }
    );
  }
}