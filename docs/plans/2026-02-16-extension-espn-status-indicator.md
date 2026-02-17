# Extension ESPN Status Indicator Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a two-row status checklist to the extension popup's `ready` state so users can see at a glance whether they are signed into Flaim and whether ESPN cookies are detected — before clicking Sync.

**Architecture:** `hasEspnCookies` is already computed during popup init and stored in React state. This change only surfaces it visually in the `ready` state render block, reusing the existing `.setup-step` CSS classes. No new logic, no new CSS.

**Tech Stack:** React (TSX), plain CSS (popup.css with CSS variables), Chrome Extension Manifest V3

---

### Task 1: Add ESPN status checklist to `ready` state

**Files:**
- Modify: `extension/src/popup/Popup.tsx` (ready state block, around line 453)

**Background:**

The `ready` state block currently renders:
1. An optional error message
2. A `.message` div ("Credentials synced" or "Ready to sync")
3. Two buttons

`hasEspnCookies` is a `boolean | null` already in state. `checkmark()` is a helper that maps `null → '…'`, `true → '✓'`, `false → '–'`.

The existing `.setup-progress` + `.setup-step` + `.step-icon` classes (from `popup.css`) render exactly the checklist style needed. No new CSS required.

**Step 1: Locate the ready state block**

Open `extension/src/popup/Popup.tsx`. Find the block starting at `{state === 'ready' && (` (around line 453). It currently looks like:

```tsx
{state === 'ready' && (
  <div className="content">
    {error && <div className="message error">{error}</div>}
    {hasCredentials ? (
      <div className="message success">Your ESPN credentials are synced!</div>
    ) : (
      <div className="message info">Ready to sync your ESPN credentials to Flaim.</div>
    )}
    <button
      className="button primary full-width"
      onClick={handleFullSetup}
      disabled={isSetupInProgress}
    >
      {hasCredentials ? 'Re-sync & Discover New ESPN Leagues/Seasons' : 'Sync to Flaim'}
    </button>
    <button className="button secondary full-width" onClick={() => openFlaim('/leagues')}>
      Your Leagues
    </button>
  </div>
)}
```

**Step 2: Add the status checklist**

Insert a `.setup-progress` block between the error message and the existing `.message` div:

```tsx
{state === 'ready' && (
  <div className="content">
    {error && <div className="message error">{error}</div>}
    <div className="setup-progress">
      <div className="setup-step completed">
        <span className="step-icon check">✓</span>
        <span>Signed in to Flaim</span>
      </div>
      <div className={`setup-step ${hasEspnCookies ? 'completed' : hasEspnCookies === null ? 'pending' : 'pending'}`}>
        <span className="step-icon check">{checkmark(hasEspnCookies)}</span>
        <span>
          {hasEspnCookies === null
            ? 'ESPN (checking…)'
            : hasEspnCookies
            ? 'ESPN detected'
            : 'ESPN not detected'}
        </span>
      </div>
    </div>
    {hasCredentials ? (
      <div className="message success">Your ESPN credentials are synced!</div>
    ) : (
      <div className="message info">Ready to sync your ESPN credentials to Flaim.</div>
    )}
    <button
      className="button primary full-width"
      onClick={handleFullSetup}
      disabled={isSetupInProgress}
    >
      {hasCredentials ? 'Re-sync & Discover New ESPN Leagues/Seasons' : 'Sync to Flaim'}
    </button>
    <button className="button secondary full-width" onClick={() => openFlaim('/leagues')}>
      Your Leagues
    </button>
  </div>
)}
```

**Step 3: Build and verify**

```bash
cd extension && npm run build:dev
```

Expected: Build completes with no TypeScript errors.

Load the unpacked extension from `extension/dist` in `chrome://extensions` (reload if already loaded). Open the popup while signed into flaim.app:
- If logged into espn.com: should see `✓ Signed in to Flaim` and `✓ ESPN detected`
- If not logged into espn.com: should see `✓ Signed in to Flaim` and `– ESPN not detected`, then be routed to `no_espn` state on init (the checklist is a belt-and-suspenders fallback)

**Step 4: Commit**

```bash
git add extension/src/popup/Popup.tsx
git commit -m "feat(extension): show ESPN login status in ready state

Add two-row status checklist (Flaim sign-in + ESPN cookie detection)
above the sync button. Reuses existing setup-step CSS classes.
hasEspnCookies already computed on popup open — no logic changes.

Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>"
```
