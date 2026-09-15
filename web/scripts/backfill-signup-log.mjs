#!/usr/bin/env node

/**
 * FLA-396 backfill for `public.signup_log`.
 *
 * Walks the Clerk user list as of a frozen cutoff and calls the idempotent
 * `record_signup` RPC for every user found. Modelled on
 * `backfill-resend-contacts.mjs` for its CLI shape (dry-run default, --apply,
 * --offset, --limit, --delay-ms, --max-users) and on the private reporting
 * reader's fail-closed pagination posture (frozen cutoff, ascending order,
 * stable total_count, unique ids, no short page before the total) — ported
 * here rather than imported, because a backfill that silently under-reads is
 * wrong forever, not just for one dashboard refresh.
 *
 * Sequencing is mandatory: apply the Supabase migration, deploy the webhook
 * writer, THEN run this backfill. Because the writer's conflict clause never
 * overwrites an existing row's created_at/source and only fills a null
 * first_touch, running the backfill while the writer is already live is
 * harmless, and re-running this script after a failure is always safe.
 *
 * Run dry-run first and read the aggregate counts before ever passing
 * --apply. This script prints an aggregate report only. It must never print
 * an email address, a metadata object, a first-touch value, an attribution
 * field, a key, or any other per-user line — a backfill report that leaks
 * the data it is backfilling is worse than no report.
 *
 * Env:
 *   CLERK_SECRET_KEY     required always.
 *   SUPABASE_URL          required only with --apply.
 *   SUPABASE_SERVICE_KEY  required only with --apply.
 */

import { pathToFileURL } from "node:url";

const CLERK_USERS_URL = "https://api.clerk.com/v1/users";
const CLERK_USERS_COUNT_URL = "https://api.clerk.com/v1/users/count";
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const MIN_CREATED_AT_MS = Date.parse("2020-01-01T00:00:00.000Z");
const CLOCK_SKEW_BUFFER_MS = 24 * 60 * 60 * 1000;
const RECORD_SIGNUP_SOURCE = "backfill";

