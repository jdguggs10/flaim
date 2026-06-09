import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { after, NextRequest, NextResponse } from "next/server";
import {
  syncClerkUserToResendContact,
  type ClerkUserEmailSyncPayload,
} from "@/lib/server/resend-contact-sync";
import {
  isWelcomeAutomationEnabled,
  sendWelcomeAutomationEvent,
} from "@/lib/server/resend-welcome-automation";

const CONTACT_SYNC_EVENTS = new Set(["user.updated"]);
const WELCOME_EVENTS = new Set(["user.created"]);
const HANDLED_EVENTS = new Set([...CONTACT_SYNC_EVENTS, ...WELCOME_EVENTS]);

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

  if (!HANDLED_EVENTS.has(event.type)) {
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

  const user = event.data;

  if (WELCOME_EVENTS.has(event.type)) {
    if (!isWelcomeAutomationEnabled()) {
      return NextResponse.json({
        received: true,
        welcome: { skipped: true, error: "Resend welcome automation is disabled" },
      });
    }

    after(async () => {
      // Resend Automations identify contacts by email and create missing contacts
      // before adding the segment and sending the welcome email.
      const welcome = await sendWelcomeAutomationEvent(user, { enabled: true });
      if (!welcome.ok && !welcome.skipped) {
        console.error("Resend welcome automation event failed:", welcome.error);
      }
    });

    return NextResponse.json({ received: true, welcome: { queued: true } });
  }

  const result = await syncClerkUserToResendContact(user);

  if (!result.ok && !result.skipped) {
    console.error("Clerk to Resend contact sync failed:", result.error);
    // Acknowledge verified Clerk events to avoid webhook retry storms for downstream Resend failures.
    return NextResponse.json({ error: "Contact sync failed", received: true, sync: result });
  }

  return NextResponse.json({ received: true, sync: result });
}
