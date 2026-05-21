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
  const get = vi.fn(async () => {
    if (existing) {
      return { data: { id: "contact_123" }, error: null };
    }

    return {
      data: null,
      error: { message: "not found", name: "not_found", statusCode: 404 },
    };
  });

  const create = vi.fn(async () => ({
    data: { id: "contact_123" },
    error: null,
  }));

  const update = vi.fn(async () => ({
    data: { id: "contact_123" },
    error: null,
  }));

  const add = vi.fn(async () => ({
    data: { id: "segment_123" },
    error: null,
  }));

  return {
    client: {
      contacts: {
        create,
        get,
        segments: { add },
        update,
      },
    },
    create,
    get,
    segmentAdd: add,
    update,
  };
}

describe("getClerkUserPrimaryEmail", () => {
  it("returns the primary Clerk email normalized to lowercase", () => {
    expect(getClerkUserPrimaryEmail(clerkUser)).toBe("gerry@example.com");
  });

  it("falls back to the first email address when Clerk has no primary id", () => {
    expect(getClerkUserPrimaryEmail({
      ...clerkUser,
      primary_email_address_id: null,
    })).toBe("secondary@example.com");
  });
});

describe("syncClerkUserToResendContact", () => {
  it("skips when contact sync is disabled", async () => {
    const { client, get } = makeClient(false);

    const result = await syncClerkUserToResendContact(clerkUser, "user.created", {
      client,
      enabled: false,
    });

    expect(result).toEqual({
      ok: false,
      skipped: true,
      error: "Resend contact sync is disabled",
    });
    expect(get).not.toHaveBeenCalled();
  });

  it("reports missing contact API configuration when enabled without a client", async () => {
    const result = await syncClerkUserToResendContact(clerkUser, "user.created", {
      enabled: true,
    });

    expect(result).toEqual({
      ok: false,
      error: "RESEND_CONTACTS_API_KEY or RESEND_API_KEY is not configured",
    });
  });

  it("creates a Resend contact without changing future unsubscribe state", async () => {
    const { client, create } = makeClient(false);

    const result = await syncClerkUserToResendContact(clerkUser, "user.created", {
      client,
      enabled: true,
      segmentId: "segment_123",
    });

    expect(result).toEqual({
      action: "created",
      email: "gerry@example.com",
      ok: true,
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

    const result = await syncClerkUserToResendContact(clerkUser, "user.updated", {
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

    await syncClerkUserToResendContact({
      ...clerkUser,
      first_name: null,
      last_name: " ",
    }, "user.updated", {
      client,
      enabled: true,
    });

    expect(update).toHaveBeenCalledWith({
      email: "gerry@example.com",
      firstName: undefined,
      lastName: undefined,
    });
  });

  it("skips explicitly unverified Clerk primary emails", async () => {
    const { client, get } = makeClient(false);

    const result = await syncClerkUserToResendContact({
      ...clerkUser,
      email_addresses: [
        {
          id: "primary",
          email_address: "unverified@example.com",
          verification: { status: "unverified" },
        },
      ],
    }, "user.created", {
      client,
      enabled: true,
    });

    expect(result).toEqual({
      ok: false,
      skipped: true,
      error: "Clerk user primary email is not verified",
    });
    expect(get).not.toHaveBeenCalled();
  });
});