export function parseArgs(argv) {
  const args = {
    apply: false,
    cutoff: null,
    delayMs: 0,
    limit: DEFAULT_LIMIT,
    maxUsers: Number.POSITIVE_INFINITY,
    offset: 0,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--apply") {
      args.apply = true;
      continue;
    }

    if (arg === "--cutoff" && next) {
      args.cutoff = next;
      index += 1;
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

  if (args.cutoff !== null && !Number.isFinite(Date.parse(args.cutoff))) {
    throw new Error("--cutoff must be a valid ISO date");
  }

  // The frozen `created_at_before` cutoff freezes what Clerk *adds*, not what
  // it removes: a user deleted between two runs shifts every later offset up
  // by one, so a second `--apply --offset N` would step over a live account
  // that has never been written. Windowing an apply run is therefore refused
  // outright. It costs nothing to forbid: `record_signup` is idempotent, so
  // every apply run simply restarts at offset zero over the whole set. Both
  // flags stay available for dry-run inspection, where nothing is written and
  // a skipped user is only a miscount in a report.
  if (args.apply && args.offset !== 0) {
    throw new Error(
      "--offset is not allowed with --apply: deletions shift later offsets, so a windowed apply run can skip a user. Re-run --apply from the start; record_signup is idempotent."
    );
  }

  if (args.apply && args.maxUsers !== Number.POSITIVE_INFINITY) {
    throw new Error(
      "--max-users is not allowed with --apply: deletions shift later offsets, so a windowed apply run can skip a user. Re-run --apply from the start; record_signup is idempotent."
    );
  }

  return args;
}

function printUsage() {
  console.log(`
Backfill public.signup_log from the Clerk user list.

Run only after the signup_log migration is applied and the webhook writer is
deployed. Dry run first; read the report; then --apply.

Dry-run:
  node scripts/backfill-signup-log.mjs

Apply:
  node scripts/backfill-signup-log.mjs --apply

Options:
  --apply           Write rows via record_signup. Omit for dry-run.
  --cutoff <iso>     Freeze the pagination cutoff at this ISO instant.
                     Defaults to now, read once at start.
  --delay-ms <n>     Wait between record_signup calls in --apply mode. Default 0.
  --limit <n>        Clerk page size. Default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}.
  --max-users <n>    Stop after scanning this many Clerk users. Dry-run only.
  --offset <n>       Start at a Clerk list offset. Dry-run only.

--offset and --max-users are refused with --apply: a user deleted between two
runs shifts every later offset, so a windowed apply run can silently step over
an account. After an anomaly or a partial apply run, re-run --apply from the
start — record_signup is idempotent.

The run exits non-zero if anything was left undone: a pagination anomaly, an
invalid created_at, or a failed record_signup call.

The report is aggregate-only: counts, the observed created_at range, and (in
dry-run) a resume offset. It never prints an email, a metadata object, a
first-touch value, a key, or a per-user line.
`);
}

export class PaginationAnomalyError extends Error {
  constructor(message, resumeOffset) {
    super(message);
    this.name = "PaginationAnomalyError";
    this.resumeOffset = resumeOffset;
  }
}

async function fetchUsersPage({ clerkSecretKey, limit, offset, cutoffMs, fetchImpl }) {
  const url = new URL(CLERK_USERS_URL);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));
  // Frozen cutoff and ascending order: this is the fail-closed posture the
  // pager below depends on. Ascending order appends new signups at the end
  // and leaves already-read offsets stable; descending would shift every
  // already-read page whenever a new signup arrives at the front.
  url.searchParams.set("order_by", "+created_at");
  url.searchParams.set("created_at_before", String(cutoffMs));

  const response = await fetchImpl(url, {
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

  // The raw REST list endpoint returns a bare JSON array of users, not the
  // `{ data, total_count }` envelope the Backend SDK's getUserList
  // synthesizes by combining this call with a separate /users/count call.
  // Tolerate `{ data: [...] }` too, for robustness, but no longer require
  // total_count here — the count comes from fetchUserCount instead.
  const users = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : null;

  if (users === null) {
    throw new Error("Clerk user list returned an unexpected response shape");
  }

  return { users };
}

/**
 * Read the total user count as of the frozen cutoff from Clerk's separate
 * `/v1/users/count` endpoint, which accepts the same `created_at_before`
 * filter as the list endpoint. This is the only source of "total" now that
 * the list endpoint itself returns a bare array.
 */
export async function fetchUserCount({ clerkSecretKey, cutoffMs, fetchImpl }) {
  const url = new URL(CLERK_USERS_COUNT_URL);
  url.searchParams.set("created_at_before", String(cutoffMs));

  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${clerkSecretKey}`,
    },
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const message = body?.errors?.[0]?.message ?? body?.message ?? response.statusText;
    throw new Error(`Clerk user count failed: ${response.status} ${message}`);
  }

  if (!Number.isSafeInteger(body?.total_count) || body.total_count < 0) {
    throw new Error("Clerk user count returned an unexpected response shape");
  }

  return body.total_count;
}

/**
 * Read the complete Clerk user set as of a fixed cutoff, one page at a time.
 * Ported from the private reporting reader's proof-oriented pager: a frozen
 * `created_at_before` cutoff, ascending order, a stable `total_count` across
 * pages, unique ids, and no short page before the total is reached. Unlike
 * that reader, which throws and renders a section unavailable, the backfill
 * throws the same way but the caller records the anomaly and a resume offset
 * rather than treating it as fatal to the whole run — this job is idempotent
 * and safe to re-run.
 */
export async function* listUsersAtCutoff({
  clerkSecretKey,
  cutoffMs,
  fetchImpl = fetch,
  limit = DEFAULT_LIMIT,
  maxUsers = Number.POSITIVE_INFINITY,
  offset = 0,
}) {
  const seenIds = new Set();
  let currentOffset = offset;
  let scanned = 0;

  // The frozen cutoff applies to both the list and the count: read the
  // expected total once, up front, exactly as the list pages will be read.
  // fetchUserCount itself throws on a non-integer or negative total_count, so
  // there is nothing further to validate here.
  const expectedTotal = await fetchUserCount({ clerkSecretKey, cutoffMs, fetchImpl });

  while (scanned < maxUsers) {
    const pageLimit = Math.min(limit, maxUsers - scanned);
    const page = await fetchUsersPage({
      clerkSecretKey,
      cutoffMs,
      fetchImpl,
      limit: pageLimit,
      offset: currentOffset,
    });

    for (const user of page.users) {
      if (!user?.id || seenIds.has(user.id)) {
        throw new PaginationAnomalyError(
          `duplicate or missing Clerk user id at offset ${currentOffset}`,
          currentOffset,
        );
      }
      seenIds.add(user.id);
    }

    if (page.users.length > 0) {
      yield { offset: currentOffset, totalCount: expectedTotal, users: page.users };
    }

    currentOffset += page.users.length;
    scanned += page.users.length;

    if (page.users.length === 0) return;

    // Re-read the count after every page. The frozen cutoff means it should
    // never move; if it does, someone (or something) has changed the set out
    // from under this run and pagination can no longer be trusted.
    const currentTotal = await fetchUserCount({ clerkSecretKey, cutoffMs, fetchImpl });
    if (currentTotal !== expectedTotal) {
      throw new PaginationAnomalyError(
        `total_count changed mid-pagination (was ${expectedTotal}, now ${currentTotal})`,
        currentOffset,
      );
    }

    if (currentOffset < expectedTotal && page.users.length < pageLimit) {
      throw new PaginationAnomalyError(
        `short page before the reported total was reached (read ${currentOffset} of ${expectedTotal})`,
        currentOffset,
      );
    }
    if (currentOffset >= expectedTotal) return;
  }
}

export function validateCreatedAt(value, { now = Date.now() } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return null;
  }
  if (value < MIN_CREATED_AT_MS || value > now + CLOCK_SKEW_BUFFER_MS) {
    return null;
  }
  return value;
}

// Hand-kept port of the first-touch normalisers in web/lib/acquisition.ts
// (`normalizeFirstTouchAcquisition`, the validator the browser writer itself
// runs) and web/lib/server/signup-log.ts (`normalizeFirstTouch`, the server
// mapper that delegates to it). Scripts are plain .mjs and cannot import
// TypeScript, so this copy must be kept in sync with both files whenever the
// first-touch shape or its rules change. A parity test in
// web/lib/server/__tests__/ runs identical fixtures through both sides.
const FIELD_LIMITS = {
  landingPath: 200,
  referrerHost: 120,
  utmSource: 100,
  utmMedium: 100,
  utmCampaign: 120,
  utmTerm: 160,
  utmContent: 160,
  ref: 100,
};

const HOSTNAME_PATTERN = /^[^\s/:]+$/;

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

/** Mirrors `cleanValue` in web/lib/acquisition.ts. */
function cleanValue(value, limit) {
  if (!value) return undefined;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, limit);
  return cleaned || undefined;
}

/** Mirrors `boundedString` in web/lib/server/signup-log.ts. */
function boundedString(value, max) {
  if (typeof value !== "string") return undefined;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\|`[\]<>*~]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
  return cleaned || undefined;
}

