#!/usr/bin/env node

import { createHash } from "node:crypto";
import { appendFile, open, readFile, unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { Resend } from "resend";

import {
  getPrimaryEmail,
  getPrimaryEmailAddress,
  hasExplicitUnverifiedStatus,
  maskEmail,
} from "./backfill-resend-contacts.mjs";

const CLERK_USERS_URL = "https://api.clerk.com/v1/users";
const DEFAULT_PAGE_LIMIT = 100;
const DEFAULT_DELAY_MS = 150;
const DEFAULT_SEND_DELAY_MS = 350;
const MINIMUM_DELAY_MS = 125;
const MINIMUM_SEND_DELAY_MS = 250;
const EXPECTED_FROM_ADDRESS = "updates@flaim.app";
const EXPECTED_SUBJECT = "Welcome to Flaim";
const WELCOME_EVENT = "flaim.user_created";

function cleanString(value) {
  const cleaned = typeof value === "string" ? value.trim() : "";
  return cleaned || null;
}

function positiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function integerAtLeast(value, flag, minimum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${flag} must be an integer of at least ${minimum}`);
  }
  return parsed;
}

function parseTimestamp(value, flag) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${flag} must be a valid ISO timestamp`);
  return timestamp;
}

export function parseArgs(argv) {
  const args = {
    apply: false,
    delayMs: DEFAULT_DELAY_MS,
    pageLimit: DEFAULT_PAGE_LIMIT,
    sendDelayMs: DEFAULT_SEND_DELAY_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--apply") {
      args.apply = true;
      continue;
    }
    if (arg === "--incident-after" && next) {
      args.incidentAfter = next;
      index += 1;
      continue;
    }
    if (arg === "--incident-before" && next) {
      args.incidentBefore = next;
      index += 1;
      continue;
    }
    if (arg === "--expected-failed" && next) {
      args.expectedFailed = positiveInteger(next, arg);
      index += 1;
      continue;
    }
    if (arg === "--expected-cohort-hash" && next) {
      args.expectedCohortHash = next;
      index += 1;
      continue;
    }
    if (arg === "--failure-manifest" && next) {
      args.failureManifest = next;
      index += 1;
      continue;
    }
    if (arg === "--expected-failure-reason" && next) {
      args.expectedFailureReason = next;
      index += 1;
      continue;
    }
    if (arg === "--ledger" && next) {
      args.ledger = next;
      index += 1;
      continue;
    }
    if (arg === "--verified-canary-hash" && next) {
      args.verifiedCanaryHash = next;
      index += 1;
      continue;
    }
    if (arg === "--delay-ms" && next) {
      args.delayMs = integerAtLeast(next, arg, MINIMUM_DELAY_MS);
      index += 1;
      continue;
    }
    if (arg === "--send-delay-ms" && next) {
      args.sendDelayMs = integerAtLeast(next, arg, MINIMUM_SEND_DELAY_MS);
      index += 1;
      continue;
    }
    if (arg === "--max-send" && next) {
      args.maxSend = positiveInteger(next, arg);
      index += 1;
      continue;
    }
    if (arg === "--page-limit" && next) {
      args.pageLimit = Math.min(positiveInteger(next, arg), 100);
      index += 1;
      continue;
    }
    if (arg === "--help") {
      args.help = true;
      continue;
    }

    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  if (args.help) return args;
  if (!args.incidentAfter) throw new Error("--incident-after is required");
  if (!args.incidentBefore) throw new Error("--incident-before is required");
  if (!args.expectedFailed) throw new Error("--expected-failed is required");
  if (!args.failureManifest) throw new Error("--failure-manifest is required");
  if (!args.expectedFailureReason) throw new Error("--expected-failure-reason is required");

  args.afterMs = parseTimestamp(args.incidentAfter, "--incident-after");
  args.beforeMs = parseTimestamp(args.incidentBefore, "--incident-before");
  if (args.afterMs >= args.beforeMs) {
    throw new Error("--incident-after must be earlier than --incident-before");
  }

  if (args.apply && !args.expectedCohortHash) {
    throw new Error("--apply requires --expected-cohort-hash from a fresh dry run");
  }
  if (args.apply && !args.ledger) throw new Error("--apply requires --ledger");
  if (args.apply && !args.maxSend) throw new Error("--apply requires --max-send");
  if (args.apply && args.maxSend > 1 && !args.verifiedCanaryHash) {
    throw new Error("--apply with --max-send greater than 1 requires --verified-canary-hash");
  }

  return args;
}

