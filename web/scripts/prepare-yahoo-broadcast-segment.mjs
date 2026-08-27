#!/usr/bin/env node

import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const CLERK_USERS_URL = "https://api.clerk.com/v1/users";
const RESEND_API_URL = "https://api.resend.com";
const DEFAULT_OUTAGE_START = "2026-07-27T18:15:36.000Z";
const DEFAULT_SEASON_YEAR = 2026;
const DEFAULT_SUPABASE_LIMIT = 1000;
const DEFAULT_CLERK_LIMIT = 500;
const DEFAULT_RESEND_LIMIT = 100;
const DEFAULT_DELAY_MS = 550;

export function parseArgs(argv) {
  const args = {
    apply: false,
    clerkLimit: DEFAULT_CLERK_LIMIT,
    delayMs: DEFAULT_DELAY_MS,
    expectedEligibleCount: null,
    outageStart: DEFAULT_OUTAGE_START,
    resendLimit: DEFAULT_RESEND_LIMIT,
    seasonYear: DEFAULT_SEASON_YEAR,
    segmentId: null,
    segmentName: null,
    supabaseLimit: DEFAULT_SUPABASE_LIMIT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--apply") {
      args.apply = true;
      continue;
    }

    if (arg === "--expected-eligible-count" && next) {
      args.expectedEligibleCount = Number(next);
      index += 1;
      continue;
    }

    if (arg === "--segment-id" && next) {
      args.segmentId = next.trim() || null;
      index += 1;
      continue;
    }

    if (arg === "--segment-name" && next) {
      args.segmentName = next.trim() || null;
      index += 1;
      continue;
    }

    if (arg === "--outage-start" && next) {
      args.outageStart = next;
      index += 1;
      continue;
    }

    if (arg === "--season-year" && next) {
      args.seasonYear = Number(next);
      index += 1;
      continue;
    }

    if (arg === "--supabase-limit" && next) {
      args.supabaseLimit = Number(next);
      index += 1;
      continue;
    }

    if (arg === "--clerk-limit" && next) {
      args.clerkLimit = Number(next);
      index += 1;
      continue;
    }

    if (arg === "--resend-limit" && next) {
      args.resendLimit = Number(next);
      index += 1;
      continue;
    }

    if (arg === "--delay-ms" && next) {
      args.delayMs = Number(next);
      index += 1;
      continue;
    }

    if (arg === "--help") {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!Number.isFinite(Date.parse(args.outageStart))) {
    throw new Error("--outage-start must be an ISO timestamp");
  }

  for (const [name, value, maximum] of [
    ["--season-year", args.seasonYear, 9999],
    ["--supabase-limit", args.supabaseLimit, 1000],
    ["--clerk-limit", args.clerkLimit, 500],
    ["--resend-limit", args.resendLimit, 100],
  ]) {
    if (!Number.isInteger(value) || value < 1 || value > maximum) {
      throw new Error(`${name} must be an integer from 1 to ${maximum}`);
    }
  }

  if (!Number.isFinite(args.delayMs) || args.delayMs < 0) {
    throw new Error("--delay-ms must be zero or greater");
  }

  if (args.expectedEligibleCount !== null &&
    (!Number.isInteger(args.expectedEligibleCount) || args.expectedEligibleCount < 1)) {
    throw new Error("--expected-eligible-count must be a positive integer");
  }

  return args;
}

function printUsage() {
  console.log(`
Prepare the one-off Yahoo operational Broadcast Segment.

Dry run:
  node scripts/prepare-yahoo-broadcast-segment.mjs

Apply after reviewing the dry-run count and manually creating the Segment:
  node scripts/prepare-yahoo-broadcast-segment.mjs --apply \\
    --segment-id <id> \\
    --segment-name "Yahoo access update - 2026-08" \\
    --expected-eligible-count <count>

Default cohort:
  Yahoo credential created on or after ${DEFAULT_OUTAGE_START}, or a stored
  ${DEFAULT_SEASON_YEAR} Yahoo league. Internal users are excluded by SHA-256 hashes supplied
  in FLAIM_INTERNAL_USER_HASHES.

The default mode is read-only and prints aggregate counts only. Apply mode only
adds already-existing, subscribed, non-suppressed contacts to the exact Segment.
It never creates contacts, changes subscription state, removes suppressions,
creates a Broadcast, or sends email.
`);
}

function cleanString(value) {
  const cleaned = typeof value === "string" ? value.trim() : "";
  return cleaned || null;
}

function normalizeEmail(value) {
  return cleanString(value)?.toLowerCase() ?? null;
}

function userHash(userId) {
  return createHash("sha256").update(userId).digest("hex");
}

