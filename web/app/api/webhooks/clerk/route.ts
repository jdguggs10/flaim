import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { NextRequest, NextResponse } from "next/server";
import {
  syncClerkUserToResendContact,
  type ClerkUserEmailSyncPayload,
} from "@/lib/server/resend-contact-sync";

const CONTACT_SYNC_EVENTS = new Set(["user.created", "user.updated"]);

function isClerkUserEmailSyncPayload(data: unknown): data is ClerkUserEmailSyncPayload {
  return (
    typeof data === "object" &&
    data !== null &&
    "id" in data &&
    typeof data.id === "string"
  );
}

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

  if (!isClerkUserEmailSyncPayload(event.data)) {
    console.error("Clerk webhook payload did not include a user id:", event.type);
    return NextResponse.json({
      error: "Unexpected webhook payload",
      received: true,
      skipped: true,
    });
  }

  const result = await syncClerkUserToResendContact(event.data);

  if (!result.ok && !result.skipped) {
    console.error("Clerk to Resend contact sync failed:", result.error);
    // Acknowledge verified Clerk events to avoid webhook retry storms for downstream Resend failures.
    return NextResponse.json({ error: "Contact sync failed", received: true, sync: result });
  }

  return NextResponse.json({ received: true, sync: result });
}
