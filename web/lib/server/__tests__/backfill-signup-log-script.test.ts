import { describe, expect, it, vi } from "vitest";

import {
  buildRecordSignupRequest,
  fetchUserCount,
  formatReport,
  listUsersAtCutoff,
  normalizeFirstTouch,
  parseArgs,
  PaginationAnomalyError,
  run,
  validateCreatedAt,
} from "../../../scripts/backfill-signup-log.mjs";
import { normalizeFirstTouch as normalizeFirstTouchTs } from "../signup-log";

const CAPTURED_AT = "2025-08-24T02:26:39.000Z";

function acquisition(fields: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    capturedAt: CAPTURED_AT,
    landingPath: "/",
    ...fields,
  };
}

function jsonResponse(body: unknown, status = 200) {
  return {
    json: async () => body,
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
  };
}

function clerkUser(id: string, createdAt: number) {
  return { created_at: createdAt, id };
}

/**
 * A Clerk pager fixture routed by URL path, matching the real REST shapes:
 * `/v1/users` returns a bare array, `/v1/users/count` returns the
 * `{ object: "total_count", total_count }` envelope, and the record_signup
 * RPC endpoint returns a plain status.
 */
function fixtureFetch({
  users,
  recordSignupStatus = 204,
}: {
  users: Array<Record<string, unknown>>;
  recordSignupStatus?: number;
}) {
  const recordSignupCalls: string[] = [];
  const fetchImpl = vi.fn(async (input: URL | string) => {
    const url = new URL(String(input));
    if (url.pathname.includes("/rpc/record_signup")) {
      recordSignupCalls.push(url.toString());
      return jsonResponse({}, recordSignupStatus);
    }
    if (url.pathname.endsWith("/users/count")) {
      return jsonResponse({ object: "total_count", total_count: users.length });
    }
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const limit = Number(url.searchParams.get("limit") ?? 100);
    return jsonResponse(users.slice(offset, offset + limit));
  });

  return { fetchImpl, recordSignupCalls };
}

const DRY_RUN_ENV = { CLERK_SECRET_KEY: "sk_test" };

const APPLY_ENV = {
  CLERK_SECRET_KEY: "sk_test",
  SUPABASE_URL: "https://proj.supabase.co",
  SUPABASE_SERVICE_KEY: "sb_secret_abc",
};

/**
 * `run` comes from a plain .mjs, so its injected `env`/`fetchImpl` infer as the
 * full `ProcessEnv` and `fetch` types. The fixtures deliberately implement only
 * the slice the script touches.
 */
function runScript(
  argv: string[],
  options: {
    env: Record<string, string>;
    fetchImpl: unknown;
    log: (line: string) => void;
  }
): Promise<number> {
  return run(argv, options as unknown as Parameters<typeof run>[1]);
}

