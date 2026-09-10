import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  acquireRecoveryLock,
  deriveRecoveryPlan,
  formatReport,
  listEmailsThroughIncident,
  parseArgs,
  parseFailureManifest,
  sendRecoveryEvents,
} from "../../../scripts/recover-resend-welcome-quota.mjs";

const AFTER = Date.parse("2026-09-06T22:10:00Z");
const BEFORE = Date.parse("2026-09-07T00:41:00Z");

function clerkUser(email: string, overrides = {}) {
  return {
    email_addresses: [{ email_address: email, id: "primary", verification: { status: "verified" } }],
    id: `user_${email}`,
    primary_email_address_id: "primary",
    ...overrides,
  };
}

function contact(email: string, overrides = {}) {
  return { email, id: `contact_${email}`, unsubscribed: false, ...overrides };
}

function welcome(email: string, createdAt: string, lastEvent: string) {
  return {
    created_at: createdAt,
    from: "Flaim <updates@flaim.app>",
    id: `${lastEvent}_${email}_${createdAt}`,
    last_event: lastEvent,
    subject: "Welcome to Flaim",
    to: [email],
  };
}

function failureEvent(record: ReturnType<typeof welcome>, reason = "reached_monthly_quota") {
  return {
    created_at: record.created_at,
    data: {
      created_at: record.created_at,
      email_id: record.id,
      failed: { reason },
      from: record.from,
      subject: record.subject,
      to: record.to,
    },
    type: "email.failed",
  };
}