/** Mirrors `normalizeFirstTouchAcquisition` in web/lib/acquisition.ts. */
export function normalizeFirstTouchAcquisition(value) {
  if (!value || typeof value !== "object") return null;
  const candidate = value;
  const landingPath =
    typeof candidate.landingPath === "string"
      ? cleanValue(candidate.landingPath, FIELD_LIMITS.landingPath)
      : undefined;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.capturedAt !== "string" ||
    Number.isNaN(Date.parse(candidate.capturedAt)) ||
    !landingPath ||
    !landingPath.startsWith("/") ||
    landingPath.includes("?") ||
    landingPath.includes("#")
  ) {
    return null;
  }

  const normalized = {
    schemaVersion: 1,
    capturedAt: new Date(candidate.capturedAt).toISOString(),
    landingPath,
  };

  for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
    if (field === "landingPath") continue;
    const fieldValue = candidate[field];
    if (fieldValue === undefined) continue;
    if (typeof fieldValue !== "string" || fieldValue.length > limit) return null;
    const cleaned = cleanValue(fieldValue, limit);
    if (!cleaned) return null;
    normalized[field] = cleaned;
  }

  return normalized;
}

/**
 * Mirrors `normalizeFirstTouch` in web/lib/server/signup-log.ts: the stored
 * row keeps no `capturedAt`, strips markup from every dimension, and requires
 * `referrerHost` to look like a bare hostname.
 */
