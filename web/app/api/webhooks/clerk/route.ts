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

  if (event.type !== "user.created" || !result.ok) {
    return NextResponse.json({ received: true, sync: result });
  }

  if (!isWelcomeAutomationEnabled()) {
    return NextResponse.json({
      received: true,
      sync: result,
      welcome: { skipped: true, error: "Resend welcome automation is disabled" },
    });
  }

  after(async () => {
    // The request-level guard already checked the feature flag; pass an explicit
    // enabled override so this queued side effect reflects that same decision.
    const welcome = await sendWelcomeAutomationEvent(event.data, { enabled: true });
    if (!welcome.ok && !welcome.skipped) {
      console.error("Resend welcome automation event failed:", welcome.error);
    }
  });

  return NextResponse.json({ received: true, sync: result, welcome: { queued: true } });
}