function printUsage() {
  console.log(`
Recover Resend welcome emails which failed asynchronously during a known quota incident.

Dry run:
  node scripts/recover-resend-welcome-quota.mjs \\
    --incident-after <ISO timestamp> \\
    --incident-before <ISO timestamp> \\
    --expected-failed <count> \\
    --failure-manifest <email.failed events JSON> \\
    --expected-failure-reason <exact reason>

Apply after reviewing the current dry-run hash:
  node scripts/recover-resend-welcome-quota.mjs \\
    --incident-after <ISO timestamp> \\
    --incident-before <ISO timestamp> \\
    --expected-failed <count> \\
    --failure-manifest <email.failed events JSON> \\
    --expected-failure-reason <exact reason> \\
    --expected-cohort-hash <sha256> \\
    --ledger <private JSONL path> \\
    --max-send 1 \\
    --apply

After verifying the canary delivered, a larger batch also requires:
    --verified-canary-hash <recipient sha256>

Required environment variables:
  CLERK_SECRET_KEY
  RESEND_OPERATOR_API_KEY

The command is dry-run by default. It never changes contacts, topics, or suppressions.
Apply mode only emits the existing flaim.user_created Automation event.
`);
}

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function normalizeListPage(response, label) {
  if (response?.error) {
    throw new Error(`${label} failed: ${response.error.message ?? "Unknown error"}`);
  }
  const page = response?.data;
  if (!page || !Array.isArray(page.data)) {
    throw new Error(`${label} returned an unexpected response shape`);
  }
  return { entries: page.data, hasMore: page.has_more === true };
}

export async function listEmailsThroughIncident({ client, afterMs, delayMs, limit }) {
  const emails = [];
  const seenCursors = new Set();
  let after;

  while (true) {
    const response = await client.emails.list({
      ...(after ? { after } : {}),
      limit,
    });
    const page = normalizeListPage(response, "Resend emails list");
    emails.push(...page.entries);

    const pageTimestamps = page.entries.map((entry) => Date.parse(entry.created_at));
    if (pageTimestamps.some((timestamp) => !Number.isFinite(timestamp))) {
      throw new Error("Resend emails list returned an invalid created_at timestamp");
    }
    const oldestMs = Math.min(...pageTimestamps);
    if (!page.hasMore || page.entries.length === 0 || oldestMs < afterMs) break;

    const cursor = cleanString(page.entries.at(-1)?.id);
    if (!cursor) throw new Error("Resend emails pagination cursor was missing");
    if (seenCursors.has(cursor)) throw new Error("Resend emails pagination cursor repeated");
    seenCursors.add(cursor);
    after = cursor;
    await sleep(delayMs);
  }

  return emails;
}

async function listAllContacts({ client, delayMs, limit }) {
  const contacts = [];
  const seenCursors = new Set();
  let after;

  while (true) {
    const response = await client.contacts.list({
      ...(after ? { after } : {}),
      limit,
    });
    const page = normalizeListPage(response, "Resend contacts list");
    contacts.push(...page.entries);
    if (!page.hasMore || page.entries.length === 0) break;

    const cursor = cleanString(page.entries.at(-1)?.id);
    if (!cursor) throw new Error("Resend contacts pagination cursor was missing");
    if (seenCursors.has(cursor)) throw new Error("Resend contacts pagination cursor repeated");
    seenCursors.add(cursor);
    after = cursor;
    await sleep(delayMs);
  }

  return contacts;
}

