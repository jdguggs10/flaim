export const ACQUISITION_COOKIE = "flaim_first_touch_v1";
export const ACQUISITION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const FIELD_LIMITS = {
  landingPath: 200,
  referrerHost: 120,
  utmSource: 100,
  utmMedium: 100,
  utmCampaign: 120,
  utmTerm: 160,
  utmContent: 160,
  ref: 100,
} as const;

export interface FirstTouchAcquisition {
  schemaVersion: 1;
  capturedAt: string;
  landingPath: string;
  referrerHost?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmTerm?: string;
  utmContent?: string;
  ref?: string;
}

interface FirstTouchInput {
  url: string;
  referrer?: string;
  capturedAt?: string;
}

function cleanValue(
  value: string | null | undefined,
  limit: number
): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, limit);
  return cleaned || undefined;
}

function normalizeFirstTouchAcquisition(
  value: unknown
): FirstTouchAcquisition | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const landingPath =
    typeof candidate.landingPath === "string"
      ? cleanValue(candidate.landingPath, FIELD_LIMITS.landingPath)
      : undefined;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.capturedAt !== "string" ||
    Number.isNaN(Date.parse(candidate.capturedAt)) ||
    !landingPath ||
    !landingPath.startsWith("/") ||
    landingPath.includes("?") ||
    landingPath.includes("#")
  ) {
    return null;
  }

  const normalized: FirstTouchAcquisition = {
    schemaVersion: 1,
    capturedAt: new Date(candidate.capturedAt).toISOString(),
    landingPath,
  };

  for (const [field, limit] of Object.entries(FIELD_LIMITS)) {
    if (field === "landingPath") continue;
    const fieldValue = candidate[field];
    if (fieldValue === undefined) continue;
    if (typeof fieldValue !== "string" || fieldValue.length > limit) return null;
    const cleaned = cleanValue(fieldValue, limit);
    if (!cleaned) return null;
    normalized[field as keyof typeof FIELD_LIMITS] = cleaned;
  }

  return normalized;
}

export function buildFirstTouchAcquisition({
  url,
  referrer,
  capturedAt = new Date().toISOString(),
}: FirstTouchInput): FirstTouchAcquisition | null {
  let landing: URL;
  try {
    landing = new URL(url);
  } catch {
    return null;
  }

  const landingPath =
    cleanValue(landing.pathname, FIELD_LIMITS.landingPath) ?? "/";
  const firstTouch: FirstTouchAcquisition = {
    schemaVersion: 1,
    capturedAt,
    landingPath: landingPath.startsWith("/") ? landingPath : "/",
  };

  if (referrer) {
    try {
      const referrerUrl = new URL(referrer);
      if (
        (referrerUrl.protocol === "https:" ||
          referrerUrl.protocol === "http:") &&
        referrerUrl.origin !== landing.origin
      ) {
        firstTouch.referrerHost = cleanValue(
          referrerUrl.hostname.toLowerCase(),
          FIELD_LIMITS.referrerHost
        );
      }
    } catch {
      // Malformed referrers are intentionally ignored.
    }
  }

  const allowlistedParams = {
    utmSource: "utm_source",
    utmMedium: "utm_medium",
    utmCampaign: "utm_campaign",
    utmTerm: "utm_term",
    utmContent: "utm_content",
    ref: "ref",
  } as const;

  for (const [field, param] of Object.entries(allowlistedParams) as Array<
    [keyof typeof allowlistedParams, string]
  >) {
    const cleaned = cleanValue(
      landing.searchParams.get(param),
      FIELD_LIMITS[field]
    );
    if (cleaned) firstTouch[field] = cleaned;
  }

  return firstTouch;
}

export function parseFirstTouchCookie(
  encoded: string | null | undefined
): FirstTouchAcquisition | null {
  if (!encoded) return null;
  try {
    const value = JSON.parse(decodeURIComponent(encoded));
    return normalizeFirstTouchAcquisition(value);
  } catch {
    return null;
  }
}

function cookieValue(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name === ACQUISITION_COOKIE) return valueParts.join("=");
  }
  return null;
}

export function readFirstTouchCookie(
  cookieHeader: string
): FirstTouchAcquisition | null {
  return parseFirstTouchCookie(cookieValue(cookieHeader));
}

export function resolveFirstTouch(
  cookieHeader: string,
  input: FirstTouchInput
): FirstTouchAcquisition | null {
  return readFirstTouchCookie(cookieHeader) ?? buildFirstTouchAcquisition(input);
}

export function firstTouchCookieString(
  firstTouch: FirstTouchAcquisition,
  secure: boolean
): string {
  const value = encodeURIComponent(JSON.stringify(firstTouch));
  return [
    `${ACQUISITION_COOKIE}=${value}`,
    "Path=/",
    `Max-Age=${ACQUISITION_COOKIE_MAX_AGE_SECONDS}`,
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function getOrCaptureBrowserFirstTouch(): FirstTouchAcquisition | null {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return null;
  }

  const firstTouch = resolveFirstTouch(document.cookie, {
    url: window.location.href,
    referrer: document.referrer,
  });
  if (!firstTouch) return null;

  if (!readFirstTouchCookie(document.cookie)) {
    document.cookie = firstTouchCookieString(
      firstTouch,
      window.location.protocol === "https:"
    );
  }
  return firstTouch;
}

export function clearBrowserFirstTouch(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  document.cookie = [
    `${ACQUISITION_COOKIE}=`,
    "Path=/",
    "Max-Age=0",
    "SameSite=Lax",
    ...(window.location.protocol === "https:" ? ["Secure"] : []),
  ].join("; ");
}

export function acquisitionUnsafeMetadata(
  firstTouch: FirstTouchAcquisition | null
): Record<string, unknown> | undefined {
  const normalized = normalizeFirstTouchAcquisition(firstTouch);
  return normalized ? { flaimAcquisition: normalized } : undefined;
}
