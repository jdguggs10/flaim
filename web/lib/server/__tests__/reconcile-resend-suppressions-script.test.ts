import { describe, expect, it, vi } from "vitest";

import {
  indexClerkPrimaryEmails,
  listAllSuppressions,
  maskEmail,
  normalizeSuppressionPage,
  parseArgs,
  reconcileSuppressions,
} from "../../../scripts/reconcile-resend-suppressions.mjs";

describe("reconcile-resend-suppressions script helpers", () => {
  it("defaults to a read-only dry run", () => {
    expect(parseArgs([])).toMatchObject({ dryRun: true, suppressionLimit: 100 });
  });

  it("accepts the current SDK nested pagination response", () => {
    expect(normalizeSuppressionPage({
      data: {
        data: [{ email: "fan@example.com", id: "supp_123", origin: "bounce" }],
        has_more: true,
        object: "list",
      },
      error: null,
    })).toEqual({
      entries: [{ email: "fan@example.com", id: "supp_123", origin: "bounce" }],
      hasMore: true,
    });
  });

  it("uses the final suppression id as the current SDK cursor and never invokes a delete API", async () => {
    const list = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          data: [
            { email: "first@example.com", id: "supp_1", origin: "bounce" },
            { email: "second@example.com", id: "supp_2", origin: "complaint" },
          ],
          has_more: true,
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          data: [{ email: "third@example.com", id: "supp_3", origin: "manual" }],
          has_more: false,
        },
        error: null,
      });
    const remove = vi.fn();

    const suppressions = await listAllSuppressions({
      client: { suppressions: { list, remove } },
      limit: 2,
      maxSuppressions: 10,
    });

    expect(suppressions.map((suppression) => suppression.id)).toEqual([
      "supp_1",
      "supp_2",
      "supp_3",
    ]);
    expect(list).toHaveBeenNthCalledWith(1, { limit: 2 });
    expect(list).toHaveBeenNthCalledWith(2, { after: "supp_2", limit: 2 });
    expect(remove).not.toHaveBeenCalled();
  });

  it("reports only masked suppression addresses and their Clerk-user match", () => {
    const clerkUsersByEmail = indexClerkPrimaryEmails([
      {
        email_addresses: [{ id: "primary", email_address: "Fan@Example.com" }],
        id: "user_123",
        primary_email_address_id: "primary",
      },
    ]);

    expect(reconcileSuppressions({
      clerkUsersByEmail,
      suppressions: [
        { email: "fan@example.com", id: "supp_123", origin: "bounce" },
        { email: "missing@example.com", id: "supp_456", origin: "complaint" },
      ],
    })).toEqual([
      {
        clerkUserId: "user_123",
        email: "fa*@example.com",
        id: "supp_123",
        origin: "bounce",
      },
      {
        clerkUserId: null,
        email: "mi*****@example.com",
        id: "supp_456",
        origin: "complaint",
      },
    ]);
    expect(maskEmail("fan@example.com")).toBe("fa*@example.com");
  });
});