export function parseInternalUserHashes(value) {
  const hashes = String(value ?? "")
    .split(/[\s,]+/)
    .map((hash) => hash.trim().toLowerCase())
    .filter(Boolean);

  if (hashes.length === 0) {
    throw new Error("FLAIM_INTERNAL_USER_HASHES is required");
  }

  for (const hash of hashes) {
    if (!/^[a-f0-9]{64}$/.test(hash)) {
      throw new Error("FLAIM_INTERNAL_USER_HASHES must contain SHA-256 hashes");
    }
  }

  return new Set(hashes);
}

export function selectYahooCohort({
  credentials,
  internalUserHashes,
  leagueRows,
  outageStart,
  seasonYear,
}) {
  const outageStartMs = Date.parse(outageStart);
  const anyLeagueUsers = new Set();
  const currentLeagueUsers = new Set();

  for (const row of leagueRows) {
    const userId = cleanString(row?.clerk_user_id);
    if (!userId) continue;
    anyLeagueUsers.add(userId);
    if (Number(row?.season_year) === seasonYear) currentLeagueUsers.add(userId);
  }

  const cohortIds = new Set();
  const stats = {
    connectedDuringOutage: 0,
    currentSeasonLeague: 0,
    externalCredentials: 0,
    historicalOnlyExcluded: 0,
    internalExcluded: 0,
    invalidCredentialRows: 0,
    oldNoLeagueExcluded: 0,
    selected: 0,
  };

  for (const credential of credentials) {
    const userId = cleanString(credential?.clerk_user_id);
    const createdAtMs = Date.parse(credential?.created_at);
    if (!userId || !Number.isFinite(createdAtMs)) {
      stats.invalidCredentialRows += 1;
      continue;
    }

    if (internalUserHashes.has(userHash(userId))) {
      stats.internalExcluded += 1;
      continue;
    }

    stats.externalCredentials += 1;
    const connectedDuringOutage = createdAtMs >= outageStartMs;
    const hasCurrentLeague = currentLeagueUsers.has(userId);

    if (connectedDuringOutage) stats.connectedDuringOutage += 1;
    if (hasCurrentLeague) stats.currentSeasonLeague += 1;

    if (connectedDuringOutage || hasCurrentLeague) {
      cohortIds.add(userId);
      continue;
    }

    if (anyLeagueUsers.has(userId)) stats.historicalOnlyExcluded += 1;
    else stats.oldNoLeagueExcluded += 1;
  }

  stats.selected = cohortIds.size;
  return { cohortIds, stats };
}

function getPrimaryEmailAddress(user) {
  const emails = Array.isArray(user?.email_addresses) ? user.email_addresses : [];
  if (emails.length === 1) return emails[0];
  return emails.find((email) => email.id === user?.primary_email_address_id) ?? null;
}

export function classifyClerkUsers({ cohortIds, users }) {
  const usersById = new Map(users.map((user) => [user.id, user]));
  const candidatesByEmail = new Map();
  const stats = {
    banned: 0,
    duplicateEmail: 0,
    missing: 0,
    noPrimaryEmail: 0,
    usable: 0,
    unverifiedPrimaryEmail: 0,
  };

  for (const userId of cohortIds) {
    const user = usersById.get(userId);
    if (!user) {
      stats.missing += 1;
      continue;
    }

    if (user.banned === true) {
      stats.banned += 1;
      continue;
    }

    const primaryEmail = getPrimaryEmailAddress(user);
    const email = normalizeEmail(primaryEmail?.email_address);
    if (!email) {
      stats.noPrimaryEmail += 1;
      continue;
    }

    if (primaryEmail?.verification?.status !== "verified") {
      stats.unverifiedPrimaryEmail += 1;
      continue;
    }

    if (candidatesByEmail.has(email)) {
      stats.duplicateEmail += 1;
      continue;
    }

    candidatesByEmail.set(email, { email });
  }

  const candidates = [...candidatesByEmail.values()];
  stats.usable = candidates.length;
  return { candidates, stats };
}

export function classifyResendEligibility({ candidates, contacts, suppressions }) {
  const contactsByEmail = new Map();
  for (const contact of contacts) {
    const email = normalizeEmail(contact?.email);
    if (email) contactsByEmail.set(email, contact);
  }

  const suppressedEmails = new Set(
    suppressions.map((suppression) => normalizeEmail(suppression?.email)).filter(Boolean),
  );
  const eligibleContacts = [];
  const stats = {
    contactMissing: 0,
    eligible: 0,
    suppressed: 0,
    unsubscribed: 0,
  };

  for (const candidate of candidates) {
    const contact = contactsByEmail.get(candidate.email);
    if (!contact || !cleanString(contact.id)) {
      stats.contactMissing += 1;
      continue;
    }

    if (contact.unsubscribed === true) {
      stats.unsubscribed += 1;
      continue;
    }

    if (suppressedEmails.has(candidate.email)) {
      stats.suppressed += 1;
      continue;
    }

    eligibleContacts.push({ contactId: contact.id, email: candidate.email });
  }

  stats.eligible = eligibleContacts.length;
  return { eligibleContacts, stats };
}

