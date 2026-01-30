# Frontend UI Consistency Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace hard-coded Tailwind color classes and ad-hoc card patterns across the web app with semantic design tokens and UI primitives, making the site dark-mode-safe and visually consistent.

**Architecture:** Add semantic CSS custom properties (success/warning/info) to the existing HSL token system, wire them into Tailwind + component variants, then migrate every file that uses raw color classes. A lightweight shell script prevents regressions.

**Tech Stack:** Next.js app router, Tailwind CSS, shadcn-style UI components (cva), Clerk.

---

### Task 1: Add semantic tokens to globals.css and tailwind.config.ts

**Files:**
- Modify: `web/app/globals.css`
- Modify: `web/tailwind.config.ts`

**Step 1: Add CSS custom properties**

In `web/app/globals.css`, add these to `:root` (inside the existing `@layer base` block, after `--radius`):

```css
--success: 142 71% 45%;
--success-foreground: 144 70% 96%;
--warning: 38 92% 50%;
--warning-foreground: 48 100% 96%;
--info: 210 90% 45%;
--info-foreground: 210 100% 96%;
```

And in `.dark` (after the existing `--chart-5`):

```css
--success: 142 71% 35%;
--success-foreground: 144 70% 96%;
--warning: 38 80% 40%;
--warning-foreground: 48 100% 96%;
--info: 210 80% 55%;
--info-foreground: 210 100% 96%;
```

**Step 2: Wire into Tailwind config**

In `web/tailwind.config.ts`, add to `colors` (after `chart`):

```ts
success: {
  DEFAULT: "hsl(var(--success))",
  foreground: "hsl(var(--success-foreground))",
},
warning: {
  DEFAULT: "hsl(var(--warning))",
  foreground: "hsl(var(--warning-foreground))",
},
info: {
  DEFAULT: "hsl(var(--info))",
  foreground: "hsl(var(--info-foreground))",
},
```

**Step 3: Verify build**

Run: `cd web && npx next build --no-lint 2>&1 | tail -5`
Expected: build succeeds (or at least no CSS/config errors).

**Step 4: Commit**

```bash
git add web/app/globals.css web/tailwind.config.ts
git commit -m "feat: add semantic status tokens (success/warning/info)"
```

---

### Task 2: Extend Alert and Badge with semantic variants

**Files:**
- Modify: `web/components/ui/alert.tsx`
- Modify: `web/components/ui/badge.tsx`

**Step 1: Add Alert variants**

In `web/components/ui/alert.tsx`, add three variants alongside `destructive`:

```ts
success: "border-success/50 text-success dark:border-success [&>svg]:text-success",
warning: "border-warning/50 text-warning dark:border-warning [&>svg]:text-warning",
info: "border-info/50 text-info dark:border-info [&>svg]:text-info",
```

**Step 2: Add Badge variants**

In `web/components/ui/badge.tsx`, add three variants alongside `destructive`:

```ts
success: "border-transparent bg-success text-success-foreground hover:bg-success/80",
warning: "border-transparent bg-warning text-warning-foreground hover:bg-warning/80",
info: "border-transparent bg-info text-info-foreground hover:bg-info/80",
```

**Step 3: Commit**

```bash
git add web/components/ui/alert.tsx web/components/ui/badge.tsx
git commit -m "feat: add success/warning/info alert and badge variants"
```

---

### Task 3: Normalize landing page step cards

The landing page (`page.tsx`) and its step components use `bg-background rounded-xl p-5 border` — an ad-hoc card pattern. Replace with the `Card` primitive.

**Files:**
- Modify: `web/app/(site)/page.tsx`
- Modify: `web/components/site/StepConnectPlatforms.tsx`
- Modify: `web/components/site/StepConnectAI.tsx`

**Step 1: In `page.tsx`**

Replace the Step 1 wrapper:
```tsx
// BEFORE:
<div className="bg-background rounded-xl p-5 border flex flex-col">
// AFTER:
<Card className="p-5 flex flex-col">
```

