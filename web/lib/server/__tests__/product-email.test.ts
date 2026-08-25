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

import { sendEspnSetupLinkEmail } from "../product-email";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("product email sends", () => {
  it("uses the Resend SDK request-options idempotency signature", async () => {
    vi.stubEnv("FLAIM_EMAILS_ENABLED", "true");
    mocks.getResendClient.mockReturnValue({
      emails: { send: mocks.emailsSend },
    });
    mocks.emailsSend.mockResolvedValue({ data: { id: "email_123" }, error: null });

    const result = await sendEspnSetupLinkEmail({
      extensionUrl: "https://example.com/extension",
      leaguesUrl: "https://example.com/leagues",
      to: "gerry@example.com",
      userId: "user_123",
    });

    expect(result).toEqual({ id: "email_123", ok: true });
    expect(mocks.emailsSend).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Your ESPN setup link for Flaim",
        tags: [{ name: "template", value: "espn-setup-link" }],
        to: "gerry@example.com",
      }),
      { idempotencyKey: "espn-setup-link/user_123" },
    );
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
