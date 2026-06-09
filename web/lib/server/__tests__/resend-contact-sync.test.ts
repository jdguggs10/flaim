import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  getClerkUserPrimaryEmail,
  syncClerkUserToResendContact,
  type ClerkUserEmailSyncPayload,
} from "../resend-contact-sync";

const clerkUser: ClerkUserEmailSyncPayload = {
  email_addresses: [
    { id: "secondary", email_address: "secondary@example.com" },
    {
      id: "primary",
      email_address: "Gerry@Example.com",
      verification: { status: "verified" },
    },
  ],
  first_name: "Gerry",
  id: "user_123",
  last_name: "Gugger",
  primary_email_address_id: "primary",
};

function makeClient(existing: boolean) {
  const create = vi.fn(async () => ({
    data: { id: "contact_123" },
    error: null,
  }));

  const update = vi.fn(async () => {
    if (existing) {
      return { data: { id: "contact_123" }, error: null };
    }

    return {
      data: null,
      error: { message: "not found", name: "not_found", statusCode: 404 },
    };
  });

  const add = vi.fn(async () => ({
    data: { id: "segment_123" },
    error: null,
  }));

  return {
    client: {
      contacts: {
        create,
        segments: { add },
        update,
      },
    },
    create,
    segmentAdd: add,
    update,
  };
}

describe("getClerkUserPrimaryEmail", () => {
  it("returns the primary Clerk email normalized to lowercase", () => {
    expect(getClerkUserPrimaryEmail(clerkUser)).toBe("gerry@example.com");
  });

  it("uses the only email address when Clerk has no primary id", () => {
    expect(getClerkUserPrimaryEmail({
      ...clerkUser,
      email_addresses: [{ id: "only", email_address: "Only@Example.com" }],
      primary_email_address_id: null,
    })).toBe("only@example.com");
  });

  it("does not guess an email address when Clerk has multiple addresses and no primary id", () => {
    expect(getClerkUserPrimaryEmail({
      ...clerkUser,
      primary_email_address_id: null,
    })).toBeNull();
  });
});

describe("syncClerkUserToResendContact", () => {
  it("skips when contact sync is disabled", async () => {
    const { client, update } = makeClient(false);

    const result = await syncClerkUserToResendContact(clerkUser, {
      client,
      enabled: false,
    });

    expect(result).toEqual({
      ok: false,
      skipped: true,
      error: "Resend contact sync is disabled",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("reports missing contact API configuration when enabled without a client", async () => {
    const result = await syncClerkUserToResendContact(clerkUser, {
      enabled: true,
    });

    expect(result).toEqual({
      ok: false,
      error: "RESEND_CONTACTS_API_KEY is not configured",
    });
  });

  it("creates a Resend contact after update reports it missing", async () => {
    const { client, create, update } = makeClient(false);

    const result = await syncClerkUserToResendContact(clerkUser, {
      client,
      enabled: true,
      segmentId: "segment_123",
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

  it("updates an existing Resend contact without passing unsubscribed", async () => {
    const { client, segmentAdd, update } = makeClient(true);

    const result = await syncClerkUserToResendContact(clerkUser, {
      client,
      enabled: true,
      segmentId: "segment_123",
    });

    expect(result).toEqual({
      action: "updated",
      email: "gerry@example.com",
      ok: true,
    });
    expect(update).toHaveBeenCalledWith({
      email: "gerry@example.com",
      firstName: "Gerry",
      lastName: "Gugger",
    });
    expect(segmentAdd).toHaveBeenCalledWith({
      email: "gerry@example.com",
      segmentId: "segment_123",
    });
  });

  it("omits blank names when updating an existing Resend contact", async () => {
    const { client, update } = makeClient(true);

    await syncClerkUserToResendContact(
      {
        ...clerkUser,
        first_name: null,
        last_name: " ",
      },
      {
        client,
        enabled: true,
      },
    );

    expect(update).toHaveBeenCalledWith({
      email: "gerry@example.com",
      firstName: undefined,
      lastName: undefined,
    });
  });

  it("skips explicitly unverified Clerk primary emails", async () => {
    const { client, update } = makeClient(false);

    const result = await syncClerkUserToResendContact(
      {
        ...clerkUser,
        email_addresses: [
          {
            id: "primary",
            email_address: "unverified@example.com",
            verification: { status: "unverified" },
          },
        ],
      },
      {
        client,
        enabled: true,
      },
    );

    expect(result).toEqual({
      ok: false,
      skipped: true,
      error: "Clerk user primary email is not verified",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("syncs users when Clerk omits email verification status", async () => {
    const { client, create } = makeClient(false);

    const result = await syncClerkUserToResendContact(
      {
        ...clerkUser,
        email_addresses: [
          {
            id: "primary",
            email_address: "oauth@example.com",
          },
        ],
        primary_email_address_id: "primary",
      },
      {
        client,
        enabled: true,
      },
    );

    expect(result).toEqual({
      action: "created",
      email: "oauth@example.com",
      ok: true,
    });
    expect(create).toHaveBeenCalledWith({
      email: "oauth@example.com",
      firstName: "Gerry",
      lastName: "Gugger",
      unsubscribed: false,
    });
  });
});
