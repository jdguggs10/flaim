import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  buildYahooDataUrls,
  buildSummary,
  classifyClerkUsers,
  classifyResendEligibility,
  listClerkUsers,
  listResendRows,
  listSupabaseRows,
  parseArgs,
  parseInternalUserHashes,
  planSegmentAdditions,
  selectYahooCohort,
  validateApplyGuards,
} from "../../../scripts/prepare-yahoo-broadcast-segment.mjs";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function jsonResponse(body: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), { headers, status });
}

describe("prepare Yahoo Broadcast Segment script helpers", () => {
  it("defaults to a read-only, campaign-specific cohort", () => {
    expect(parseArgs([])).toMatchObject({
      apply: false,
      outageStart: "2026-07-27T18:15:36.000Z",
      seasonYear: 2026,
      segmentId: null,
    });
  });

  it("reports a missing value for value-taking flags", () => {
    expect(() => parseArgs(["--segment-id"])).toThrow("--segment-id requires a value");
    expect(() => parseArgs(["--segment-name", "--apply"])).toThrow(
      "--segment-name requires a value",
    );
  });

  it("orders Yahoo league pages by user and unique row id", () => {
    const { credentialsUrl, leaguesUrl } = buildYahooDataUrls("https://example.supabase.co");

    expect(credentialsUrl.searchParams.get("order")).toBe("clerk_user_id.asc");
    expect(leaguesUrl.searchParams.get("select")).toBe("clerk_user_id,season_year,id");
    expect(leaguesUrl.searchParams.get("order")).toBe("clerk_user_id.asc,id.asc");
  });

  it("requires valid internal-user hashes", () => {
    expect(() => parseInternalUserHashes("")).toThrow("required");
    expect(() => parseInternalUserHashes("not-a-hash")).toThrow("SHA-256");
    expect(parseInternalUserHashes(`${hash("internal")}, ${hash("internal")}`).size).toBe(1);
  });

  it("selects outage-era credentials or current-season league users", () => {
    const result = selectYahooCohort({
      credentials: [
        { clerk_user_id: "outage", created_at: "2026-08-01T00:00:00Z" },
        { clerk_user_id: "current", created_at: "2026-07-01T00:00:00Z" },
        { clerk_user_id: "historical", created_at: "2026-07-01T00:00:00Z" },
        { clerk_user_id: "unused", created_at: "2026-07-01T00:00:00Z" },
        { clerk_user_id: "internal", created_at: "2026-08-01T00:00:00Z" },
      ],
      internalUserHashes: new Set([hash("internal")]),
      leagueRows: [
        { clerk_user_id: "current", season_year: 2026 },
        { clerk_user_id: "historical", season_year: 2025 },
      ],
      outageStart: "2026-07-27T18:15:36.000Z",
      seasonYear: 2026,
    });

    expect([...result.cohortIds]).toEqual(["outage", "current"]);
    expect(result.stats).toMatchObject({
      connectedDuringOutage: 1,
      currentSeasonLeague: 1,
      historicalOnlyExcluded: 1,
      internalExcluded: 1,
      oldNoLeagueExcluded: 1,
      selected: 2,
    });
  });

  it("filters Clerk state and deduplicates normalized primary emails", () => {
    const { candidates, stats } = classifyClerkUsers({
      cohortIds: new Set(["good", "duplicate", "unverified", "banned", "missing"]),
      users: [
        {
          email_addresses: [{
            email_address: "Fan@Example.com",
            id: "email-good",
            verification: { status: "verified" },
          }],
          id: "good",
          primary_email_address_id: "email-good",
        },
        {
          email_addresses: [{
            email_address: "fan@example.com",
            id: "email-duplicate",
            verification: { status: "verified" },
          }],
          id: "duplicate",
          primary_email_address_id: "email-duplicate",
        },
        {
          email_addresses: [{
            email_address: "no@example.com",
            id: "email-unverified",
            verification: { status: "unverified" },
          }],
          id: "unverified",
          primary_email_address_id: "email-unverified",
        },
        { banned: true, id: "banned" },
      ],
    });

    expect(candidates).toEqual([{ email: "fan@example.com" }]);
    expect(stats).toMatchObject({
      banned: 1,
      duplicateEmail: 1,
      missing: 1,
      unverifiedPrimaryEmail: 1,
      usable: 1,
    });
  });

  it("excludes missing, unsubscribed, and suppressed Resend contacts", () => {
    const { eligibleContacts, stats } = classifyResendEligibility({
      candidates: [
        { email: "eligible@example.com" },
        { email: "missing@example.com" },
        { email: "unsubscribed@example.com" },
        { email: "suppressed@example.com" },
      ],
      contacts: [
        { email: "eligible@example.com", id: "contact-eligible", unsubscribed: false },
        { email: "unsubscribed@example.com", id: "contact-unsubscribed", unsubscribed: true },
        { email: "suppressed@example.com", id: "contact-suppressed", unsubscribed: false },
      ],
      suppressions: [{ email: "suppressed@example.com" }],
    });

    expect(eligibleContacts).toEqual([
      { contactId: "contact-eligible", email: "eligible@example.com" },
    ]);
    expect(stats).toEqual({
      contactMissing: 1,
      eligible: 1,
      suppressed: 1,
      unsubscribed: 1,
    });
  });

  it("requires exact apply confirmations and rejects foreign Segment members", () => {
    expect(() => validateApplyGuards({
      apply: true,
      expectedEligibleCount: 4,
      segmentId: "segment-id",
      segmentName: "Yahoo access update - 2026-08",
    }, 5)).toThrow("Eligible count changed");

    expect(() => planSegmentAdditions({
      eligibleContacts: [{ contactId: "eligible", email: "fan@example.com" }],
      segmentContacts: [{ id: "foreign" }],
    })).toThrow("outside the reviewed eligible cohort");
  });

  it("paginates Supabase through an exact page-size boundary", async () => {
    const pages = [
      [{ id: "1" }, { id: "2" }],
      [{ id: "3" }, { id: "4" }],
      [],
    ];
    const ranges: string[] = [];
    const fetcher = vi.fn(async (_input: URL | RequestInfo, options?: RequestInit) => {
      ranges.push((options?.headers as Record<string, string>).Range);
      return jsonResponse(pages.shift());
    });

    const rows = await listSupabaseRows({
      fetcher,
      headers: { Authorization: "Bearer test" },
      limit: 2,
      url: new URL("https://example.supabase.co/rest/v1/yahoo_leagues"),
    });

    expect(rows).toHaveLength(4);
    expect(ranges).toEqual(["0-1", "2-3", "4-5"]);
  });

  it("retries a rate-limited Supabase page without sleeping in tests", async () => {
    const delayFn = vi.fn(async () => undefined);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(jsonResponse({}, 429, { "retry-after": "0" }))
      .mockResolvedValueOnce(jsonResponse([{ id: "1" }]));

    const rows = await listSupabaseRows({
      delayFn,
      fetcher,
      headers: { Authorization: "Bearer test" },
      limit: 2,
      url: new URL("https://example.supabase.co/rest/v1/yahoo_leagues"),
    });

    expect(rows).toEqual([{ id: "1" }]);
    expect(delayFn).toHaveBeenCalledWith(550);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("paginates Clerk users by offset", async () => {
    const offsets: string[] = [];
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      offsets.push(url.searchParams.get("offset") ?? "");
      if (offsets.length === 1) return jsonResponse([{ id: "1" }, { id: "2" }]);
      return jsonResponse([{ id: "3" }]);
    });

    const users = await listClerkUsers({ fetcher, limit: 2, secretKey: "test" });

    expect(users).toHaveLength(3);
    expect(offsets).toEqual(["0", "2"]);
  });

  it("paginates Resend rows with the last returned id as its cursor", async () => {
    const cursors: Array<string | null> = [];
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(String(input));
      cursors.push(url.searchParams.get("after"));
      if (cursors.length === 1) {
        return jsonResponse({ data: [{ id: "1" }, { id: "2" }], has_more: true });
      }
      return jsonResponse({ data: [{ id: "3" }], has_more: false });
    });

    const rows = await listResendRows({
      apiKey: "test",
      delayMs: 0,
      fetcher,
      limit: 2,
      path: "/contacts",
    });

    expect(rows).toHaveLength(3);
    expect(cursors).toEqual([null, "2"]);
  });

  it("builds an aggregate-only report", () => {
    const summary = buildSummary({
      clerk: { usable: 1 },
      cohort: { selected: 1 },
      resend: { eligible: 1 },
    });
    const serialized = JSON.stringify(summary);

    expect(summary).toEqual({
      clerk: { usable: 1 },
      cohort: { selected: 1 },
      resend: { eligible: 1 },
    });
    expect(serialized).not.toContain("@");
    expect(serialized).not.toContain("user_");
  });
});