describe("backfill-signup-log script helpers", () => {
  it("defaults to dry-run mode", () => {
    expect(parseArgs([])).toMatchObject({
      apply: false,
      cutoff: null,
      delayMs: 0,
      limit: 100,
      offset: 0,
    });
  });

  it("caps --limit at 500", () => {
    expect(parseArgs(["--limit", "10000"])).toMatchObject({ limit: 500 });
  });

  it("parses --apply, --delay-ms, and --cutoff", () => {
    expect(
      parseArgs(["--apply", "--delay-ms", "10", "--cutoff", "2026-09-01T00:00:00.000Z"])
    ).toMatchObject({
      apply: true,
      cutoff: "2026-09-01T00:00:00.000Z",
      delayMs: 10,
      offset: 0,
    });
  });

  it("parses --offset and --max-users for a dry run", () => {
    expect(parseArgs(["--offset", "50", "--max-users", "5"])).toMatchObject({
      apply: false,
      maxUsers: 5,
      offset: 50,
    });
  });

  it("rejects an invalid --cutoff", () => {
    expect(() => parseArgs(["--cutoff", "not-a-date"])).toThrow("--cutoff must be a valid ISO date");
  });

  it("refuses --offset and --max-users with --apply, but allows them for a dry run", () => {
    expect(() => parseArgs(["--apply", "--offset", "5"])).toThrow(
      /--offset is not allowed with --apply/
    );
    expect(() => parseArgs(["--apply", "--max-users", "5"])).toThrow(
      /--max-users is not allowed with --apply/
    );
    expect(parseArgs(["--offset", "5", "--max-users", "5"])).toMatchObject({
      apply: false,
      maxUsers: 5,
      offset: 5,
    });
  });

  describe("listUsersAtCutoff", () => {
    it("sends the frozen cutoff and ascending order on every page, including count calls", async () => {
      const fetchImpl = vi.fn(async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/users/count")) {
          return jsonResponse({ object: "total_count", total_count: 1 });
        }
        return jsonResponse([clerkUser("user_1", 1000)]);
      });

      const pages = [];
      for await (const page of listUsersAtCutoff({
        clerkSecretKey: "sk_test",
        cutoffMs: 5000,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        limit: 10,
      })) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(fetchImpl.mock.calls.length).toBeGreaterThan(0);
      for (const [input] of fetchImpl.mock.calls) {
        const url = input as URL;
        expect(url.searchParams.get("created_at_before")).toBe("5000");
        if (!url.pathname.endsWith("/users/count")) {
          expect(url.searchParams.get("order_by")).toBe("+created_at");
        }
      }
    });

    it("freezes the cutoff across multiple pages", async () => {
      const listPages = [[clerkUser("user_1", 1000)], [clerkUser("user_2", 2000)]];
      let listCallIndex = 0;
      const fetchImpl = vi.fn(async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/users/count")) {
          return jsonResponse({ object: "total_count", total_count: 2 });
        }
        const page = listPages[listCallIndex] ?? [];
        listCallIndex += 1;
        return jsonResponse(page);
      });

      const pages = [];
      for await (const page of listUsersAtCutoff({
        clerkSecretKey: "sk_test",
        cutoffMs: 5000,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        limit: 1,
      })) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      for (const [input] of fetchImpl.mock.calls) {
        expect((input as URL).searchParams.get("created_at_before")).toBe("5000");
      }
    });

    it("throws with a resume offset when total_count changes mid-pagination", async () => {
      let countCallIndex = 0;
      const fetchImpl = vi.fn(async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/users/count")) {
          countCallIndex += 1;
          return jsonResponse({
            object: "total_count",
            total_count: countCallIndex === 1 ? 2 : 3,
          });
        }
        return jsonResponse([clerkUser("user_1", 1000)]);
      });

      const drain = async () => {
        for await (const _page of listUsersAtCutoff({
          clerkSecretKey: "sk_test",
          cutoffMs: 5000,
          fetchImpl: fetchImpl as unknown as typeof fetch,
          limit: 1,
        })) {
          // drain
        }
      };

      let caught: unknown;
      try {
        await drain();
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(PaginationAnomalyError);
      expect((caught as { resumeOffset: number }).resumeOffset).toBe(1);
    });

    it("throws on a duplicate id", async () => {
      const fetchImpl = vi.fn(async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/users/count")) {
          return jsonResponse({ object: "total_count", total_count: 2 });
        }
        return jsonResponse([clerkUser("user_1", 1000), clerkUser("user_1", 2000)]);
      });

      const drain = async () => {
        for await (const _page of listUsersAtCutoff({
          clerkSecretKey: "sk_test",
          cutoffMs: 5000,
          fetchImpl: fetchImpl as unknown as typeof fetch,
          limit: 10,
        })) {
          // drain
        }
      };

      await expect(drain()).rejects.toThrow(/duplicate/);
    });

    it("throws on a short page before the reported total is reached", async () => {
      const fetchImpl = vi.fn(async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/users/count")) {
          return jsonResponse({ object: "total_count", total_count: 5 });
        }
        return jsonResponse([clerkUser("user_1", 1000)]);
      });

      const drain = async () => {
        for await (const _page of listUsersAtCutoff({
          clerkSecretKey: "sk_test",
          cutoffMs: 5000,
          fetchImpl: fetchImpl as unknown as typeof fetch,
          limit: 10,
        })) {
          // drain
        }
      };

      await expect(drain()).rejects.toThrow(/short page/);
      await expect(drain()).rejects.toMatchObject({ resumeOffset: 1 });
    });
  });

  describe("fetchUserCount", () => {
    it("sends created_at_before and returns the integer total", async () => {
      const fetchImpl = vi.fn(async (_input) =>
        jsonResponse({ object: "total_count", total_count: 42 })
      );

      const total = await fetchUserCount({ clerkSecretKey: "sk_test", cutoffMs: 5000, fetchImpl });

      expect(total).toBe(42);
      const [url] = fetchImpl.mock.calls[0];
      expect(String(url)).toContain("/v1/users/count");
      expect((url as URL).searchParams.get("created_at_before")).toBe("5000");
    });

    it("throws on a non-2xx response", async () => {
      const fetchImpl = vi.fn(async () => jsonResponse({ message: "nope" }, 500));

      await expect(
        fetchUserCount({ clerkSecretKey: "sk_test", cutoffMs: 5000, fetchImpl })
      ).rejects.toThrow(/Clerk user count failed/);
    });

    it("throws when total_count is not a non-negative integer", async () => {
      const fetchImpl = vi.fn(async () =>
        jsonResponse({ object: "total_count", total_count: "42" })
      );

      await expect(
        fetchUserCount({ clerkSecretKey: "sk_test", cutoffMs: 5000, fetchImpl })
      ).rejects.toThrow(/unexpected response shape/);
    });
  });

  describe("validateCreatedAt", () => {
    it("accepts a finite integer millisecond timestamp in range", () => {
      const now = Date.parse("2026-09-15T00:00:00.000Z");
      expect(validateCreatedAt(Date.parse("2026-01-01T00:00:00.000Z"), { now })).toBe(
        Date.parse("2026-01-01T00:00:00.000Z")
      );
    });

    it("rejects NaN, non-integer, missing, and out-of-range values", () => {
      const now = Date.parse("2026-09-15T00:00:00.000Z");
      expect(validateCreatedAt(Number.NaN, { now })).toBeNull();
      expect(validateCreatedAt(1234.5, { now })).toBeNull();
      expect(validateCreatedAt(undefined, { now })).toBeNull();
      expect(validateCreatedAt("1700000000000", { now })).toBeNull();
      expect(validateCreatedAt(Date.parse("2000-01-01T00:00:00.000Z"), { now })).toBeNull();
      expect(validateCreatedAt(now + 30 * 24 * 60 * 60 * 1000, { now })).toBeNull();
    });
  });

  describe("normalizeFirstTouch", () => {
    it("returns null when the schema version, capturedAt, or landing path is invalid", () => {
      expect(normalizeFirstTouch(undefined)).toBeNull();
      expect(normalizeFirstTouch({ flaimAcquisition: acquisition({ schemaVersion: 2 }) })).toBeNull();
      expect(
        normalizeFirstTouch({ flaimAcquisition: { landingPath: "/x", schemaVersion: 1 } })
      ).toBeNull();
      expect(
        normalizeFirstTouch({ flaimAcquisition: acquisition({ landingPath: "no-leading-slash" }) })
      ).toBeNull();
    });

    it("keeps a realistic first touch and drops capturedAt, which the row does not store", () => {
      expect(
        normalizeFirstTouch({
          flaimAcquisition: acquisition({ landingPath: "/join", ref: "hn" }),
        })
      ).toEqual({ landingPath: "/join", ref: "hn", schemaVersion: 1 });
    });
  });

  // The script cannot import the TypeScript mapper, so the only thing keeping
  // the two copies honest is this: identical fixtures, identical output.
  describe("first-touch parity with web/lib/server/signup-log.ts", () => {
    const fixtures: Array<[string, unknown]> = [
      ["missing bag", undefined],
      ["empty bag", {}],
      ["no capturedAt", { flaimAcquisition: { schemaVersion: 1, landingPath: "/" } }],
      ["unparseable capturedAt", { flaimAcquisition: acquisition({ capturedAt: "nope" }) }],
      ["wrong schema version", { flaimAcquisition: acquisition({ schemaVersion: 2 }) }],
      ["full realistic payload", {
        flaimAcquisition: acquisition({
          landingPath: "/guides/espn",
          ref: "hn",
          referrerHost: "news.ycombinator.com",
          utmCampaign: "launch",
          utmContent: "cta-top",
          utmMedium: "email",
          utmSource: "newsletter",
          utmTerm: "espn",
        }),
      }],
      ["control characters", {
        flaimAcquisition: acquisition({ utmSource: "  news\u0000letter  <b>  " }),
      }],
      ["markup-only dimension", { flaimAcquisition: acquisition({ ref: "`|[]*~" }) }],
      ["query in landing path", {
        flaimAcquisition: acquisition({ landingPath: "/guides?utm_source=evil" }),
      }],
      ["fragment in landing path", {
        flaimAcquisition: acquisition({ landingPath: "/guides#frag" }),
      }],
      ["oversized landing path", {
        flaimAcquisition: acquisition({ landingPath: `/${"a".repeat(500)}` }),
      }],
      ["oversized dimension", {
        flaimAcquisition: acquisition({ utmSource: "a".repeat(500) }),
      }],
      ["non-string dimension", {
        flaimAcquisition: acquisition({ utmMedium: { nested: true } }),
      }],
      ["mixed-case referrer host", {
        flaimAcquisition: acquisition({ referrerHost: "News.YCombinator.COM" }),
      }],
      ["referrer host with a scheme", {
        flaimAcquisition: acquisition({ referrerHost: "https://news.ycombinator.com" }),
      }],
      ["referrer host with a path", {
        flaimAcquisition: acquisition({ referrerHost: "news.ycombinator.com/x" }),
      }],
      ["referrer host with a port", {
        flaimAcquisition: acquisition({ referrerHost: "news.ycombinator.com:8443" }),
      }],
    ];

    it.each(fixtures)("agrees on %s", (_name, fixture) => {
      expect(normalizeFirstTouch(fixture)).toEqual(normalizeFirstTouchTs(fixture));
    });

    it("lower-cases the referrer host on both sides", () => {
      const fixture = {
        flaimAcquisition: acquisition({ referrerHost: "News.YCombinator.COM" }),
      };
      expect(normalizeFirstTouch(fixture)).toMatchObject({
        referrerHost: "news.ycombinator.com",
      });
    });
  });

  describe("buildRecordSignupRequest", () => {
    it("sends only apikey for a new-style secret key", () => {
      const request = buildRecordSignupRequest("https://proj.supabase.co", "sb_secret_abc", {
        clerkUserId: "user_1",
        createdAtIso: "2026-01-01T00:00:00.000Z",
        firstTouch: null,
      });

      expect(request.headers.apikey).toBe("sb_secret_abc");
      expect((request.headers as Record<string, string>).Authorization).toBeUndefined();
      expect(request.url).toBe("https://proj.supabase.co/rest/v1/rpc/record_signup");
      expect(JSON.parse(request.body)).toEqual({
        p_clerk_user_id: "user_1",
        p_created_at: "2026-01-01T00:00:00.000Z",
        p_first_touch: null,
        p_source: "backfill",
      });
    });

    it("sends both apikey and Authorization for a legacy JWT key", () => {
      const request = buildRecordSignupRequest("https://proj.supabase.co", "eyJhbGciOi...", {
        clerkUserId: "user_1",
        createdAtIso: "2026-01-01T00:00:00.000Z",
        firstTouch: { landingPath: "/", schemaVersion: 1 },
      });

      expect(request.headers.apikey).toBe("eyJhbGciOi...");
      expect((request.headers as Record<string, string>).Authorization).toBe("Bearer eyJhbGciOi...");
    });
  });

  describe("run", () => {
    const users = [
      clerkUser("user_1", Date.parse("2026-01-01T00:00:00.000Z")),
      clerkUser("user_2", Date.parse("2026-02-01T00:00:00.000Z")),
    ];

    it("performs zero record_signup calls without --apply", async () => {
      const { fetchImpl, recordSignupCalls } = fixtureFetch({ users });
      const log = vi.fn();

      const exitCode = await runScript([], { env: DRY_RUN_ENV, fetchImpl, log });

      expect(exitCode).toBe(0);
      expect(recordSignupCalls).toHaveLength(0);
      expect(log.mock.calls[0][0]).toContain("scanned: 2");
      expect(log.mock.calls[0][0]).toContain("written: 0");
    });

    it("calls record_signup once per valid user with --apply", async () => {
      const { fetchImpl, recordSignupCalls } = fixtureFetch({ users });
      const log = vi.fn();

      const exitCode = await runScript(["--apply"], { env: APPLY_ENV, fetchImpl, log });

      expect(exitCode).toBe(0);
      expect(recordSignupCalls).toHaveLength(2);
      expect(log.mock.calls[0][0]).toContain("written: 2");
      expect(log.mock.calls[0][0]).toContain("status: complete");
      // An apply run never advertises a resume offset: deletions would shift it.
      expect(log.mock.calls[0][0]).toContain("re-run --apply from the start");
      expect(log.mock.calls[0][0]).not.toContain("resume_offset");
    });

    it("exits non-zero when a user has an invalid created_at", async () => {
      const { fetchImpl } = fixtureFetch({
        users: [clerkUser("user_1", Date.parse("2026-01-01T00:00:00.000Z")), clerkUser("user_2", 12)],
      });
      const log = vi.fn();

      const exitCode = await runScript([], { env: DRY_RUN_ENV, fetchImpl, log });

      expect(exitCode).toBe(1);
      expect(log.mock.calls[0][0]).toContain("invalid: 1");
      expect(log.mock.calls[0][0]).toContain("status: incomplete");
    });

    it("exits non-zero on a pagination anomaly", async () => {
      const fetchImpl = vi.fn(async (input: URL | string) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/users/count")) {
          return jsonResponse({ object: "total_count", total_count: 9 });
        }
        return jsonResponse([clerkUser("user_1", Date.parse("2026-01-01T00:00:00.000Z"))]);
      });
      const log = vi.fn();

      const exitCode = await runScript(["--limit", "10"], { env: DRY_RUN_ENV, fetchImpl, log });

      expect(exitCode).toBe(1);
      expect(log.mock.calls[0][0]).toContain("anomaly: short page");
    });

    it("exits non-zero when a record_signup call fails", async () => {
      const { fetchImpl } = fixtureFetch({ users, recordSignupStatus: 500 });
      const log = vi.fn();

      const exitCode = await runScript(["--apply"], { env: APPLY_ENV, fetchImpl, log });

      expect(exitCode).toBe(1);
      expect(log.mock.calls[0][0]).toContain("failures_by_status[500]: 2");
      expect(log.mock.calls[0][0]).toContain("written: 0");
    });

    it("refuses a windowed apply run", async () => {
      const { fetchImpl, recordSignupCalls } = fixtureFetch({ users });

      await expect(
        runScript(["--apply", "--offset", "5"], { env: APPLY_ENV, fetchImpl, log: vi.fn() })
      ).rejects.toThrow(/--offset is not allowed with --apply/);
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(recordSignupCalls).toHaveLength(0);
    });
  });

  describe("formatReport", () => {
    it("renders every aggregate field and no per-user data", () => {
      const report = formatReport({
        anomaly: null,
        apply: false,
        cutoffIso: "2026-09-15T00:00:00.000Z",
        duplicate: 0,
        earliestCreatedAt: "2026-01-01T00:00:00.000Z",
        failuresByStatus: { 500: 2 },
        invalid: 1,
        latestCreatedAt: "2026-09-01T00:00:00.000Z",
        resumeOffset: 100,
        scanned: 10,
        skipped: 2,
        valid: 9,
        written: 0,
      });

      expect(report).toContain("scanned: 10");
      expect(report).toContain("valid: 9");
      expect(report).toContain("invalid: 1");
      expect(report).toContain("skipped: 2");
      expect(report).toContain("resume_offset: 100");
      expect(report).toContain("failures_by_status[500]: 2");
    });

    it("never leaks an email, first-touch value, unsafe_metadata, or a user id", () => {
      const fixtureUsers = [
        {
          created_at: Date.parse("2026-08-01T00:00:00.000Z"),
          email_addresses: [{ email_address: "leaker@example.com" }],
          id: "user_super_secret_id",
          unsafe_metadata: {
            flaimAcquisition: {
              landingPath: "/join",
              schemaVersion: 1,
              utmSource: "LEAKME",
            },
          },
        },
      ];

      const now = Date.parse("2026-09-15T00:00:00.000Z");
      let scanned = 0;
      let valid = 0;
      let skipped = 0;
      let earliestCreatedAt: number | null = null;
      let latestCreatedAt: number | null = null;

      for (const user of fixtureUsers) {
        scanned += 1;
        const createdAtMs = validateCreatedAt(user.created_at, { now });
        if (createdAtMs === null) continue;
        valid += 1;
        earliestCreatedAt = createdAtMs;
        latestCreatedAt = createdAtMs;

        const firstTouch = normalizeFirstTouch(user.unsafe_metadata);
        if (user.unsafe_metadata && firstTouch === null) skipped += 1;
      }

      const report = formatReport({
        anomaly: null,
        apply: false,
        cutoffIso: "2026-09-15T00:00:00.000Z",
        duplicate: 0,
        earliestCreatedAt: earliestCreatedAt === null ? null : new Date(earliestCreatedAt).toISOString(),
        failuresByStatus: {},
        invalid: scanned - valid,
        latestCreatedAt: latestCreatedAt === null ? null : new Date(latestCreatedAt).toISOString(),
        resumeOffset: 1,
        scanned,
        skipped,
        valid,
        written: 0,
      });

      expect(report).not.toContain("leaker@example.com");
      expect(report).not.toContain("LEAKME");
      expect(report).not.toContain("unsafe_metadata");
      expect(report).not.toContain("user_super_secret_id");
    });
  });
});
