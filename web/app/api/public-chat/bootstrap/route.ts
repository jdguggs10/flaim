import { getCachedPublicChatContext } from "@/lib/server/public-chat-context";
import { NextResponse } from "next/server";

export async function GET() {
  const sessionContext = await getCachedPublicChatContext();

  return NextResponse.json(
    {
      warmed: Boolean(sessionContext),
      hasSessionContext: Boolean(sessionContext),
      hasSportsPulse: false,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
