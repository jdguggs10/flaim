import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const afterCallbacks: Array<() => Promise<void> | void> = [];

  return {
    after: vi.fn((callback: () => Promise<void> | void) => {
      afterCallbacks.push(callback);
    }),
    afterCallbacks,
    clearEmailRetry: vi.fn(),
    isWelcomeAutomationEnabled: vi.fn(),
    logEmailOps: vi.fn(),
    markEmailRetry: vi.fn(),
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

vi.mock("@/lib/server/email-ops", () => ({
  logEmailOps: mocks.logEmailOps,
}));

vi.mock("@/lib/server/email-retry-marker", () => ({
  clearEmailRetry: mocks.clearEmailRetry,
  markEmailRetry: mocks.markEmailRetry,
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

beforeEach(() => {
  mocks.clearEmailRetry.mockResolvedValue({ ok: true, skipped: true });
  mocks.markEmailRetry.mockResolvedValue({ ok: true, skipped: false });
});

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
    expect(mocks.clearEmailRetry).toHaveBeenCalledWith("user_123", "welcomeEvent", {
      metadata: undefined,
    });
  });

  it("keeps the user.created response queued when the async welcome event fails", async () => {
    mocks.verifyWebhook.mockResolvedValue({ type: "user.created", data: clerkUser });
    mocks.isWelcomeAutomationEnabled.mockReturnValue(true);
    mocks.sendWelcomeAutomationEvent.mockResolvedValue({
      ok: false,
      email: "gerry@example.com",
      event: "flaim.user_created",
      error: "Resend rejected the event",
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ received: true, welcome: { queued: true } });

    await mocks.afterCallbacks[0]();

    expect(mocks.logEmailOps).toHaveBeenCalledWith("email.welcome_event_failed", {
      error: "Resend rejected the event",
      provider: "resend",
      reason: "welcome_event_send_failed",
      source: "clerk.user.created",
      userId: "user_123",
    });
    expect(mocks.markEmailRetry).toHaveBeenCalledWith("user_123", "welcomeEvent", {
      metadata: undefined,
    });
  });

  it("contains an after callback exception and still leaves a welcome retry marker", async () => {
    mocks.verifyWebhook.mockResolvedValue({ type: "user.created", data: clerkUser });
    mocks.isWelcomeAutomationEnabled.mockReturnValue(true);
    mocks.sendWelcomeAutomationEvent.mockRejectedValue(new Error("unexpected Resend error"));

    const response = await POST(request());

    expect(response.status).toBe(200);
    await expect(mocks.afterCallbacks[0]()).resolves.toBeUndefined();
    expect(mocks.logEmailOps).toHaveBeenCalledWith("email.welcome_event_failed", {
      error: expect.any(Error),
      provider: "resend",
      reason: "welcome_event_after_failed",
      source: "clerk.user.created",
      userId: "user_123",
    });
    expect(mocks.markEmailRetry).toHaveBeenCalledWith("user_123", "welcomeEvent", {
      metadata: undefined,
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
    expect(mocks.logEmailOps).toHaveBeenCalledWith("email.welcome_event_skipped", {
      provider: "resend",
      reason: "welcome_automation_disabled",
      source: "clerk.user.created",
      userId: "user_123",
    });
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
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.sendWelcomeAutomationEvent).not.toHaveBeenCalled();

    await mocks.afterCallbacks[0]();

    expect(mocks.clearEmailRetry).toHaveBeenCalledWith("user_123", "contactSync", {
      metadata: undefined,
    });
  });

  it("records the failed contact sync for later repair", async () => {
    mocks.verifyWebhook.mockResolvedValue({ type: "user.updated", data: clerkUser });
    mocks.syncClerkUserToResendContact.mockResolvedValue({
      email: "gerry@example.com",
      error: "Resend rate limited",
      ok: false,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.logEmailOps).toHaveBeenCalledWith("email.contact_sync_failed", {
      error: "Resend rate limited",
      provider: "resend",
      reason: "contact_sync_failed",
      source: "clerk.user.updated",
      userId: "user_123",
    });

    await mocks.afterCallbacks[0]();

    expect(mocks.markEmailRetry).toHaveBeenCalledWith("user_123", "contactSync", {
      metadata: undefined,
    });
  });

  it("acknowledges the Clerk webhook when writing the contact retry marker fails", async () => {
    mocks.verifyWebhook.mockResolvedValue({ type: "user.updated", data: clerkUser });
    mocks.syncClerkUserToResendContact.mockResolvedValue({
      error: "Resend rate limited",
      ok: false,
    });
    mocks.markEmailRetry.mockResolvedValue({ ok: false, error: new Error("Clerk unavailable") });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await mocks.afterCallbacks[0]();
    expect(mocks.logEmailOps).toHaveBeenCalledWith("email.contact_sync_failed", {
      error: expect.any(Error),
      provider: "clerk",
      reason: "retry_marker_write_failed",
      source: "clerk.user.updated",
      userId: "user_123",
    });
  });

  it("does not rewrite an existing contact marker when its update webhook fails again", async () => {
    const markedUser = {
      ...clerkUser,
      private_metadata: {
        flaim_email_ops: {
          contactSync: { failedAt: "2026-08-24T12:00:00.000Z" },
        },
      },
    };
    mocks.verifyWebhook.mockResolvedValue({ type: "user.updated", data: markedUser });
    mocks.syncClerkUserToResendContact.mockResolvedValue({
      error: "Resend remains unavailable",
      ok: false,
    });
    mocks.markEmailRetry.mockResolvedValue({ ok: true, skipped: true });

    await POST(request());
    await mocks.afterCallbacks[0]();

    expect(mocks.markEmailRetry).toHaveBeenCalledWith("user_123", "contactSync", {
      metadata: markedUser.private_metadata,
    });
  });
});
