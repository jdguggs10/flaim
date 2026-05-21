#!/usr/bin/env node

import { Resend } from "resend";

const CLERK_USERS_URL = "https://api.clerk.com/v1/users";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

function parseArgs(argv) {
  const args = {
    apply: false,
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

    if (arg === "--limit" && next) {
      args.limit = Math.min(Number(next), MAX_LIMIT);
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

  return args;
}

function printUsage() {
  console.log(`
Backfill Clerk users into Resend contacts.

Dry-run:
  node scripts/backfill-resend-contacts.mjs

Apply to one eligible user:
  node scripts/backfill-resend-contacts.mjs --apply --max-users 1

Options:
  --apply              Write contacts to Resend. Omit for dry-run.
  --limit <n>          Clerk page size. Defaults to ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.
  --max-users <n>      Stop after scanning this many Clerk users.
  --offset <n>         Start at a Clerk list offset.
  --segment-id <id>    Resend Segment ID. Defaults to RESEND_CONTACT_SEGMENT_ID.
`);
}

function cleanString(value) {
  const cleaned = typeof value === "string" ? value.trim() : "";
  return cleaned || null;
}

function getPrimaryEmailAddress(user) {
  const emails = Array.isArray(user.email_addresses) ? user.email_addresses : [];
  return (
    emails.find((email) => email.id === user.primary_email_address_id) ??
    emails[0] ??
    null
  );
}

function getPrimaryEmail(user) {
  return cleanString(getPrimaryEmailAddress(user)?.email_address)?.toLowerCase() ?? null;
}

function hasExplicitUnverifiedStatus(emailAddress) {
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
  return error?.statusCode === 409 || /already.*segment/i.test(error?.message ?? "");
}

function maskEmail(email) {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const prefix = local.slice(0, 2);
  return `${prefix}${"*".repeat(Math.max(local.length - 2, 1))}@${domain}`;
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

async function ensureContactSegment(resend, email, segmentId) {
  const { error } = await resend.contacts.segments.add({ email, segmentId });
  if (!error || isAlreadyInSegment(error)) return null;
  return getResendErrorMessage(error);
}

async function syncContact({ resend, segmentId, user }) {
  const email = getPrimaryEmail(user);
  const { firstName, lastName } = getNameFields(user);

  const existing = await resend.contacts.get({ email });

  if (existing.error && !isNotFound(existing.error)) {
    return { ok: false, email, error: getResendErrorMessage(existing.error) };
  }

  if (existing.error) {
    const payload = {
      email,
      firstName,
      lastName,
      unsubscribed: false,
    };

    if (segmentId) {
      payload.segments = [{ id: segmentId }];
    }

    const created = await resend.contacts.create(payload);
    if (created.error) {
      return { ok: false, email, error: getResendErrorMessage(created.error) };
    }

    return { ok: true, action: "created", email };
  }

  const updated = await resend.contacts.update({
    email,
    firstName,
    lastName,
  });

  if (updated.error) {
    return { ok: false, email, error: getResendErrorMessage(updated.error) };
  }

  if (segmentId) {
    const segmentError = await ensureContactSegment(resend, email, segmentId);
    if (segmentError) {
      return { ok: false, email, error: segmentError };
    }
  }

  return { ok: true, action: "updated", email };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const clerkSecretKey = process.env.CLERK_SECRET_KEY;
  const resendContactsApiKey = process.env.RESEND_CONTACTS_API_KEY ?? process.env.RESEND_API_KEY;

  if (!clerkSecretKey) {
    throw new Error("CLERK_SECRET_KEY is required");
  }

  if (args.apply && !resendContactsApiKey) {
    throw new Error("RESEND_CONTACTS_API_KEY or RESEND_API_KEY is required when --apply is set");
  }

  const resend = args.apply ? new Resend(resendContactsApiKey) : null;
  const stats = {
    created: 0,
    dryRunEligible: 0,
    failed: 0,
    scanned: 0,
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

      if (!email) {
        stats.skippedNoEmail += 1;
      } else if (hasExplicitUnverifiedStatus(primaryEmailAddress)) {
        stats.skippedUnverified += 1;
      } else if (!args.apply) {
        stats.dryRunEligible += 1;
        console.log(`dry-run eligible ${maskEmail(email)} ${user.id}`);
      } else {
        const result = await syncContact({ resend, segmentId: args.segmentId, user });
        if (result.ok) {
          stats[result.action] += 1;
          console.log(`${result.action} ${maskEmail(result.email)} ${user.id}`);
        } else {
          stats.failed += 1;
          console.error(`failed ${maskEmail(result.email ?? email)} ${user.id}: ${result.error}`);
        }
      }

      if (stats.scanned >= args.maxUsers) break;
    }

    offset += page.users.length;

    if (page.users.length < limit) break;
    if (page.totalCount !== null && offset >= page.totalCount) break;
  }

  console.log(JSON.stringify({ apply: args.apply, segmentId: args.segmentId, stats }, null, 2));

  if (stats.failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
