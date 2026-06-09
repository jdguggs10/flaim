import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  isWelcomeAutomationEnabled,
  sendWelcomeAutomationEvent,
  WELCOME_AUTOMATION_EVENT_NAME,
} from "../resend-welcome-automation";
import type { ClerkUserEmailSyncPayload } from "../resend-contact-sync";

const clerkUser: ClerkUserEmailSyncPayload = {
  email_addresses: [
    {
      id: "primary",
      email_address: "Gerry@Example.com",
      verification: { status: "verified" },
    },
  ],
  first_name: " Gerry ",
  id: "user_123",
  last_name: " Gugger ",
  primary_email_address_id: "primary",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isWelcomeAutomationEnabled", () => {
  it("uses the welcome automation environment flag when no override is passed", () => {
    vi.stubEnv("RESEND_WELCOME_AUTOMATION_ENABLED", "true");

    expect(isWelcomeAutomationEnabled()).toBe(true);

    vi.stubEnv("RESEND_WELCOME_AUTOMATION_ENABLED", "false");

    expect(isWelcomeAutomationEnabled()).toBe(false);
    expect(isWelcomeAutomationEnabled({ enabled: true })).toBe(true);
  });
});

describe("sendWelcomeAutomationEvent", () => {
  it("skips when the welcome automation is disabled", async () => {
    const send = vi.fn();

    const result = await sendWelcomeAutomationEvent(clerkUser, {
      client: { events: { send } },
      enabled: false,
    });

    expect(result).toEqual({
      ok: false,
      skipped: true,
      error: "Resend welcome automation is disabled",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends the configured Resend event for the Clerk primary email", async () => {
    const send = vi.fn(async () => ({
      data: { event: WELCOME_AUTOMATION_EVENT_NAME, object: "event" },
      error: null,
    }));

    const result = await sendWelcomeAutomationEvent(clerkUser, {
      client: { events: { send } },
      enabled: true,
    });

    expect(result).toEqual({
      ok: true,
      email: "gerry@example.com",
      event: WELCOME_AUTOMATION_EVENT_NAME,
    });
    expect(send).toHaveBeenCalledWith({
      email: "gerry@example.com",
      event: WELCOME_AUTOMATION_EVENT_NAME,
      payload: {
        clerk_user_id: "user_123",
        given_name: "Gerry",
        source: "clerk.user_created",
      },
    });
  });

  it("falls back to a plain greeting name when Clerk first name is blank", async () => {
    const send = vi.fn(async () => ({
      data: { event: WELCOME_AUTOMATION_EVENT_NAME, object: "event" },
      error: null,
    }));

    await sendWelcomeAutomationEvent(
      { ...clerkUser, first_name: " " },
      {
        client: { events: { send } },
        enabled: true,
      },
    );

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        given_name: "there",
      }),
    }));
  });

  it("skips explicitly unverified Clerk primary emails", async () => {
    const send = vi.fn();

    const result = await sendWelcomeAutomationEvent(
      {
        ...clerkUser,
        email_addresses: [
          {
            id: "primary",
            email_address: "unverified@example.com",
            verification: { status: "unverified" },
          },
        ],
      },
      {
        client: { events: { send } },
        enabled: true,
      },
    );

    expect(result).toEqual({
      ok: false,
      skipped: true,
      error: "Clerk user primary email is not verified",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("skips when the Clerk user has no primary email", async () => {
    const send = vi.fn();

    const result = await sendWelcomeAutomationEvent(
      { ...clerkUser, email_addresses: [], primary_email_address_id: null },
      {
        client: { events: { send } },
        enabled: true,
      },
    );

    expect(result).toEqual({
      ok: false,
      skipped: true,
      error: "Clerk user has no email address",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("reports a missing Resend events client", async () => {
    vi.stubEnv("RESEND_EVENTS_API_KEY", undefined);
    vi.stubEnv("RESEND_CONTACTS_API_KEY", undefined);

    const result = await sendWelcomeAutomationEvent(clerkUser, {
      enabled: true,
    });

    expect(result).toEqual({
      ok: false,
      error: "RESEND_EVENTS_API_KEY or RESEND_CONTACTS_API_KEY is not configured",
    });
  });

  it("reports a Resend event send error", async () => {
    const send = vi.fn(async () => ({
      data: null,
      error: { message: "event rejected" },
    }));

    const result = await sendWelcomeAutomationEvent(clerkUser, {
      client: { events: { send } },
      enabled: true,
    });

    expect(result).toEqual({
      ok: false,
      email: "gerry@example.com",
      event: WELCOME_AUTOMATION_EVENT_NAME,
      error: "event rejected",
    });
  });
});
