#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { Resend } from "resend";

const CLERK_USERS_URL = "https://api.clerk.com/v1/users";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const EMAIL_RETRY_METADATA_KEY = "flaim_email_ops";
const WELCOME_AUTOMATION_EVENT_NAME = "flaim.user_created";

export function parseArgs(argv) {
  const args = {
    apply: false,
    delayMs: 0,
    flaggedOnly: false,
    forceResend: false,
    limit: DEFAULT_LIMIT,
    maxUsers: Number.POSITIVE_INFINITY,
    offset: 0,
    segmentId: process.env.RESEND_CONTACT_SEGMENT_ID?.trim() || null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--apply") {
      args.apply = true;
      continue;
    }

    if (arg === "--flagged-only") {
      args.flaggedOnly = true;
      continue;
    }

    if (arg === "--force-resend") {
      args.forceResend = true;
      continue;
    }

    if (arg === "--limit" && next) {
      args.limit = Math.min(Number(next), MAX_LIMIT);
      index += 1;
      continue;
    }

    if (arg === "--delay-ms" && next) {
      args.delayMs = Number(next);
      index += 1;
      continue;
    }

    if (arg === "--max-users" && next) {
      args.maxUsers = Number(next);
      index += 1;
      continue;
    }

    if (arg === "--offset" && next) {
      args.offset = Number(next);
      index += 1;
      continue;
    }

    if (arg === "--segment-id" && next) {
      args.segmentId = next.trim() || null;
      index += 1;
      continue;
    }

    if (arg === "--help") {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(args.limit) || args.limit < 1) {
    throw new Error("--limit must be a positive number");
  }

  if (Number.isNaN(args.maxUsers) || args.maxUsers < 1) {
    throw new Error("--max-users must be a positive number");
  }

  if (!Number.isFinite(args.offset) || args.offset < 0) {
    throw new Error("--offset must be zero or greater");
  }

  if (!Number.isFinite(args.delayMs) || args.delayMs < 0) {
    throw new Error("--delay-ms must be zero or greater");
  }

  if (args.forceResend && (!args.flaggedOnly || !args.apply)) {
    throw new Error("--force-resend requires --flagged-only --apply");
  }

  return args;
}

function printUsage() {
  console.log(`
Backfill or repair Clerk users in Resend contacts.

Dry-run:
  node scripts/backfill-resend-contacts.mjs

Apply to one eligible user:
  node scripts/backfill-resend-contacts.mjs --apply --max-users 1

Options:
  --apply              Write contacts to Resend. Omit for dry-run.
  --flagged-only       Process only Clerk users with a failed email-operation marker.
  --force-resend       Re-send a flagged welcome event even when its Resend contact exists.
  --delay-ms <n>       Wait between Resend writes. Defaults to 0.
  --limit <n>          Clerk page size. Defaults to ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.
  --max-users <n>      Stop after scanning this many Clerk users.
  --offset <n>         Start at a Clerk list offset.
  --segment-id <id>    Resend Segment ID. Defaults to RESEND_CONTACT_SEGMENT_ID.

Resend rate limits apply. Use --delay-ms, --max-users, and --offset to pace larger backfills.

When used with --apply, --flagged-only clears a failed welcome-event marker without
re-sending when the automation-created contact already exists. Use --force-resend to
override that conservative deduplication; it requires --flagged-only --apply. A replay
can deliver a late welcome email, so review the dry-run output before applying it.
`);
}

export function cleanString(value) {
  const cleaned = typeof value === "string" ? value.trim() : "";
  return cleaned || null;
}

export function resolveResendEventsApiKey(eventsApiKey, contactsApiKey) {
  return cleanString(eventsApiKey) ?? cleanString(contactsApiKey);
}

// Keep primary email selection aligned with web/lib/server/resend-contact-sync.ts.
export function getPrimaryEmailAddress(user) {
  const emails = Array.isArray(user.email_addresses) ? user.email_addresses : [];
  if (emails.length === 1) return emails[0];
  return emails.find((email) => email.id === user.primary_email_address_id) ?? null;
}

export function getPrimaryEmail(user) {
  return cleanString(getPrimaryEmailAddress(user)?.email_address)?.toLowerCase() ?? null;
}

export function hasExplicitUnverifiedStatus(emailAddress) {
  const status = cleanString(emailAddress?.verification?.status);
  return Boolean(status && status !== "verified");
}

function getNameFields(user) {
  return {
    firstName: cleanString(user.first_name) ?? undefined,
    lastName: cleanString(user.last_name) ?? undefined,
  };
}

function getResendErrorMessage(error) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && typeof error.message === "string") {
    return error.message;
  }
  return "Unknown Resend error";
}

