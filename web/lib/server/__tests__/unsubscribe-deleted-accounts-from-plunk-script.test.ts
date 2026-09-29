import { describe, expect, it, vi } from "vitest";
import {
  buildUnsubscribePlan,
  collectClerkEmails,
  listAllPlunkContacts,
  listDeletedClerkUserIds,
  parseArgs,
  run,
} from "../../../scripts/unsubscribe-deleted-accounts-from-plunk.mjs";

const CUTOFF_MS = Date.parse("2026-09-29T12:00:00.000Z");
const WRITE_PHASE_MS = CUTOFF_MS + 60_000;
const BEFORE = "2026-09-01T00:00:00.000Z";
const AFTER = "2026-09-29T12:00:01.000Z";

const ENV = {
  CLERK_SECRET_KEY: "sk_test_clerk",
  PLUNK_SECRET_API_KEY: "sk_test_plunk",
  SUPABASE_SERVICE_KEY: "sb_secret_test",
  SUPABASE_URL: "https://project.supabase.co",
};

type Contact = {
  createdAt: string;
  data?: Record<string, unknown> | null;
  email: string;
  id: string;
  subscribed: boolean;
};

type ClerkUser = {
  created_at: number;
  email_addresses: Array<{ email_address: string; id: string }>;
  id: string;
  primary_email_address_id: string;
};

type Plan = ReturnType<typeof buildUnsubscribePlan>;

function json(payload: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json", ...headers },
    status,
  });
}

function clerkUser(id: string, emails: string[], createdAt = 1): ClerkUser {
  return {
    created_at: createdAt,
    email_addresses: emails.map((email, index) => ({ email_address: email, id: `${id}_email_${index}` })),
    id,
    primary_email_address_id: `${id}_email_0`,
  };
}

function contact(id: string, email: string, overrides: Partial<Contact> = {}): Contact {
  return { createdAt: BEFORE, data: {}, email, id, subscribed: true, ...overrides };
}

function planContact(
  id: string,
  email: string,
  clerkUserId: string | null,
  overrides: { createdAtMs?: number; subscribed?: boolean } = {},
) {
  return { clerkUserId, createdAtMs: 1, data: {}, email, id, subscribed: true, ...overrides };
}

function matchedIds(plan: Plan) {
  return plan.matches.map((match: { contact: { id: string }; source: string }) => [
    match.contact.id,
    match.source,
  ]);
}

/**
 * One injected fetch for every provider. State is mutable so a test can land
 * a signup or a deletion between the scan and the write phase via `afterScan`,
 * which fires once, when the last Plunk list page of the first scan is served.
 * Clerk honors `created_at_before`, as the real API does.
 */
type ProviderState = { clerkUsers: ClerkUser[]; deletedIds: string[]; store: Map<string, Contact> };

