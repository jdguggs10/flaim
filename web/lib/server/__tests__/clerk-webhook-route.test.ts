import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const afterCallbacks: Array<() => Promise<void> | void> = [];

  return {
    after: vi.fn((callback: () => Promise<void> | void) => {
      afterCallbacks.push(callback);
    }),
    afterCallbacks,
    clearEmailRetry: vi.fn(),
    getClerkUserProductEmail: vi.fn(),
    isPlunkMarketingSyncEnabled: vi.fn(),
    getWelcomeDeliveryConfig: vi.fn(),
    logEmailOps: vi.fn(),
    mapClerkUserToSignup: vi.fn(),
    markEmailRetry: vi.fn(),
    recordSignup: vi.fn(),
    sendWelcomeEmail: vi.fn(),
    sendWelcomeAutomationEvent: vi.fn(),
    syncClerkUserToResendContact: vi.fn(),
    syncClerkUserToPlunkContact: vi.fn(),
    verifyWebhook: vi.fn(),
  };
});

vi.mock("@clerk/nextjs/webhooks", () => ({
  verifyWebhook: mocks.verifyWebhook,
}));

vi.mock("@/lib/server/resend-contact-sync", () => ({
  getClerkUserProductEmail: mocks.getClerkUserProductEmail,
  syncClerkUserToResendContact: mocks.syncClerkUserToResendContact,
}));

vi.mock("@/lib/server/resend-welcome-automation", () => ({
  sendWelcomeAutomationEvent: mocks.sendWelcomeAutomationEvent,
}));

vi.mock("@/lib/server/plunk-contact-sync", () => ({
  isPlunkMarketingSyncEnabled: mocks.isPlunkMarketingSyncEnabled,
  syncClerkUserToPlunkContact: mocks.syncClerkUserToPlunkContact,
}));

vi.mock("@/lib/server/product-email", () => ({
  sendWelcomeEmail: mocks.sendWelcomeEmail,
}));

vi.mock("@/lib/server/welcome-delivery-mode", () => ({
  getWelcomeDeliveryConfig: mocks.getWelcomeDeliveryConfig,
}));

vi.mock("@/lib/server/email-ops", () => ({
  logEmailOps: mocks.logEmailOps,
}));

