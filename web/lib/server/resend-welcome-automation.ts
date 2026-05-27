import "server-only";
import type { SendEventOptions } from "resend";
import {
  getResendErrorMessage,
  getResendEventsClient,
} from "@/lib/server/resend-client";
import {
  getClerkUserPrimaryEmail,
  type ClerkUserEmailSyncPayload,
} from "@/lib/server/resend-contact-sync";

export const WELCOME_AUTOMATION_EVENT_NAME = "flaim.user_created";

export interface WelcomeAutomationEventResult {
  email?: string;
  error?: string;
  event?: string;
  ok: boolean;
  skipped?: boolean;
}

type ResendEventApiError = {
  message?: string;
};

type ResendEventApiResponse<T> =
  | { data: T; error: null }
  | { data: null; error: ResendEventApiError };

interface WelcomeAutomationEventClient {
  events: {
    send: (
      payload: SendEventOptions,
    ) => Promise<ResendEventApiResponse<{ event: string; object: string }>>;
  };
}

interface SendWelcomeAutomationEventOptions {
  client?: WelcomeAutomationEventClient;
  enabled?: boolean;
  eventName?: string;
}

function cleanString(value: string | null | undefined) {
  const cleaned = value?.trim();
  return cleaned || null;
}

export function isWelcomeAutomationEnabled(options: SendWelcomeAutomationEventOptions = {}) {
  return options.enabled ?? process.env.RESEND_WELCOME_AUTOMATION_ENABLED === "true";
}

export async function sendWelcomeAutomationEvent(
  user: ClerkUserEmailSyncPayload,
  options: SendWelcomeAutomationEventOptions = {},
): Promise<WelcomeAutomationEventResult> {
  if (!isWelcomeAutomationEnabled(options)) {
    return { ok: false, skipped: true, error: "Resend welcome automation is disabled" };
  }

  const email = getClerkUserPrimaryEmail(user);
  if (!email) {
    return { ok: false, skipped: true, error: "Clerk user has no email address" };
  }

  const client = options.client ?? getResendEventsClient();
  if (!client) {
    return {
      ok: false,
      error: "RESEND_EVENTS_API_KEY or RESEND_CONTACTS_API_KEY is not configured",
    };
  }

  const event = cleanString(options.eventName) ?? WELCOME_AUTOMATION_EVENT_NAME;
  const firstName = cleanString(user.first_name);
  const lastName = cleanString(user.last_name);

  try {
    const { data, error } = await client.events.send({
      email,
      event,
      payload: {
        clerk_user_id: user.id,
        first_name: firstName ?? "there",
        last_name: lastName ?? "",
        source: "clerk.user_created",
      },
    });

    if (error) {
      return { ok: false, email, event, error: getResendErrorMessage(error) };
    }

    return { ok: true, email, event: data.event };
  } catch (error) {
    return { ok: false, email, event, error: getResendErrorMessage(error) };
  }
}
