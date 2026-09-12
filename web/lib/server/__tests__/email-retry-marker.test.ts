import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  clearEmailRetry,
  EMAIL_RETRY_METADATA_KEY,
  hasEmailRetryMarker,
  markEmailRetry,
} from "../email-retry-marker";

function makeClient() {
  return {
    users: {
      updateUserMetadata: vi.fn(async () => ({})),
    },
  };
}

describe("email retry markers", () => {
  it("writes only the failed retry marker with a deterministic timestamp", async () => {
    const client = makeClient();

    const result = await markEmailRetry("user_123", "contactSync", {
      client,
      metadata: { unrelated: { preserved: true } },
      now: new Date("2026-08-24T12:00:00.000Z"),
    });

    expect(result).toEqual({ ok: true, skipped: false });
    expect(client.users.updateUserMetadata).toHaveBeenCalledWith("user_123", {
      privateMetadata: {
        [EMAIL_RETRY_METADATA_KEY]: {
          contactSync: { failedAt: "2026-08-24T12:00:00.000Z" },
        },
      },
    });
  });

  it("does not update metadata for the second failed contact-sync webhook carrying its existing marker", async () => {
    const client = makeClient();
    const metadata = {
      [EMAIL_RETRY_METADATA_KEY]: {
        contactSync: { failedAt: "2026-08-24T12:00:00.000Z" },
      },
    };

    const result = await markEmailRetry("user_123", "contactSync", { client, metadata });

    expect(result).toEqual({ ok: true, skipped: true });
    expect(client.users.updateUserMetadata).not.toHaveBeenCalled();
    expect(hasEmailRetryMarker(metadata, "contactSync")).toBe(true);
  });

  it("clears only the completed marker through Clerk deep-merge deletion", async () => {
    const client = makeClient();
    const metadata = {
      [EMAIL_RETRY_METADATA_KEY]: {
        contactSync: { failedAt: "2026-08-24T12:00:00.000Z" },
        welcomeEvent: { failedAt: "2026-08-24T11:00:00.000Z" },
      },
    };

    const result = await clearEmailRetry("user_123", "contactSync", { client, metadata });

    expect(result).toEqual({ ok: true, skipped: false });
    expect(client.users.updateUserMetadata).toHaveBeenCalledWith("user_123", {
      privateMetadata: {
        [EMAIL_RETRY_METADATA_KEY]: {
          contactSync: null,
        },
      },
    });
  });
});
