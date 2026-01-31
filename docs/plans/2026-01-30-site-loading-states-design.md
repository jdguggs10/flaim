# Site Loading States — Design

**Date:** 2026-01-30
**Status:** Draft
**Approach:** Optimistic layout with inline spinners (Approach B)

## Problem

Both the leagues page and homepage have unclear loading delays when fetching auth status, credentials, and league data. The leagues page is worst — a full-page spinner blocks all content until both Clerk auth and ESPN credential checks complete. The homepage has minor layout shifts when ESPN/Yahoo status checks resolve.

## Principles

- Show page structure immediately; load data into sections independently.
- Only block on Clerk `isLoaded` (fast, cookie-based). Everything else is inline.
- No skeleton components — use contextual spinners inside existing card/section shells.
- Minimize layout shift with fixed minimum heights on loading sections.

---

## Phase 1: Leagues Page

### Current behavior

1. Full-page `Loader2` spinner while `!isLoaded || isCheckingCreds` (`leagues/page.tsx:779-785`)
2. Once unblocked, second spinner while `isLoadingLeagues` fetches league list
3. Yahoo section has its own `isCheckingYahoo` spinner (only visible if expanded)
4. Preferences fetch has no loading state at all

### Changes

**Remove `isCheckingCreds` from page blocker.** The guard at line 779 changes from:

```
if (!isLoaded || isCheckingCreds) → full page spinner
```

to:

```
if (!isLoaded) → full page spinner
```

This means the page structure (header, Active Leagues card, League Maintenance section) renders immediately after Clerk loads.

**Active Leagues card gets its own inline loading state.** While `isLoadingLeagues` is true, the card body shows a centered `Loader2` spinner with "Loading your leagues..." text. This is close to what exists today (line 859-862) but the card shell, header, and description are already visible around it — no more blank page.

**ESPN maintenance section shows inline creds status.** While `isCheckingCreds` is true, the ESPN collapsible section shows "Checking credentials..." with a small spinner next to the ESPN label (where the "Credentials Saved" badge normally appears). When it resolves, the badge appears. No layout shift because the badge area has a fixed min-width.

**Yahoo maintenance section — no change needed.** The `isCheckingYahoo` spinner already lives inside the collapsible section. It only shows when the user expands Yahoo setup, which is fine.

### Files to change

| File | Change |
|------|--------|
| `web/app/(site)/leagues/page.tsx:779` | Remove `isCheckingCreds` from page guard |
| `web/app/(site)/leagues/page.tsx:859-862` | Add "Loading your leagues..." label to existing spinner |
| `web/app/(site)/leagues/page.tsx:1147-1151` | Show inline spinner while `isCheckingCreds`, then badge |

---

## Phase 2: Homepage (StepConnectPlatforms)

### Current behavior

1. ESPN and Yahoo columns each show "Checking..." with a spinner
2. When checks resolve, content shifts — buttons/check marks appear in place of the spinner
3. `StepConnectAI` shows "Loading account status..." in a muted box before Clerk loads

### Changes

**Fixed minimum height on ESPN/Yahoo column content area.** Add `min-h-[72px]` (or similar) to the content div inside each platform column. This reserves space so the layout doesn't jump when "Checking..." is replaced by buttons or status indicators.

**No structural changes.** The existing "Checking..." spinners with labels are already inline and contextual — they just need the layout stability fix.

**StepConnectAI — no change needed.** The "Loading account status..." message is already a reasonable placeholder. Clerk loads fast from cookies so this is rarely visible for more than a flash.

### Files to change

| File | Change |
|------|--------|
| `web/components/site/StepConnectPlatforms.tsx:232` | Add `min-h-[72px]` to ESPN column content area |
| `web/components/site/StepConnectPlatforms.tsx:318` | Add `min-h-[72px]` to Yahoo column content area |

---

## Out of scope

- Skeleton screens (maintenance burden, diminishing returns for this project)
- SWR / React Query migration (would help but is a larger refactor)
- Batching ESPN + Yahoo into a single API call (backend change, not worth it now)
- Preferences loading state (fire-and-forget is fine — it's non-blocking and fast)

## Success criteria

- Leagues page shows header + card structure within ~200ms of navigation (Clerk cookie load)
- No full-page blank spinner while credential check runs
- Homepage platform columns don't shift height when status checks resolve
