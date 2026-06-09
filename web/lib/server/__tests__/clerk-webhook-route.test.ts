import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const afterCallbacks: Array<() => Promise<void> | void> = [];

  return {
    after: vi.fn((callback: () => Promise<void> | void) => {
      afterCallbacks.push(callback);
    }),
    afterCallbacks,
    isWelcomeAutomationEnabled: vi.fn(),
    sendWelcomeAutomationEvent: vi.fn(),
    syncClerkUserToResendContact: vi.fn(),
    verifyWebhook: vi.fn(),
  };
});

vi.mock("@clerk/nextjs/webhooks", () => ({
  verifyWebhook: mocks.verifyWebhook,
}));

vi.mock("@/lib/server/resend-contact-sync", () => ({
  syncClerkUserToResendContact: mocks.syncClerkUserToResendContact,
}));

vi.mock("@/lib/server/resend-welcome-automation", () => ({
  isWelcomeAutomationEnabled: mocks.isWelcomeAutomationEnabled,
  sendWelcomeAutomationEvent: mocks.sendWelcomeAutomationEvent,
}));

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();

  return {
    ...actual,
    after: mocks.after,
  };
});

import { POST } from "../../../app/api/webhooks/clerk/route";

const clerkUser = {
  email_addresses: [{ id: "email_123", email_address: "gerry@example.com" }],
  first_name: "Gerry",
  id: "user_123",
  last_name: "Gugger",
  primary_email_address_id: "email_123",
};

function request() {
  return new Request("https://flaim.app/api/webhooks/clerk", {
    method: "POST",
  }) as Parameters<typeof POST>[0];
}

afterEach(() => {
  mocks.afterCallbacks.length = 0;
  vi.clearAllMocks();
});

describe("POST /api/webhooks/clerk", () => {
  it("queues a Resend automation event for user.created without pre-syncing the contact", async () => {
    mocks.verifyWebhook.mockResolvedValue({ type: "user.created", data: clerkUser });
    mocks.isWelcomeAutomationEnabled.mockReturnValue(true);
    mocks.sendWelcomeAutomationEvent.mockResolvedValue({
      ok: true,
      email: "gerry@example.com",
      event: "flaim.user_created",
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ received: true, welcome: { queued: true } });
    expect(mocks.syncClerkUserToResendContact).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.sendWelcomeAutomationEvent).not.toHaveBeenCalled();

    await mocks.afterCallbacks[0]();

    expect(mocks.sendWelcomeAutomationEvent).toHaveBeenCalledWith(clerkUser, {
      enabled: true,
    });
  });

  it("does not sync contacts or queue an event when welcome automation is disabled", async () => {
    mocks.verifyWebhook.mockResolvedValue({ type: "user.created", data: clerkUser });
    mocks.isWelcomeAutomationEnabled.mockReturnValue(false);

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      received: true,
      welcome: { skipped: true, error: "Resend welcome automation is disabled" },
    });
    expect(mocks.syncClerkUserToResendContact).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.sendWelcomeAutomationEvent).not.toHaveBeenCalled();
  });

  it("keeps user.updated on the Resend contact sync path without queuing welcome email", async () => {
    mocks.verifyWebhook.mockResolvedValue({ type: "user.updated", data: clerkUser });
    mocks.syncClerkUserToResendContact.mockResolvedValue({
      action: "updated",
      email: "gerry@example.com",
      ok: true,
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      received: true,
      sync: { action: "updated", email: "gerry@example.com", ok: true },
    });
    expect(mocks.syncClerkUserToResendContact).toHaveBeenCalledWith(clerkUser);
    expect(mocks.isWelcomeAutomationEnabled).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.sendWelcomeAutomationEvent).not.toHaveBeenCalled();
  });
});
