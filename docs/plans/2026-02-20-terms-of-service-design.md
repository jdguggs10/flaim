# Terms of Service Page — Design

**Date:** 2026-02-20
**Status:** Approved
**Approach:** Clone privacy page pattern (Approach A)

## Goal

Publish a production Terms of Service page at `https://flaim.app/terms` needed for the OpenAI Apps Directory submission and general legal hygiene.

## Files Changed

| File | Change |
|------|--------|
| `web/app/(site)/terms/page.tsx` | New — ToS page |
| `web/app/(site)/layout.tsx` | Add "Terms" link to footer |
| `web/app/sitemap.ts` | Add `/terms` entry |
| `docs/CONNECTOR-DOCS.md` | Add Terms link alongside privacy link |
| `docs/submissions/openai-app-submission.md` | Check off step 3 and dashboard checklist item |
| `docs/dev/CURRENT-EXECUTION-STATE.md` | One-line note: ToS page published |

## Implementation Approach

Mirror the existing privacy page exactly:
- Route: `web/app/(site)/terms/page.tsx` (Next.js App Router, site group layout)
- Style: `container max-w-3xl mx-auto py-12 px-4`, `text-muted-foreground` sections
- Metadata: canonical `https://flaim.app/terms`
- No new components, no new dependencies

## ToS Content Sections (in order)

1. **What Flaim Is** — read-only fantasy data connector, not a chatbot, not affiliated with ESPN/Yahoo/Sleeper
2. **Eligibility** — 13+, valid Flaim account required
3. **Your Account** — account security is user's responsibility; notify us of unauthorized access
4. **Platform Credentials** — ESPN session credentials and Yahoo/Sleeper OAuth tokens stored encrypted, used only to fetch data at user's request; user responsible for authorization
5. **Acceptable Use** — read-only only; prohibited: scraping at scale, sharing credentials, abusing rate limits, reverse-engineering, illegal use
6. **Third-Party Services** — ESPN, Yahoo, Sleeper, Clerk, Supabase, Cloudflare, Vercel, user's AI provider; Flaim not responsible for their availability or policy changes
7. **Disclaimers** — no uptime guarantee, data may be delayed/inaccurate, fantasy decisions solely user's
8. **Limitation of Liability** — to fullest extent permitted by law; no consequential/indirect damages
9. **Indemnification** — user indemnifies Flaim for misuse
10. **Termination** — may suspend for ToS violations; user may close account any time
11. **Changes to These Terms** — posted here with updated date; continued use = acceptance
12. **Governing Law** — New York; disputes in New York courts
13. **Contact** — privacy@flaim.app

## Language Notes

- Use "ESPN session credentials" (not "cookies") — consistent with privacy page
- Plain English, non-legalese tone
- No invented compliance claims

## Legal Placeholders Needing Human Review

- Limitation of liability cap (currently worded as "to the fullest extent permitted by law" — no dollar cap specified)
- Indemnification scope (standard solo-project boilerplate)
- New York governing law clause (verify jurisdiction is appropriate for your situation)