async function listAllSuppressions({ client, delayMs, limit }) {
  const suppressions = [];
  const seenCursors = new Set();
  let after;

  while (true) {
    const response = await client.suppressions.list({
      ...(after ? { after } : {}),
      limit,
    });
    const page = normalizeListPage(response, "Resend suppressions list");
    suppressions.push(...page.entries);
    if (!page.hasMore || page.entries.length === 0) break;

    const cursor = cleanString(page.entries.at(-1)?.id);
    if (!cursor) throw new Error("Resend suppressions pagination cursor was missing");
    if (seenCursors.has(cursor)) throw new Error("Resend suppressions pagination cursor repeated");
    seenCursors.add(cursor);
    after = cursor;
    await sleep(delayMs);
  }

  return suppressions;
}

async function listAllClerkUsers({ clerkSecretKey, delayMs }) {
  const users = [];
  const limit = 500;
  let offset = 0;
  const seenPageMarkers = new Set();

  while (true) {
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

    const page = Array.isArray(body) ? body : body?.data;
    if (!Array.isArray(page)) throw new Error("Clerk user list returned an unexpected response shape");
    const marker = `${page.length}:${cleanString(page[0]?.id) ?? "empty"}:${cleanString(page.at(-1)?.id) ?? "empty"}`;
    if (seenPageMarkers.has(marker)) throw new Error("Clerk user pagination repeated a page");
    seenPageMarkers.add(marker);
    users.push(...page);
    offset += page.length;

    const totalCount = typeof body?.total_count === "number" ? body.total_count : null;
    if (page.length < limit || (totalCount !== null && offset >= totalCount)) break;
    await sleep(delayMs);
  }

  return users;
}

function extractAddress(from) {
  const value = cleanString(from)?.toLowerCase();
  if (!value) return null;
  const match = value.match(/<([^>]+)>$/);
  return cleanString(match?.[1] ?? value)?.toLowerCase() ?? null;
}

function normalizeEmail(value) {
  return cleanString(value)?.toLowerCase() ?? null;
}

function timestampOf(record) {
  return Date.parse(record.created_at);
}

function isExpectedWelcome(record) {
  return extractAddress(record?.from) === EXPECTED_FROM_ADDRESS &&
    cleanString(record?.subject) === EXPECTED_SUBJECT &&
    Array.isArray(record?.to) &&
    record.to.length === 1 &&
    normalizeEmail(record.to[0]);
}

function indexClerkUsers(users) {
  const index = new Map();
  for (const user of users) {
    const email = getPrimaryEmail(user);
    if (!email) continue;
    const matches = index.get(email) ?? [];
    matches.push(user);
    index.set(email, matches);
  }
  return index;
}

function indexContacts(contacts) {
  const index = new Map();
  for (const contact of contacts) {
    const email = normalizeEmail(contact?.email);
    if (email) index.set(email, contact);
  }
  return index;
}

function hashCohort(entries) {
  const identities = entries.map((entry) => `${entry.email}\0${entry.clerkUserId}`);
  return createHash("sha256").update(identities.sort().join("\n")).digest("hex");
}

function recipientHash(entry) {
  return createHash("sha256").update(`${entry.email}\0${entry.clerkUserId}`).digest("hex");
}

export function parseFailureManifest(value, {
  afterMs,
  beforeMs,
  expectedFailed,
  expectedFailureReason,
}) {
  const events = Array.isArray(value) ? value : value?.events;
  if (!Array.isArray(events)) {
    throw new Error("Failure manifest must be an array or an object with an events array");
  }
  if (events.length !== expectedFailed) {
    throw new Error(`Failure manifest count mismatch: expected ${expectedFailed}, found ${events.length}`);
  }

  const seenIds = new Set();
  return events.map((event, index) => {
    const data = event?.data ?? event;
    const id = cleanString(data?.email_id);
    const createdAt = cleanString(event?.observed_at ?? data?.created_at);
    const createdMs = Date.parse(createdAt ?? "");
    const reason = cleanString(data?.failed?.reason ?? data?.reason);
    const eventType = cleanString(event?.type ?? event?.event);
    if (eventType !== "email.failed" || !id || !Number.isFinite(createdMs)) {
      throw new Error(`Failure manifest event ${index + 1} has an invalid source-evidence shape`);
    }
    if (seenIds.has(id)) throw new Error(`Failure manifest contains duplicate email_id ${id}`);
    seenIds.add(id);
    if (createdMs < afterMs || createdMs > beforeMs) {
      throw new Error(`Failure manifest event ${id} falls outside the incident window`);
    }
    if (reason !== expectedFailureReason) {
      throw new Error(
        `Failure manifest event ${id} has reason ${reason ?? "missing"}, expected ${expectedFailureReason}`,
      );
    }
    return { createdAt, createdMs, id, reason };
  });
}

