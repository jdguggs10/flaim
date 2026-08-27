import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildSummary,
  classifyClerkUsers,
  classifyResendEligibility,
  parseArgs,
  parseInternalUserHashes,
  planSegmentAdditions,
  selectYahooCohort,
  validateApplyGuards,
} from "../../../scripts/prepare-yahoo-broadcast-segment.mjs";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
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
