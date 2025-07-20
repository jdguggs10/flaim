import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from '@flaim/auth/web/server';
import { UsageTracker } from '@flaim/auth/shared';
import type { UsageActionRequest } from '@/types/api-responses';

export const runtime = 'edge';

export async function GET() {
  try {
    const authResult = await requireAuth();
    
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { userId } = authResult;
    const usage = UsageTracker.getUsageStats(userId);
    
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
      UsageTracker.upgradeToPaid(userId);
      return NextResponse.json({
        success: true,
        message: "Upgraded to paid plan",
        usage: UsageTracker.getUsageStats(userId)
      });
    }
    
    if (action === "downgrade") {
      UsageTracker.downgradeToFree(userId);
      return NextResponse.json({
        success: true,
        message: "Downgraded to free plan",
        usage: UsageTracker.getUsageStats(userId)
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