vi.mock("@/lib/server/signup-log", () => ({
  mapClerkUserToSignup: mocks.mapClerkUserToSignup,
  recordSignup: mocks.recordSignup,
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

const SIGNUP_CREATED_AT_MS = 1756002400000;
const SIGNUP_CREATED_AT_ISO = "2025-08-24T02:26:40.000Z";

const signupRow = {
  clerkUserId: "user_123",
  createdAt: SIGNUP_CREATED_AT_ISO,
  firstTouch: null,
};

const clerkUser = {
  created_at: SIGNUP_CREATED_AT_MS,
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
  mocks.getClerkUserProductEmail.mockReturnValue({ ok: true, email: "gerry@example.com" });
  mocks.isPlunkMarketingSyncEnabled.mockReturnValue(false);
  mocks.getWelcomeDeliveryConfig.mockReturnValue({ mode: "automation", source: "legacy" });
  mocks.markEmailRetry.mockResolvedValue({ ok: true, skipped: false });
  mocks.mapClerkUserToSignup.mockReturnValue(signupRow);
  mocks.recordSignup.mockResolvedValue(undefined);
});

afterEach(() => {
  mocks.afterCallbacks.length = 0;
  vi.clearAllMocks();
});

describe("POST /api/webhooks/clerk", () => {
  it("queues a Resend automation event for user.created without pre-syncing the contact", async () => {
    mocks.verifyWebhook.mockResolvedValue({ type: "user.created", data: clerkUser });
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

  it("sends one direct transactional welcome without emitting the automation event", async () => {
    mocks.verifyWebhook.mockResolvedValue({ type: "user.created", data: clerkUser });
    mocks.getWelcomeDeliveryConfig.mockReturnValue({ mode: "direct", source: "explicit" });
    mocks.sendWelcomeEmail.mockResolvedValue({ id: "email_123", ok: true });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ received: true, welcome: { queued: true } });
    expect(mocks.sendWelcomeEmail).not.toHaveBeenCalled();
    expect(mocks.sendWelcomeAutomationEvent).not.toHaveBeenCalled();

    await mocks.afterCallbacks[0]();

    expect(mocks.sendWelcomeEmail).toHaveBeenCalledTimes(1);
    expect(mocks.sendWelcomeEmail).toHaveBeenCalledWith({
      idempotencyKey: "welcome/user_123",
      to: "gerry@example.com",
      userId: "user_123",
    });
    expect(mocks.sendWelcomeAutomationEvent).not.toHaveBeenCalled();
    expect(mocks.clearEmailRetry).toHaveBeenCalledWith("user_123", "welcomeEvent", {
      metadata: undefined,
    });
  });

  it("marks a failed direct welcome for repair", async () => {
    mocks.verifyWebhook.mockResolvedValue({ type: "user.created", data: clerkUser });
    mocks.getWelcomeDeliveryConfig.mockReturnValue({ mode: "direct", source: "explicit" });
    mocks.sendWelcomeEmail.mockResolvedValue({ error: "Resend rejected the send", ok: false });

    await POST(request());
    await mocks.afterCallbacks[0]();

    expect(mocks.logEmailOps).toHaveBeenCalledWith("email.welcome_event_failed", {
      error: "Resend rejected the send",
      provider: "resend",
      reason: "welcome_direct_send_failed",
      source: "clerk.user.created",
      userId: "user_123",
    });
    expect(mocks.markEmailRetry).toHaveBeenCalledWith("user_123", "welcomeEvent", {
      metadata: undefined,
    });
  });

  it("marks a skipped direct send caused by missing send configuration", async () => {
    mocks.verifyWebhook.mockResolvedValue({ type: "user.created", data: clerkUser });
    mocks.getWelcomeDeliveryConfig.mockReturnValue({ mode: "direct", source: "explicit" });
    mocks.sendWelcomeEmail.mockResolvedValue({
      error: "RESEND_API_KEY is not configured",
      ok: false,
      skipped: true,
    });

    await POST(request());
    await mocks.afterCallbacks[0]();

    expect(mocks.markEmailRetry).toHaveBeenCalledWith("user_123", "welcomeEvent", {
      metadata: undefined,
    });
  });

  it("does not mark a direct welcome when the Clerk user has no usable email", async () => {
    mocks.verifyWebhook.mockResolvedValue({ type: "user.created", data: clerkUser });
    mocks.getWelcomeDeliveryConfig.mockReturnValue({ mode: "direct", source: "explicit" });
    mocks.getClerkUserProductEmail.mockReturnValue({
      error: "Clerk user has no email address",
      ok: false,
      skipped: true,
    });

    await POST(request());
    await mocks.afterCallbacks[0]();

    expect(mocks.sendWelcomeEmail).not.toHaveBeenCalled();
    expect(mocks.markEmailRetry).not.toHaveBeenCalled();
  });

  it("keeps the user.created response queued when the async welcome event fails", async () => {
    mocks.verifyWebhook.mockResolvedValue({ type: "user.created", data: clerkUser });
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

  it("does not sync contacts or queue a welcome when delivery is disabled", async () => {
    mocks.verifyWebhook.mockResolvedValue({ type: "user.created", data: clerkUser });
    mocks.getWelcomeDeliveryConfig.mockReturnValue({ mode: "disabled", source: "explicit" });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      received: true,
      welcome: { skipped: true, error: "Welcome delivery is disabled" },
    });
    expect(mocks.syncClerkUserToResendContact).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.sendWelcomeAutomationEvent).not.toHaveBeenCalled();
    expect(mocks.logEmailOps).toHaveBeenCalledWith("email.welcome_event_skipped", {
      provider: "resend",
      reason: "welcome_delivery_disabled",
      source: "clerk.user.created",
      userId: "user_123",
    });
  });

  it("queues Plunk contact ownership independently when welcome delivery is disabled", async () => {
    mocks.verifyWebhook.mockResolvedValue({ type: "user.created", data: clerkUser });
    mocks.getWelcomeDeliveryConfig.mockReturnValue({ mode: "disabled", source: "explicit" });
    mocks.isPlunkMarketingSyncEnabled.mockReturnValue(true);
    mocks.syncClerkUserToPlunkContact.mockResolvedValue({ action: "tracked", ok: true });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      received: true,
      welcome: { skipped: true, error: "Welcome delivery is disabled" },
    });
    expect(mocks.after).toHaveBeenCalledTimes(1);

    await mocks.afterCallbacks[0]();

    expect(mocks.syncClerkUserToPlunkContact).toHaveBeenCalledWith(clerkUser, {
      enabled: true,
    });
    expect(mocks.clearEmailRetry).toHaveBeenCalledWith("user_123", "plunkContactSync", {
      metadata: undefined,
    });
  });

  it("records a retry marker when the non-blocking Plunk sync fails", async () => {
    mocks.verifyWebhook.mockResolvedValue({ type: "user.created", data: clerkUser });
    mocks.getWelcomeDeliveryConfig.mockReturnValue({ mode: "disabled", source: "explicit" });
    mocks.isPlunkMarketingSyncEnabled.mockReturnValue(true);
    mocks.syncClerkUserToPlunkContact.mockResolvedValue({
      error: "Plunk contact lookup failed (503)",
      ok: false,
      retryable: true,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    await mocks.afterCallbacks[0]();
    expect(mocks.logEmailOps).toHaveBeenCalledWith("email.contact_sync_failed", {
      error: "Plunk contact lookup failed (503)",
      provider: "plunk",
      reason: "plunk_marketing_contact_sync_failed",
      source: "clerk.user.created",
      userId: "user_123",
    });
    expect(mocks.markEmailRetry).toHaveBeenCalledWith("user_123", "plunkContactSync", {
      metadata: undefined,
    });
  });

  it("fails closed on an invalid explicit welcome mode", async () => {
    mocks.verifyWebhook.mockResolvedValue({ type: "user.created", data: clerkUser });
    mocks.getWelcomeDeliveryConfig.mockReturnValue({
      invalidValue: "both",
      mode: "disabled",
      source: "explicit",
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      received: true,
      welcome: { skipped: true, error: "Welcome delivery mode is invalid" },
    });
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.logEmailOps).toHaveBeenCalledWith("email.welcome_event_skipped", {
      provider: "resend",
      reason: "welcome_delivery_mode_invalid",
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
    expect(mocks.getWelcomeDeliveryConfig).not.toHaveBeenCalled();
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.sendWelcomeAutomationEvent).not.toHaveBeenCalled();
    expect(mocks.syncClerkUserToPlunkContact).not.toHaveBeenCalled();

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

  it("writes the signup log before the welcome email is scheduled", async () => {
    mocks.verifyWebhook.mockResolvedValue({ type: "user.created", data: clerkUser });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.mapClerkUserToSignup).toHaveBeenCalledWith(clerkUser);
    expect(mocks.recordSignup).toHaveBeenCalledWith(signupRow, { source: "webhook" });
    expect(mocks.after).toHaveBeenCalledTimes(1);
    expect(mocks.recordSignup.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.after.mock.invocationCallOrder[0]
    );
  });

  it("writes the signup log even when welcome delivery is disabled", async () => {
    mocks.verifyWebhook.mockResolvedValue({ type: "user.created", data: clerkUser });
    mocks.getWelcomeDeliveryConfig.mockReturnValue({ mode: "disabled", source: "explicit" });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      received: true,
      welcome: { skipped: true, error: "Welcome delivery is disabled" },
    });
    expect(mocks.recordSignup).toHaveBeenCalledWith(signupRow, { source: "webhook" });
  });

  it("writes the signup log for user.updated before the contact sync", async () => {
    mocks.verifyWebhook.mockResolvedValue({ type: "user.updated", data: clerkUser });
    mocks.syncClerkUserToResendContact.mockResolvedValue({
      action: "updated",
      email: "gerry@example.com",
      ok: true,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.recordSignup).toHaveBeenCalledWith(signupRow, { source: "webhook" });
    expect(mocks.syncClerkUserToResendContact).toHaveBeenCalled();
  });

  it("returns 500 and schedules nothing when the signup log write fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.verifyWebhook.mockResolvedValue({ type: "user.created", data: clerkUser });
    mocks.recordSignup.mockRejectedValue(new Error("Failed to record signup (401)"));

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Signup log write failed" });
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.getWelcomeDeliveryConfig).not.toHaveBeenCalled();
    expect(mocks.syncClerkUserToResendContact).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("returns 500 and schedules nothing when the payload cannot be mapped", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.verifyWebhook.mockResolvedValue({ type: "user.created", data: clerkUser });
    mocks.mapClerkUserToSignup.mockImplementation(() => {
      throw new Error("Clerk payload created_at is not an integer millisecond epoch");
    });

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: "Unexpected webhook payload" });
    expect(mocks.recordSignup).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
