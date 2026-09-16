#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Resend } from "resend";
import {
  getPrimaryEmail,
  listAllSuppressions,
} from "./reconcile-resend-suppressions.mjs";
import {
  fetchUserCount,
  listUsersAtCutoff,
} from "./backfill-signup-log.mjs";

const PLUNK_API_ORIGIN = "https://next-api.useplunk.com";
const DEFAULT_DELAY_MS = 75;
const DEFAULT_RETRIES = 5;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function cleanString(value) {
  const cleaned = typeof value === "string" ? value.trim() : "";
  return cleaned || null;
}

export function normalizeEmail(value) {
  const email = cleanString(value)?.toLowerCase() ?? null;
  if (!email || /\s/.test(email) || !email.includes("@")) return null;
  return email;
}

function normalizeHeader(value) {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/[ -]+/g, "_");
}

export function parseCsv(input) {
  const rows = [];
  let field = "";
  let row = [];
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }

  if (quoted) throw new Error("CSV contains an unterminated quoted field");
  row.push(field.replace(/\r$/, ""));
  if (row.some((value) => value !== "")) rows.push(row);
  return rows;
}

function parseUnsubscribed(value, rowNumber) {
  const normalized = cleanString(value)?.toLowerCase();
  if (["true", "1", "yes", "unsubscribed", "opt_out"].includes(normalized)) return true;
  if (["false", "0", "no", "subscribed", "opt_in"].includes(normalized)) return false;
  throw new Error(`Resend contact export row ${rowNumber} has an unknown unsubscribe value`);
}

export function parseResendContactsCsv(input) {
  const rows = parseCsv(input);
  if (rows.length < 2) throw new Error("Resend contact export is empty");

  const headers = rows[0].map(normalizeHeader);
  const emailIndex = headers.indexOf("email");
  const unsubscribedIndex = headers.indexOf("unsubscribed");
  const firstNameIndex = headers.indexOf("first_name");
  const lastNameIndex = headers.indexOf("last_name");
  if (emailIndex < 0 || unsubscribedIndex < 0) {
    throw new Error("Resend contact export must include email and unsubscribed columns");
  }

  const contacts = [];
  for (const [offset, row] of rows.slice(1).entries()) {
    const email = normalizeEmail(row[emailIndex]);
    if (!email) throw new Error(`Resend contact export row ${offset + 2} has an invalid email`);
    contacts.push({
      email,
      firstName: firstNameIndex >= 0 ? cleanString(row[firstNameIndex]) : null,
      lastName: lastNameIndex >= 0 ? cleanString(row[lastNameIndex]) : null,
      unsubscribed: parseUnsubscribed(row[unsubscribedIndex], offset + 2),
    });
  }
  return contacts;
}

function clerkContact(user) {
  const email = normalizeEmail(getPrimaryEmail(user));
  if (!email) return null;
  const primary = Array.isArray(user.email_addresses)
    ? user.email_addresses.find((item) => item?.id === user.primary_email_address_id) ??
      (user.email_addresses.length === 1 ? user.email_addresses[0] : null)
    : null;
  const verification = cleanString(primary?.verification?.status);
  if (verification && verification !== "verified") return null;

  return {
    clerkUserId: cleanString(user.id),
    email,
    firstName: cleanString(user.first_name),
    lastName: cleanString(user.last_name),
  };
}

function upsertSource(map, contact, source) {
  const current = map.get(contact.email) ?? {
    clerkUserId: null,
    email: contact.email,
    firstName: null,
    fromClerk: false,
    fromResend: false,
    fromSuppression: false,
    lastName: null,
    resendUnsubscribed: false,
  };
  if (source === "clerk") {
    current.fromClerk = true;
    current.clerkUserId = contact.clerkUserId ?? current.clerkUserId;
    current.firstName = contact.firstName ?? current.firstName;
    current.lastName = contact.lastName ?? current.lastName;
  } else if (source === "resend") {
    current.fromResend = true;
    current.firstName ??= contact.firstName;
    current.lastName ??= contact.lastName;
    current.resendUnsubscribed ||= contact.unsubscribed === true;
  } else {
    current.fromSuppression = true;
  }
  map.set(contact.email, current);
}

