import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  isPlunkMarketingSyncEnabled,
  syncClerkUserToPlunkContact,
} from "../plunk-contact-sync";

const clerkUser = {
  email_addresses: [
    {
      email_address: "Gerry@Example.com",
      id: "email_123",
      verification: { status: "verified" },
    },
  ],
  first_name: " Gerry ",
  id: "user_123",
  last_name: " Gugger ",
  primary_email_address_id: "email_123",
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Plunk marketing contact sync", () => {
  it("fails closed when the feature flag is off", async () => {
    const request = vi.fn();

    await expect(
      syncClerkUserToPlunkContact(clerkUser, {
        apiKey: "pk_test",
        fetch: request,
      }),
    ).resolves.toEqual({
      error: "Plunk marketing contact sync is disabled",
      ok: false,
      retryable: false,
      skipped: true,
    });
    expect(request).not.toHaveBeenCalled();
    expect(isPlunkMarketingSyncEnabled()).toBe(false);
  });

  it("treats an enabled flag without a key as retryable rollout debt", async () => {
    await expect(
      syncClerkUserToPlunkContact(clerkUser, { enabled: true }),
    ).resolves.toEqual({
      error: "PLUNK_PUBLIC_API_KEY is not configured",
      ok: false,
      retryable: true,
    });
  });

  it("skips an unusable Clerk email without creating retry debt", async () => {
    const request = vi.fn();
    const unverifiedUser = {
      ...clerkUser,
      email_addresses: [
        {
          ...clerkUser.email_addresses[0],
          verification: { status: "unverified" },
        },
      ],
    };

    await expect(
      syncClerkUserToPlunkContact(unverifiedUser, {
        apiKey: "pk_test",
        enabled: true,
        fetch: request,
      }),
    ).resolves.toEqual({
      error: "Clerk user primary email is not verified",
      ok: false,
      retryable: false,
      skipped: true,
    });
    expect(request).not.toHaveBeenCalled();
  });

  it("atomically tracks a signup without sending a subscribed override", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({ success: true, data: { contact: "contact_123", event: "event_123" } }),
    );

    await expect(
      syncClerkUserToPlunkContact(clerkUser, {
        apiKey: "pk_test",
        enabled: true,
        fetch: request,
      }),
    ).resolves.toEqual({ action: "tracked", ok: true });

    expect(request).toHaveBeenCalledTimes(1);
    const [url, requestInit] = request.mock.calls[0];
    expect(url).toBe("https://next-api.useplunk.com/v1/track");
    expect(requestInit?.headers).toEqual(
      expect.objectContaining({ "Idempotency-Key": "flaim-user-created/user_123" }),
    );
    const payload = JSON.parse(String(requestInit?.body));
    expect(payload).toEqual({
      data: {
        clerkUserId: "user_123",
        firstName: "Gerry",
        lastName: "Gugger",
        source: "clerk.user_created",
      },
      email: "gerry@example.com",
      event: "flaim.user_created",
    });
    expect(payload).not.toHaveProperty("subscribed");
  });

  it("treats the provider's idempotency replay response as success", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({ success: false, error: { code: "IDEMPOTENCY_KEY_REUSED" } }, 409),
    );

    await expect(
      syncClerkUserToPlunkContact(clerkUser, {
        apiKey: "pk_test",
        enabled: true,
        fetch: request,
      }),
    ).resolves.toEqual({ action: "replayed", ok: true });
  });

  it("does not mistake an unrelated conflict for an idempotent replay", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse(
        { success: false, error: { code: "CONFLICT", message: "Different conflict" } },
        409,
      ),
    );

    await expect(
      syncClerkUserToPlunkContact(clerkUser, {
        apiKey: "pk_test",
        enabled: true,
        fetch: request,
      }),
    ).resolves.toEqual({
      error: "Plunk contact tracking failed (409): Different conflict",
      ok: false,
      retryable: true,
    });
  });

  it("keeps provider failures retryable without exposing request credentials", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse(
          {
            success: false,
            error: { message: "Project temporarily unavailable" },
          },
          503,
        ),
      );

    const result = await syncClerkUserToPlunkContact(clerkUser, {
      apiKey: "pk_do_not_log",
      enabled: true,
      fetch: request,
    });

    expect(result).toEqual({
      error: "Plunk contact tracking failed (503): Project temporarily unavailable",
      ok: false,
      retryable: true,
    });
    expect(JSON.stringify(result)).not.toContain("pk_do_not_log");
    expect(JSON.stringify(result)).not.toContain("gerry@example.com");
  });
});
