import { getCachedPublicChatContext } from "@/lib/server/public-chat-context";
import { getCachedSportsTodayPulse } from "@/lib/server/public-chat-sports-pulse";
import { NextResponse } from "next/server";

export async function GET() {
  const [sessionContext, sportsTodayPulse] = await Promise.all([
    getCachedPublicChatContext(),
    getCachedSportsTodayPulse(),
  ]);

  return NextResponse.json(
    {
      warmed: Boolean(sessionContext || sportsTodayPulse),
      hasSessionContext: Boolean(sessionContext),
      hasSportsPulse: Boolean(sportsTodayPulse),
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