export function buildMigrationPlan({ clerkUsers, plunkContacts, resendContacts, suppressions }) {
  const candidates = new Map();
  const clerkEmails = new Set();
  const resendEmails = new Set();
  const suppressionEmails = new Set();
  const plunkFalseEmails = new Set();

  for (const user of clerkUsers) {
    const contact = clerkContact(user);
    if (!contact) continue;
    clerkEmails.add(contact.email);
    upsertSource(candidates, contact, "clerk");
  }
  for (const contact of resendContacts) {
    resendEmails.add(contact.email);
    upsertSource(candidates, contact, "resend");
  }
  for (const [index, suppression] of suppressions.entries()) {
    const email = normalizeEmail(suppression?.email);
    if (!email) {
      throw new Error(`Resend suppression record ${index + 1} has an invalid email`);
    }
    suppressionEmails.add(email);
    upsertSource(candidates, { email }, "suppression");
  }
  for (const contact of plunkContacts) {
    const email = normalizeEmail(contact?.email);
    if (email && contact?.subscribed === false) plunkFalseEmails.add(email);
  }

  const targets = [...candidates.values()]
    .map((candidate) => {
      const subscribed = !(
        candidate.resendUnsubscribed ||
        candidate.fromSuppression ||
        plunkFalseEmails.has(candidate.email)
      );
      return {
        data: {
          ...(candidate.clerkUserId ? { clerkUserId: candidate.clerkUserId } : {}),
          ...(candidate.firstName ? { firstName: candidate.firstName } : {}),
          ...(candidate.lastName ? { lastName: candidate.lastName } : {}),
          source: "flaim_marketing_migration",
        },
        email: candidate.email,
        subscribed,
      };
    })
    .sort((a, b) => Number(a.subscribed) - Number(b.subscribed) || a.email.localeCompare(b.email));

  return {
    stats: {
      clerkCurrent: clerkEmails.size,
      clerkOnlyGap: [...clerkEmails].filter((email) => !resendEmails.has(email)).length,
      existingPlunkFalseProtected: [...candidates.keys()].filter((email) => plunkFalseEmails.has(email)).length,
      plannedFalse: targets.filter((target) => !target.subscribed).length,
      plannedTrue: targets.filter((target) => target.subscribed).length,
      resendAllStatus: resendEmails.size,
      resendOnlyRetained: [...resendEmails].filter((email) => !clerkEmails.has(email)).length,
      suppressionOnly: [...suppressionEmails].filter(
        (email) => !clerkEmails.has(email) && !resendEmails.has(email),
      ).length,
      suppressions: suppressionEmails.size,
      union: targets.length,
    },
    targets,
  };
}

