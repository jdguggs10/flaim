import { describe, expect, it } from "vitest";

import {
  getPrimaryEmail,
  hasExplicitUnverifiedStatus,
  maskEmail,
  parseArgs,
} from "../../../scripts/backfill-resend-contacts.mjs";

describe("backfill-resend-contacts script helpers", () => {
  it("defaults to dry-run mode", () => {
    expect(parseArgs([])).toMatchObject({
      apply: false,
      delayMs: 0,
      limit: 100,
      offset: 0,
    });
  });

  it("parses write pacing options", () => {
    expect(parseArgs(["--apply", "--max-users", "5", "--delay-ms", "250"])).toMatchObject({
      apply: true,
      delayMs: 250,
      maxUsers: 5,
    });
  });

  it("masks email addresses in logs", () => {
    expect(maskEmail("gerry@example.com")).toBe("ge***@example.com");
  });

  it("uses the only Clerk email when primary id is missing", () => {
    expect(getPrimaryEmail({
      email_addresses: [{ id: "only", email_address: "Only@Example.com" }],
      primary_email_address_id: null,
    })).toBe("only@example.com");
  });

  it("does not guess when multiple Clerk emails exist without a primary id", () => {
    expect(getPrimaryEmail({
      email_addresses: [
        { id: "first", email_address: "first@example.com" },
        { id: "second", email_address: "second@example.com" },
      ],
      primary_email_address_id: null,
    })).toBeNull();
  });

  it("skips only explicit unverified statuses", () => {
    expect(hasExplicitUnverifiedStatus({ verification: { status: "unverified" } })).toBe(true);
    expect(hasExplicitUnverifiedStatus({ verification: { status: "verified" } })).toBe(false);
    expect(hasExplicitUnverifiedStatus({})).toBe(false);
  });
});
