# Search Console + CWS Handoff

Last updated: 2026-02-16
Owner: Gerry

This file captures the exact state of Google Search Console and Chrome Web Store (CWS) work completed on 2026-02-16 so the task can be resumed quickly later.

## Goal

- Keep Google Search Console and Chrome Web Store operations under the dedicated publisher account: `gerry@flaim.app`.
- Maintain personal Gmail only as recovery/backup access.
- Ensure sitemap/robots are live and Search Console can crawl/index key pages.

## Accounts and Ownership State

### Google Search Console

- Domain property: `flaim.app`
- Verified owner: `gerry@flaim.app` (publisher account)
- Verified owner (backup/recovery): `gerald.gugger@gmail.com`
- This is the intended setup: publishing account + backup owner.

### Chrome Web Store

- Signed-in account for dashboard work: `gerry@flaim.app`
- Publisher: `Flaim App`
- Listing: `Flaim - ESPN Fantasy Connector`
- Extension ID: `mbnokejgglkfgkeeenolgdpcnfakpbkn`
- Public status: `Published - public`

## SEO Technical Work Completed

### Problem encountered

- `https://flaim.app/sitemap.xml` returned `404`
- `https://flaim.app/robots.txt` returned `404`
- Search Console sitemap status was `Couldn't fetch`

### Fix implemented in code

- Added `web/app/sitemap.ts`
- Added `web/app/robots.ts`
- Added doc references for those routes in `web/README.md`
- Added changelog note in `docs/CHANGELOG.md`

### Post-fix production verification

- `https://flaim.app/sitemap.xml` -> `200` and valid XML
- `https://flaim.app/robots.txt` -> `200`
- Search Console sitemap status -> `Success` with `3` discovered pages

## Deployment Notes (Important)

- Local `vercel --prod` from `web/` targeted the wrong Vercel project (`web`) and failed because it lacked Clerk env (`Missing publishableKey`).
- Correct production path for `flaim.app` is existing repo CI workflow (push -> Actions -> Vercel deployment check).
- Use CI deploy path, not ad-hoc `vercel --prod` from the `web/` folder, unless project linkage/env parity is fixed first.

## Search Console Current Snapshot

- Property: `sc-domain:flaim.app`
- Sitemaps page has one row:
  - URL: `https://flaim.app/sitemap.xml`
  - Type: `Sitemap`
  - Status: `Success`
  - Discovered pages: `3`
  - Discovered videos: `0`

## CWS Listing Review Snapshot

### What currently looks good

- Listing is live and visible.
- Privacy disclosure links to `https://flaim.app/privacy`.
- Non-affiliation language appears in overview copy.
- Permissions/data declarations are present.

### Gaps observed

1. No ratings/reviews yet (`0 ratings`).
2. Listing copy can be more benefit-led and keyword-focused.
3. Screenshots exist but can tell a stronger conversion story.

## Ready-to-Use Listing Copy (Draft)

### Suggested title

`Flaim - ESPN Fantasy Connector for AI`

### Suggested short description

`Sync your ESPN fantasy leagues to Flaim so Claude and ChatGPT can answer with your real roster and league data.`

### Suggested full description

```text
Connect your ESPN fantasy data to AI in minutes.

Flaim is an MCP connector service. This Chrome extension securely syncs your ESPN credentials to your Flaim account so your AI assistant can use your real league context.

What you can do:
- Connect ESPN fantasy leagues to Claude and ChatGPT
- Ask about roster decisions, matchups, standings, and free agents
- Keep league context up to date with one-click sync

How it works:
1) Install extension
2) Sign in to flaim.app
3) Click Sync
4) Use Flaim in your AI connector setup

Privacy and security:
- Credentials are sent over HTTPS
- Credentials are stored encrypted
- Data is not sold to third parties
- Not affiliated with ESPN

This extension handles ESPN sync only. Additional platform setup and connector management happen at flaim.app.
```

### Suggested screenshot caption set (5 total)

1. `Sign in and start ESPN sync in one click`
2. `Securely connect ESPN credentials to Flaim`
3. `Leagues are discovered and ready for AI`
4. `Use Flaim with Claude/ChatGPT connectors`
5. `Ask AI about your real roster, matchups, and standings`

## Recommended Next Session Checklist

1. Open CWS dev dashboard as `gerry@flaim.app`.
2. Update title + short description + full description.
3. Upload/replace screenshots to complete 5-caption flow.
4. Keep personal Gmail as backup owner in Search Console unless recovery strategy changes.
5. Ask 2-3 trusted users for honest review submissions to establish initial rating signal.
6. After copy/screenshot update, re-check listing in incognito for first-impression quality.

## Quick Links

- Search Console property:
  - `https://search.google.com/u/1/search-console?resource_id=sc-domain:flaim.app`
- Search Console sitemaps:
  - `https://search.google.com/u/1/search-console/sitemaps?resource_id=sc-domain:flaim.app`
- Public CWS listing:
  - `https://chromewebstore.google.com/detail/flaim-espn-fantasy-connec/mbnokejgglkfgkeeenolgdpcnfakpbkn`
- CWS dev dashboard item edit (authuser=1):
  - `https://chrome.google.com/u/1/webstore/devconsole/d2be566e-1bcc-4ed0-a17f-17bab216456d/mbnokejgglkfgkeeenolgdpcnfakpbkn/edit`
