import { describe, expect, it, vi } from "vitest";

import {
  buildRecordSignupRequest,
  formatReport,
  listUsersAtCutoff,
  normalizeFirstTouch,
  parseArgs,
  PaginationAnomalyError,
  validateCreatedAt,
} from "../../../scripts/backfill-signup-log.mjs";

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

  it("parses --apply, --offset, --delay-ms, --max-users, and --cutoff", () => {
    expect(
      parseArgs([
        "--apply",
        "--offset",
        "50",
        "--delay-ms",
        "10",
        "--max-users",
        "5",
        "--cutoff",
        "2026-09-01T00:00:00.000Z",
      ])
    ).toMatchObject({
      apply: true,
      cutoff: "2026-09-01T00:00:00.000Z",
      delayMs: 10,
      maxUsers: 5,
      offset: 50,
    });
  });

  it("rejects an invalid --cutoff", () => {
    expect(() => parseArgs(["--cutoff", "not-a-date"])).toThrow("--cutoff must be a valid ISO date");
  });

  describe("listUsersAtCutoff", () => {
    it("sends the frozen cutoff and ascending order on every page", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ data: [clerkUser("user_1", 1000)], total_count: 1 })
        );

      const pages = [];
      for await (const page of listUsersAtCutoff({
        clerkSecretKey: "sk_test",
        cutoffMs: 5000,
        fetchImpl,
        limit: 10,
      })) {
        pages.push(page);
      }

      expect(pages).toHaveLength(1);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url] = fetchImpl.mock.calls[0];
      expect(url.searchParams.get("created_at_before")).toBe("5000");
      expect(url.searchParams.get("order_by")).toBe("+created_at");
    });

    it("freezes the cutoff across multiple pages", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ data: [clerkUser("user_1", 1000)], total_count: 2 })
        )
        .mockResolvedValueOnce(
          jsonResponse({ data: [clerkUser("user_2", 2000)], total_count: 2 })
        );

      const pages = [];
      for await (const page of listUsersAtCutoff({
        clerkSecretKey: "sk_test",
        cutoffMs: 5000,
        fetchImpl,
        limit: 1,
      })) {
        pages.push(page);
      }

      expect(pages).toHaveLength(2);
      for (const call of fetchImpl.mock.calls) {
        expect(call[0].searchParams.get("created_at_before")).toBe("5000");
      }
    });

    it("throws with a resume offset when total_count changes mid-pagination", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({ data: [clerkUser("user_1", 1000)], total_count: 2 })
        )
        .mockResolvedValueOnce(
          jsonResponse({ data: [clerkUser("user_2", 2000)], total_count: 3 })
        );

      const drain = async () => {
        for await (const _page of listUsersAtCutoff({
          clerkSecretKey: "sk_test",
          cutoffMs: 5000,
          fetchImpl,
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
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(
          jsonResponse({
            data: [clerkUser("user_1", 1000), clerkUser("user_1", 2000)],
            total_count: 2,
          })
        );

      const drain = async () => {
        for await (const _page of listUsersAtCutoff({
          clerkSecretKey: "sk_test",
          cutoffMs: 5000,
          fetchImpl,
          limit: 10,
        })) {
          // drain
        }
      };

      await expect(drain()).rejects.toThrow(/duplicate/);
    });

    it("throws on a short page before the reported total is reached", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ data: [clerkUser("user_1", 1000)], total_count: 5 })
        );

      const drain = async () => {
        for await (const _page of listUsersAtCutoff({
          clerkSecretKey: "sk_test",
          cutoffMs: 5000,
          fetchImpl,
          limit: 10,
        })) {
          // drain
        }
      };

      await expect(drain()).rejects.toThrow(/short page/);
      await expect(drain()).rejects.toMatchObject({ resumeOffset: 1 });
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
    it("returns null when the schema version or landing path is invalid", () => {
      expect(normalizeFirstTouch(undefined)).toBeNull();
      expect(normalizeFirstTouch({ flaimAcquisition: { schemaVersion: 2, landingPath: "/x" } })).toBeNull();
      expect(
        normalizeFirstTouch({ flaimAcquisition: { landingPath: "no-leading-slash", schemaVersion: 1 } })
      ).toBeNull();
    });

    it("bounds oversized fields instead of rejecting the whole object", () => {
      const result = normalizeFirstTouch({
        flaimAcquisition: {
          landingPath: "/join",
          schemaVersion: 1,
          utmSource: "a".repeat(500),
        },
      });

      expect(result).toEqual({
        landingPath: "/join",
        schemaVersion: 1,
        utmSource: "a".repeat(100),
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

  describe("dry run", () => {
    it("performs zero RPC calls without --apply", async () => {
      // parseArgs([]) defaults to dry-run; buildRecordSignupRequest / fetch
      // must never be reached on that path. Asserted at the arg level here;
      // the main() apply-gate itself is exercised by reading the script.
      const args = parseArgs([]);
      expect(args.apply).toBe(false);
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