export function deriveRecoveryPlan({
  afterMs,
  beforeMs,
  clerkUsers,
  contacts,
  emails,
  failureEvents,
  recoveryAttemptRecipientHashes = new Set(),
  suppressions,
}) {
  const welcomeEmails = emails.filter(isExpectedWelcome);
  const recordsById = new Map(welcomeEmails.map((record) => [cleanString(record.id), record]));
  const failureRecords = failureEvents.map((event) => {
    const record = recordsById.get(event.id);
    if (
      !record ||
      record.last_event !== "failed" ||
      timestampOf(record) < afterMs ||
      timestampOf(record) > beforeMs
    ) {
      throw new Error(
        `Source-proven quota failure ${event.id} did not reconcile to a failed sent-email record`,
      );
    }
    return record;
  });

  const failuresByEmail = new Map();
  const failureRecordIds = new Set();
  for (const record of failureRecords) {
    failureRecordIds.add(record.id);
    const email = normalizeEmail(record.to[0]);
    const records = failuresByEmail.get(email) ?? [];
    records.push(record);
    failuresByEmail.set(email, records);
  }

  const laterAttempts = new Set();
  for (const record of welcomeEmails) {
    const email = normalizeEmail(record.to[0]);
    const failures = failuresByEmail.get(email);
    if (!failures || failureRecordIds.has(record.id)) continue;
    const latestFailureMs = Math.max(...failures.map(timestampOf));
    if (timestampOf(record) > latestFailureMs) {
      laterAttempts.add(email);
    }
  }

  const suppressedEmails = new Set(
    suppressions.map((entry) => normalizeEmail(entry?.email)).filter(Boolean),
  );
  const contactsByEmail = indexContacts(contacts);
  const clerkUsersByEmail = indexClerkUsers(clerkUsers);
  const exclusions = {
    ambiguousClerkUser: [],
    inactiveClerkUser: [],
    laterWelcomeAttempt: [],
    missingClerkUser: [],
    missingResendContact: [],
    suppressed: [],
    unsubscribed: [],
    unverifiedPrimaryEmail: [],
  };
  const eligible = [];

  for (const email of [...failuresByEmail.keys()].sort()) {
    if (suppressedEmails.has(email)) {
      exclusions.suppressed.push(email);
      continue;
    }

    const contact = contactsByEmail.get(email);
    if (!contact) {
      exclusions.missingResendContact.push(email);
      continue;
    }
    if (contact.unsubscribed === true) {
      exclusions.unsubscribed.push(email);
      continue;
    }

    const users = clerkUsersByEmail.get(email) ?? [];
    if (users.length === 0) {
      exclusions.missingClerkUser.push(email);
      continue;
    }
    if (users.length > 1) {
      exclusions.ambiguousClerkUser.push(email);
      continue;
    }

    const user = users[0];
    if (user.banned === true || user.locked === true || user.deleted_at) {
      exclusions.inactiveClerkUser.push(email);
      continue;
    }
    if (hasExplicitUnverifiedStatus(getPrimaryEmailAddress(user))) {
      exclusions.unverifiedPrimaryEmail.push(email);
      continue;
    }

    const entry = { clerkUserId: user.id, email };
    const entryWithHash = { ...entry, recipientHash: recipientHash(entry) };
    if (
      laterAttempts.has(email) &&
      !recoveryAttemptRecipientHashes.has(entryWithHash.recipientHash)
    ) {
      exclusions.laterWelcomeAttempt.push(email);
      continue;
    }
    eligible.push(entryWithHash);
  }

  return {
    cohortHash: hashCohort(eligible),
    eligible,
    exclusions,
    failureRecords: failureRecords.length,
    uniqueFailedRecipients: failuresByEmail.size,
  };
}