export async function listMigrationClerkUsers({
  clerkSecretKey,
  cutoffMs,
  fetchImpl = fetch,
  limit = 500,
}) {
  const expectedTotal = await fetchUserCount({ clerkSecretKey, cutoffMs, fetchImpl });
  const users = [];
  for await (const page of listUsersAtCutoff({
    clerkSecretKey,
    cutoffMs,
    fetchImpl,
    limit,
  })) {
    users.push(...page.users);
  }
  if (users.length !== expectedTotal) {
    throw new Error(
      `Clerk snapshot count mismatch (read ${users.length} of ${expectedTotal})`,
    );
  }
  return users;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function migrationFingerprint(targets) {
  return sha256(targets.map((target) => `${target.email}|${target.subscribed}`).join("\n"));
}

export function reconcileAppliedPlan({ plunkContacts, targets }) {
  const finalByEmail = new Map();
  for (const contact of plunkContacts) {
    const email = normalizeEmail(contact?.email);
    if (email) finalByEmail.set(email, contact);
  }

  const reconciliation = {
    concurrentFalsePreserved: 0,
    finalSubscribed: [...finalByEmail.values()].filter((contact) => contact?.subscribed === true).length,
    finalTotal: finalByEmail.size,
    finalUnsubscribed: [...finalByEmail.values()].filter((contact) => contact?.subscribed === false).length,
    missing: 0,
    plannedFalseVerified: 0,
    plannedTrueVerified: 0,
    unsafeStateMismatches: 0,
  };

  for (const target of targets) {
    const contact = finalByEmail.get(target.email);
    if (!contact) {
      reconciliation.missing += 1;
      continue;
    }
    if (!target.subscribed) {
      if (contact.subscribed === false) reconciliation.plannedFalseVerified += 1;
      else reconciliation.unsafeStateMismatches += 1;
      continue;
    }
    if (contact.subscribed === true) reconciliation.plannedTrueVerified += 1;
    else if (contact.subscribed === false) reconciliation.concurrentFalsePreserved += 1;
    else reconciliation.unsafeStateMismatches += 1;
  }

  return {
    ...reconciliation,
    safe: reconciliation.missing === 0 && reconciliation.unsafeStateMismatches === 0,
  };
}

export function reconcileCurrentClerkCoverage({ clerkUsers, plunkContacts }) {
  const clerkEmails = new Set(
    clerkUsers.map(clerkContact).filter(Boolean).map((contact) => contact.email),
  );
  const plunkEmails = new Set(
    plunkContacts.map((contact) => normalizeEmail(contact?.email)).filter(Boolean),
  );
  const missing = [...clerkEmails].filter((email) => !plunkEmails.has(email)).length;
  return { clerkCurrent: clerkEmails.size, missing, safe: missing === 0 };
}

function targetHash(target) {
  return sha256(`${target.email}|${target.subscribed}`);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function retryDelay(response, attempt) {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(seconds * 1_000, 0);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(date - Date.now(), 0);
  }
  return Math.min(1_000 * 2 ** attempt, 30_000);
}

function isIdempotencyReplay(payload) {
  return payload?.error?.code === "IDEMPOTENCY_KEY_REUSED";
}

export function createPlunkClient({
  apiKey,
  delayMs = DEFAULT_DELAY_MS,
  fetchImpl = fetch,
  maxRetries = DEFAULT_RETRIES,
  publicApiKey,
}) {
  let lastRequestAt = 0;

  async function request(path, init = {}, requestApiKey = apiKey, acceptConflict = false) {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const waitForPacing = Math.max(delayMs - (Date.now() - lastRequestAt), 0);
      if (waitForPacing) await sleep(waitForPacing);
      lastRequestAt = Date.now();

      let response;
      try {
        response = await fetchImpl(`${PLUNK_API_ORIGIN}${path}`, {
          ...init,
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${requestApiKey}`,
            ...(init.body ? { "Content-Type": "application/json" } : {}),
            ...init.headers,
          },
          signal: init.signal ?? AbortSignal.timeout(15_000),
        });
      } catch (error) {
        if (attempt < maxRetries) {
          await sleep(Math.min(1_000 * 2 ** attempt, 30_000));
          continue;
        }
        throw new Error(
          `Plunk ${init.method ?? "GET"} ${path.split("?")[0]} failed after network retries`,
          { cause: error },
        );
      }
      if (response.ok || (acceptConflict && response.status === 409)) return response;
      if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
        await sleep(retryDelay(response, attempt));
        continue;
      }
      throw new Error(`Plunk ${init.method ?? "GET"} ${path.split("?")[0]} failed (${response.status})`);
    }
    throw new Error("Plunk request exhausted retries");
  }

  async function listContacts() {
    const contacts = [];
    let cursor;
    do {
      const query = new URLSearchParams({ limit: "100" });
      if (cursor) query.set("cursor", cursor);
      const response = await request(`/contacts?${query}`);
      const body = await response.json();
      if (!Array.isArray(body?.data)) throw new Error("Plunk contact list returned an unexpected response");
      contacts.push(...body.data);
      cursor = body.hasMore === true ? cleanString(body.cursor) : null;
      if (body.hasMore === true && !cursor) throw new Error("Plunk contact list cursor was missing");
    } while (cursor);
    return contacts;
  }

  async function applyTarget(target) {
    if (!target.subscribed) {
      await request("/contacts", {
        body: JSON.stringify(target),
        method: "POST",
      });
      return { action: "upserted_false" };
    }

    if (!publicApiKey) throw new Error("PLUNK_PUBLIC_API_KEY is required for subscribed targets");
    const tracked = await request(
      "/v1/track",
      {
        body: JSON.stringify({
          data: target.data,
          email: target.email,
          event: "flaim.contact_migrated",
        }),
        headers: { "Idempotency-Key": `flaim-contact-migration/${targetHash(target)}` },
        method: "POST",
      },
      publicApiKey,
      true,
    );
    if (tracked.status === 409) {
      const body = await tracked.json().catch(() => null);
      if (!isIdempotencyReplay(body)) {
        throw new Error("Plunk POST /v1/track failed (409)");
      }
      return { action: "replayed_true" };
    }
    return { action: "tracked_true" };
  }

  return { applyTarget, listContacts };
}

async function readState(path, fingerprint) {
  try {
    const state = JSON.parse(await readFile(path, "utf8"));
    if (state.fingerprint !== fingerprint) {
      throw new Error("Migration state does not match the current source snapshot");
    }
    return {
      completed: new Set(Array.isArray(state.completed) ? state.completed : []),
      fingerprint,
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { completed: new Set(), fingerprint };
    throw error;
  }
}

async function writeState(path, state) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(
    temporary,
    `${JSON.stringify({ completed: [...state.completed].sort(), fingerprint: state.fingerprint }, null, 2)}\n`,
    { mode: 0o600 },
  );
  await rename(temporary, path);
}

export async function applyMigrationPlan({ client, stateFile, targets, onProgress = () => {} }) {
  const fingerprint = migrationFingerprint(targets);
  const state = await readState(stateFile, fingerprint);
  const counts = { applied: 0, resumed: 0 };

  for (const target of targets) {
    const hash = targetHash(target);
    if (state.completed.has(hash)) {
      counts.resumed += 1;
      continue;
    }
    await client.applyTarget(target);
    counts.applied += 1;
    state.completed.add(hash);
    await writeState(stateFile, state);
    onProgress({ ...counts, completed: state.completed.size, total: targets.length });
  }
  return counts;
}

export function parseArgs(argv) {
  const args = {
    apply: false,
    delayMs: DEFAULT_DELAY_MS,
    maxRetries: DEFAULT_RETRIES,
    resendContacts: null,
    stateFile: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--apply") args.apply = true;
    else if (arg === "--resend-contacts" && next) {
      args.resendContacts = resolve(next);
      index += 1;
    } else if (arg === "--state-file" && next) {
      args.stateFile = resolve(next);
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
  if (!args.help && !args.resendContacts) throw new Error("--resend-contacts is required");
  if (args.apply && !args.stateFile) throw new Error("--state-file is required with --apply");
  for (const [name, path] of [
    ["--resend-contacts", args.resendContacts],
    ["--state-file", args.stateFile],
  ]) {
    if (!path) continue;
    const fromRepo = relative(REPO_ROOT, path);
    if (!fromRepo.startsWith("..") && !isAbsolute(fromRepo)) {
      throw new Error(`${name} must point outside the repository`);
    }
  }
  if (!Number.isFinite(args.delayMs) || args.delayMs < 60) {
    throw new Error("--delay-ms must be at least 60 to stay below Plunk's project limit");
  }
  if (!Number.isInteger(args.maxRetries) || args.maxRetries < 0 || args.maxRetries > 10) {
    throw new Error("--max-retries must be an integer from 0 to 10");
  }
  return args;
}

function printUsage() {
  console.log(`
Dry-run-first Resend/Clerk to Plunk marketing-contact migration.

Usage:
  node scripts/migrate-marketing-contacts-to-plunk.mjs --resend-contacts /path/outside-repo/contacts.csv
  node scripts/migrate-marketing-contacts-to-plunk.mjs --resend-contacts /path/outside-repo/contacts.csv --apply --state-file /path/outside-repo/plunk-state.json

The source CSV and resumable state file contain or derive from customer data.
Keep both outside git. Dry-run is the default; --apply writes Plunk contacts.
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printUsage();

  const clerkSecretKey = process.env.CLERK_SECRET_KEY;
  const resendSuppressionsApiKey = process.env.RESEND_SUPPRESSIONS_API_KEY;
  const plunkApiKey = process.env.PLUNK_SECRET_API_KEY;
  const plunkPublicApiKey = process.env.PLUNK_PUBLIC_API_KEY;
  if (!clerkSecretKey) throw new Error("CLERK_SECRET_KEY is required");
  if (!resendSuppressionsApiKey) throw new Error("RESEND_SUPPRESSIONS_API_KEY is required");
  if (!plunkApiKey) throw new Error("PLUNK_SECRET_API_KEY is required");
  if (!plunkPublicApiKey) throw new Error("PLUNK_PUBLIC_API_KEY is required");

  const client = createPlunkClient({
    apiKey: plunkApiKey,
    delayMs: args.delayMs,
    maxRetries: args.maxRetries,
    publicApiKey: plunkPublicApiKey,
  });
  const clerkCutoffMs = Date.now();
  const [csv, clerkUsers, suppressions, plunkContacts] = await Promise.all([
    readFile(args.resendContacts, "utf8"),
    listMigrationClerkUsers({ clerkSecretKey, cutoffMs: clerkCutoffMs }),
    listAllSuppressions({
      client: new Resend(resendSuppressionsApiKey),
      limit: 100,
      maxSuppressions: Number.POSITIVE_INFINITY,
    }),
    client.listContacts(),
  ]);
  const resendContacts = parseResendContactsCsv(csv);
  const plan = buildMigrationPlan({ clerkUsers, plunkContacts, resendContacts, suppressions });
  console.log(
    JSON.stringify(
      { clerkCutoff: new Date(clerkCutoffMs).toISOString(), mode: args.apply ? "apply" : "dry-run", stats: plan.stats },
      null,
      2,
    ),
  );
  if (!args.apply) return;

  const counts = await applyMigrationPlan({
    client,
    stateFile: args.stateFile,
    targets: plan.targets,
    onProgress(progress) {
      if (progress.completed % 250 === 0 || progress.completed === progress.total) {
        console.log(JSON.stringify({ progress }));
      }
    },
  });
  const finalClerkCutoffMs = Date.now();
  const [finalContacts, finalClerkUsers] = await Promise.all([
    client.listContacts(),
    listMigrationClerkUsers({ clerkSecretKey, cutoffMs: finalClerkCutoffMs }),
  ]);
  const reconciliation = reconcileAppliedPlan({
    plunkContacts: finalContacts,
    targets: plan.targets,
  });
  const clerkCoverage = reconcileCurrentClerkCoverage({
    clerkUsers: finalClerkUsers,
    plunkContacts: finalContacts,
  });
  console.log(
    JSON.stringify(
      {
        applied: counts,
        clerkCoverage: {
          ...clerkCoverage,
          cutoff: new Date(finalClerkCutoffMs).toISOString(),
        },
        completed: reconciliation.safe && clerkCoverage.safe,
        reconciliation,
        stats: plan.stats,
      },
      null,
      2,
    ),
  );
  if (!reconciliation.safe || !clerkCoverage.safe) {
    throw new Error("Plunk migration reconciliation found missing or unsafe contact states");
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "Unknown migration error");
    process.exit(1);
  });
}