export function normalizeFirstTouch(unsafeMetadata) {
  const outer = asRecord(unsafeMetadata);
  const acquisition = normalizeFirstTouchAcquisition(outer?.flaimAcquisition);
  if (!acquisition) return null;

  const stored = {
    schemaVersion: 1,
    landingPath: acquisition.landingPath,
  };

  for (const [field, max] of Object.entries(FIELD_LIMITS)) {
    if (field === "landingPath") continue;
    const cleaned = boundedString(acquisition[field], max);
    if (cleaned === undefined) continue;
    if (field === "referrerHost") {
      const host = cleaned.toLowerCase();
      if (!HOSTNAME_PATTERN.test(host)) continue;
      stored.referrerHost = host;
      continue;
    }
    stored[field] = cleaned;
  }

  return stored;
}

/**
 * Build the record_signup RPC request. Header contract is key-class aware:
 * a new-style secret key (`sb_secret_` prefix) is sent in `apikey` only; a
 * legacy JWT service key is sent in both `apikey` and `Authorization: Bearer`.
 */
export function buildRecordSignupRequest(supabaseUrl, supabaseServiceKey, {
  clerkUserId,
  createdAtIso,
  firstTouch,
  source = RECORD_SIGNUP_SOURCE,
}) {
  const headers = {
    Accept: "application/json",
    apikey: supabaseServiceKey,
    "Content-Type": "application/json",
    Prefer: "return=minimal",
  };

  if (!supabaseServiceKey.startsWith("sb_secret_")) {
    headers.Authorization = `Bearer ${supabaseServiceKey}`;
  }

  return {
    body: JSON.stringify({
      p_clerk_user_id: clerkUserId,
      p_created_at: createdAtIso,
      p_first_touch: firstTouch ?? null,
      p_source: source,
    }),
    headers,
    method: "POST",
    url: `${supabaseUrl}/rest/v1/rpc/record_signup`,
  };
}

async function callRecordSignup({ fetchImpl, supabaseServiceKey, supabaseUrl, ...params }) {
  const request = buildRecordSignupRequest(supabaseUrl, supabaseServiceKey, params);
  const response = await fetchImpl(request.url, {
    body: request.body,
    headers: request.headers,
    method: request.method,
  });
  return { ok: response.ok, status: response.status };
}

