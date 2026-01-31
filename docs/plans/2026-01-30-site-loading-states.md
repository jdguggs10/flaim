# Site Loading States Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove full-page loading blockers and layout shifts so users see page structure immediately while data loads inline.

**Architecture:** Two phases of small CSS/JSX edits. Phase 1 removes the credential-check blocker from the leagues page and adds contextual loading labels. Phase 2 adds minimum heights to homepage platform columns to prevent layout shift. No new components, no new state, no backend changes.

**Tech Stack:** Next.js, React, Tailwind CSS, Clerk `useAuth`, existing `useEspnCredentials` hook, Lucide icons (`Loader2`)

**Design doc:** `docs/plans/2026-01-30-site-loading-states-design.md`

---

## Phase 1: Leagues Page

### Task 1: Remove `isCheckingCreds` from full-page guard

**Files:**
- Modify: `web/app/(site)/leagues/page.tsx:779`

**Step 1: Edit the page guard**

Change line 779 from:

```tsx
  if (!isLoaded || isCheckingCreds) {
```

to:

```tsx
  if (!isLoaded) {
```

This lets the full page structure render as soon as Clerk auth loads, without waiting for the ESPN credential check.

**Step 2: Verify the app builds**

Run: `npm run build --prefix web 2>&1 | tail -20`
Expected: Build succeeds (no compile errors from removing the condition)

**Step 3: Commit**

```bash
git add web/app/\(site\)/leagues/page.tsx
git commit -m "fix(leagues): remove credential check from full-page loading guard"
```

---

### Task 2: Add label to leagues list spinner

**Files:**
- Modify: `web/app/(site)/leagues/page.tsx:859-862`

**Step 1: Add text label to the existing loading spinner**

Change lines 859-862 from:

```tsx
            {isLoadingLeagues ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
```

to:

```tsx
            {isLoadingLeagues ? (
              <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Loading your leagues...</span>
              </div>
```

**Step 2: Verify the app builds**

Run: `npm run build --prefix web 2>&1 | tail -20`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add web/app/\(site\)/leagues/page.tsx
git commit -m "fix(leagues): add loading label to league list spinner"
```

---

### Task 3: Inline credential status in ESPN maintenance section

**Files:**
- Modify: `web/app/(site)/leagues/page.tsx:1145-1151`

**Step 1: Replace static badge with loading-aware badge**

Change lines 1145-1151 from:

```tsx
                <div className="flex items-center gap-2">
                  <span className="text-lg">ESPN</span>
                  {hasCredentials && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-success/20 text-success">
                      Credentials Saved
                    </span>
                  )}
                </div>
```

to:

```tsx
                <div className="flex items-center gap-2">
                  <span className="text-lg">ESPN</span>
                  {isCheckingCreds ? (
                    <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Checking...
                    </span>
                  ) : hasCredentials ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-success/20 text-success">
                      Credentials Saved
                    </span>
                  ) : null}
                </div>
```

Note: `isCheckingCreds` is already destructured from `useEspnCredentials()` at line 185, so no new imports or state needed.

**Step 2: Verify the app builds**

Run: `npm run build --prefix web 2>&1 | tail -20`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add web/app/\(site\)/leagues/page.tsx
git commit -m "fix(leagues): show inline credential check status in ESPN section"
```

---

## Phase 2: Homepage (StepConnectPlatforms)

### Task 4: Add min-height to ESPN column content area

**Files:**
- Modify: `web/components/site/StepConnectPlatforms.tsx:232`

**Step 1: Add min-height to prevent layout shift**

Change line 232 from:

```tsx
        <div className="p-4 border rounded-lg space-y-3">
```

to:

```tsx
        <div className="p-4 border rounded-lg space-y-3 min-h-[88px]">
```

The value `88px` accommodates the tallest resolved state (two lines of status text + button). The "Checking..." spinner and resolved content both fit within this height, preventing layout jump.

**Step 2: Verify the app builds**

Run: `npm run build --prefix web 2>&1 | tail -20`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add web/components/site/StepConnectPlatforms.tsx
git commit -m "fix(homepage): add min-height to ESPN column to prevent layout shift"
```

---

### Task 5: Add min-height to Yahoo column content area

**Files:**
- Modify: `web/components/site/StepConnectPlatforms.tsx:318`

**Step 1: Add min-height to prevent layout shift**

Change line 318 from:

```tsx
        <div className="p-4 border rounded-lg space-y-3">
```

to:

```tsx
        <div className="p-4 border rounded-lg space-y-3 min-h-[88px]">
```

**Step 2: Verify the app builds**

Run: `npm run build --prefix web 2>&1 | tail -20`
Expected: Build succeeds

**Step 3: Commit**

```bash
git add web/components/site/StepConnectPlatforms.tsx
git commit -m "fix(homepage): add min-height to Yahoo column to prevent layout shift"
```

---

## Task 6: Visual verification and docs

**Step 1: Run full lint**

Run: `npm run lint --prefix web 2>&1 | tail -20`
Expected: No new lint errors

**Step 2: Run full build**

Run: `npm run build --prefix web 2>&1 | tail -20`
Expected: Build succeeds

**Step 3: Update changelog**

Add to `docs/CHANGELOG.md` under `## [Unreleased]`, in a new `### Site Loading States` section:

```markdown
### Site Loading States
- **Fixed**: Leagues page no longer shows full-page spinner while checking ESPN credentials. Page structure renders immediately after Clerk auth loads.
- **Added**: "Loading your leagues..." label on league list spinner for clearer feedback.
- **Added**: Inline "Checking..." badge in ESPN maintenance section while credential status loads.
- **Fixed**: Homepage ESPN and Yahoo platform columns no longer shift height when status checks complete (added `min-h`).
```

**Step 4: Commit docs**

```bash
git add docs/CHANGELOG.md
git commit -m "docs: add site loading states to changelog"
```
