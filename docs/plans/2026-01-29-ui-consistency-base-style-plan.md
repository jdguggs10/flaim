# UI Consistency Base Style Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the marketing/settings pages consistent with a dark-mode-safe base style using existing Tailwind tokens and UI primitives.

**Architecture:** Standardize on the existing shadcn-style primitives (`Button`, `Card`, `Input`, `Alert`, `Badge`, `Popover`, `Dialog`) and tokenized colors from `globals.css`. Replace hand-rolled surfaces and hard-coded colors with component primitives and semantic variants. Keep chat UI as secondary alignment after site pages.

**Tech Stack:** Next.js app router, Tailwind CSS, shadcn-style UI components, Clerk.

---

### Task 1: Define the base UI rules for this pass

**Files:**
- Create: `docs/dev/ui-consistency-notes.md`

**Step 1: Write the base rules doc (no code changes yet)**

```markdown
# UI Consistency Base Rules (2026-01-29)

- Use UI primitives from `web/components/ui` for all new UI.
- Card surfaces: `Card` with default `rounded-lg`, `p-6`, `shadow-sm`.
- Spacing: vertical stacks use `space-y-4` or `space-y-6`; section padding `py-8`/`py-12`.
- Colors: only tokenized colors (`bg-background`, `bg-muted`, `text-muted-foreground`, `border-border`).
- Status colors: use semantic variants on `Alert`/`Badge` and dark-safe classes.
- Typography: section titles `text-2xl font-semibold`, page titles `text-3xl font-bold`.
- Avoid raw `<button>` for actions; use `Button`.
```

**Step 2: Save the doc**

Run: `ls docs/dev/ui-consistency-notes.md`
Expected: file exists.

**Step 3: Commit**

```bash
git add docs/dev/ui-consistency-notes.md
git commit -m "docs: add ui consistency base rules"
```

---

### Task 2: Align landing page steps with Card primitives

**Files:**
- Modify: `web/app/(site)/page.tsx`
- Modify: `web/components/site/StepConnectPlatforms.tsx`
- Modify: `web/components/site/StepConnectAI.tsx`

**Step 1: Write the failing test**

```ts
// web/__tests__/ui-consistency/landing-steps.test.tsx
// Assert landing steps render Card/Alert/Button class tokens (smoke test)
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- landing-steps.test.tsx`
Expected: FAIL (test file missing).

**Step 3: Implement minimal UI alignment**

- Replace hand-rolled card wrappers with `Card`, `CardHeader`, `CardContent` where possible.
- Ensure step number pill, headings, and status rows use tokenized colors.
- Replace any raw `<button>` with `Button`.

**Step 4: Write the test to check for consistency tokens**

```ts
// Check for Card root class and absence of rounded-xl/p-5 patterns.
```

**Step 5: Run test to verify it passes**

Run: `npm --prefix web test -- landing-steps.test.tsx`
Expected: PASS.

**Step 6: Commit**

```bash
git add web/app/(site)/page.tsx web/components/site/StepConnectPlatforms.tsx web/components/site/StepConnectAI.tsx web/__tests__/ui-consistency/landing-steps.test.tsx
git commit -m "feat: standardize landing step cards"
```

---

### Task 3: Standardize consent page to base style

**Files:**
- Modify: `web/components/site/connectors/ConsentScreen.tsx`
- Modify: `web/app/(site)/oauth/consent/page.tsx`

**Step 1: Write the failing test**

```ts
// web/__tests__/ui-consistency/consent-screen.test.tsx
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- consent-screen.test.tsx`
Expected: FAIL.

**Step 3: Implement minimal UI alignment**

- Ensure Card layout uses base typography and spacing.
- Replace any remaining raw button/link patterns with `Button` or `Link` + Button.
- Replace hard-coded colors with token classes.

**Step 4: Run test to verify it passes**

