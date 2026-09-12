import "server-only";

export type EmailOpsEvent =
  | "email.bounced"
  | "email.complained"
  | "email.contact_sync_failed"
  | "email.delivery_delayed"
  | "email.failed"
  | "email.send_failed"
  | "email.welcome_event_failed"
  | "email.welcome_event_skipped"
  | "email.webhook_verification_failed";

export interface EmailOpsDetails {
  error?: unknown;
  eventId?: string;
  provider?: "clerk" | "resend";
  reason?: string;
  resendEmailId?: string;
  source?: string;
  userId?: string;
}

const EMAIL_ADDRESS_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const SECRET_PATTERN = /\b(?:re|whsec)_[A-Za-z0-9_-]+\b/gi;
// Clerk secret keys are prefixed with sk_test_ or sk_live_. Keep this narrow so
// normal words beginning with "sk_" are not unexpectedly removed from logs.
const CLERK_SECRET_PATTERN = /\bsk_(?:test|live)_[A-Za-z0-9_-]+\b/gi;
const BEARER_PATTERN = /\bBearer\s+[^\s]+/gi;
const MAX_DETAIL_LENGTH = 240;

function sanitizeText(value: string) {
  return value
    .replace(EMAIL_ADDRESS_PATTERN, "[redacted-email]")
    .replace(SECRET_PATTERN, "[redacted-secret]")
    .replace(CLERK_SECRET_PATTERN, "[redacted-secret]")
    .replace(BEARER_PATTERN, "Bearer [redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, MAX_DETAIL_LENGTH);
}

function getSafeError(error: unknown) {
  if (error instanceof Error) return sanitizeText(error.message);
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return sanitizeText(error.message);
  }
  if (typeof error === "string") return sanitizeText(error);
  return "Unknown error";
}

/**
 * Emits a compact JSON record that Vercel can index as a structured log. Do not
 * add recipient addresses, request bodies, webhook signatures, or API keys.
 */
export function logEmailOps(event: EmailOpsEvent, details: EmailOpsDetails = {}) {
  const record: Record<string, string> = {
    event,
    service: "email",
  };

  if (details.provider) record.provider = details.provider;
  if (details.source) record.source = sanitizeText(details.source);
  if (details.userId) record.userId = sanitizeText(details.userId);
  if (details.resendEmailId) record.resendEmailId = sanitizeText(details.resendEmailId);
  if (details.eventId) record.eventId = sanitizeText(details.eventId);
  if (details.reason) record.reason = sanitizeText(details.reason);
  if (details.error !== undefined) record.error = getSafeError(details.error);

  // Keep the log payload JSON-safe even if a future caller accidentally passes
  // a non-serializable Error-derived value above.
  const log = event === "email.welcome_event_skipped" ? console.info : console.error;
  log(JSON.stringify(record));
}
