# Design: Extension ESPN Status Indicator

Date: 2026-02-16
Status: Approved

## Problem

When a user opens the extension popup in the `ready` state, there is no visible indication of whether ESPN cookies are detected. The user has no way to know if they are logged into ESPN before clicking "Sync to Flaim" — they just have to click and hope.

## Solution

Surface the existing `hasEspnCookies` state (already computed during popup init) as a two-row status checklist in the `ready` state, above the existing message and buttons.

## Design

### UI

Two-row checklist rendered in the `ready` state:

```
✓  Signed in to Flaim
✓  ESPN detected          ← green check when cookies found
–  ESPN not detected      ← fallback (shouldn't appear in ready state)
…  ESPN (checking…)       ← while hasEspnCookies is null
```

### Implementation

- **File changed:** `extension/src/popup/Popup.tsx` only
- **CSS changes:** None — reuse existing `.setup-progress`, `.setup-step`, `.step-icon` classes
- **Logic changes:** None — `hasEspnCookies` is already set during init before `ready` state is reached
- **Lines added:** ~10 lines in the `ready` state render block

### Behavior

- `hasEspnCookies === true` → `✓  ESPN detected`
- `hasEspnCookies === null` → `…  ESPN (checking…)` (uses existing `checkmark()` helper)
- `hasEspnCookies === false` → `–  ESPN not detected` (defensive; `no_espn` state handles this case normally)

The existing Flaim sign-in row is always `✓` in the `SignedIn` context.

## Out of Scope

- No real-time cookie watching or background sync
- No changes to `no_espn` state or its "Open ESPN Fantasy" button
- No changes to the diagnostics panel
