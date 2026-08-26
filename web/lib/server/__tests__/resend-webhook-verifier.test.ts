import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Resend } from "resend";

const testWebhookSecretMarker = "flaim-test-webhook-key";
const webhookSecret = `whsec_${Buffer.from(testWebhookSecretMarker).toString("base64")}`;
const messageId = "msg_123";
const timestamp = "1724500800";

function sign(payload: string) {
  const secret = Buffer.from(webhookSecret.slice("whsec_".length), "base64");
  return `v1,${createHmac("sha256", secret)
    .update(`${messageId}.${timestamp}.${payload}`)
    .digest("base64")}`;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Resend webhook signature verifier", () => {
  it("accepts an authentic Standard Webhooks signature only for the original raw bytes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Number(timestamp) * 1000));
    const payload = '{\n  "type": "email.failed",\n  "data": { "email_id": "email_123", "failed": { "reason": "mailbox unavailable" } }\n}';
    const verifier = new Resend("webhook-verifier");
    const headers = {
      id: messageId,
      signature: sign(payload),
      timestamp,
    };

    expect(verifier.webhooks.verify({ headers, payload, webhookSecret })).toMatchObject({
      type: "email.failed",
    });

    // Parsing then serializing changes whitespace and invalidates this exact signature.
    const reserializedPayload = JSON.stringify(JSON.parse(payload));
    expect(reserializedPayload).not.toBe(payload);
    expect(() => verifier.webhooks.verify({
      headers,
      payload: reserializedPayload,
      webhookSecret,
    })).toThrow();
  });

  it("rejects a tampered signature", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Number(timestamp) * 1000));
    const payload = '{"type":"email.complained","data":{"email_id":"email_123"}}';
    const verifier = new Resend("webhook-verifier");

    expect(() => verifier.webhooks.verify({
      headers: {
        id: messageId,
        signature: "v1,not-a-valid-signature",
        timestamp,
      },
      payload,
      webhookSecret,
    })).toThrow();
  });

  it("rejects a validly signed but stale Svix timestamp", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Number(timestamp) * 1000 + 10 * 60 * 1000));
    const payload = '{"type":"email.complained","data":{"email_id":"email_123"}}';
    const verifier = new Resend("webhook-verifier");

    expect(() => verifier.webhooks.verify({
      headers: {
        id: messageId,
        signature: sign(payload),
        timestamp,
      },
      payload,
      webhookSecret,
    })).toThrow();
  });
});
