import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logEmailOps: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/server/email-ops", () => ({
  logEmailOps: mocks.logEmailOps,
}));

vi.mock("@/lib/server/resend-client", () => ({
  getResendWebhookVerifier: () => ({
    webhooks: { verify: mocks.verify },
  }),
}));

import { POST } from "../../../app/api/webhooks/resend/route";

function request(body: string, headers: Record<string, string> = {}) {
  return new Request("https://flaim.app/api/webhooks/resend", {
    body,
    headers: {
      "content-type": "application/json",
      "svix-id": "msg_123",
      "svix-signature": "v1,test-signature",
      "svix-timestamp": "1724500800",
      ...headers,
    },
    method: "POST",
  }) as Parameters<typeof POST>[0];
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("POST /api/webhooks/resend", () => {
  it("verifies the exact raw request body before logging a bounced delivery", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SIGNING_SECRET", "whsec_test");
    const rawPayload = '{\n  "type": "email.bounced",\n  "data": { "email_id": "email_123" }\n}';
    expect(JSON.stringify(JSON.parse(rawPayload))).not.toBe(rawPayload);
    mocks.verify.mockReturnValue({
      created_at: "2026-08-24T12:00:00.000Z",
      data: {
        bounce: { message: "recipient rejected", subType: "general", type: "hard" },
        email_id: "email_123",
      },
      type: "email.bounced",
    });

    const response = await POST(request(rawPayload));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ event: "email.bounced", received: true });
    expect(mocks.verify).toHaveBeenCalledWith({
      headers: {
        id: "msg_123",
        signature: "v1,test-signature",
        timestamp: "1724500800",
      },
      payload: rawPayload,
      webhookSecret: "whsec_test",
    });
    expect(mocks.logEmailOps).toHaveBeenCalledWith("email.bounced", {
      eventId: "msg_123",
      provider: "resend",
      reason: "recipient rejected",
      resendEmailId: "email_123",
      source: "resend.webhook",
    });
  });

  it("rejects a failed signature without handling the untrusted event", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SIGNING_SECRET", "whsec_test");
    mocks.verify.mockImplementation(() => {
      throw new Error("signature mismatch");
    });

    const response = await POST(request('{"type":"email.failed"}'));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid webhook" });
    expect(mocks.logEmailOps).toHaveBeenCalledWith("email.webhook_verification_failed", {
      error: expect.any(Error),
      eventId: "msg_123",
      provider: "resend",
      reason: "invalid_svix_signature",
      source: "resend.webhook",
    });
  });

  it("rejects missing Svix signature headers before attempting verification", async () => {
    vi.stubEnv("RESEND_WEBHOOK_SIGNING_SECRET", "whsec_test");

    const response = await POST(request('{"type":"email.failed"}', { "svix-signature": "" }));

    expect(response.status).toBe(400);
    expect(mocks.verify).not.toHaveBeenCalled();
    expect(mocks.logEmailOps).toHaveBeenCalledWith("email.webhook_verification_failed", {
      provider: "resend",
      reason: "missing_svix_headers",
      source: "resend.webhook",
    });
  });
});
