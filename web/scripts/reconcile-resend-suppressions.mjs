#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import { Resend } from "resend";

const CLERK_USERS_URL = "https://api.clerk.com/v1/users";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 100;

export function parseArgs(argv) {
  const args = {
    clerkLimit: DEFAULT_LIMIT,
    maxSuppressions: Number.POSITIVE_INFINITY,
    suppressionLimit: DEFAULT_LIMIT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--clerk-limit" && next) {
      args.clerkLimit = Math.min(Number(next), 500);
      index += 1;
      continue;
    }

    if (arg === "--suppression-limit" && next) {
      args.suppressionLimit = Math.min(Number(next), MAX_LIMIT);
      index += 1;
      continue;
    }

    if (arg === "--max-suppressions" && next) {
      args.maxSuppressions = Number(next);
      index += 1;
      continue;
    }

    if (arg === "--help") {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  for (const [name, value] of [
    ["--clerk-limit", args.clerkLimit],
    ["--suppression-limit", args.suppressionLimit],
    ["--max-suppressions", args.maxSuppressions],
  ]) {
    if ((name !== "--max-suppressions" && (!Number.isFinite(value) || value < 1)) ||
      (name === "--max-suppressions" && (Number.isNaN(value) || value < 1))) {
      throw new Error(`${name} must be a positive number`);
    }
  }

  return args;
}

function printUsage() {
  console.log(`
Read-only reconciliation of Resend suppressions against Clerk users.

Usage:
  node scripts/reconcile-resend-suppressions.mjs

Options:
  --clerk-limit <n>        Clerk page size (default ${DEFAULT_LIMIT}, max 500).
  --suppression-limit <n>  Resend page size (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).
  --max-suppressions <n>   Stop after this many suppression records.

This command is always dry-run/read-only. It never removes a Resend suppression.
`);
}

function cleanString(value) {
  const cleaned = typeof value === "string" ? value.trim() : "";
  return cleaned || null;
}

function getPrimaryEmailAddress(user) {
  const emails = Array.isArray(user.email_addresses) ? user.email_addresses : [];
  if (emails.length === 1) return emails[0];
  return emails.find((email) => email.id === user.primary_email_address_id) ?? null;
}

export function getPrimaryEmail(user) {
  return cleanString(getPrimaryEmailAddress(user)?.email_address)?.toLowerCase() ?? null;
}

export function maskEmail(email) {
  const [local, domain] = email.split("@");
  if (!domain) return "[redacted-email]";
  const prefix = local.slice(0, 2);
  return `${prefix}${"*".repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

async function listClerkUsers({ clerkSecretKey, limit, offset }) {
  const url = new URL(CLERK_USERS_URL);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));

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

  if (Array.isArray(body)) return { totalCount: null, users: body };
  if (Array.isArray(body?.data)) {
    return {
      totalCount: typeof body.total_count === "number" ? body.total_count : null,
      users: body.data,
    };
  }

  throw new Error("Clerk user list returned an unexpected response shape");
}

async function listAllClerkUsers({ clerkSecretKey, limit }) {
  const users = [];
  let offset = 0;

  while (true) {
    const page = await listClerkUsers({ clerkSecretKey, limit, offset });
    users.push(...page.users);
    offset += page.users.length;

    if (page.users.length < limit) break;
    if (page.totalCount !== null && offset >= page.totalCount) break;
  }

  return users;
}

/** Supports SDK `{ data, error }` responses and the nested list data shape. */
export function normalizeSuppressionPage(response) {
  const root = response && typeof response === "object" && "error" in response
    ? response.data
    : response;

  if (!root || typeof root !== "object") {
    throw new Error("Resend suppressions returned an unexpected response shape");
  }

  if (!Array.isArray(root.data)) {
    throw new Error("Resend suppressions returned an unexpected response shape");
  }

  return {
    entries: root.data,
    hasMore: root.has_more === true,
  };
}

export async function listAllSuppressions({ client, limit, maxSuppressions }) {
  const suppressions = [];
  let after;

  while (suppressions.length < maxSuppressions) {
    const pageLimit = Math.min(limit, maxSuppressions - suppressions.length);
    const result = await client.suppressions.list({
      ...(after ? { after } : {}),
      limit: pageLimit,
    });

    if (result.error) {
      throw new Error(`Resend suppressions list failed: ${result.error.message ?? "Unknown error"}`);
    }

    const page = normalizeSuppressionPage(result);
    suppressions.push(...page.entries.slice(0, maxSuppressions - suppressions.length));

    if (!page.hasMore || page.entries.length === 0 || suppressions.length >= maxSuppressions) break;

    const cursor = page.entries.at(-1)?.id;
    if (!cursor || typeof cursor !== "string") {
      throw new Error("Resend suppressions pagination cursor was missing");
    }
    after = cursor;
  }

  return suppressions;
}

export function indexClerkPrimaryEmails(users) {
  const index = new Map();
  for (const user of users) {
    const email = getPrimaryEmail(user);
    if (email) index.set(email, user.id);
  }
  return index;
}

export function reconcileSuppressions({ clerkUsersByEmail, suppressions }) {
  return suppressions.map((suppression) => {
    const email = cleanString(suppression?.email)?.toLowerCase();
    return {
      clerkUserId: email ? clerkUsersByEmail.get(email) ?? null : null,
      email: maskEmail(email ?? ""),
      id: suppression?.id ?? null,
      origin: suppression?.origin ?? "unknown",
    };
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const clerkSecretKey = process.env.CLERK_SECRET_KEY;
  const resendSuppressionsApiKey = process.env.RESEND_SUPPRESSIONS_API_KEY;

  if (!clerkSecretKey) throw new Error("CLERK_SECRET_KEY is required");
  if (!resendSuppressionsApiKey) throw new Error("RESEND_SUPPRESSIONS_API_KEY is required");

  const [users, suppressions] = await Promise.all([
    listAllClerkUsers({ clerkSecretKey, limit: args.clerkLimit }),
    listAllSuppressions({
      client: new Resend(resendSuppressionsApiKey),
      limit: args.suppressionLimit,
      maxSuppressions: args.maxSuppressions,
    }),
  ]);
  const records = reconcileSuppressions({
    clerkUsersByEmail: indexClerkPrimaryEmails(users),
    suppressions,
  });
  const stats = { matchedClerkUser: 0, missingClerkUser: 0, suppressions: records.length };

  for (const record of records) {
    if (record.clerkUserId) stats.matchedClerkUser += 1;
    else stats.missingClerkUser += 1;

    console.log(
      `suppression ${record.email} origin=${record.origin} clerk_user=${record.clerkUserId ?? "none"}`,
    );
  }

  console.log(JSON.stringify({ stats }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