Run: `npm --prefix web test -- consent-screen.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add web/components/site/connectors/ConsentScreen.tsx web/app/(site)/oauth/consent/page.tsx web/__tests__/ui-consistency/consent-screen.test.tsx
git commit -m "feat: align oauth consent with base ui"
```

---

### Task 4: Make privacy and inspirations pages dark-mode safe

**Files:**
- Modify: `web/app/(site)/privacy/page.tsx`
- Modify: `web/app/(site)/inspirations/page.tsx`

**Step 1: Write the failing test**

```ts
// web/__tests__/ui-consistency/content-pages.test.tsx
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- content-pages.test.tsx`
Expected: FAIL.

**Step 3: Implement minimal UI alignment**

- Swap `prose` class for tokenized typography helpers or add dark-safe prose class if kept.
- Replace any fixed colors with tokenized colors.
- Normalize headings to base typography sizes.

**Step 4: Run test to verify it passes**

Run: `npm --prefix web test -- content-pages.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add web/app/(site)/privacy/page.tsx web/app/(site)/inspirations/page.tsx web/__tests__/ui-consistency/content-pages.test.tsx
git commit -m "feat: make content pages dark-safe"
```

---

### Task 5: Reduce color drift on /leagues badges and banners

**Files:**
- Modify: `web/app/(site)/leagues/page.tsx`

**Step 1: Write the failing test**

```ts
// web/__tests__/ui-consistency/leagues-colors.test.tsx
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- leagues-colors.test.tsx`
Expected: FAIL.

**Step 3: Implement minimal UI alignment**

- Replace direct `bg-green-100`, `text-green-700`, `bg-red-*` with `Badge`/`Alert` variants or tokenized classes.
- Ensure dark equivalents are present when status colors are necessary.

**Step 4: Run test to verify it passes**

Run: `npm --prefix web test -- leagues-colors.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add web/app/(site)/leagues/page.tsx web/__tests__/ui-consistency/leagues-colors.test.tsx
git commit -m "feat: normalize league status colors"
```

---

### Task 6: Align chat entry UI (secondary pass)

**Files:**
- Modify: `web/components/chat/assistant.tsx`

**Step 1: Write the failing test**

```ts
// web/__tests__/ui-consistency/chat-entry.test.tsx
```

**Step 2: Run test to verify it fails**

Run: `npm --prefix web test -- chat-entry.test.tsx`
Expected: FAIL.

**Step 3: Implement minimal UI alignment**

- Replace raw buttons with `Button`.
- Convert setup banner to `Alert` with tokenized colors.
- Ensure spacing matches base rules.

**Step 4: Run test to verify it passes**

Run: `npm --prefix web test -- chat-entry.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add web/components/chat/assistant.tsx web/__tests__/ui-consistency/chat-entry.test.tsx
git commit -m "feat: align chat entry ui with base style"
```

---

### Task 7: Manual QA pass (visual)

**Files:**
- None

**Step 1: Run local dev server**

Run: `npm run dev:frontend`
Expected: server running.

**Step 2: Visual smoke check**

- `/` landing steps are consistent cards.
- `/leagues` badges and alerts are dark-safe.
- `/privacy` and `/inspirations` look consistent in dark mode.
- `/oauth/consent` aligns with card styles.
- `/chat` entry screen matches base button styles.

**Step 3: Commit QA note**

```bash
git commit --allow-empty -m "chore: record ui consistency qa pass"
```

---

### Task 8: Update plan cross-reference (after comparison)

**Files:**
- Modify: `docs/plans/2026-01-29-frontend-ui-consistency-plan.md`

**Step 1: Compare with prior plan**

- Identify overlaps and conflicts.
- Merge tasks or mark superseded items.

**Step 2: Update plan file**

- Add a short “Reconciled plan” section with deltas.

**Step 3: Commit**

```bash
git add docs/plans/2026-01-29-frontend-ui-consistency-plan.md
git commit -m "docs: reconcile ui consistency plan"
```