Replace `text-green-600` on "Signed in" with `text-success`:
```tsx
// BEFORE:
<div className="flex items-center gap-2 text-sm text-green-600 font-medium">
// AFTER:
<div className="flex items-center gap-2 text-sm text-success font-medium">
```

Add import: `import { Card } from '@/components/ui/card';`

**Step 2: In `StepConnectPlatforms.tsx`**

Replace all 3 occurrences of `bg-background rounded-xl p-5 border` with `Card className="p-5"`. The 3 locations are:
- Line 184 (loading state)
- Line 198 (signed-out state)
- Line 209 (main render)

Replace all `text-green-600` (lines 242, 247, 307, 327) with `text-success`.

Replace the error div (line 278):
```tsx
// BEFORE:
<div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">{espnError}</div>
// AFTER:
<div className="p-3 bg-destructive/10 border border-destructive/30 rounded text-sm text-destructive">{espnError}</div>
```

Add import: `import { Card } from '@/components/ui/card';`

**Step 3: In `StepConnectAI.tsx`**

Replace the wrapper (line 37):
```tsx
// BEFORE:
<div className="bg-background rounded-xl p-5 border flex flex-col">
// AFTER:
<Card className="p-5 flex flex-col">
```
And the closing `</div>` → `</Card>`.

Replace `text-green-500` on copy confirmation (lines 133, 155) with `text-success`.

Add import: `import { Card } from '@/components/ui/card';`

**Step 4: Verify**

Run: `cd web && npx next build --no-lint 2>&1 | tail -5`
Expected: builds.

**Step 5: Commit**

```bash
git add web/app/(site)/page.tsx web/components/site/StepConnectPlatforms.tsx web/components/site/StepConnectAI.tsx
git commit -m "feat: normalize landing step cards to Card primitive"
```

---

### Task 4: Normalize chat message bubbles and input

The chat uses hard-coded hex colors (`bg-[#ededed]`, `bg-white`, `text-black`, `bg-black`, `bg-[#D7D7D7]`, etc.) that break in dark mode.

**Files:**
- Modify: `web/components/chat/message.tsx`
- Modify: `web/components/chat/loading-message.tsx`
- Modify: `web/components/chat/chat.tsx`
- Modify: `web/components/chat/mcp-approval.tsx`

**Step 1: In `message.tsx`**

User bubble (line 15):
```tsx
// BEFORE:
bg-[#ededed] text-stone-900
// AFTER:
bg-secondary text-secondary-foreground
```

Assistant bubble (line 29):
```tsx
// BEFORE:
text-black bg-white
// AFTER:
text-foreground bg-card
```

**Step 2: In `loading-message.tsx`**

Line 8:
```tsx
// BEFORE:
text-black bg-white
// AFTER:
text-foreground bg-card
```

Line 9 (pulse dot):
```tsx
// BEFORE:
bg-black
// AFTER:
bg-foreground
```

**Step 3: In `chat.tsx`**

Input container (line 122):
```tsx
// BEFORE:
bg-white border border-stone-200 shadow-sm
// AFTER:
bg-card border border-border shadow-sm
```

Send button (line 150):
```tsx
// BEFORE:
bg-black text-white ... disabled:bg-[#D7D7D7] disabled:text-[#f4f4f4]
// AFTER:
bg-foreground text-background ... disabled:bg-muted disabled:text-muted-foreground
```

Debug badge (line 75):
```tsx
// BEFORE:
bg-amber-100 border border-amber-300 text-amber-800
// AFTER:
bg-warning/20 border border-warning/50 text-warning
```

Active league badge (line 83):
```tsx
// BEFORE:
bg-blue-50 border border-blue-200 text-blue-700
// AFTER:
bg-info/10 border border-info/30 text-info
```

**Step 4: In `mcp-approval.tsx`**

Approval box (line 22):
```tsx
// BEFORE:
text-black bg-gray-100
// AFTER:
text-foreground bg-secondary
```

Decline button (line 36):
```tsx
// BEFORE:
className="bg-gray-200 text-gray-700 hover:bg-gray-300 hover:text-gray-800"
// AFTER:
variant="secondary"
```
(Remove the className prop; the `secondary` variant handles it.)

