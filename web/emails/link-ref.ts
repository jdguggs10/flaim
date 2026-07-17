/**
 * Email link attribution.
 *
 * Every flaim.app link in an outbound email should carry a `ref` param so
 * post-send activity can be attributed in Workers Logs (the /leagues page
 * reports `ref` via the setup-signal pipeline). Only tag Flaim-owned URLs —
 * external links (Chrome Web Store, ChatGPT) don't read our params.
 *
 * Campaign naming: `email-<campaign>`, lowercase, digits, hyphens.
 * Dashboard-composed Resend broadcasts can't use this helper; add the param
 * to links by hand there (see docs/EMAILS.md, "Link attribution").
 */
const REF_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function withEmailRef(url: string, campaign: string): string {
  if (!REF_PATTERN.test(campaign)) {
    throw new Error(`Invalid email ref campaign: ${campaign}`);
  }
  const parsed = new URL(url);
  parsed.searchParams.set('ref', campaign);
  return parsed.toString();
}