export function validateApplyGuards(args, eligibleCount) {
  if (!args.apply) return;
  if (!args.segmentId) throw new Error("--apply requires --segment-id");
  if (!args.segmentName) throw new Error("--apply requires --segment-name");
  if (args.expectedEligibleCount === null) {
    throw new Error("--apply requires --expected-eligible-count from the reviewed dry run");
  }
  if (args.expectedEligibleCount !== eligibleCount) {
    throw new Error(
      `Eligible count changed: expected ${args.expectedEligibleCount}, found ${eligibleCount}`,
    );
  }
}

export function planSegmentAdditions({ eligibleContacts, segmentContacts }) {
  const eligibleIds = new Set(eligibleContacts.map((contact) => contact.contactId));
  const existingIds = new Set();

  for (const contact of segmentContacts) {
    const contactId = cleanString(contact?.id);
    if (!contactId) throw new Error("Segment returned a contact without an id");
    if (!eligibleIds.has(contactId)) {
      throw new Error("Segment contains a contact outside the reviewed eligible cohort");
    }
    existingIds.add(contactId);
  }

  return {
    additions: eligibleContacts.filter((contact) => !existingIds.has(contact.contactId)),
    existingCount: existingIds.size,
  };
}

export function buildSummary({ cohort, clerk, resend, segment = null }) {
  return {
    cohort: { ...cohort },
    clerk: { ...clerk },
    resend: { ...resend },
    ...(segment ? { segment: { ...segment } } : {}),
  };
}

async function fetchJson(fetcher, url, options, label) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetcher(url, options);
    const body = await response.json().catch(() => null);
    if (response.status === 429 && attempt < 3) {
      const retryAfterSeconds = Number(response.headers?.get?.("retry-after"));
      const retryDelay = Number.isFinite(retryAfterSeconds)
        ? Math.max(retryAfterSeconds * 1000, DEFAULT_DELAY_MS)
        : DEFAULT_DELAY_MS * (attempt + 1);
      await delay(retryDelay);
      continue;
    }
    if (!response.ok) throw new Error(`${label} failed with status ${response.status}`);
    return { body, response };
  }

  throw new Error(`${label} remained rate limited`);
}

export async function listSupabaseRows({ fetcher = fetch, headers, limit, url }) {
  const rows = [];

  for (let offset = 0; ; offset += limit) {
    const { body } = await fetchJson(fetcher, url, {
      headers: {
        ...headers,
        Range: `${offset}-${offset + limit - 1}`,
      },
    }, "Supabase list");

    if (!Array.isArray(body)) throw new Error("Supabase list returned an unexpected response");
    rows.push(...body);
    if (body.length < limit) break;
  }

  return rows;
}

async function listClerkUsers({ fetcher = fetch, secretKey, limit }) {
  const users = [];

  for (let offset = 0; ; offset += limit) {
    const url = new URL(CLERK_USERS_URL);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    const { body } = await fetchJson(fetcher, url, {
      headers: { Authorization: `Bearer ${secretKey}` },
    }, "Clerk user list");

    if (!Array.isArray(body)) throw new Error("Clerk user list returned an unexpected response");
    users.push(...body);
    if (body.length < limit) break;
  }

  return users;
}

async function listResendRows({ apiKey, delayMs = DEFAULT_DELAY_MS, fetcher = fetch, limit, path }) {
  const rows = [];
  let after = null;

  while (true) {
    const url = new URL(path, RESEND_API_URL);
    url.searchParams.set("limit", String(limit));
    if (after) url.searchParams.set("after", after);
    const { body } = await fetchJson(fetcher, url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    }, "Resend list");

    const page = Array.isArray(body?.data) ? body.data : null;
    if (!page) throw new Error("Resend list returned an unexpected response");
    rows.push(...page);
    if (body.has_more !== true || page.length === 0) break;
    after = cleanString(page.at(-1)?.id);
    if (!after) throw new Error("Resend list pagination cursor was missing");
    if (delayMs > 0) await delay(delayMs);
  }

  return rows;
}

async function getResendSegment({ apiKey, fetcher = fetch, segmentId }) {
  const url = new URL(`/segments/${encodeURIComponent(segmentId)}`, RESEND_API_URL);
  const { body } = await fetchJson(fetcher, url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  }, "Resend Segment lookup");
  return body;
}

