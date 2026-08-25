import { describe, expect, it, vi } from "vitest";

import {
  getPrimaryEmail,
  getEmailRetryMarkers,
  hasExplicitUnverifiedStatus,
  maskEmail,
  parseArgs,
  retryFlaggedUser,
  resolveResendEventsApiKey,
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

  it("parses the flagged-only recovery mode without enabling writes", () => {
    expect(parseArgs(["--flagged-only"])).toMatchObject({
      apply: false,
      flaggedOnly: true,
    });
  });

  it("falls back to the contacts key when the optional events key is blank", () => {
    expect(resolveResendEventsApiKey(" ", "contacts-key")).toBe("contacts-key");
  });

  it("finds only the explicit retry markers in Clerk private metadata", () => {
    expect(getEmailRetryMarkers({
      private_metadata: {
        flaim_email_ops: {
          contactSync: { failedAt: "2026-08-24T12:00:00.000Z" },
          unrelated: { preserved: true },
        },
      },
    })).toEqual({ contactSync: true, welcomeEvent: false });
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

  it("clears the matching contact-sync marker only after a successful retry", async () => {
    const clearMarker = vi.fn(async () => ({ ok: true }));
    const contacts = {
      contacts: {
        create: vi.fn(),
        segments: { add: vi.fn() },
        update: vi.fn(async () => ({ data: { id: "contact_123" }, error: null })),
      },
    };

    const results = await retryFlaggedUser({
      clearMarker,
      clerkSecretKey: "sk_test",
      resendContacts: contacts,
      resendEvents: null,
      segmentId: null,
      user: {
        email_addresses: [{ id: "primary", email_address: "fan@example.com" }],
        id: "user_123",
        primary_email_address_id: "primary",
        private_metadata: {
          flaim_email_ops: {
            contactSync: { failedAt: "2026-08-24T12:00:00.000Z" },
            welcomeEvent: { failedAt: "2026-08-24T12:01:00.000Z" },
          },
        },
      },
    });

    expect(results).toEqual([
      { kind: "contactSync", ok: true },
      {
        error: "RESEND_EVENTS_API_KEY or RESEND_CONTACTS_API_KEY is required",
        kind: "welcomeEvent",
        ok: false,
      },
    ]);
    expect(clearMarker).toHaveBeenCalledTimes(1);
    expect(clearMarker).toHaveBeenCalledWith({
      clerkSecretKey: "sk_test",
      kind: "contactSync",
      userId: "user_123",
    });
  });

  it("replays a flagged welcome event only through the apply helper and clears it on success", async () => {
    const clearMarker = vi.fn(async () => ({ ok: true }));
    const send = vi.fn(async () => ({
      data: { event: "flaim.user_created", object: "event" },
      error: null,
    }));

    const results = await retryFlaggedUser({
      clearMarker,
      clerkSecretKey: "sk_test",
      resendContacts: null,
      resendEvents: { events: { send } },
      segmentId: null,
      user: {
        email_addresses: [{ id: "primary", email_address: "fan@example.com" }],
        first_name: "Fan",
        id: "user_123",
        primary_email_address_id: "primary",
        private_metadata: {
          flaim_email_ops: {
            welcomeEvent: { failedAt: "2026-08-24T12:01:00.000Z" },
          },
        },
      },
    });

    expect(results).toEqual([{ kind: "welcomeEvent", ok: true }]);
    expect(send).toHaveBeenCalledWith({
      email: "fan@example.com",
      event: "flaim.user_created",
      payload: {
        clerk_user_id: "user_123",
        given_name: "Fan",
        source: "backfill-resend-contacts.flagged-only",
      },
    });
    expect(clearMarker).toHaveBeenCalledWith({
      clerkSecretKey: "sk_test",
      kind: "welcomeEvent",
      userId: "user_123",
    });
  });

  it("retains a welcome marker when the replay is rejected", async () => {
    const clearMarker = vi.fn(async () => ({ ok: true }));

    const results = await retryFlaggedUser({
      clearMarker,
      clerkSecretKey: "sk_test",
      resendContacts: null,
      resendEvents: {
        events: {
          send: vi.fn(async () => ({ data: null, error: { message: "event rejected" } })),
        },
      },
      segmentId: null,
      user: {
        email_addresses: [{ id: "primary", email_address: "fan@example.com" }],
        id: "user_123",
        primary_email_address_id: "primary",
        private_metadata: {
          flaim_email_ops: {
            welcomeEvent: { failedAt: "2026-08-24T12:01:00.000Z" },
          },
        },
      },
    });

    expect(results).toEqual([{ error: "event rejected", kind: "welcomeEvent", ok: false }]);
    expect(clearMarker).not.toHaveBeenCalled();
  });

  it("retains a rejected contact retry while continuing to the next marked operation", async () => {
    const clearMarker = vi.fn(async () => ({ ok: true }));
    const send = vi.fn(async () => ({
      data: { event: "flaim.user_created", object: "event" },
      error: null,
    }));

    const results = await retryFlaggedUser({
      clearMarker,
      clerkSecretKey: "sk_test",
      resendContacts: {
        contacts: {
          create: vi.fn(),
          segments: { add: vi.fn() },
          update: vi.fn(async () => {
            throw new Error("contact network failed");
          }),
        },
      },
      resendEvents: { events: { send } },
      segmentId: null,
      user: {
        email_addresses: [{ id: "primary", email_address: "fan@example.com" }],
        id: "user_123",
        primary_email_address_id: "primary",
        private_metadata: {
          flaim_email_ops: {
            contactSync: { failedAt: "2026-08-24T12:00:00.000Z" },
            welcomeEvent: { failedAt: "2026-08-24T12:01:00.000Z" },
          },
        },
      },
    });

    expect(results).toEqual([
      { error: "contact network failed", kind: "contactSync", ok: false },
      { kind: "welcomeEvent", ok: true },
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(clearMarker).toHaveBeenCalledTimes(1);
    expect(clearMarker).toHaveBeenCalledWith({
      clerkSecretKey: "sk_test",
      kind: "welcomeEvent",
      userId: "user_123",
    });
  });

  it("retains a contact marker when its Clerk clear rejects and continues to the welcome marker", async () => {
    const clearMarker = vi
      .fn()
      .mockRejectedValueOnce(new Error("Clerk contact clear failed"))
      .mockResolvedValueOnce({ ok: true });
    const send = vi.fn(async () => ({
      data: { event: "flaim.user_created", object: "event" },
      error: null,
    }));

    const results = await retryFlaggedUser({
      clearMarker,
      clerkSecretKey: "sk_test",
      resendContacts: {
        contacts: {
          create: vi.fn(),
          segments: { add: vi.fn() },
          update: vi.fn(async () => ({ data: { id: "contact_123" }, error: null })),
        },
      },
      resendEvents: { events: { send } },
      segmentId: null,
      user: {
        email_addresses: [{ id: "primary", email_address: "fan@example.com" }],
        id: "user_123",
        primary_email_address_id: "primary",
        private_metadata: {
          flaim_email_ops: {
            contactSync: { failedAt: "2026-08-24T12:00:00.000Z" },
            welcomeEvent: { failedAt: "2026-08-24T12:01:00.000Z" },
          },
        },
      },
    });

    expect(results).toEqual([
      { error: "Clerk contact clear failed", kind: "contactSync", ok: false },
      { kind: "welcomeEvent", ok: true },
    ]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(clearMarker).toHaveBeenCalledTimes(2);
  });

  it("retains a welcome marker when its Clerk clear rejects without aborting the sweep caller", async () => {
    const clearMarker = vi.fn().mockRejectedValueOnce(new Error("Clerk welcome clear failed"));
    const send = vi.fn(async () => ({
      data: { event: "flaim.user_created", object: "event" },
      error: null,
    }));
    const user = {
      email_addresses: [{ id: "primary", email_address: "fan@example.com" }],
      id: "user_123",
      primary_email_address_id: "primary",
      private_metadata: {
        flaim_email_ops: {
          welcomeEvent: { failedAt: "2026-08-24T12:01:00.000Z" },
        },
      },
    };

    await expect(retryFlaggedUser({
      clearMarker,
      clerkSecretKey: "sk_test",
      resendContacts: null,
      resendEvents: { events: { send } },
      segmentId: null,
      user,
    })).resolves.toEqual([
      { error: "Clerk welcome clear failed", kind: "welcomeEvent", ok: false },
    ]);

    // The helper resolves instead of throwing, so the outer user loop can run
    // another marked user after this retained marker.
    const nextClearMarker = vi.fn(async () => ({ ok: true }));
    await expect(retryFlaggedUser({
      clearMarker: nextClearMarker,
      clerkSecretKey: "sk_test",
      resendContacts: null,
      resendEvents: { events: { send } },
      segmentId: null,
      user: { ...user, id: "user_456" },
    })).resolves.toEqual([{ kind: "welcomeEvent", ok: true }]);
    expect(nextClearMarker).toHaveBeenCalledWith({
      clerkSecretKey: "sk_test",
      kind: "welcomeEvent",
      userId: "user_456",
    });
  });
});
