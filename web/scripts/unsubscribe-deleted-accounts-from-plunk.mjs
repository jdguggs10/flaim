#!/usr/bin/env node

/**
 * Pre-send gate: unsubscribe deleted Flaim accounts from Plunk marketing email.
 *
 * Only the auth worker receives Clerk's `user.deleted` event, the event has no
 * email address, and Flaim keeps no first-party email copy. Unsubscribing a
 * Plunk contact by id needs the broad secret key, which must never be
 * deployed. Marketing email only goes out when an operator sends a Broadcast
 * by hand, so this script runs immediately before each audience send instead
 * of in real time.
 *
 * Rules, applied only to contacts that are currently subscribed:
 *   1. `data.clerkUserId` is in `public.account_deletions`
 *      -> unsubscribeSource "account_deletion".
 *   2. No `data.clerkUserId`, the email is not any current Clerk address
 *      (primary or secondary), and the contact was created before the frozen
 *      Clerk snapshot -> unsubscribeSource "no_current_account".
 *
 * Matches are unsubscribed with PATCH /contacts/:id. Contacts are never
 * deleted, so the unsubscribed record keeps a later re-signup from being
 * re-added as subscribed (the signup sync omits `subscribed`).
 *
 * Dry-run is the default. The report is aggregate counts only: it never
 * prints an email address, a contact id, a Clerk user id, or a key. Any
 * malformed provider page, count mismatch, or match count above the ceiling
 * fails the run closed.
 *
 * Env (all required, for dry-run and apply alike):
 *   PLUNK_SECRET_API_KEY   operator shell only; never deployed.
 *   CLERK_SECRET_KEY       frozen Clerk snapshot for rule 2.
 *   SUPABASE_URL           reads public.account_deletions.
 *   SUPABASE_SERVICE_KEY   service-role key (select on account_deletions).
 */

import { pathToFileURL } from "node:url";
import {
  createPlunkClient,
  listMigrationClerkUsers,
  normalizeEmail,
} from "./migrate-marketing-contacts-to-plunk.mjs";

const DEFAULT_DELAY_MS = 75;
const DEFAULT_RETRIES = 5;
const DEFAULT_MAX_MATCHES = 200;
const PLUNK_PAGE_SIZE = 100;
const SUPABASE_PAGE_SIZE = 1000;

export const UNSUBSCRIBE_SOURCES = {
  accountDeletion: "account_deletion",
  noCurrentAccount: "no_current_account",
};

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseArgs(argv) {
  const args = {
    apply: false,
    delayMs: DEFAULT_DELAY_MS,
    help: false,
    maxMatches: DEFAULT_MAX_MATCHES,
    maxRetries: DEFAULT_RETRIES,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--max-matches" && next) {
      args.maxMatches = Number(next);
      index += 1;
    } else if (arg === "--delay-ms" && next) {
      args.delayMs = Number(next);
      index += 1;
    } else if (arg === "--max-retries" && next) {
      args.maxRetries = Number(next);
      index += 1;
    } else if (arg === "--help") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!Number.isInteger(args.maxMatches) || args.maxMatches < 0) {
    throw new Error("--max-matches must be a non-negative integer");
  }
  if (!Number.isFinite(args.delayMs) || args.delayMs < 60) {
    throw new Error("--delay-ms must be at least 60 to stay below Plunk's project limit");
  }
  if (!Number.isInteger(args.maxRetries) || args.maxRetries < 0 || args.maxRetries > 10) {
    throw new Error("--max-retries must be an integer from 0 to 10");
  }
  return args;
}

function printUsage(log) {
  log(`
Unsubscribe deleted Flaim accounts from Plunk marketing email.

Usage:
  node scripts/unsubscribe-deleted-accounts-from-plunk.mjs
  node scripts/unsubscribe-deleted-accounts-from-plunk.mjs --apply

Options:
  --apply            Unsubscribe the matched contacts. Omit for dry-run.
  --max-matches <n>  Fail closed when rule 1 + rule 2 matches exceed n.
                     Default ${DEFAULT_MAX_MATCHES}.
  --delay-ms <n>     Minimum gap between Plunk requests. Default ${DEFAULT_DELAY_MS}, min 60.
  --max-retries <n>  Plunk retries on 429/5xx/network errors. Default ${DEFAULT_RETRIES}.

Requires PLUNK_SECRET_API_KEY, CLERK_SECRET_KEY, SUPABASE_URL, and
SUPABASE_SERVICE_KEY. The report is aggregate counts only.
`);
}

