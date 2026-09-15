import { verifyWebhook } from "@clerk/nextjs/webhooks";
import { after, NextRequest, NextResponse } from "next/server";
import { logEmailOps } from "@/lib/server/email-ops";
import {
  clearEmailRetry,
  markEmailRetry,
} from "@/lib/server/email-retry-marker";
import {
  syncClerkUserToResendContact,
  type ClerkUserEmailSyncPayload,
} from "@/lib/server/resend-contact-sync";
import {
  isWelcomeAutomationEnabled,
  sendWelcomeAutomationEvent,
} from "@/lib/server/resend-welcome-automation";
import {
  mapClerkUserToSignup,
  recordSignup,
  type SignupLogInput,
} from "@/lib/server/signup-log";

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

  // The permanent signup log is written before anything else, for both
  // user.created and user.updated, and above the welcome-flag early return —
  // otherwise a flag about email would quietly become a flag about analytics.
  // It is awaited rather than scheduled in `after()` because `after()` work is
  // best-effort and cancelled on timeout, and this capture may not be.
  let signup: SignupLogInput;
  try {
    signup = mapClerkUserToSignup(event.data);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "signup_log.payload_invalid",
        reason: error instanceof Error ? error.message : "unknown_error",
        source: `clerk.${event.type}`,
        userId: user.id,
      })
    );
    return NextResponse.json({ error: "Unexpected webhook payload" }, { status: 500 });
  }

  try {
    await recordSignup(signup, { source: "webhook" });
  } catch (error) {
    // Return 500 before the welcome is queued: Svix retries the delivery, and
    // because nothing was scheduled the retry cannot double-send a welcome.
    console.error(
      JSON.stringify({
        event: "signup_log.write_failed",
        reason: error instanceof Error ? error.message : "unknown_error",
        source: `clerk.${event.type}`,
        userId: user.id,
      })
    );
    return NextResponse.json({ error: "Signup log write failed" }, { status: 500 });
  }

  if (WELCOME_EVENTS.has(event.type)) {
    if (!isWelcomeAutomationEnabled()) {
      logEmailOps("email.welcome_event_skipped", {
        provider: "resend",
        reason: "welcome_automation_disabled",
        source: "clerk.user.created",
        userId: user.id,
      });
      return NextResponse.json({
        received: true,
        welcome: { skipped: true, error: "Resend welcome automation is disabled" },
      });
    }

    after(async () => {
      try {
        // Resend Automations identify contacts by email and create missing contacts
        // before adding the segment and sending the welcome email. The feature flag
        // was checked before queueing; keep the async call aligned with that decision.
        const welcome = await sendWelcomeAutomationEvent(user, { enabled: true });
        if (!welcome.ok && !welcome.skipped) {
          logEmailOps("email.welcome_event_failed", {
            error: welcome.error,
            provider: "resend",
            reason: "welcome_event_send_failed",
            source: "clerk.user.created",
            userId: user.id,
          });

          const marker = await markEmailRetry(user.id, "welcomeEvent", {
            metadata: user.private_metadata,
          });
          if (!marker.ok) {
            logEmailOps("email.welcome_event_failed", {
              error: marker.error,
              provider: "clerk",
              reason: "retry_marker_write_failed",
              source: "clerk.user.created",
              userId: user.id,
            });
          }
          return;
        }

        if (welcome.ok) {
          const marker = await clearEmailRetry(user.id, "welcomeEvent", {
            metadata: user.private_metadata,
          });
          if (!marker.ok) {
            logEmailOps("email.welcome_event_failed", {
              error: marker.error,
              provider: "clerk",
              reason: "retry_marker_clear_failed",
              source: "clerk.user.created",
              userId: user.id,
            });
          }
        }
      } catch (error) {
        // `after()` work must not create an unhandled rejection after Clerk has
        // already received its acknowledgement.
        logEmailOps("email.welcome_event_failed", {
          error,
          provider: "resend",
          reason: "welcome_event_after_failed",
          source: "clerk.user.created",
          userId: user.id,
        });

        const marker = await markEmailRetry(user.id, "welcomeEvent", {
          metadata: user.private_metadata,
        });
        if (!marker.ok) {
          logEmailOps("email.welcome_event_failed", {
            error: marker.error,
            provider: "clerk",
            reason: "retry_marker_write_failed",
            source: "clerk.user.created",
            userId: user.id,
          });
        }
      }
    });

    return NextResponse.json({ received: true, welcome: { queued: true } });
  }

  const result = await syncClerkUserToResendContact(user);

  if (!result.ok && !result.skipped) {
    logEmailOps("email.contact_sync_failed", {
      error: result.error,
      provider: "resend",
      reason: "contact_sync_failed",
      source: "clerk.user.updated",
      userId: user.id,
    });

    after(async () => {
      const marker = await markEmailRetry(user.id, "contactSync", {
        metadata: user.private_metadata,
      });
      if (!marker.ok) {
        logEmailOps("email.contact_sync_failed", {
          error: marker.error,
          provider: "clerk",
          reason: "retry_marker_write_failed",
          source: "clerk.user.updated",
          userId: user.id,
        });
      }
    });

    // Acknowledge verified Clerk events to avoid webhook retry storms for downstream Resend failures.
    return NextResponse.json({ error: "Contact sync failed", received: true, sync: result });
  }

  if (result.ok) {
    after(async () => {
      const marker = await clearEmailRetry(user.id, "contactSync", {
        metadata: user.private_metadata,
      });
      if (!marker.ok) {
        logEmailOps("email.contact_sync_failed", {
          error: marker.error,
          provider: "clerk",
          reason: "retry_marker_clear_failed",
          source: "clerk.user.updated",
          userId: user.id,
        });
      }
    });
  }

  return NextResponse.json({ received: true, sync: result });
}