function fakeProviders({
  afterPatch,
  afterScan,
  clerkList,
  clerkUsers = [clerkUser("user_current", ["current@example.com", "secondary@example.com"])],
  contacts,
  deletedIds = ["user_deleted"],
  lookupStatus = 200,
  pageSize = 2,
  patchStatus = 200,
  plunkPage,
}: {
  afterPatch?: (id: string, state: ProviderState) => void;
  afterScan?: (state: ProviderState) => void;
  clerkList?: (offset: number) => unknown;
  clerkUsers?: ClerkUser[];
  contacts: Contact[];
  deletedIds?: string[];
  lookupStatus?: number;
  pageSize?: number;
  patchStatus?: number;
  plunkPage?: (cursor: string | null) => unknown;
}) {
  const store = new Map(contacts.map((item) => [item.id, structuredClone(item)]));
  const patches: Array<{ body: unknown; id: string }> = [];
  const lookups: string[] = [];
  let scanned = false;

  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.host === "api.clerk.com" && url.searchParams.has("email_address")) {
      // Live per-address lookup: no cutoff, matches primary or secondary.
      const email = String(url.searchParams.get("email_address"));
      lookups.push(email);
      if (lookupStatus !== 200) return json({ errors: [{ message: "nope" }] }, lookupStatus);
      return json(
        clerkUsers.filter((user) =>
          user.email_addresses.some((address) => address.email_address.toLowerCase() === email),
        ),
      );
    }
    if (url.host === "api.clerk.com") {
      const before = Number(url.searchParams.get("created_at_before"));
      const visible = clerkUsers.filter((user) => user.created_at < before);
      if (url.pathname.endsWith("/users/count")) return json({ total_count: visible.length });
      const offset = Number(url.searchParams.get("offset"));
      if (clerkList) return json(clerkList(offset));
      const limit = Number(url.searchParams.get("limit"));
      return json(visible.slice(offset, offset + limit));
    }
    if (url.host === "project.supabase.co") {
      const rows = deletedIds.map((id) => ({ clerk_user_id: id }));
      const [from, to] = String((init?.headers as Record<string, string>).Range)
        .split("-")
        .map(Number);
      const page = rows.slice(from, to + 1);
      const range = page.length ? `${from}-${from + page.length - 1}` : "*";
      return json(page, 200, { "Content-Range": `${range}/${rows.length}` });
    }
    if (url.host === "next-api.useplunk.com") {
      const contactId = url.pathname.startsWith("/contacts/")
        ? decodeURIComponent(url.pathname.slice("/contacts/".length))
        : null;
      if (init?.method === "PATCH" && contactId) {
        const body = JSON.parse(String(init.body));
        patches.push({ body, id: contactId });
        if (patchStatus !== 200) return json({ error: "nope" }, patchStatus);
        const current = store.get(contactId);
        if (current) store.set(contactId, { ...current, subscribed: body.subscribed });
        afterPatch?.(contactId, { clerkUsers, deletedIds, store });
        return json({ id: contactId, subscribed: body.subscribed });
      }
      if (contactId) {
        const current = store.get(contactId);
        return current ? json(current) : json({ error: "not found" }, 404);
      }
      const cursor = url.searchParams.get("cursor");
      if (plunkPage) return json(plunkPage(cursor));
      const all = [...store.values()];
      const start = cursor ? Number(cursor) : 0;
      const data = all.slice(start, start + pageSize);
      const hasMore = start + pageSize < all.length;
      const page = json({
        cursor: hasMore ? String(start + pageSize) : null,
        data,
        hasMore,
        total: all.length,
      });
      if (!hasMore && !scanned) {
        scanned = true;
        afterScan?.({ clerkUsers, deletedIds, store });
      }
      return page;
    }
    throw new Error(`Unexpected request to ${url.host}`);
  });

  return { fetchImpl, lookups, patches, store };
}

async function runScript(argv: string[], fetchImpl: typeof fetch) {
  const lines: string[] = [];
  const times = [CUTOFF_MS, WRITE_PHASE_MS];
  const exitCode = await run(argv, {
    env: ENV as unknown as NodeJS.ProcessEnv,
    fetchImpl,
    log: (line: string) => lines.push(line),
    now: () => times.shift() ?? WRITE_PHASE_MS,
    plunkDelayMs: 0,
  });
  const output = lines.join("\n");
  return { exitCode, output, report: JSON.parse(lines[lines.length - 1]) };
}