export function formatReport({ plan, scannedEmails }) {
  const excluded = Object.fromEntries(
    Object.entries(plan.exclusions).map(([reason, emails]) => [reason, emails.length]),
  );
  return {
    cohortHash: plan.cohortHash,
    eligible: {
      count: plan.eligible.length,
      canaryHash: plan.eligible[0]?.recipientHash ?? null,
      recipients: plan.eligible.map((entry) => maskEmail(entry.email)),
    },
    excluded,
    source: {
      failedWelcomeRecords: plan.failureRecords,
      scannedEmails,
      uniqueFailedRecipients: plan.uniqueFailedRecipients,
    },
  };
}

export function parseLedger(text) {
  const entries = text.trim() ? text.trim().split("\n").map((line) => JSON.parse(line)) : [];
  const latest = new Map();
  for (const entry of entries) {
    if (!cleanString(entry?.recipientHash) || !cleanString(entry?.status)) {
      throw new Error("Recovery ledger contains an invalid entry");
    }
    latest.set(entry.recipientHash, entry);
  }
  return latest;
}

export async function acquireRecoveryLock(ledgerPath) {
  const lockPath = `${ledgerPath}.lock`;
  let handle;
  try {
    handle = await open(lockPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
  } catch (error) {
    await handle?.close().catch(() => {});
    if (error?.code === "EEXIST") {
      throw new Error(
        `Recovery lock already exists at ${lockPath}; stop and reconcile the running or interrupted process`,
      );
    }
    throw error;
  }

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await handle.close();
    await unlink(lockPath);
  };
}

async function appendLedger(ledgerPath, entry) {
  await appendFile(
    ledgerPath,
    `${JSON.stringify({ ...entry, recordedAt: new Date().toISOString() })}\n`,
    { mode: 0o600 },
  );
}

