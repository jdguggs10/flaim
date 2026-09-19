import "server-only";
import {
  getClerkUserProductEmail,
  type ClerkUserEmailSyncPayload,
} from "@/lib/server/resend-contact-sync";

const PLUNK_API_ORIGIN = "https://next-api.useplunk.com";

export type PlunkContactSyncResult =
  | { action: "replayed" | "tracked"; ok: true }
  | { error: string; ok: false; retryable: boolean; skipped?: boolean };

interface PlunkContactSyncOptions {
  apiKey?: string;
  apiOrigin?: string;
  enabled?: boolean;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

function cleanString(value: string | null | undefined) {
  const cleaned = value?.trim();
  return cleaned || null;
}

function getErrorMessage(payload: unknown) {
  if (typeof payload === "string" && payload.trim()) return payload.trim();
  if (typeof payload !== "object" || payload === null) return null;

  const record = payload as Record<string, unknown>;
  if (typeof record.error === "string" && record.error.trim()) {
    return record.error.trim();
  }
  if (
    typeof record.error === "object" &&
    record.error !== null &&
    "message" in record.error &&
    typeof record.error.message === "string" &&
    record.error.message.trim()
  ) {
    return record.error.message.trim();
  }
  if (typeof record.message === "string" && record.message.trim()) {
    return record.message.trim();
  }
  return null;
}

function isIdempotencyReplay(payload: unknown) {
  return (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "object" &&
    payload.error !== null &&
    "code" in payload.error &&
    payload.error.code === "IDEMPOTENCY_KEY_REUSED"
  );
}

async function parseResponse(response: Response) {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function failedRequest(label: string, response: Response, payload: unknown) {
  const detail = getErrorMessage(payload);
  return `${label} failed (${response.status})${detail ? `: ${detail}` : ""}`;
}

export function isPlunkMarketingSyncEnabled(options: Pick<PlunkContactSyncOptions, "enabled"> = {}) {
  return options.enabled ?? process.env.PLUNK_MARKETING_SYNC_ENABLED === "true";
}

/**
 * Track the verified Clerk signup through Plunk's atomic public endpoint. New
 * contacts default subscribed, while an existing contact retains its current
 * state because `subscribed` is deliberately omitted.
 */
export async function syncClerkUserToPlunkContact(
  user: ClerkUserEmailSyncPayload,
  options: PlunkContactSyncOptions = {},
): Promise<PlunkContactSyncResult> {
  if (!isPlunkMarketingSyncEnabled(options)) {
    return {
      error: "Plunk marketing contact sync is disabled",
      ok: false,
      retryable: false,
      skipped: true,
    };
  }

  const emailResult = getClerkUserProductEmail(user);
  if (!emailResult.ok) {
    return {
      error: emailResult.error,
      ok: false,
      retryable: false,
      skipped: true,
    };
  }

  const apiKey = cleanString(options.apiKey ?? process.env.PLUNK_PUBLIC_API_KEY);
  if (!apiKey) {
    return {
      error: "PLUNK_PUBLIC_API_KEY is not configured",
      ok: false,
      retryable: true,
    };
  }

  const request = options.fetch ?? fetch;
  const origin = (options.apiOrigin ?? PLUNK_API_ORIGIN).replace(/\/$/, "");
  const email = emailResult.email;
  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  const data = {
    clerkUserId: user.id,
    firstName: cleanString(user.first_name),
    lastName: cleanString(user.last_name),
    source: "clerk.user_created",
  };

  try {
    const tracked = await request(`${origin}/v1/track`, {
      body: JSON.stringify({ data, email, event: "flaim.user_created" }),
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "Idempotency-Key": `flaim-user-created/${user.id}`,
      },
      method: "POST",
      signal: AbortSignal.timeout(options.timeoutMs ?? 8_000),
    });
    const trackedPayload = await parseResponse(tracked);
    if (tracked.status === 409 && isIdempotencyReplay(trackedPayload)) {
      return { action: "replayed", ok: true };
    }
    if (!tracked.ok) {
      return {
        error: failedRequest("Plunk contact tracking", tracked, trackedPayload),
        ok: false,
        retryable: true,
      };
    }

    return { action: "tracked", ok: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Unknown Plunk contact sync error",
      ok: false,
      retryable: true,
    };
  }
}
