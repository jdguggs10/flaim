import { NextRequest, NextResponse } from "next/server";
import type { WebhookEventPayload } from "resend";
import { logEmailOps, type EmailOpsEvent } from "@/lib/server/email-ops";
import { getResendWebhookVerifier } from "@/lib/server/resend-client";

const DELIVERY_EVENTS = {
  "email.bounced": "email.bounced",
  "email.complained": "email.complained",
  "email.delivery_delayed": "email.delivery_delayed",
  "email.failed": "email.failed",
} as const satisfies Record<string, EmailOpsEvent>;

function getHeader(request: NextRequest, name: string) {
  return request.headers.get(name) ?? undefined;
}

function getFailureReason(event: WebhookEventPayload) {
  if (event.type === "email.bounced") return event.data.bounce.message;
  if (event.type === "email.failed") return event.data.failed.reason;
  return undefined;
}

function isTrackedDeliveryEvent(event: WebhookEventPayload): event is Extract<
  WebhookEventPayload,
  { type: keyof typeof DELIVERY_EVENTS }
> {
  return event.type in DELIVERY_EVENTS;
}

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SIGNING_SECRET?.trim();
  if (!webhookSecret) {
    logEmailOps("email.webhook_verification_failed", {
      provider: "resend",
      reason: "webhook_signing_secret_not_configured",
      source: "resend.webhook",
    });
    return NextResponse.json({ error: "Webhook unavailable" }, { status: 500 });
  }

  // Do not use request.json(): signature verification is over these exact bytes.
  const payload = await request.text();
  const id = getHeader(request, "svix-id");
  const signature = getHeader(request, "svix-signature");
  const timestamp = getHeader(request, "svix-timestamp");

  if (!id || !signature || !timestamp) {
    logEmailOps("email.webhook_verification_failed", {
      provider: "resend",
      reason: "missing_svix_headers",
      source: "resend.webhook",
    });
    return NextResponse.json({ error: "Invalid webhook" }, { status: 400 });
  }

  const headers = { id, signature, timestamp };

  let event: WebhookEventPayload;
  try {
    event = getResendWebhookVerifier().webhooks.verify({
      headers,
      payload,
      webhookSecret,
    });
  } catch (error) {
    logEmailOps("email.webhook_verification_failed", {
      error,
      eventId: headers.id,
      provider: "resend",
      reason: "invalid_svix_signature",
      source: "resend.webhook",
    });
    return NextResponse.json({ error: "Invalid webhook" }, { status: 400 });
  }

  if (!isTrackedDeliveryEvent(event)) {
    return NextResponse.json({ received: true, skipped: true });
  }

  logEmailOps(DELIVERY_EVENTS[event.type], {
    eventId: headers.id,
    provider: "resend",
    reason: getFailureReason(event),
    resendEmailId: event.data.email_id,
    source: "resend.webhook",
  });

  return NextResponse.json({ event: event.type, received: true });
}