**Step 5: Verify & Commit**

```bash
cd web && npx next build --no-lint 2>&1 | tail -5
git add web/components/chat/message.tsx web/components/chat/loading-message.tsx web/components/chat/chat.tsx web/components/chat/mcp-approval.tsx
git commit -m "feat: normalize chat bubbles and input to design tokens"
```

---

### Task 5: Normalize tool-call component

`tool-call.tsx` uses hard-coded colors (`text-blue-500`, `text-gray-700`, `bg-[#fafafa]`, `text-zinc-500`, `bg-red-50`, `text-red-*`, `bg-slate-*`, `bg-[#ededed]`).

**Files:**
- Modify: `web/components/chat/tool-call.tsx`

**Step 1: Replace palette classes**

| Old | New | Locations |
|-----|-----|-----------|
| `text-blue-500` | `text-info` | lines 150, 233, 249, 286, 384 |
| `text-red-500` | `text-destructive` | line 286 (error state) |
| `text-gray-700` | `text-muted-foreground` | lines 149, 285, 382 |
| `bg-[#fafafa]` | `bg-muted` | lines 171, 309, 398 |
| `bg-red-50 border border-red-200` | `bg-destructive/10 border border-destructive/30` | lines 93, 309 |
| `text-red-600` | `text-destructive` | lines 95, 101 |
| `text-red-700` | `text-destructive` | lines 98, 105 |
| `text-red-800` | `text-destructive` | line 97 |
| `bg-slate-100 border border-slate-200 ... text-slate-600` | `bg-muted border border-border ... text-muted-foreground` | line 124 |
| `text-zinc-500` | `text-muted-foreground` | lines 218, 364 |
| `bg-[#ededed] text-xs text-zinc-500` | `bg-secondary text-xs text-muted-foreground` | line 421 |

Also replace the hard-coded `backgroundColor: "#fafafa"` in SyntaxHighlighter `customStyle` props with `"transparent"` (6 occurrences — the parent bg-muted handles the background).

**Step 2: Verify & Commit**

```bash
cd web && npx next build --no-lint 2>&1 | tail -5
git add web/components/chat/tool-call.tsx
git commit -m "feat: normalize tool-call colors to design tokens"
```

---

### Task 6: Normalize chat header buttons, dev-console, and assistant banner

**Files:**
- Modify: `web/components/chat/account-header-button.tsx`
- Modify: `web/components/chat/espn-header-button.tsx`
- Modify: `web/components/chat/assistant.tsx`
- Modify: `web/components/chat/websearch-config.tsx`
- Modify: `web/components/chat/sport-platform-config.tsx`
- Modify: `web/components/chat/dev-console/environment-badge.tsx`
- Modify: `web/components/chat/dev-console/copy-button.tsx`
- Modify: `web/components/chat/dev-console/account-section.tsx`
- Modify: `web/components/chat/dev-console/espn-section.tsx`
- Modify: `web/components/chat/dev-console/mcp-section.tsx`
- Modify: `web/components/chat/dev-console/debug-section.tsx`
- Modify: `web/components/chat/dev-console/tools-section.tsx`

**Step 1: Status dot pattern (account-header-button.tsx, espn-header-button.tsx)**

Replace status dot colors:
```ts
// BEFORE:
"bg-green-500" / "bg-red-500" / "bg-amber-500"
// AFTER:
"bg-success" / "bg-destructive" / "bg-warning"
```

Replace inline text colors:
```ts
// BEFORE:
"text-green-600" / "text-red-600" / "text-amber-600"
// AFTER:
"text-success" / "text-destructive" / "text-warning"
```

Apply to both files (same pattern).

**Step 2: assistant.tsx SetupBanner**

```tsx
// BEFORE:
bg-amber-50 border border-amber-200
text-amber-600 / text-amber-800 / text-amber-700 / hover:text-amber-900
// AFTER:
bg-warning/10 border border-warning/30
text-warning / text-warning / text-warning / hover:text-warning
```

**Step 3: websearch-config.tsx**

