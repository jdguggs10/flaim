import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  applyMigrationPlan,
  buildMigrationPlan,
  createPlunkClient,
  listMigrationClerkUsers,
  parseArgs,
  parseResendContactsCsv,
  reconcileAppliedPlan,
  reconcileCurrentClerkCoverage,
} from "../../../scripts/migrate-marketing-contacts-to-plunk.mjs";

function response(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

describe("Plunk marketing contact migration", () => {
  it("parses the actual Resend contact fields and quoted CSV values", () => {
    const contacts = parseResendContactsCsv(
      '\uFEFFemail,first_name,last_name,unsubscribed\r\n"one@example.com","One, Jr.",User,false\r\ntwo@example.com,,,true\r\n',
    );

    expect(contacts).toEqual([
      {
        email: "one@example.com",
        firstName: "One, Jr.",
        lastName: "User",
        unsubscribed: false,
      },
      {
        email: "two@example.com",
        firstName: null,
        lastName: null,
        unsubscribed: true,
      },
    ]);
  });

  it("reports an invalid unsubscribe cell by row without echoing its value", () => {
    const csv = "email,unsubscribed\nuser@example.com,leak@example.com\n";
    expect(() => parseResendContactsCsv(csv)).toThrow(
      "Resend contact export row 2 has an unknown unsubscribe value",
    );
    try {
      parseResendContactsCsv(csv);
    } catch (error) {
      expect(String(error)).not.toContain("leak@example.com");
    }
  });

  it("unions Clerk and Resend while every false source wins", () => {
    const plan = buildMigrationPlan({
      clerkUsers: [
        {
          email_addresses: [{ email_address: "gap@example.com", id: "gap_email" }],
          first_name: "Gap",
          id: "clerk_gap",
          primary_email_address_id: "gap_email",
        },
        {
          email_addresses: [{ email_address: "false@example.com", id: "false_email" }],
          id: "clerk_false",
          primary_email_address_id: "false_email",
        },
      ],
      plunkContacts: [{ email: "gap@example.com", subscribed: false }],
      resendContacts: [
        {
          email: "retained@example.com",
          firstName: null,
          lastName: null,
          unsubscribed: false,
        },
        {
          email: "false@example.com",
          firstName: null,
          lastName: null,
          unsubscribed: true,
        },
      ],
      suppressions: [{ email: "suppression-only@example.com" }],
    });

    expect(plan.stats).toEqual({
      clerkCurrent: 2,
      clerkOnlyGap: 1,
      existingPlunkFalseProtected: 1,
      plannedFalse: 3,
      plannedTrue: 1,
      resendAllStatus: 2,
      resendOnlyRetained: 1,
      suppressionOnly: 1,
      suppressions: 1,
      union: 4,
    });
    expect(plan.targets.map(({ email, subscribed }) => ({ email, subscribed }))).toEqual([
      { email: "false@example.com", subscribed: false },
      { email: "gap@example.com", subscribed: false },
      { email: "suppression-only@example.com", subscribed: false },
      { email: "retained@example.com", subscribed: true },
    ]);
  });

  it("fails closed on a malformed suppression record", () => {
    expect(() =>
      buildMigrationPlan({
        clerkUsers: [],
        plunkContacts: [],
        resendContacts: [],
        suppressions: [{ email: "not-an-email" }],
      }),
    ).toThrow("Resend suppression record 1 has an invalid email");
  });

  it("reads Clerk through a frozen, ascending, count-checked snapshot", async () => {
    const users = [
      { id: "user_1", created_at: 1 },
      { id: "user_2", created_at: 2 },
      { id: "user_3", created_at: 3 },
    ];
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/users/count")) return response({ total_count: 3 });
      const offset = Number(url.searchParams.get("offset"));
      expect(url.searchParams.get("order_by")).toBe("+created_at");
      expect(url.searchParams.get("created_at_before")).toBe("12345");
      return response(offset === 0 ? users.slice(0, 2) : users.slice(2));
    });

    await expect(
      listMigrationClerkUsers({
        clerkSecretKey: "sk_test_clerk",
        cutoffMs: 12345,
        fetchImpl,
        limit: 2,
      }),
    ).resolves.toEqual(users);
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });

  it("uses the atomic track path for true targets without a subscribed override", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      response({ success: true, data: { contact: "contact_1", event: "event_1" } }),
    );
    const client = createPlunkClient({
      apiKey: "sk_test",
      delayMs: 0,
      fetchImpl,
      maxRetries: 0,
      publicApiKey: "pk_test",
    });

    await expect(
      client.applyTarget({ data: { source: "test" }, email: "user@example.com", subscribed: true }),
    ).resolves.toEqual({ action: "tracked_true" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://next-api.useplunk.com/v1/track");
    expect(init?.headers).toEqual(expect.objectContaining({ Authorization: "Bearer pk_test" }));
    expect(JSON.parse(String(init?.body))).not.toHaveProperty("subscribed");
  });

  it("writes false targets through the secret contacts API", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      response({ id: "contact_1", email: "false@example.com", subscribed: false }),
    );
    const client = createPlunkClient({
      apiKey: "sk_test",
      delayMs: 0,
      fetchImpl,
      maxRetries: 0,
      publicApiKey: "pk_test",
    });

    await expect(
      client.applyTarget({ data: { source: "test" }, email: "false@example.com", subscribed: false }),
    ).resolves.toEqual({ action: "upserted_false" });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://next-api.useplunk.com/contacts");
    expect(init?.headers).toEqual(expect.objectContaining({ Authorization: "Bearer sk_test" }));
    expect(JSON.parse(String(init?.body))).toEqual({
      data: { source: "test" },
      email: "false@example.com",
      subscribed: false,
    });
  });

  it("persists only hashes and resumes completed work", async () => {
    const directory = await mkdtemp(join(tmpdir(), "flaim-plunk-migration-"));
    const stateFile = join(directory, "state.json");
    const targets = [
      { data: {}, email: "false@example.com", subscribed: false },
      { data: {}, email: "true@example.com", subscribed: true },
    ];
    const applyTarget = vi.fn().mockResolvedValue({ action: "upserted_false" });

    const first = await applyMigrationPlan({
      client: { applyTarget },
      stateFile,
      targets,
    });
    const second = await applyMigrationPlan({
      client: { applyTarget },
      stateFile,
      targets,
    });
    const state = await readFile(stateFile, "utf8");

    expect(first).toEqual({ applied: 2, resumed: 0 });
    expect(second).toEqual({ applied: 0, resumed: 2 });
    expect(applyTarget).toHaveBeenCalledTimes(2);
    expect(state).not.toContain("false@example.com");
    expect(state).not.toContain("true@example.com");
  });

  it("reconciles false targets strictly while accepting a concurrent opt-out", () => {
    const result = reconcileAppliedPlan({
      plunkContacts: [
        { email: "false@example.com", subscribed: false },
        { email: "true@example.com", subscribed: true },
        { email: "opted-out-during-import@example.com", subscribed: false },
      ],
      targets: [
        { data: {}, email: "false@example.com", subscribed: false },
        { data: {}, email: "true@example.com", subscribed: true },
        { data: {}, email: "opted-out-during-import@example.com", subscribed: true },
      ],
    });

    expect(result).toEqual({
      concurrentFalsePreserved: 1,
      finalSubscribed: 1,
      finalTotal: 3,
      finalUnsubscribed: 2,
      missing: 0,
      plannedFalseVerified: 1,
      plannedTrueVerified: 1,
      safe: true,
      unsafeStateMismatches: 0,
    });
  });

  it("detects a Clerk signup that arrived after the planned snapshot", () => {
    const coverage = reconcileCurrentClerkCoverage({
      clerkUsers: [
        {
          email_addresses: [{ email_address: "present@example.com", id: "email_1" }],
          id: "user_1",
          primary_email_address_id: "email_1",
        },
        {
          email_addresses: [{ email_address: "late@example.com", id: "email_2" }],
          id: "user_2",
          primary_email_address_id: "email_2",
        },
      ],
      plunkContacts: [{ email: "present@example.com", subscribed: true }],
    });

    expect(coverage).toEqual({ clerkCurrent: 2, missing: 1, safe: false });
  });

  it("requires an explicit external state file before applying", () => {
    expect(() => parseArgs(["--resend-contacts", "/tmp/contacts.csv", "--apply"])).toThrow(
      "--state-file is required with --apply",
    );
  });

  it("refuses migration artifacts inside the repository", () => {
    expect(() =>
      parseArgs(["--resend-contacts", join(process.cwd(), "contacts.csv")]),
    ).toThrow("--resend-contacts must point outside the repository");
  });
});
