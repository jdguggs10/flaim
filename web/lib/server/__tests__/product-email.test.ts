import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  emailsSend: vi.fn(),
  getResendClient: vi.fn(),
  logEmailOps: vi.fn(),
}));

vi.mock("server-only", () => ({}));

vi.mock("@/lib/server/resend-client", () => ({
  getResendClient: mocks.getResendClient,
  getResendErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "Unknown Resend error",
}));

vi.mock("@/lib/server/email-ops", () => ({
  logEmailOps: mocks.logEmailOps,
}));

import { sendEspnSetupLinkEmail, sendWelcomeEmail } from "../product-email";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("product email sends", () => {
  it("forwards a caller-supplied semantic idempotency key to the Resend SDK", async () => {
    vi.stubEnv("FLAIM_EMAILS_ENABLED", "true");
    mocks.getResendClient.mockReturnValue({
      emails: { send: mocks.emailsSend },
    });
    mocks.emailsSend.mockResolvedValue({ data: { id: "email_123" }, error: null });

    const result = await sendWelcomeEmail({
      idempotencyKey: "order-receipt/order_123",
      leaguesUrl: "https://example.com/leagues",
      to: "gerry@example.com",
      unsubscribeUrl: "https://example.com/unsubscribe",
      userId: "user_123",
    });

    expect(result).toEqual({ id: "email_123", ok: true });
    const [message] = mocks.emailsSend.mock.calls[0];
    expect(message.react.props).not.toHaveProperty("firstName");
    expect(mocks.emailsSend).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Welcome to Flaim",
        tags: [{ name: "template", value: "welcome" }],
        to: "gerry@example.com",
      }),
      { idempotencyKey: "order-receipt/order_123" },
    );
  });

  it("allows a setup-link resend for the same user without a provider replay key", async () => {
    vi.stubEnv("FLAIM_EMAILS_ENABLED", "true");
    mocks.getResendClient.mockReturnValue({
      emails: { send: mocks.emailsSend },
    });

    const sentByIdempotencyKey = new Map<string, string>();
    let sequence = 0;
    mocks.emailsSend.mockImplementation(async (_message, options?: { idempotencyKey?: string }) => {
      const key = options?.idempotencyKey;
      if (key && sentByIdempotencyKey.has(key)) {
        return { data: { id: sentByIdempotencyKey.get(key) }, error: null };
      }

      const id = `email_${++sequence}`;
      if (key) sentByIdempotencyKey.set(key, id);
      return { data: { id }, error: null };
    });

    const request = {
      extensionUrl: "https://example.com/extension",
      leaguesUrl: "https://example.com/leagues",
      to: "gerry@example.com",
      userId: "user_123",
    };
    const first = await sendEspnSetupLinkEmail(request);
    const second = await sendEspnSetupLinkEmail(request);

    expect(first).toEqual({ id: "email_1", ok: true });
    expect(second).toEqual({ id: "email_2", ok: true });
    expect(mocks.emailsSend).toHaveBeenCalledTimes(2);
    expect(mocks.emailsSend.mock.calls[0]).toHaveLength(1);
    expect(mocks.emailsSend.mock.calls[1]).toHaveLength(1);
  });

  it("reports failed sends through the structured email operations path", async () => {
    vi.stubEnv("FLAIM_EMAILS_ENABLED", "true");
    mocks.getResendClient.mockReturnValue({
      emails: { send: mocks.emailsSend },
    });
    mocks.emailsSend.mockResolvedValue({ data: null, error: new Error("gerry@example.com bounced") });

    const result = await sendEspnSetupLinkEmail({
      extensionUrl: "https://example.com/extension",
      leaguesUrl: "https://example.com/leagues",
      to: "gerry@example.com",
      userId: "user_123",
    });

    expect(result).toEqual({ error: "gerry@example.com bounced", ok: false });
    expect(mocks.logEmailOps).toHaveBeenCalledWith("email.send_failed", {
      error: "gerry@example.com bounced",
      provider: "resend",
      reason: "resend_email_send_failed",
      source: "product.espn-setup-link",
      userId: "user_123",
    });
  });
});