function isNotFound(error) {
  return error?.statusCode === 404 || error?.name === "not_found";
}

function isAlreadyInSegment(error) {
  return /already.*segment/i.test(error?.message ?? "") || error?.statusCode === 409;
}

export function maskEmail(email) {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const prefix = local.slice(0, 2);
  return `${prefix}${"*".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

export function getEmailRetryMarkers(user) {
  const privateMetadata = user?.private_metadata ?? user?.privateMetadata;
  const retryMetadata = privateMetadata?.[EMAIL_RETRY_METADATA_KEY];

  if (!retryMetadata || typeof retryMetadata !== "object" || Array.isArray(retryMetadata)) {
    return { contactSync: false, welcomeEvent: false };
  }

  return {
    contactSync:
      typeof retryMetadata.contactSync === "object" && retryMetadata.contactSync !== null,
    welcomeEvent:
      typeof retryMetadata.welcomeEvent === "object" && retryMetadata.welcomeEvent !== null,
  };
}

function getWelcomeGivenName(value) {
  const cleaned = cleanString(value);
  if (!cleaned) return "there";

  const safeName = cleaned
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .trim();

  return safeName || "there";
}

async function listClerkUsers({ clerkSecretKey, limit, offset }) {
  const url = new URL(CLERK_USERS_URL);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("order_by", "-created_at");

  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${clerkSecretKey}`,
    },
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const message = body?.errors?.[0]?.message ?? body?.message ?? response.statusText;
    throw new Error(`Clerk user list failed: ${response.status} ${message}`);
  }

  if (Array.isArray(body)) {
    return { totalCount: null, users: body };
  }

  if (Array.isArray(body?.data)) {
    return {
      totalCount: typeof body.total_count === "number" ? body.total_count : null,
      users: body.data,
    };
  }

  throw new Error("Clerk user list returned an unexpected response shape");
}

