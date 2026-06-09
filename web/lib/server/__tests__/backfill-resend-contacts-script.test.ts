import { describe, expect, it, vi } from "vitest";

import {
  getPrimaryEmail,
  hasExplicitUnverifiedStatus,
  maskEmail,
  parseArgs,
  syncContact,
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

  it("creates missing contacts with the configured segment", async () => {
    const update = vi.fn(async () => ({
      data: null,
      error: { message: "not found", name: "not_found", statusCode: 404 },
    }));
    const create = vi.fn(async () => ({ data: { id: "contact_123" }, error: null }));
    const resend = {
      contacts: {
        create,
        segments: { add: async () => ({ data: { id: "segment_123" }, error: null }) },
        update,
      },
    };

    const result = await syncContact({
      resend,
      segmentId: "segment_123",
      user: {
        email_addresses: [{ id: "primary", email_address: "Gerry@Example.com" }],
        first_name: " Gerry ",
        last_name: " Gugger ",
        primary_email_address_id: "primary",
      },
    });

    expect(result).toEqual({
      action: "created",
      email: "gerry@example.com",
      ok: true,
    });
    expect(update).toHaveBeenCalledWith({
      email: "gerry@example.com",
      firstName: "Gerry",
      lastName: "Gugger",
    });
    expect(create).toHaveBeenCalledWith({
      email: "gerry@example.com",
      firstName: "Gerry",
      lastName: "Gugger",
      segments: [{ id: "segment_123" }],
      unsubscribed: false,
    });
  });

  it("does not create after a non-404 update failure", async () => {
    const create = vi.fn(async () => ({ data: { id: "contact_123" }, error: null }));
    const resend = {
      contacts: {
        create,
        segments: { add: async () => ({ data: { id: "segment_123" }, error: null }) },
        update: async () => ({
          data: null,
          error: { message: "rate limited", statusCode: 429 },
        }),
      },
    };

    const result = await syncContact({
      resend,
      segmentId: "segment_123",
      user: {
        email_addresses: [{ id: "primary", email_address: "Gerry@Example.com" }],
        primary_email_address_id: "primary",
      },
    });

    expect(result).toEqual({
      email: "gerry@example.com",
      error: "rate limited",
      ok: false,
    });
    expect(create).not.toHaveBeenCalled();
  });
});