async function addContactToSegment({ apiKey, contactId, fetcher = fetch, segmentId }) {
  const url = new URL(
    `/contacts/${encodeURIComponent(contactId)}/segments/${encodeURIComponent(segmentId)}`,
    RESEND_API_URL,
  );
  await fetchJson(fetcher, url, {
    headers: { Authorization: `Bearer ${apiKey}` },
    method: "POST",
  }, "Resend Segment add");
}

function requireEnvironment(name) {
  const value = cleanString(process.env[name]);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabaseUrl = requireEnvironment("SUPABASE_URL");
  const supabaseServiceKey = requireEnvironment("SUPABASE_SERVICE_KEY");
  const clerkSecretKey = requireEnvironment("CLERK_SECRET_KEY");
  const resendApiKey = requireEnvironment("RESEND_BROADCASTS_API_KEY");
  const internalUserHashes = parseInternalUserHashes(
    requireEnvironment("FLAIM_INTERNAL_USER_HASHES"),
  );
  const supabaseHeaders = {
    apikey: supabaseServiceKey,
    Authorization: `Bearer ${supabaseServiceKey}`,
  };

  const credentialsUrl = new URL("/rest/v1/yahoo_credentials", supabaseUrl);
  credentialsUrl.searchParams.set("select", "clerk_user_id,created_at");
  credentialsUrl.searchParams.set("order", "clerk_user_id.asc");
  const leaguesUrl = new URL("/rest/v1/yahoo_leagues", supabaseUrl);
  leaguesUrl.searchParams.set("select", "clerk_user_id,season_year");
  leaguesUrl.searchParams.set("order", "clerk_user_id.asc");

  const [credentials, leagueRows, users] = await Promise.all([
    listSupabaseRows({
      headers: supabaseHeaders,
      limit: args.supabaseLimit,
      url: credentialsUrl,
    }),
    listSupabaseRows({
      headers: supabaseHeaders,
      limit: args.supabaseLimit,
      url: leaguesUrl,
    }),
    listClerkUsers({ limit: args.clerkLimit, secretKey: clerkSecretKey }),
  ]);
  const contacts = await listResendRows({
    apiKey: resendApiKey,
    delayMs: args.delayMs,
    limit: args.resendLimit,
    path: "/contacts",
  });
  const suppressions = await listResendRows({
    apiKey: resendApiKey,
    delayMs: args.delayMs,
    limit: args.resendLimit,
    path: "/suppressions",
  });
  const { cohortIds, stats: cohortStats } = selectYahooCohort({
    credentials,
    internalUserHashes,
    leagueRows,
    outageStart: args.outageStart,
    seasonYear: args.seasonYear,
  });
  const { candidates, stats: clerkStats } = classifyClerkUsers({ cohortIds, users });
  const { eligibleContacts, stats: resendStats } = classifyResendEligibility({
    candidates,
    contacts,
    suppressions,
  });
  validateApplyGuards(args, eligibleContacts.length);

  let segmentStats = null;
  if (args.apply) {
    const segment = await getResendSegment({ apiKey: resendApiKey, segmentId: args.segmentId });
    if (cleanString(segment?.name) !== args.segmentName) {
      throw new Error("Resend Segment name did not match --segment-name");
    }

    const segmentContacts = await listResendRows({
      apiKey: resendApiKey,
      delayMs: args.delayMs,
      limit: args.resendLimit,
      path: `/segments/${encodeURIComponent(args.segmentId)}/contacts`,
    });
    const plan = planSegmentAdditions({ eligibleContacts, segmentContacts });

    for (let index = 0; index < plan.additions.length; index += 1) {
      await addContactToSegment({
        apiKey: resendApiKey,
        contactId: plan.additions[index].contactId,
        segmentId: args.segmentId,
      });
      if (args.delayMs > 0 && index < plan.additions.length - 1) await delay(args.delayMs);
    }

    const finalContacts = await listResendRows({
      apiKey: resendApiKey,
      delayMs: args.delayMs,
      limit: args.resendLimit,
      path: `/segments/${encodeURIComponent(args.segmentId)}/contacts`,
    });
    const finalPlan = planSegmentAdditions({ eligibleContacts, segmentContacts: finalContacts });
    if (finalPlan.additions.length !== 0 || finalContacts.length !== eligibleContacts.length) {
      throw new Error("Resend Segment verification did not match the eligible cohort");
    }

    segmentStats = {
      added: plan.additions.length,
      existing: plan.existingCount,
      final: finalContacts.length,
      verified: true,
    };
  }

  console.log(JSON.stringify(buildSummary({
    clerk: clerkStats,
    cohort: cohortStats,
    resend: resendStats,
    segment: segmentStats,
  }), null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