export async function clearEmailRetryMarker({
  clerkSecretKey,
  fetchImpl = fetch,
  kind,
  userId,
}) {
  const response = await fetchImpl(`${CLERK_USERS_URL}/${encodeURIComponent(userId)}/metadata`, {
    body: JSON.stringify({
      private_metadata: {
        [EMAIL_RETRY_METADATA_KEY]: {
          [kind]: null,
        },
      },
    }),
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${clerkSecretKey}`,
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const message = body?.errors?.[0]?.message ?? body?.message ?? response.statusText;
    return { error: `Clerk retry marker clear failed: ${response.status} ${message}`, ok: false };
  }

  return { ok: true };
}

async function ensureContactSegment(resend, email, segmentId) {
  const { error } = await resend.contacts.segments.add({ email, segmentId });
  if (!error || isAlreadyInSegment(error)) return null;
  return getResendErrorMessage(error);
}

async function delay(ms) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function syncContact({ resend, segmentId, user }) {
  const email = getPrimaryEmail(user);
  const { firstName, lastName } = getNameFields(user);

  const updated = await resend.contacts.update({
    email,
    firstName,
    lastName,
  });

  if (updated.error) {
    if (!isNotFound(updated.error)) {
      return { ok: false, email, error: getResendErrorMessage(updated.error) };
    }

    const payload = {
      email,
      firstName,
      lastName,
      ...(segmentId ? { segments: [{ id: segmentId }] } : {}),
      unsubscribed: false,
    };

    const created = await resend.contacts.create(payload);
    if (created.error) {
      return { ok: false, email, error: getResendErrorMessage(created.error) };
    }

    return { ok: true, action: "created", email };
  }

  if (segmentId) {
    const segmentError = await ensureContactSegment(resend, email, segmentId);
    if (segmentError) {
      return { ok: false, email, error: segmentError };
    }
  }

  return { ok: true, action: "updated", email };
}

/**
 * In resend@6.22.0, contacts.get({ email }) returns the SDK's standard
 * { data, error } envelope. A missing contact is a 404 error, while any other
 * error leaves the recovery marker intact rather than risking a duplicate send.
 */
async function getResendContactStatus({ resend, email }) {
  try {
    const { data, error } = await resend.contacts.get({ email });

    if (data) return { exists: true, ok: true };
    if (error && isNotFound(error)) return { exists: false, ok: true };
    if (error) return { error: getResendErrorMessage(error), ok: false };

    return { error: "Resend contacts.get returned no data or error", ok: false };
  } catch (error) {
    return { error: getResendErrorMessage(error), ok: false };
  }
}

export async function sendWelcomeRetryEvent({ resend, user }) {
  const email = getPrimaryEmail(user);
  if (!email) {
    return { error: "Clerk user has no email address", ok: false, skipped: true };
  }

  if (hasExplicitUnverifiedStatus(getPrimaryEmailAddress(user))) {
    return { error: "Clerk user primary email is not verified", ok: false, skipped: true };
  }

  try {
    const { data, error } = await resend.events.send({
      email,
      event: WELCOME_AUTOMATION_EVENT_NAME,
      payload: {
        clerk_user_id: user.id,
        given_name: getWelcomeGivenName(user.first_name),
        source: "backfill-resend-contacts.flagged-only",
      },
    });

    if (error) {
      return { error: getResendErrorMessage(error), ok: false };
    }

    return { event: data?.event ?? WELCOME_AUTOMATION_EVENT_NAME, ok: true };
  } catch (error) {
    return { error: getResendErrorMessage(error), ok: false };
  }
}

/**
 * Retry only operations which Clerk previously marked as failed. A marker is
 * cleared after its matching Resend operation succeeds, or after a welcome
 * contact-existence check conservatively finds automation-created evidence. It
 * is deliberately never cleared by an unrelated contact sync.
 */
export async function retryFlaggedUser({
  clearMarker = clearEmailRetryMarker,
  clerkSecretKey,
  forceResend = false,
  resendContacts,
  resendEvents,
  segmentId,
  user,
}) {
  const markers = getEmailRetryMarkers(user);
  const results = [];

  if (markers.welcomeEvent) {
    if (!resendEvents) {
      results.push({ error: "RESEND_EVENTS_API_KEY or RESEND_CONTACTS_API_KEY is required", kind: "welcomeEvent", ok: false });
    } else {
      const email = getPrimaryEmail(user);
      const primaryEmailAddress = getPrimaryEmailAddress(user);
      let shouldSend = true;

      if (!email) {
        results.push({ error: "Clerk user has no email address", kind: "welcomeEvent", ok: false, skipped: true });
        shouldSend = false;
      } else if (hasExplicitUnverifiedStatus(primaryEmailAddress)) {
        results.push({ error: "Clerk user primary email is not verified", kind: "welcomeEvent", ok: false, skipped: true });
        shouldSend = false;
      } else if (!forceResend) {
        if (!resendContacts) {
          results.push({
            error: "RESEND_CONTACTS_API_KEY is required to check a flagged welcome event",
            kind: "welcomeEvent",
            ok: false,
          });
          shouldSend = false;
        } else {
          const contact = await getResendContactStatus({ resend: resendContacts, email });
          if (!contact.ok) {
            results.push({ ...contact, kind: "welcomeEvent" });
            shouldSend = false;
          } else if (contact.exists) {
            // The welcome automation normally owns contact creation. Treat an
            // existing contact as conservative evidence that it already handled
            // this event, unless an operator deliberately passes --force-resend.
            shouldSend = false;
            try {
              const cleared = await clearMarker({
                clerkSecretKey,
                kind: "welcomeEvent",
                userId: user.id,
              });
              results.push(cleared.ok
                ? { kind: "welcomeEvent", ok: true, skipped: true }
                : { ...cleared, kind: "welcomeEvent" });
            } catch (error) {
              results.push({
                error: getResendErrorMessage(error),
                kind: "welcomeEvent",
                ok: false,
              });
            }
          }
        }
      }

      if (shouldSend) {
        const result = await sendWelcomeRetryEvent({ resend: resendEvents, user });
        if (!result.ok) {
          results.push({ ...result, kind: "welcomeEvent" });
        } else {
          try {
            const cleared = await clearMarker({
              clerkSecretKey,
              kind: "welcomeEvent",
              userId: user.id,
            });
            results.push(cleared.ok ? { kind: "welcomeEvent", ok: true } : { ...cleared, kind: "welcomeEvent" });
          } catch (error) {
            results.push({
              error: getResendErrorMessage(error),
              kind: "welcomeEvent",
              ok: false,
            });
          }
        }
      }
    }
  }

  // Welcome recovery runs before contact repair so a contact-sync retry cannot
  // create the contact that would cause this same recovery pass to skip the
  // welcome event.
  if (markers.contactSync) {
    if (!resendContacts) {
      results.push({ error: "RESEND_CONTACTS_API_KEY is required", kind: "contactSync", ok: false });
    } else {
      let result;
      try {
        result = await syncContact({ resend: resendContacts, segmentId, user });
      } catch (error) {
        // A network/SDK rejection must retain this marker and let the next
        // marked operation (or user) continue through the sweep.
        results.push({
          error: getResendErrorMessage(error),
          kind: "contactSync",
          ok: false,
        });
        result = null;
      }

      if (!result) {
        // The failure was recorded above; do not clear the marker.
      } else if (!result.ok) {
        results.push({ ...result, kind: "contactSync" });
      } else {
        try {
          const cleared = await clearMarker({
            clerkSecretKey,
            kind: "contactSync",
            userId: user.id,
          });
          results.push(cleared.ok ? { kind: "contactSync", ok: true } : { ...cleared, kind: "contactSync" });
        } catch (error) {
          results.push({
            error: getResendErrorMessage(error),
            kind: "contactSync",
            ok: false,
          });
        }
      }
    }
  }

  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const clerkSecretKey = process.env.CLERK_SECRET_KEY;
  const resendContactsApiKey = cleanString(process.env.RESEND_CONTACTS_API_KEY);

  if (!clerkSecretKey) {
    throw new Error("CLERK_SECRET_KEY is required");
  }

  if (args.apply && !args.flaggedOnly && !resendContactsApiKey) {
    throw new Error("RESEND_CONTACTS_API_KEY is required when --apply is set");
  }

  const resendContacts = args.apply && resendContactsApiKey ? new Resend(resendContactsApiKey) : null;
  const resendEventsApiKey = resolveResendEventsApiKey(
    process.env.RESEND_EVENTS_API_KEY,
    resendContactsApiKey,
  );
  const resendEvents = args.apply && resendEventsApiKey ? new Resend(resendEventsApiKey) : null;
  const stats = {
    created: 0,
    dryRunEligible: 0,
    failed: 0,
    flagged: 0,
    retryCleared: 0,
    retryRetained: 0,
    retrySkipped: 0,
    scanned: 0,
    skippedUnflagged: 0,
    skippedNoEmail: 0,
    skippedUnverified: 0,
    updated: 0,
  };

  let offset = args.offset;

  while (stats.scanned < args.maxUsers) {
    const remaining = args.maxUsers - stats.scanned;
    const limit = Math.min(args.limit, remaining);
    const page = await listClerkUsers({ clerkSecretKey, limit, offset });

    if (page.users.length === 0) break;

    for (const user of page.users) {
      stats.scanned += 1;

      const primaryEmailAddress = getPrimaryEmailAddress(user);
      const email = getPrimaryEmail(user);
      const retryMarkers = getEmailRetryMarkers(user);
      const isFlagged = retryMarkers.contactSync || retryMarkers.welcomeEvent;

      if (args.flaggedOnly && !isFlagged) {
        stats.skippedUnflagged += 1;
      } else if (args.flaggedOnly && !args.apply) {
        stats.flagged += 1;
        const kinds = [
          ...(retryMarkers.contactSync ? ["contactSync"] : []),
          ...(retryMarkers.welcomeEvent ? ["welcomeEvent"] : []),
        ];
        console.log(`dry-run flagged ${user.id} ${kinds.join(",")}`);
      } else if (args.flaggedOnly) {
        stats.flagged += 1;
        const results = await retryFlaggedUser({
          clerkSecretKey,
          forceResend: args.forceResend,
          resendContacts,
          resendEvents,
          segmentId: args.segmentId,
          user,
        });

        for (const result of results) {
          if (result.ok) {
            stats.retryCleared += 1;
            if (result.skipped) {
              stats.retrySkipped += 1;
              console.log(`retry-skipped ${result.kind} ${user.id}: Resend contact already exists`);
            } else {
              console.log(`retry-cleared ${result.kind} ${user.id}`);
            }
          } else {
            stats.retryRetained += 1;
            stats.failed += 1;
            console.error(`retry-retained ${result.kind} ${user.id}: ${result.error}`);
          }
        }

        await delay(args.delayMs);
      } else if (!email) {
        stats.skippedNoEmail += 1;
      } else if (hasExplicitUnverifiedStatus(primaryEmailAddress)) {
        stats.skippedUnverified += 1;
      } else if (!args.apply) {
        stats.dryRunEligible += 1;
        console.log(`dry-run eligible ${maskEmail(email)} ${user.id}`);
      } else {
        const result = await syncContact({ resend: resendContacts, segmentId: args.segmentId, user });
        if (result.ok) {
          if (result.action === "created") {
            stats.created += 1;
          } else {
            stats.updated += 1;
          }
          console.log(`${result.action} ${maskEmail(result.email)} ${user.id}`);
        } else {
          stats.failed += 1;
          console.error(`failed ${maskEmail(result.email ?? email)} ${user.id}: ${result.error}`);
        }

        await delay(args.delayMs);
      }

      if (stats.scanned >= args.maxUsers) break;
    }

    offset += page.users.length;

    if (page.users.length < limit) break;
    if (page.totalCount !== null && offset >= page.totalCount) break;
  }

  console.log(JSON.stringify({
    apply: args.apply,
    flaggedOnly: args.flaggedOnly,
    forceResend: args.forceResend,
    segmentId: args.segmentId,
    stats,
  }, null, 2));

  if (stats.failed > 0) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