```tsx
// BEFORE:
bg-white border text-sm flex-1 text-zinc-900 placeholder:text-zinc-400
// AFTER:
bg-card border text-sm flex-1 text-foreground placeholder:text-muted-foreground
```

**Step 4: sport-platform-config.tsx**

Green success block:
```tsx
// BEFORE:
bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800
text-green-800 dark:text-green-300 / text-green-700 dark:text-green-400
// AFTER:
bg-success/10 border-success/30
text-success / text-success
```

Yellow warning block:
```tsx
// BEFORE:
bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800
text-yellow-800 dark:text-yellow-300 / text-yellow-700 dark:text-yellow-400
// AFTER:
bg-warning/10 border-warning/30
text-warning / text-warning
```

**Step 5: Dev console files**

Apply the same `text-green-600` → `text-success`, `text-red-600` → `text-destructive`, `text-amber-600` → `text-warning`, `bg-red-50` → `bg-destructive/10`, `bg-amber-50` → `bg-warning/10` pattern across:
- `environment-badge.tsx`: `bg-green-500`→`bg-success`, `bg-yellow-500`→`bg-warning`, `bg-red-500`→`bg-destructive`, `text-white`→`text-success-foreground`/`text-destructive-foreground`, `text-black`→`text-warning-foreground`
- `copy-button.tsx`: `text-green-500` → `text-success`
- `account-section.tsx`: `text-green-600` → `text-success`, `text-red-600` → `text-destructive`
- `espn-section.tsx`: `text-green-600` → `text-success`, `text-red-600` → `text-destructive`, `text-amber-600` → `text-warning`
- `mcp-section.tsx`: `text-green-600` → `text-success`, `text-red-600` → `text-destructive`, `bg-red-50 dark:bg-red-900/20` → `bg-destructive/10`
- `debug-section.tsx`: `text-green-600` → `text-success`, `text-red-600` → `text-destructive`, `bg-red-50 dark:bg-red-900/20` → `bg-destructive/10`, `hover:text-red-700 hover:bg-red-50` → `hover:text-destructive hover:bg-destructive/10`
- `tools-section.tsx`: `text-green-600` → `text-success`, `text-red-600` → `text-destructive`, `text-amber-600 bg-amber-50 dark:bg-amber-900/20` → `text-warning bg-warning/10`

**Step 6: Verify & Commit**

```bash
cd web && npx next build --no-lint 2>&1 | tail -5
git add web/components/chat/ web/components/chat/dev-console/
git commit -m "feat: normalize chat header, dev-console, and config colors"
```

---

### Task 7: Normalize OAuth consent and leagues pages

**Files:**
- Modify: `web/components/site/connectors/ConsentScreen.tsx`
- Modify: `web/app/(site)/leagues/page.tsx`

**Step 1: ConsentScreen.tsx**

Replace permission checkmarks:
```tsx
// BEFORE:
text-green-500
// AFTER:
text-success
```

**Step 2: leagues/page.tsx**

Replace:
- `bg-blue-50 border-blue-200 text-blue-900 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-200` → use Alert with `className="bg-info/10 border-info/30 text-info"`
- `text-yellow-500` and `hover:text-yellow-500` → `text-warning` and `hover:text-warning`
- `bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400` → `bg-success/20 text-success`
- `text-green-600` → `text-success`

**Step 3: Verify & Commit**

```bash
cd web && npx next build --no-lint 2>&1 | tail -5
git add web/components/site/connectors/ConsentScreen.tsx web/app/(site)/leagues/page.tsx
git commit -m "feat: normalize consent and leagues page colors"
```

---

### Task 8: Delete dead components and add consistency check

**Files:**
- Delete: `web/components/ui/panel.tsx` (empty, unreferenced)
- Delete: `web/components/site/StepSyncEspn.tsx` (unreferenced)
- Delete: `web/components/site/EspnCredentialsCard.tsx` (unreferenced)
- Modify: `web/components/ui/index.ts` (remove panel export if present)
- Create: `scripts/ui-consistency-check.sh`
- Modify: `package.json`

**Step 1: Remove panel export from barrel**

In `web/components/ui/index.ts`, remove the line (if it exists — panel.tsx is empty but may not be exported). Check first.