describe("unsubscribe deleted accounts from Plunk", () => {
  it("matches rule 1 by deleted clerkUserId and rule 2 by missing current account", () => {
    const plan = buildUnsubscribePlan({
      clerkEmails: collectClerkEmails([clerkUser("user_current", ["current@example.com"])]),
      contacts: [
        planContact("c1", "gone@example.com", "user_deleted"),
        planContact("c2", "current@example.com", "user_current"),
        planContact("c3", "resend-only@example.com", null),
        planContact("c4", "current@example.com", null),
      ],
      cutoffMs: CUTOFF_MS,
      deletedClerkUserIds: new Set(["user_deleted"]),
    });

    expect(matchedIds(plan)).toEqual([
      ["c1", "account_deletion"],
      ["c3", "no_current_account"],
    ]);
    expect(plan.stats).toEqual({
      alreadyUnsubscribed: 0,
      rule1Matches: 1,
      rule1ProtectedByClerkEmail: 0,
      rule2Matches: 1,
      rule2ProtectedByClerkEmail: 1,
      rule2SkippedCreatedAfterSnapshot: 0,
      scanned: 4,
      subscribed: 4,
      subscribedWithoutClerkUserId: 2,
    });
  });

  it("keeps a deleted account's contact subscribed when a live account now owns the email", () => {
    const plan = buildUnsubscribePlan({
      clerkEmails: collectClerkEmails([clerkUser("user_new", ["Returning@Example.com"])]),
      contacts: [planContact("c1", "returning@example.com", "user_deleted")],
      cutoffMs: CUTOFF_MS,
      deletedClerkUserIds: new Set(["user_deleted"]),
    });

    expect(plan.matches).toEqual([]);
    expect(plan.stats.rule1ProtectedByClerkEmail).toBe(1);
    expect(plan.stats.rule1Matches).toBe(0);
  });

  it("protects a contact whose email is a secondary Clerk address", () => {
    const plan = buildUnsubscribePlan({
      clerkEmails: collectClerkEmails([
        clerkUser("user_current", ["primary@example.com", "Secondary@Example.com"]),
      ]),
      contacts: [planContact("c1", "secondary@example.com", null)],
      cutoffMs: CUTOFF_MS,
      deletedClerkUserIds: new Set(),
    });

    expect(plan.matches).toEqual([]);
    expect(plan.stats.rule2ProtectedByClerkEmail).toBe(1);
  });

  it("skips already-unsubscribed contacts even when a rule would match", () => {
    const plan = buildUnsubscribePlan({
      clerkEmails: new Set(),
      contacts: [
        planContact("c1", "a@example.com", "user_deleted", { subscribed: false }),
        planContact("c2", "b@example.com", null, { subscribed: false }),
      ],
      cutoffMs: CUTOFF_MS,
      deletedClerkUserIds: new Set(["user_deleted"]),
    });

    expect(plan.matches).toEqual([]);
    expect(plan.stats.alreadyUnsubscribed).toBe(2);
    expect(plan.stats.subscribed).toBe(0);
  });

  it("never applies rule 2 to a contact created at or after the Clerk snapshot", () => {
    const plan = buildUnsubscribePlan({
      clerkEmails: new Set(),
      contacts: [
        planContact("c1", "at@example.com", null, { createdAtMs: CUTOFF_MS }),
        planContact("c2", "late@example.com", null, { createdAtMs: CUTOFF_MS + 1 }),
      ],
      cutoffMs: CUTOFF_MS,
      deletedClerkUserIds: new Set(),
    });

    expect(plan.matches).toEqual([]);
    expect(plan.stats.rule2SkippedCreatedAfterSnapshot).toBe(2);
  });

  it("dry run makes zero writes and prints counts without addresses or ids", async () => {
    const { fetchImpl, patches } = fakeProviders({
      contacts: [
        contact("c1", "gone@example.com", { data: { clerkUserId: "user_deleted" } }),
        contact("c2", "resend-only@example.com"),
        contact("c3", "secondary@example.com"),
        contact("c4", "late@example.com", { createdAt: AFTER }),
        contact("c5", "opted-out@example.com", { subscribed: false }),
      ],
    });

    const { exitCode, output, report } = await runScript([], fetchImpl);

    expect(exitCode).toBe(0);
    expect(patches).toEqual([]);
    expect(fetchImpl.mock.calls.every(([, init]) => (init?.method ?? "GET") === "GET")).toBe(true);
    expect(report).toMatchObject({
      deletedAccounts: 1,
      mode: "dry-run",
      plunk: {
        alreadyUnsubscribed: 1,
        rule1Matches: 1,
        rule1ProtectedByClerkEmail: 0,
        rule2Matches: 1,
        rule2ProtectedByClerkEmail: 1,
        rule2SkippedCreatedAfterSnapshot: 1,
        scanned: 5,
        subscribed: 4,
        subscribedWithoutClerkUserId: 3,
      },
      status: "complete",
      totalMatches: 2,
    });
    expect(output).not.toMatch(/@example\.com/);
    expect(output).not.toContain("user_deleted");
    expect(output).not.toContain("c1");
  });

  it("applies with a subscribed-only PATCH and verifies on a fresh read", async () => {
    const { fetchImpl, patches, store } = fakeProviders({
      contacts: [
        contact("c1", "gone@example.com", { data: { clerkUserId: "user_deleted", source: "x" } }),
        contact("c2", "resend-only@example.com", { data: null }),
        contact("c3", "current@example.com", { data: { clerkUserId: "user_current" } }),
      ],
    });

    const { exitCode, report } = await runScript(["--apply"], fetchImpl);

    expect(exitCode).toBe(0);
    expect(patches).toEqual([
      { body: { subscribed: false }, id: "c1" },
      { body: { subscribed: false }, id: "c2" },
    ]);
    expect(store.get("c1")?.data).toEqual({ clerkUserId: "user_deleted", source: "x" });
    expect(store.get("c3")?.subscribed).toBe(true);
    expect(report).toMatchObject({
      applied: 2,
      failed: 0,
      mode: "apply",
      skippedNoLongerQualifies: 0,
      status: "complete",
      verification: { missing: 0, safe: true, stillSubscribed: 0, verified: 2 },
    });
  });

  it("re-checks each match before writing and skips contacts a signup claimed after the scan", async () => {
    const { fetchImpl, patches, store } = fakeProviders({
      afterScan: ({ clerkUsers, store: contacts }) => {
        // c2: the signup sync attached a live clerkUserId to the contact.
        const claimed = contacts.get("c2");
        if (claimed) contacts.set("c2", { ...claimed, data: { clerkUserId: "user_new_a" } });
        clerkUsers.push(clerkUser("user_new_a", ["claimed@example.com"], CUTOFF_MS + 1_000));
        // c3: only Clerk knows the new owner so far; the contact is unchanged.
        clerkUsers.push(clerkUser("user_new_b", ["owned@example.com"], CUTOFF_MS + 2_000));
      },
      contacts: [
        contact("c1", "gone@example.com", { data: { clerkUserId: "user_deleted" } }),
        contact("c2", "claimed@example.com"),
        contact("c3", "owned@example.com"),
      ],
    });

    const { exitCode, report } = await runScript(["--apply"], fetchImpl);

    expect(exitCode).toBe(0);
    expect(patches).toEqual([{ body: { subscribed: false }, id: "c1" }]);
    expect(store.get("c2")?.subscribed).toBe(true);
    expect(store.get("c3")?.subscribed).toBe(true);
    expect(report).toMatchObject({
      applied: 1,
      failed: 0,
      skippedNoLongerQualifies: 2,
      status: "complete",
      totalMatches: 3,
      verification: { safe: true, verified: 1 },
    });
  });

  it("reports an incomplete apply when a write fails", async () => {
    const { fetchImpl, store } = fakeProviders({
      contacts: [contact("c1", "gone@example.com", { data: { clerkUserId: "user_deleted" } })],
      patchStatus: 400,
    });

    const { exitCode, report } = await runScript(["--apply", "--max-retries", "0"], fetchImpl);

    expect(exitCode).toBe(1);
    expect(store.get("c1")?.subscribed).toBe(true);
    expect(report).toMatchObject({ applied: 0, failed: 1, status: "incomplete" });
  });

  it("skips a contact whose address a signup claims between two writes", async () => {
    const { fetchImpl, lookups, patches, store } = fakeProviders({
      afterPatch: (id, { clerkUsers }) => {
        if (id === "c1") {
          clerkUsers.push(clerkUser("user_new", ["second@example.com"], WRITE_PHASE_MS));
        }
      },
      contacts: [contact("c1", "first@example.com"), contact("c2", "second@example.com")],
    });

    const { exitCode, report } = await runScript(["--apply"], fetchImpl);

    expect(exitCode).toBe(0);
    expect(lookups).toEqual(["first@example.com", "second@example.com"]);
    expect(patches).toEqual([{ body: { subscribed: false }, id: "c1" }]);
    expect(store.get("c2")?.subscribed).toBe(true);
    expect(report).toMatchObject({
      applied: 1,
      failed: 0,
      skippedNoLongerQualifies: 1,
      status: "complete",
      totalMatches: 2,
    });
  });

  it("counts a failed Clerk lookup as failed and does not write", async () => {
    const { fetchImpl, patches } = fakeProviders({
      contacts: [contact("c1", "resend-only@example.com")],
      lookupStatus: 500,
    });

    const { exitCode, report } = await runScript(["--apply"], fetchImpl);

    expect(exitCode).toBe(1);
    expect(patches).toEqual([]);
    expect(report).toMatchObject({ applied: 0, failed: 1, status: "incomplete" });
  });

  it.each([
    [
      "an account deletion lands during the scan",
      ({ deletedIds }: ProviderState) => {
        deletedIds.push("user_deleted_mid_run");
      },
      { clerkSnapshotChanged: false, deletedAccountsChanged: true },
    ],
    [
      "a Clerk user disappears from the frozen snapshot",
      ({ clerkUsers }: ProviderState) => {
        clerkUsers.pop();
      },
      { clerkSnapshotChanged: true, deletedAccountsChanged: false },
    ],
    [
      "a Clerk user swaps a secondary address with the count unchanged",
      ({ clerkUsers }: ProviderState) => {
        clerkUsers[0].email_addresses[1] = { email_address: "new-secondary@example.com", id: "e_new" };
      },
      { clerkSnapshotChanged: true, deletedAccountsChanged: false },
    ],
  ])("reports rerun, not a clean result, when %s", async (_label, afterScan, drift) => {
    const { fetchImpl, patches } = fakeProviders({
      afterScan,
      clerkUsers: [
        clerkUser("user_current", ["current@example.com", "old-secondary@example.com"]),
        clerkUser("user_other", ["other@example.com"]),
      ],
      contacts: [contact("c1", "current@example.com", { data: { clerkUserId: "user_current" } })],
    });

    const { exitCode, report } = await runScript(["--apply"], fetchImpl);

    expect(exitCode).toBe(1);
    expect(patches).toEqual([]);
    expect(report).toMatchObject({ drift, status: "rerun", totalMatches: 0 });
  });

  it("fails closed when the Clerk snapshot returns an empty page before its total", async () => {
    const { fetchImpl, patches } = fakeProviders({
      clerkList: () => [],
      contacts: [contact("c1", "resend-only@example.com")],
    });

    await expect(runScript(["--apply"], fetchImpl)).rejects.toThrow(
      /empty page before the reported total/,
    );
    expect(patches).toEqual([]);
  });

  it("fails closed when matches exceed the ceiling, before any write", async () => {
    const { fetchImpl, patches } = fakeProviders({
      contacts: [contact("c1", "one@example.com"), contact("c2", "two@example.com")],
    });

    await expect(runScript(["--apply", "--max-matches", "1"], fetchImpl)).rejects.toThrow(
      "2 matches exceed --max-matches 1",
    );
    expect(patches).toEqual([]);
  });

  it("fails closed on a malformed Plunk page", async () => {
    const { fetchImpl, patches } = fakeProviders({
      contacts: [],
      plunkPage: () => ({ data: [{ email: "x@example.com", id: "c1", subscribed: "yes" }], hasMore: false, total: 1 }),
    });

    await expect(runScript(["--apply"], fetchImpl)).rejects.toThrow(
      "Plunk contact at position 1 has a non-boolean subscribed state",
    );
    expect(patches).toEqual([]);
  });

  it("fails closed without echoing an invalid email", async () => {
    const request = vi.fn().mockResolvedValue(
      json({ data: [contact("c1", "not an email@example.com")], hasMore: false, total: 1 }),
    );
    await expect(listAllPlunkContacts({ request })).rejects.toThrow(
      /^Plunk contact at position 1 has an invalid email$/,
    );
  });

  it("fails closed when the scanned count does not match the reported total", async () => {
    const request = vi.fn().mockResolvedValue(
      json({ data: [contact("c1", "a@example.com")], hasMore: false, total: 2 }),
    );
    await expect(listAllPlunkContacts({ request })).rejects.toThrow(
      "Plunk contact scan read 1 contacts but the API reported 2; rerun",
    );
  });

  it("fails closed when a page claims more results without a cursor", async () => {
    const request = vi.fn().mockResolvedValue(
      json({ cursor: null, data: [contact("c1", "a@example.com")], hasMore: true, total: 2 }),
    );
    await expect(listAllPlunkContacts({ request })).rejects.toThrow(
      "Plunk contact list cursor was missing",
    );
  });

  it("reads account_deletions with the sb_secret_ header contract and a count check", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      const headers = init?.headers as Record<string, string>;
      expect(headers.apikey).toBe("sb_secret_test");
      expect(headers.Authorization).toBeUndefined();
      expect(headers.Prefer).toBe("count=exact");
      return headers.Range === "0-1"
        ? json([{ clerk_user_id: "a" }, { clerk_user_id: "b" }], 200, { "Content-Range": "0-1/3" })
        : json([{ clerk_user_id: "c" }], 200, { "Content-Range": "2-2/3" });
    });

    const ids = await listDeletedClerkUserIds({
      fetchImpl,
      pageSize: 2,
      supabaseServiceKey: "sb_secret_test",
      supabaseUrl: "https://project.supabase.co",
    });
    expect([...ids]).toEqual(["a", "b", "c"]);
  });

  it("fails closed when account_deletions returns fewer rows than its count", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json([{ clerk_user_id: "a" }], 200, { "Content-Range": "0-0/2" }),
    );
    await expect(
      listDeletedClerkUserIds({
        fetchImpl,
        pageSize: 5,
        supabaseServiceKey: "legacy-jwt",
        supabaseUrl: "https://project.supabase.co",
      }),
    ).rejects.toThrow("Supabase account_deletions read 1 of 2 rows; rerun");
  });

  it("refuses an empty Clerk snapshot", async () => {
    const { fetchImpl } = fakeProviders({ clerkUsers: [], contacts: [] });
    await expect(runScript([], fetchImpl)).rejects.toThrow("Clerk snapshot is empty");
  });

  it("validates flags", () => {
    expect(parseArgs([])).toMatchObject({ apply: false, maxMatches: 200 });
    expect(() => parseArgs(["--max-matches", "-1"])).toThrow("--max-matches must be a non-negative integer");
    expect(() => parseArgs(["--delay-ms", "10"])).toThrow("--delay-ms must be at least 60");
    expect(() => parseArgs(["--delete"])).toThrow("Unknown argument: --delete");
  });
});
