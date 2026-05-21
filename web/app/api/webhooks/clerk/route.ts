import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { NextRequest, NextResponse } from "next/server";
import {
  syncClerkUserToResendContact,
  type ClerkUserEmailSyncPayload,
} from "@/lib/server/resend-contact-sync";

const CONTACT_SYNC_EVENTS = new Set(["user.created", "user.updated"]);

export async function POST(request: NextRequest) {
  let event;

  try {
    event = await verifyWebhook(request);
  } catch (error) {
    console.error("Clerk webhook verification failed:", error);
    return NextResponse.json({ error: "Webhook verification failed" }, { status: 400 });
  }

  if (!CONTACT_SYNC_EVENTS.has(event.type)) {
    return NextResponse.json({ received: true, skipped: true });
  }

  const result = await syncClerkUserToResendContact(
    event.data as ClerkUserEmailSyncPayload,
    event.type as "user.created" | "user.updated",
  );

  if (!result.ok && !result.skipped) {
    console.error("Clerk to Resend contact sync failed:", result.error);
    return NextResponse.json(
      { error: "Contact sync failed", received: true },
      { status: 502 },
    );
  }

  return NextResponse.json({ received: true, sync: result });
}
