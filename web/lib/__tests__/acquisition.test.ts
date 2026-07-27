import { describe, expect, it, vi } from "vitest";
import {
  acquisitionUnsafeMetadata,
  buildFirstTouchAcquisition,
  clearBrowserFirstTouch,
  firstTouchCookieString,
  parseFirstTouchCookie,
  resolveFirstTouch,
} from "../acquisition";

const CAPTURED_AT = "2026-07-27T14:00:00.000Z";

describe("first-touch acquisition", () => {
  it("captures only allowlisted campaign fields and the landing pathname", () => {
    const result = buildFirstTouchAcquisition({
      url:
        "https://flaim.app/leagues?utm_source=threads&utm_medium=social&utm_campaign=draft-season&utm_term=keeper&utm_content=card-a&ref=profile&email=private%40example.com",
      referrer: "https://www.threads.com/@flaim_app/post/secret-path",
      capturedAt: CAPTURED_AT,
    });

    expect(result).toEqual({
      schemaVersion: 1,
      capturedAt: CAPTURED_AT,
      landingPath: "/leagues",
      referrerHost: "www.threads.com",
      utmSource: "threads",
      utmMedium: "social",
      utmCampaign: "draft-season",
      utmTerm: "keeper",
      utmContent: "card-a",
      ref: "profile",
    });
    expect(JSON.stringify(result)).not.toContain("private@example.com");
    expect(JSON.stringify(result)).not.toContain("secret-path");
  });

  it("preserves direct or unknown visits without inventing a source", () => {
    expect(
      buildFirstTouchAcquisition({
        url: "https://flaim.app/",
        capturedAt: CAPTURED_AT,
      })
    ).toEqual({
      schemaVersion: 1,
      capturedAt: CAPTURED_AT,
      landingPath: "/",
    });
  });

  it("ignores same-origin and malformed referrers", () => {
    expect(
      buildFirstTouchAcquisition({
        url: "https://flaim.app/sign-up",
        referrer: "https://flaim.app/?utm_source=internal",
        capturedAt: CAPTURED_AT,
      })
    ).not.toHaveProperty("referrerHost");
    expect(
      buildFirstTouchAcquisition({
        url: "https://flaim.app/sign-up",
        referrer: "not a url",
        capturedAt: CAPTURED_AT,
      })
    ).not.toHaveProperty("referrerHost");
  });

  it("bounds oversized values and drops control-only values", () => {
    const result = buildFirstTouchAcquisition({
      url: `https://flaim.app/${"p".repeat(300)}?utm_source=${"s".repeat(
        300
      )}&ref=%00%01`,
      capturedAt: CAPTURED_AT,
    });

    expect(result?.landingPath).toHaveLength(200);
    expect(result?.utmSource).toHaveLength(100);
    expect(result).not.toHaveProperty("ref");
  });

  it("round-trips a valid cookie and rejects malformed stored values", () => {
    const firstTouch = buildFirstTouchAcquisition({
      url: "https://flaim.app/?utm_source=newsletter",
      capturedAt: CAPTURED_AT,
    });
    expect(firstTouch).not.toBeNull();
    if (!firstTouch) return;

    const cookie = firstTouchCookieString(firstTouch, true);
    const encoded = cookie.match(/^[^=]+=([^;]+)/)?.[1];
    expect(parseFirstTouchCookie(encoded)).toEqual(firstTouch);
    expect(parseFirstTouchCookie("%7Bbad-json")).toBeNull();
  });

  it("reconstructs stored values from the allowlist before forwarding", () => {
    const tampered = {
      schemaVersion: 1,
      capturedAt: CAPTURED_AT,
      landingPath: "/",
      utmSource: "threads",
      arbitraryExtra: "must-not-survive",
    };
    const encoded = encodeURIComponent(JSON.stringify(tampered));

    expect(parseFirstTouchCookie(encoded)).toEqual({
      schemaVersion: 1,
      capturedAt: CAPTURED_AT,
      landingPath: "/",
      utmSource: "threads",
    });
    expect(
      acquisitionUnsafeMetadata(
        tampered as typeof tampered & {
          schemaVersion: 1;
        }
      )
    ).toEqual({
      flaimAcquisition: {
        schemaVersion: 1,
        capturedAt: CAPTURED_AT,
        landingPath: "/",
        utmSource: "threads",
      },
    });
    expect(
      parseFirstTouchCookie(
        encodeURIComponent(
          JSON.stringify({ ...tampered, landingPath: "/?email=private" })
        )
      )
    ).toBeNull();
  });

  it("keeps an existing first touch instead of replacing it", () => {
    const existing = buildFirstTouchAcquisition({
      url: "https://flaim.app/?utm_source=newsletter",
      capturedAt: CAPTURED_AT,
    });
    expect(existing).not.toBeNull();
    if (!existing) return;

    const cookie = firstTouchCookieString(existing, true);
    expect(
      resolveFirstTouch(`theme=dark; ${cookie}`, {
        url: "https://flaim.app/?utm_source=threads",
        capturedAt: "2026-07-28T14:00:00.000Z",
      })
    ).toEqual(existing);
  });

  it("nests first touch under the analytics-only Clerk key", () => {
    const firstTouch = buildFirstTouchAcquisition({
      url: "https://flaim.app/?ref=friend",
      capturedAt: CAPTURED_AT,
    });
    expect(acquisitionUnsafeMetadata(firstTouch)).toEqual({
      flaimAcquisition: firstTouch,
    });
    expect(acquisitionUnsafeMetadata(null)).toBeUndefined();
  });

  it("expires the browser first-touch cookie after authentication", () => {
    vi.stubGlobal("window", { location: { protocol: "https:" } });
    vi.stubGlobal("document", { cookie: "" });

    clearBrowserFirstTouch();

    expect(document.cookie).toBe(
      "flaim_first_touch_v1=; Path=/; Max-Age=0; SameSite=Lax; Secure"
    );
    vi.unstubAllGlobals();
  });
});