describe("recover-resend-welcome-quota script", () => {
  it("requires explicit incident bounds and a reviewed hash for apply mode", () => {
    expect(() => parseArgs([])).toThrow("--incident-after is required");
    expect(() => parseArgs([
      "--incident-after", "2026-09-06T22:10:00Z",
      "--incident-before", "2026-09-07T00:41:00Z",
      "--expected-failed", "109",
      "--failure-manifest", "/tmp/failures.json",
      "--expected-failure-reason", "reached_monthly_quota",
      "--apply",
    ])).toThrow("--apply requires --expected-cohort-hash");

    expect(() => parseArgs([
      "--incident-after", "2026-09-06T22:10:00Z",
      "--incident-before", "2026-09-07T00:41:00Z",
      "--expected-failed", "109",
      "--failure-manifest", "/tmp/failures.json",
      "--expected-failure-reason", "reached_monthly_quota",
      "--expected-cohort-hash", "hash",
      "--ledger", "/tmp/ledger.jsonl",
      "--max-send", "2",
      "--apply",
    ])).toThrow("requires --verified-canary-hash");

    expect(() => parseArgs([
      "--incident-after", "2026-09-06T22:10:00Z",
      "--incident-before", "2026-09-07T00:41:00Z",
      "--expected-failed", "109",
      "--failure-manifest", "/tmp/failures.json",
      "--expected-failure-reason", "reached_monthly_quota",
      "--delay-ms", "0",
    ])).toThrow("at least 125");
  });

  it("pages backward until it crosses the incident boundary", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          data: [
            welcome("new@example.com", "2026-09-07T00:00:00Z", "failed"),
            welcome("cursor@example.com", "2026-09-06T23:00:00Z", "failed"),
          ],
          has_more: true,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          data: [welcome("old@example.com", "2026-09-06T21:00:00Z", "delivered")],
          has_more: true,
        },
        error: null,
      });

    const emails = await listEmailsThroughIncident({
      afterMs: AFTER,
      client: { emails: { list } },
      delayMs: 0,
      limit: 2,
    });

    expect(emails).toHaveLength(3);
    expect(list).toHaveBeenNthCalledWith(1, { limit: 2 });
    expect(list).toHaveBeenNthCalledWith(2, {
      after: "failed_cursor@example.com_2026-09-06T23:00:00Z",
      limit: 2,
    });
  });

  it("selects only current eligible users and reports masked recipients", () => {
    const emails = [
      welcome("eligible@example.com", "2026-09-06T23:00:00Z", "failed"),
      welcome("later@example.com", "2026-09-06T23:01:00Z", "failed"),
      welcome("later@example.com", "2026-09-07T00:45:00Z", "delivered"),
      welcome("suppressed@example.com", "2026-09-06T23:02:00Z", "failed"),
      welcome("unsubscribed@example.com", "2026-09-06T23:03:00Z", "failed"),
    ];
    const failureEvents = parseFailureManifest(
      emails.filter((email) => email.last_event === "failed").map((email) => failureEvent(email)),
      {
        afterMs: AFTER,
        beforeMs: BEFORE,
        expectedFailed: 4,
        expectedFailureReason: "reached_monthly_quota",
      },
    );
    const clerkUsers = [
      clerkUser("eligible@example.com"),
      clerkUser("later@example.com"),
      clerkUser("suppressed@example.com"),
      clerkUser("unsubscribed@example.com"),
    ];
    const contacts = [
      contact("eligible@example.com"),
      contact("later@example.com"),
      contact("suppressed@example.com"),
      contact("unsubscribed@example.com", { unsubscribed: true }),
    ];

    const plan = deriveRecoveryPlan({
      afterMs: AFTER,
      beforeMs: BEFORE,
      clerkUsers,
      contacts,
      emails,
      failureEvents,
      suppressions: [{ email: "suppressed@example.com" }],
    });
    const report = formatReport({ plan, scannedEmails: emails.length });

    expect(plan.eligible.map((entry) => entry.email)).toEqual(["eligible@example.com"]);
    expect(report).toMatchObject({
      eligible: { count: 1, recipients: ["el******@example.com"] },
      excluded: {
        laterWelcomeAttempt: 1,
        suppressed: 1,
        unsubscribed: 1,
      },
      source: { failedWelcomeRecords: 4, uniqueFailedRecipients: 4 },
    });
    expect(JSON.stringify(report)).not.toContain("eligible@example.com");
  });

  it("requires source-proven quota events and reconciles them to sent-email records", () => {
    const record = welcome("fan@example.com", "2026-09-06T23:00:00Z", "failed");
    expect(() => parseFailureManifest([failureEvent(record, "invalid_recipient")], {
      afterMs: AFTER,
      beforeMs: BEFORE,
      expectedFailed: 1,
      expectedFailureReason: "reached_monthly_quota",
    })).toThrow("has reason invalid_recipient");

    const failures = parseFailureManifest([failureEvent(record)], {
      afterMs: AFTER,
      beforeMs: BEFORE,
      expectedFailed: 1,
      expectedFailureReason: "reached_monthly_quota",
    });
    expect(() => deriveRecoveryPlan({
      afterMs: AFTER,
      beforeMs: BEFORE,
      clerkUsers: [clerkUser("fan@example.com")],
      contacts: [contact("fan@example.com")],
      emails: [],
      failureEvents: failures,
      suppressions: [],
    })).toThrow("did not reconcile to a failed sent-email record");
  });

  it("keeps a ledgered recovery recipient in the original cohort after its canary email appears", () => {
    const failed = welcome("canary@example.com", "2026-09-06T23:00:00Z", "failed");
    const failureEvents = parseFailureManifest([failureEvent(failed)], {
      afterMs: AFTER,
      beforeMs: BEFORE,
      expectedFailed: 1,
      expectedFailureReason: "reached_monthly_quota",
    });
    const inputs = {
      afterMs: AFTER,
      beforeMs: BEFORE,
      clerkUsers: [clerkUser("canary@example.com")],
      contacts: [contact("canary@example.com")],
      failureEvents,
      suppressions: [],
    };
    const initial = deriveRecoveryPlan({ ...inputs, emails: [failed] });
    const canaryHash = initial.eligible[0].recipientHash;
    const resumed = deriveRecoveryPlan({
      ...inputs,
      emails: [
        welcome("canary@example.com", "2026-09-07T00:45:00Z", "delivered"),
        failed,
      ],
      recoveryAttemptRecipientHashes: new Set([canaryHash]),
    });

    expect(resumed.cohortHash).toBe(initial.cohortHash);
    expect(resumed.eligible.map((entry) => entry.email)).toEqual(["canary@example.com"]);
    expect(resumed.exclusions.laterWelcomeAttempt).toHaveLength(0);
  });

  it("sends sequential recovery events and stops without retrying an ambiguous result", async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce({ data: { event: "flaim.user_created" }, error: null })
      .mockRejectedValueOnce(new Error("connection reset"));
    const cohort = [
      { clerkUserId: "user_1", email: "first@example.com", recipientHash: "hash_1" },
      { clerkUserId: "user_2", email: "second@example.com", recipientHash: "hash_2" },
      { clerkUserId: "user_3", email: "third@example.com", recipientHash: "hash_3" },
    ];
    const directory = await mkdtemp(join(tmpdir(), "flaim-welcome-recovery-"));
    const ledgerPath = join(directory, "ledger.jsonl");

    await expect(sendRecoveryEvents({
      client: { events: { send } },
      cohort,
      cohortHash: "cohort_hash",
      delayMs: 0,
      ledgerPath,
      maxSend: 3,
      source: "quota-recovery-2026-09-06",
    })).rejects.toThrow("stopped without retry");

    expect(send).toHaveBeenCalledTimes(2);
    const ledger = await readFile(ledgerPath, "utf8");
    expect(ledger).toContain('"recipientHash":"hash_1","status":"accepted"');
    expect(ledger).toContain('"recipientHash":"hash_2","status":"attempting"');
    expect(send).toHaveBeenNthCalledWith(1, {
      email: "first@example.com",
      event: "flaim.user_created",
      payload: {
        clerk_user_id: "user_1",
        source: "quota-recovery-2026-09-06",
      },
    });
  });

  it("leaves a data-less Resend response attempting so it cannot be retried", async () => {
    const send = vi.fn().mockResolvedValue({ data: null, error: null });
    const directory = await mkdtemp(join(tmpdir(), "flaim-welcome-recovery-"));
    const ledgerPath = join(directory, "ledger.jsonl");

    await expect(sendRecoveryEvents({
      client: { events: { send } },
      cohort: [{ clerkUserId: "user_1", email: "first@example.com", recipientHash: "hash_1" }],
      cohortHash: "cohort_hash",
      delayMs: 0,
      ledgerPath,
      maxSend: 1,
      source: "quota-recovery-2026-09-06",
    })).rejects.toThrow("response contained neither data nor an error");

    const ledger = await readFile(ledgerPath, "utf8");
    expect(ledger).toContain('"recipientHash":"hash_1","status":"attempting"');
    expect(ledger).not.toContain('"status":"rejected"');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("allows only one recovery process to hold a ledger lock", async () => {
    const directory = await mkdtemp(join(tmpdir(), "flaim-welcome-recovery-"));
    const ledgerPath = join(directory, "ledger.jsonl");
    const release = await acquireRecoveryLock(ledgerPath);

    await expect(acquireRecoveryLock(ledgerPath)).rejects.toThrow("Recovery lock already exists");
    await release();

    const releaseAgain = await acquireRecoveryLock(ledgerPath);
    await releaseAgain();
  });
});