async function delay(ms) {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Render the aggregate-only report. `summary` never carries an email, a
 * metadata object, a first-touch value, a key, or a per-user id, so there is
 * nothing here to redact — the guarantee is structural, not a filter applied
 * at print time.
 */
export function formatReport(summary) {
  const lines = [
    "signup-log backfill report",
    `mode: ${summary.apply ? "apply" : "dry-run"}`,
    `cutoff: ${summary.cutoffIso}`,
    `scanned: ${summary.scanned}`,
    `valid: ${summary.valid}`,
    `invalid: ${summary.invalid}`,
    `duplicate: ${summary.duplicate}`,
    `skipped: ${summary.skipped}`,
    `written: ${summary.written}`,
    `earliest_created_at: ${summary.earliestCreatedAt ?? "n/a"}`,
    `latest_created_at: ${summary.latestCreatedAt ?? "n/a"}`,
    // A resume offset is only meaningful for a dry run. An apply run never
    // resumes mid-list, because a deletion between runs would shift the
    // offsets out from under it.
    summary.apply
      ? "resume: re-run --apply from the start (record_signup is idempotent)"
      : `resume_offset: ${summary.resumeOffset}`,
    `anomaly: ${summary.anomaly ?? "none"}`,
  ];

  const failureEntries = Object.entries(summary.failuresByStatus ?? {});
  if (failureEntries.length === 0) {
    lines.push("failures_by_status: none");
  } else {
    for (const [status, count] of failureEntries) {
      lines.push(`failures_by_status[${status}]: ${count}`);
    }
  }

  const reasons = failureReasons(summary);
  lines.push(
    reasons.length === 0
      ? "status: complete"
      : `status: incomplete (${reasons.join(", ")})`
  );

  return lines.join("\n");
}

/**
 * Why the run must exit non-zero. An invalid `created_at` is not a cosmetic
 * counter: that user has no row and never will unless someone notices, so a
 * run that saw one is incomplete in both dry-run and apply mode.
 */
export function failureReasons(summary) {
  const reasons = [];
  if (summary.anomaly) reasons.push("pagination anomaly");
  if (summary.invalid > 0) reasons.push(`${summary.invalid} invalid created_at`);
  const failedCalls = Object.values(summary.failuresByStatus ?? {}).reduce(
    (total, count) => total + count,
    0
  );
  if (failedCalls > 0) reasons.push(`${failedCalls} failed record_signup calls`);
  return reasons;
}

/**
 * The whole job, with its I/O injected so tests can drive it end to end.
 * Returns the process exit code: zero only when every scanned user was
 * accounted for. Configuration problems (missing env, refused flags) throw.
 */
export async function run(argv, { env = process.env, fetchImpl = fetch, log = console.log } = {}) {
  const args = parseArgs(argv);
  const clerkSecretKey = env.CLERK_SECRET_KEY;

  if (!clerkSecretKey) {
    throw new Error("CLERK_SECRET_KEY is required");
  }

  let supabaseUrl = null;
  let supabaseServiceKey = null;

  if (args.apply) {
    supabaseUrl = env.SUPABASE_URL?.trim().replace(/\/+$/, "") ?? "";
    supabaseServiceKey = env.SUPABASE_SERVICE_KEY?.trim() ?? "";
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required with --apply");
    }
  }

  // Frozen once, at the start of the run, and never re-read for the
  // remainder of pagination — that is what "frozen cutoff" means.
  const cutoffMs = args.cutoff !== null ? Date.parse(args.cutoff) : Date.now();

  const stats = {
    duplicate: 0,
    earliestCreatedAt: null,
    failuresByStatus: {},
    invalid: 0,
    latestCreatedAt: null,
    scanned: 0,
    skipped: 0,
    valid: 0,
    written: 0,
  };

  let resumeOffset = args.offset;
  let anomaly = null;

  try {
    for await (const page of listUsersAtCutoff({
      clerkSecretKey,
      cutoffMs,
      fetchImpl,
      limit: args.limit,
      maxUsers: args.maxUsers,
      offset: args.offset,
    })) {
      for (const user of page.users) {
        stats.scanned += 1;

        const createdAtMs = validateCreatedAt(user.created_at);
        if (createdAtMs === null) {
          stats.invalid += 1;
          continue;
        }

        stats.valid += 1;
        if (stats.earliestCreatedAt === null || createdAtMs < stats.earliestCreatedAt) {
          stats.earliestCreatedAt = createdAtMs;
        }
        if (stats.latestCreatedAt === null || createdAtMs > stats.latestCreatedAt) {
          stats.latestCreatedAt = createdAtMs;
        }

        // Unusable attribution is counted, never a reason to skip the user:
        // the signup itself is the fact worth keeping, so the row is still
        // written with a null first_touch.
        const firstTouch = normalizeFirstTouch(user.unsafe_metadata);
        if (user.unsafe_metadata && firstTouch === null) {
          stats.skipped += 1;
        }

        if (args.apply) {
          const result = await callRecordSignup({
            clerkUserId: user.id,
            createdAtIso: new Date(createdAtMs).toISOString(),
            fetchImpl,
            firstTouch,
            supabaseServiceKey,
            supabaseUrl,
          });

          if (result.ok) {
            stats.written += 1;
          } else {
            stats.failuresByStatus[result.status] = (stats.failuresByStatus[result.status] ?? 0) + 1;
          }

          await delay(args.delayMs);
        }
      }

      resumeOffset = page.offset + page.users.length;
    }
  } catch (error) {
    if (error instanceof PaginationAnomalyError) {
      anomaly = error.message;
      resumeOffset = error.resumeOffset;
    } else {
      throw error;
    }
  }

  const summary = {
    anomaly,
    apply: args.apply,
    cutoffIso: new Date(cutoffMs).toISOString(),
    duplicate: anomaly && /duplicate/i.test(anomaly) ? 1 : 0,
    earliestCreatedAt: stats.earliestCreatedAt === null ? null : new Date(stats.earliestCreatedAt).toISOString(),
    failuresByStatus: stats.failuresByStatus,
    invalid: stats.invalid,
    latestCreatedAt: stats.latestCreatedAt === null ? null : new Date(stats.latestCreatedAt).toISOString(),
    resumeOffset,
    scanned: stats.scanned,
    skipped: stats.skipped,
    valid: stats.valid,
    written: stats.written,
  };

  log(formatReport(summary));

  return failureReasons(summary).length > 0 ? 1 : 0;
}

async function main() {
  process.exitCode = await run(process.argv.slice(2));
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;

if (entryUrl && import.meta.url === entryUrl) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