export async function sendRecoveryEvents({
  client,
  cohort,
  cohortHash,
  delayMs,
  ledgerPath,
  maxSend,
  source,
}) {
  const results = [];
  for (const entry of cohort.slice(0, maxSend)) {
    await appendLedger(ledgerPath, {
      cohortHash,
      recipientHash: entry.recipientHash,
      status: "attempting",
    });
    let response;
    try {
      response = await client.events.send({
        email: entry.email,
        event: WELCOME_EVENT,
        payload: {
          clerk_user_id: entry.clerkUserId,
          source,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Ambiguous Resend event result for ${maskEmail(entry.email)}; stopped without retry: ${message.replaceAll(entry.email, maskEmail(entry.email))}`,
      );
    }

    if (response?.error) {
      const message = response.error.message ?? "Unknown error";
      await appendLedger(ledgerPath, {
        cohortHash,
        recipientHash: entry.recipientHash,
        status: "rejected",
      });
      throw new Error(
        `Resend rejected recovery event for ${maskEmail(entry.email)}: ${message.replaceAll(entry.email, maskEmail(entry.email))}`,
      );
    }
    if (!response?.data) {
      throw new Error(
        `Ambiguous Resend event result for ${maskEmail(entry.email)}; stopped without retry: response contained neither data nor an error`,
      );
    }

    await appendLedger(ledgerPath, {
      cohortHash,
      recipientHash: entry.recipientHash,
      status: "accepted",
    });
    results.push({ email: maskEmail(entry.email), event: response.data.event, status: "accepted" });
    if (results.length < Math.min(cohort.length, maxSend)) await sleep(delayMs);
  }
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const clerkSecretKey = cleanString(process.env.CLERK_SECRET_KEY);
  const resendApiKey = cleanString(process.env.RESEND_OPERATOR_API_KEY);
  if (!clerkSecretKey) throw new Error("CLERK_SECRET_KEY is required");
  if (!resendApiKey) throw new Error("RESEND_OPERATOR_API_KEY is required");

  const releaseLock = args.apply ? await acquireRecoveryLock(args.ledger) : null;
  try {

    const client = new Resend(resendApiKey);
    const manifestValue = JSON.parse(await readFile(args.failureManifest, "utf8"));
    const failureEvents = parseFailureManifest(manifestValue, {
    afterMs: args.afterMs,
    beforeMs: args.beforeMs,
    expectedFailed: args.expectedFailed,
    expectedFailureReason: args.expectedFailureReason,
  });
  let ledger = new Map();
  const recoveryAttemptRecipientHashes = new Set();
  if (args.apply) {
    const ledgerText = await readFile(args.ledger, "utf8").catch((error) => {
      if (error?.code === "ENOENT") return "";
      throw error;
    });
    ledger = parseLedger(ledgerText);
    for (const [hash, entry] of ledger) {
      if (entry.cohortHash !== args.expectedCohortHash) {
        throw new Error("Recovery ledger contains an entry from a different cohort");
      }
      if (entry.status === "accepted" || entry.status === "attempting") {
        recoveryAttemptRecipientHashes.add(hash);
      }
    }
  }
  // Keep Resend pagination streams sequential so the account-wide request rate stays bounded.
  const emails = await listEmailsThroughIncident({
    afterMs: args.afterMs,
    client,
    delayMs: args.delayMs,
    limit: args.pageLimit,
  });
  const contacts = await listAllContacts({ client, delayMs: args.delayMs, limit: args.pageLimit });
  const suppressions = await listAllSuppressions({
    client,
    delayMs: args.delayMs,
    limit: args.pageLimit,
  });
  const clerkUsers = await listAllClerkUsers({ clerkSecretKey, delayMs: args.delayMs });
  const plan = deriveRecoveryPlan({
    afterMs: args.afterMs,
    beforeMs: args.beforeMs,
    clerkUsers,
    contacts,
    emails,
    failureEvents,
    recoveryAttemptRecipientHashes,
    suppressions,
  });
  const report = formatReport({ plan, scannedEmails: emails.length });
  console.log(JSON.stringify(report, null, 2));

  if (!args.apply) {
    console.log("dry-run complete; no recovery events sent");
    return;
  }
  if (plan.cohortHash !== args.expectedCohortHash) {
    throw new Error(
      `Cohort hash changed: expected ${args.expectedCohortHash}, found ${plan.cohortHash}; run a fresh dry run`,
    );
  }
  if (plan.eligible.length === 0) throw new Error("No eligible recovery recipients");

  const unresolved = plan.eligible.filter(
    (entry) => ledger.get(entry.recipientHash)?.status === "attempting",
  );
  if (unresolved.length > 0) {
    throw new Error(
      "Recovery ledger contains an ambiguous attempting entry; reconcile it before resuming",
    );
  }
  const accepted = new Set(
    plan.eligible
      .filter((entry) => ledger.get(entry.recipientHash)?.status === "accepted")
      .map((entry) => entry.recipientHash),
  );
  const canaryHash = plan.eligible[0]?.recipientHash;
  if (accepted.size > 0 && !args.verifiedCanaryHash) {
    throw new Error("Verify the accepted canary delivery before resuming this recovery");
  }
  if (
    args.verifiedCanaryHash &&
    (args.verifiedCanaryHash !== canaryHash || !accepted.has(args.verifiedCanaryHash))
  ) {
    throw new Error("The verified canary hash is not the accepted canary for this cohort");
  }
  const remaining = plan.eligible.filter((entry) => !accepted.has(entry.recipientHash));
  if (remaining.length === 0) {
    throw new Error("All eligible recovery recipients are already accepted in the ledger");
  }

  const results = await sendRecoveryEvents({
    client,
    cohort: remaining,
    cohortHash: plan.cohortHash,
    delayMs: args.sendDelayMs,
    ledgerPath: args.ledger,
    maxSend: args.maxSend,
    source: "quota-recovery-2026-09-06",
  });
    console.log(JSON.stringify({ recoveryEvents: results }, null, 2));
  } finally {
    await releaseLock?.();
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