/**
 * PostgREST header contract, matching backfill-signup-log.mjs: a new-style
 * `sb_secret_` key goes in `apikey` only; a legacy JWT service key goes in
 * both `apikey` and `Authorization: Bearer`.
 */
function supabaseHeaders(serviceKey) {
  const headers = { Accept: "application/json", apikey: serviceKey };
  if (!serviceKey.startsWith("sb_secret_")) headers.Authorization = `Bearer ${serviceKey}`;
  return headers;
}

function parseContentRangeTotal(value) {
  const match = /^(?:\d+-\d+|\*)\/(\d+)$/.exec(value ?? "");
  return match ? Number(match[1]) : null;
}

/**
 * Read every `account_deletions.clerk_user_id`, ordered and count-checked.
 * The table is an insert-only tombstone, so a total that moves mid-read means
 * a deletion landed during the run; that fails closed and the operator reruns.
 */
export async function listDeletedClerkUserIds({
  fetchImpl = fetch,
  pageSize = SUPABASE_PAGE_SIZE,
  supabaseServiceKey,
  supabaseUrl,
}) {
  const ids = new Set();
  let expectedTotal = null;

  for (let offset = 0; ; offset += pageSize) {
    const url = new URL("/rest/v1/account_deletions", supabaseUrl);
    url.searchParams.set("select", "clerk_user_id");
    url.searchParams.set("order", "clerk_user_id.asc");
    const response = await fetchImpl(url, {
      headers: {
        ...supabaseHeaders(supabaseServiceKey),
        Prefer: "count=exact",
        Range: `${offset}-${offset + pageSize - 1}`,
        "Range-Unit": "items",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new Error(`Supabase account_deletions read failed (${response.status})`);
    }
    const total = parseContentRangeTotal(response.headers.get("content-range"));
    const body = await response.json().catch(() => null);
    if (!Array.isArray(body) || total === null) {
      throw new Error("Supabase account_deletions returned an unexpected response");
    }
    if (expectedTotal === null) expectedTotal = total;
    else if (total !== expectedTotal) {
      throw new Error("Supabase account_deletions count changed mid-read; rerun");
    }

    for (const row of body) {
      const id = typeof row?.clerk_user_id === "string" ? row.clerk_user_id.trim() : "";
      if (!id || ids.has(id)) {
        throw new Error("Supabase account_deletions returned a missing or duplicate id");
      }
      ids.add(id);
    }

    if (ids.size >= expectedTotal || body.length < pageSize) break;
  }

  if (ids.size !== expectedTotal) {
    throw new Error(
      `Supabase account_deletions read ${ids.size} of ${expectedTotal} rows; rerun`,
    );
  }
  return ids;
}

function validateContact(contact, position) {
  const where = `Plunk contact at position ${position}`;
  if (!isRecord(contact)) throw new Error(`${where} is not an object`);
  if (typeof contact.id !== "string" || !contact.id.trim()) {
    throw new Error(`${where} has no id`);
  }
  const email = normalizeEmail(contact.email);
  if (!email) throw new Error(`${where} has an invalid email`);
  if (typeof contact.subscribed !== "boolean") {
    throw new Error(`${where} has a non-boolean subscribed state`);
  }
  const createdAtMs = Date.parse(contact.createdAt);
  if (!Number.isFinite(createdAtMs)) throw new Error(`${where} has an invalid createdAt`);
  if (contact.data !== undefined && contact.data !== null && !isRecord(contact.data)) {
    throw new Error(`${where} has a non-object data field`);
  }
  const data = isRecord(contact.data) ? contact.data : {};
  const rawClerkUserId = data.clerkUserId;
  if (
    rawClerkUserId !== undefined &&
    rawClerkUserId !== null &&
    typeof rawClerkUserId !== "string"
  ) {
    throw new Error(`${where} has a non-string clerkUserId`);
  }
  const clerkUserId = typeof rawClerkUserId === "string" ? rawClerkUserId.trim() || null : null;

  return {
    clerkUserId,
    createdAtMs,
    data,
    email,
    id: contact.id,
    subscribed: contact.subscribed,
  };
}

/**
 * Page through every Plunk contact with the cursor the live API returns
 * (`{ data, total, cursor, hasMore }`). Fails closed on a malformed page, a
 * duplicate id, a shrinking total, or a final count that does not match the
 * last reported total. Live signups may grow the total mid-scan; they are
 * accepted only if the scan still ends with exactly that many contacts.
 */
export async function listAllPlunkContacts({ request }) {
  const contacts = [];
  const ids = new Set();
  let cursor = null;
  let lastTotal = null;

  do {
    const query = new URLSearchParams({ limit: String(PLUNK_PAGE_SIZE) });
    if (cursor) query.set("cursor", cursor);
    const response = await request(`/contacts?${query}`);
    const body = await response.json().catch(() => null);
    if (
      !isRecord(body) ||
      !Array.isArray(body.data) ||
      !Number.isSafeInteger(body.total) ||
      body.total < 0 ||
      typeof body.hasMore !== "boolean"
    ) {
      throw new Error("Plunk contact list returned a malformed page");
    }
    if (lastTotal !== null && body.total < lastTotal) {
      throw new Error("Plunk contact total shrank mid-scan; rerun");
    }
    lastTotal = body.total;

    for (const raw of body.data) {
      const contact = validateContact(raw, contacts.length + 1);
      if (ids.has(contact.id)) throw new Error("Plunk contact list returned a duplicate id");
      ids.add(contact.id);
      contacts.push(contact);
    }

    if (body.hasMore) {
      cursor = typeof body.cursor === "string" && body.cursor.trim() ? body.cursor : null;
      if (!cursor) throw new Error("Plunk contact list cursor was missing");
      if (body.data.length === 0) throw new Error("Plunk contact list returned an empty page with more");
    } else {
      cursor = null;
    }
  } while (cursor);

  if (contacts.length !== lastTotal) {
    throw new Error(
      `Plunk contact scan read ${contacts.length} contacts but the API reported ${lastTotal}; rerun`,
    );
  }
  return contacts;
}

/** Every Clerk address (primary and secondary, any verification state). */
export function collectClerkEmails(clerkUsers) {
  const emails = new Set();
  for (const user of clerkUsers) {
    if (!Array.isArray(user?.email_addresses)) continue;
    for (const address of user.email_addresses) {
      const email = normalizeEmail(address?.email_address);
      if (email) emails.add(email);
    }
  }
  return emails;
}

export function buildUnsubscribePlan({ clerkEmails, contacts, cutoffMs, deletedClerkUserIds }) {
  const stats = {
    alreadyUnsubscribed: 0,
    rule1Matches: 0,
    rule2Matches: 0,
    rule2ProtectedByClerkEmail: 0,
    rule2SkippedCreatedAfterSnapshot: 0,
    scanned: contacts.length,
    subscribed: 0,
    subscribedWithoutClerkUserId: 0,
  };
  const matches = [];

  for (const contact of contacts) {
    if (!contact.subscribed) {
      stats.alreadyUnsubscribed += 1;
      continue;
    }
    stats.subscribed += 1;

    if (contact.clerkUserId) {
      if (deletedClerkUserIds.has(contact.clerkUserId)) {
        stats.rule1Matches += 1;
        matches.push({ contact, source: UNSUBSCRIBE_SOURCES.accountDeletion });
      }
      continue;
    }

    stats.subscribedWithoutClerkUserId += 1;
    if (clerkEmails.has(contact.email)) {
      stats.rule2ProtectedByClerkEmail += 1;
      continue;
    }
    if (contact.createdAtMs >= cutoffMs) {
      stats.rule2SkippedCreatedAfterSnapshot += 1;
      continue;
    }
    stats.rule2Matches += 1;
    matches.push({ contact, source: UNSUBSCRIBE_SOURCES.noCurrentAccount });
  }

  return { matches, stats };
}

/**
 * Existing contact data is sent back with the source added, so the call keeps
 * `clerkUserId` and other fields whether Plunk merges or replaces `data`.
 */
export function buildUnsubscribeBody(match) {
  return {
    data: { ...match.contact.data, unsubscribeSource: match.source },
    subscribed: false,
  };
}

export async function applyUnsubscribes({ matches, request }) {
  const counts = { applied: 0, failed: 0 };
  for (const match of matches) {
    try {
      await request(`/contacts/${encodeURIComponent(match.contact.id)}`, {
        body: JSON.stringify(buildUnsubscribeBody(match)),
        method: "PATCH",
      });
      counts.applied += 1;
    } catch {
      counts.failed += 1;
    }
  }
  return counts;
}

export function verifyUnsubscribed({ contacts, matches }) {
  const byId = new Map(contacts.map((contact) => [contact.id, contact]));
  const result = { missing: 0, stillSubscribed: 0, verified: 0 };
  for (const match of matches) {
    const contact = byId.get(match.contact.id);
    if (!contact) result.missing += 1;
    else if (contact.subscribed === false) result.verified += 1;
    else result.stillSubscribed += 1;
  }
  return { ...result, safe: result.missing === 0 && result.stillSubscribed === 0 };
}

function requireEnv(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/**
 * The whole job with its I/O injected. Returns the process exit code: zero
 * only when the run completed and, for --apply, every match verified false.
 * Configuration and fail-closed provider errors throw.
 *
 * @param {string[]} argv
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   fetchImpl?: typeof fetch,
 *   log?: (line: string) => void,
 *   now?: () => number,
 *   plunkDelayMs?: number,
 * }} [options] `plunkDelayMs` is a test hook that bypasses the CLI's 60ms floor.
 */
export async function run(
  argv,
  { env = process.env, fetchImpl = fetch, log = console.log, now = Date.now, plunkDelayMs } = {},
) {
  const args = parseArgs(argv);
  if (args.help) {
    printUsage(log);
    return 0;
  }

  const plunkApiKey = requireEnv(env, "PLUNK_SECRET_API_KEY");
  const clerkSecretKey = requireEnv(env, "CLERK_SECRET_KEY");
  const supabaseUrl = requireEnv(env, "SUPABASE_URL").replace(/\/+$/, "");
  const supabaseServiceKey = requireEnv(env, "SUPABASE_SERVICE_KEY");

  const { request } = createPlunkClient({
    apiKey: plunkApiKey,
    delayMs: plunkDelayMs ?? args.delayMs,
    fetchImpl,
    maxRetries: args.maxRetries,
  });

  // Freeze the Clerk snapshot first, then read Plunk. Every contact created
  // before the cutoff can then be judged against a Clerk set that already
  // contains any account that could own it.
  const cutoffMs = now();
  const clerkUsers = await listMigrationClerkUsers({ clerkSecretKey, cutoffMs, fetchImpl });
  if (clerkUsers.length === 0) {
    throw new Error("Clerk snapshot is empty; refusing to judge contacts against it");
  }
  const clerkEmails = collectClerkEmails(clerkUsers);
  const deletedClerkUserIds = await listDeletedClerkUserIds({
    fetchImpl,
    supabaseServiceKey,
    supabaseUrl,
  });
  const contacts = await listAllPlunkContacts({ request });

  const plan = buildUnsubscribePlan({ clerkEmails, contacts, cutoffMs, deletedClerkUserIds });
  const totalMatches = plan.matches.length;
  const report = {
    clerkSnapshot: {
      cutoff: new Date(cutoffMs).toISOString(),
      emails: clerkEmails.size,
      users: clerkUsers.length,
    },
    deletedAccounts: deletedClerkUserIds.size,
    maxMatches: args.maxMatches,
    mode: args.apply ? "apply" : "dry-run",
    plunk: plan.stats,
    totalMatches,
  };

  if (totalMatches > args.maxMatches) {
    log(JSON.stringify({ ...report, status: "refused: matches above --max-matches" }, null, 2));
    throw new Error(
      `${totalMatches} matches exceed --max-matches ${args.maxMatches}; review before raising it`,
    );
  }

  if (!args.apply || totalMatches === 0) {
    log(JSON.stringify({ ...report, status: "complete" }, null, 2));
    return 0;
  }

  const counts = await applyUnsubscribes({ matches: plan.matches, request });
  const finalContacts = await listAllPlunkContacts({ request });
  const verification = verifyUnsubscribed({ contacts: finalContacts, matches: plan.matches });
  const completed = counts.failed === 0 && verification.safe;
  log(
    JSON.stringify(
      {
        ...report,
        applied: counts.applied,
        failed: counts.failed,
        status: completed ? "complete" : "incomplete",
        verification,
      },
      null,
      2,
    ),
  );
  return completed ? 0 : 1;
}

async function main() {
  process.exitCode = await run(process.argv.slice(2));
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;

if (entryUrl && import.meta.url === entryUrl) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Unknown unsubscribe error");
    process.exit(1);
  });
}
