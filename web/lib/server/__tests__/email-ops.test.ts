import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { logEmailOps } from "../email-ops";

describe("email operations logs", () => {
  it("emits a greppable JSON record without addresses or secrets", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logEmailOps("email.failed", {
      error: "Resend rejected gerry@example.com using whsec_secret",
      provider: "resend",
      resendEmailId: "email_123",
      userId: "user_123",
    });

    expect(JSON.parse(error.mock.calls[0][0])).toEqual({
      error: "Resend rejected [redacted-email] using [redacted-secret]",
      event: "email.failed",
      provider: "resend",
      resendEmailId: "email_123",
      service: "email",
      userId: "user_123",
    });
    error.mockRestore();
  });

  it("redacts Clerk secret keys without redacting ordinary sk_ text", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logEmailOps("email.send_failed", {
      error: "Clerk rejected sk_live_1234567890 but kept sk_not_a_secret",
    });

    const record = JSON.parse(error.mock.calls[0][0]) as { error: string };
    expect(record.error).toContain("[redacted-secret]");
    expect(record.error).not.toContain("sk_live_1234567890");
    expect(record.error).toContain("sk_not_a_secret");
    error.mockRestore();
  });
});