**Step 2: Delete dead files**

```bash
rm web/components/ui/panel.tsx
rm web/components/site/StepSyncEspn.tsx
rm web/components/site/EspnCredentialsCard.tsx
```

**Step 3: Create consistency check script**

Create `scripts/ui-consistency-check.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "Checking for hard-coded palette classes..."

# Allow-list: bg-black/50 and bg-black/80 are used for overlays (dialog.tsx)
# Allow-list: bg-foreground text-background on send button is tokenized (not raw)
VIOLATIONS=$(
  grep -rn --include='*.tsx' --include='*.ts' \
    -E 'bg-(white|gray|red|green|blue|amber|yellow|slate|stone|zinc)|text-(black|white|gray|red|green|blue|amber|yellow|slate|stone|zinc)|bg-\[#' \
    web/components web/app \
    | grep -v 'node_modules' \
    | grep -v 'bg-black/[0-9]' \
  || true
)

if [ -n "$VIOLATIONS" ]; then
  echo "FAIL: Hard-coded color classes found:"
  echo "$VIOLATIONS"
  exit 1
fi

echo "PASS: No hard-coded color violations found."
```

**Step 4: Add npm script**

Add to root `package.json` scripts:

```json
"ui:check": "bash scripts/ui-consistency-check.sh"
```

**Step 5: Run check**

```bash
chmod +x scripts/ui-consistency-check.sh
npm run ui:check
```

Expected: PASS (if all prior tasks completed correctly). If FAIL, fix remaining violations.

**Step 6: Commit**

```bash
git add -A scripts/ui-consistency-check.sh package.json web/components/ui/panel.tsx web/components/ui/index.ts web/components/site/StepSyncEspn.tsx web/components/site/EspnCredentialsCard.tsx
git commit -m "chore: delete dead components, add ui consistency check"
```

---

### Task 9: Write base rules doc and update docs index

**Files:**
- Create: `docs/dev/ui-consistency.md`
- Modify: `docs/INDEX.md`

**Step 1: Write rules doc**

Create `docs/dev/ui-consistency.md`:

```markdown
# UI Consistency Base Rules (2026-01-29)

Scope: web app (`web/`).

- Use primitives from `web/components/ui` (Button, Card, Input, Alert, Badge, Popover, Dialog).
- Surfaces: default is `Card` (rounded-lg + shadow-sm). Use `bg-muted` for inset areas.
- Colors: only tokenized classes (bg-background, bg-muted, text-muted-foreground, border-border).
- Status colors: `text-success`, `text-warning`, `text-info`, `text-destructive` — never raw green/amber/blue/red.
- Status backgrounds: `bg-success/10`, `bg-warning/10`, etc. for tinted panels.
- Typography: page title = text-3xl font-bold; section title = text-2xl font-semibold.
- Layout: section padding py-8; vertical stacks space-y-4 for tight, space-y-6 for roomy.
- Raw `<button>` is for icon-only or non-Button elements; otherwise use `Button`.
- Run `npm run ui:check` to verify no regressions.
```

**Step 2: Add to INDEX.md**

Under the `### Dev docs` section, add a bullet:
```markdown
- `docs/dev/ui-consistency.md`: Base rules for tokenized color usage and UI primitives.
```

**Step 3: Commit**

```bash
git add docs/dev/ui-consistency.md docs/INDEX.md
git commit -m "docs: add ui consistency rules and update index"
```

---

### Task 10: Manual QA and final verification

**Files:** None modified.

**Step 1: Run full checks**

```bash
npm run ui:check
cd web && npx next build --no-lint 2>&1 | tail -10
```

Both must pass.

**Step 2: Visual spot check**

Start dev server: `npm run dev:frontend`

Check these pages visually:
- `/` — step cards use Card, green statuses use success token
- `/leagues` — star icons use warning, status pills use success/info tokens
- `/chat` — message bubbles, tool calls, input box all use tokenized colors
- `/oauth/consent` — checkmarks use success token

**Step 3: Record QA**

```bash
git commit --allow-empty -m "chore: ui consistency pass complete"
```
