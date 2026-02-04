/**
 * ESPN Cookie Utilities
 * ---------------------------------------------------------------------------
 * Read ESPN authentication cookies from the browser.
 */

export interface EspnCredentials {
  swid: string;
  s2: string;
}

/**
 * Read ESPN authentication cookies from the browser.
 * Requires "cookies" permission and "https://*.espn.com/*" host permission.
 */
export async function getEspnCredentials(): Promise<EspnCredentials | null> {
  try {
    const [swidCookie, s2Cookie] = await Promise.all([
      chrome.cookies.get({ url: 'https://www.espn.com', name: 'SWID' }),
      chrome.cookies.get({ url: 'https://www.espn.com', name: 'espn_s2' }),
    ]);

    if (!swidCookie?.value || !s2Cookie?.value) {
      return null;
    }

    return {
      swid: swidCookie.value,
      s2: s2Cookie.value,
    };
  } catch {
    return null;
  }
}

/**
 * Validate ESPN credentials format.
 * SWID should be a UUID in curly braces.
 * espn_s2 should be at least 50 characters.
 */
export function validateCredentials(creds: EspnCredentials): boolean {
  const swidRegex = /^\{[0-9A-Fa-f-]{36}\}$/;
  return swidRegex.test(creds.swid) && creds.s2.length >= 50;
}
