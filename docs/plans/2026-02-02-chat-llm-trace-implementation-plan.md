# LLM Trace Dev Console Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an LLM Trace panel to the chat dev console that shows the exact prompt payloads and tool outputs injected into the model, while simplifying the chat header.

**Architecture:** Client-only tracing captured in `processMessages()` and stored in a lightweight Zustand trace store. The Dev Console renders trace entries with prompt, tools, and assistant output blocks. No worker or API changes.

**Tech Stack:** Next.js (App Router), React, Zustand, shadcn/ui, TypeScript.

---

### Task 1: Add trace types + store in conversation state

**Files:**
- Modify: `web/stores/chat/useConversationStore.ts`
- Create: `web/lib/chat/trace-types.ts`

**Step 1: Write the failing test (manual checklist)**

Create `docs/dev/llm-trace-manual-test.md` with:
- Open `/chat` → no LLM Trace section (expected FAIL before implementation)
- Send a message → no prompt payload shown (expected FAIL)

**Step 2: Run test to verify it fails**

Manual: open `/chat` and confirm LLM Trace section is missing.

**Step 3: Write minimal implementation**

Add types:
```ts
// web/lib/chat/trace-types.ts
export type TraceToolEvent = {
  id: string;
  tool_type: string;
  name?: string | null;
  arguments?: string;
  parsedArguments?: unknown;
  output?: string | null;
  status?: string;
  error?: string | null;
};

export type LlmTraceEntry = {
  id: string;
  kind: "request";
  sentAt: string;
  previousResponseId?: string | null;
  inputItems: unknown[];
  toolsSnapshot: unknown[];
  systemPrompt?: string;
  leagueContext?: string | null;
  userMessage?: string | null;
  assistantOutput?: string | null;
  toolEvents: TraceToolEvent[];
  error?: string | null;
};
```

Update store:
- Add `traceEntries: LlmTraceEntry[]` (bounded to last 50).
- Add `addTraceEntry(entry)` and `updateTraceEntry(id, updater)`.
- Add `clearTraces()` and call it from `clearConversation`.

**Step 4: Run test to verify it passes**

Manual: open `/chat`, still missing UI (expected until Task 4). Confirm no runtime errors.

**Step 5: Commit**

```bash
git add docs/dev/llm-trace-manual-test.md web/lib/chat/trace-types.ts web/stores/chat/useConversationStore.ts
git commit -m "feat: add trace types and store"
```

---

### Task 2: Add trace redaction helpers

**Files:**
- Create: `web/lib/chat/trace-utils.ts`

**Step 1: Write the failing test (manual checklist)**

Extend `docs/dev/llm-trace-manual-test.md`:
- Verify Authorization headers are redacted in trace payloads (expected FAIL).

**Step 2: Run test to verify it fails**

Manual: (after Task 1) inspect trace data once added; confirm tokens currently visible.

**Step 3: Write minimal implementation**

Implement `redactSensitive(value)`:
- Redact keys `authorization`, any key containing `clerk`.
- Redact string values where key matches `/token|jwt|secret/i`.
- Preserve structure and non-sensitive fields.

**Step 4: Run test to verify it passes**

Manual: once trace capture is wired, verify tokens are masked as `***redacted***`.

**Step 5: Commit**

```bash
git add web/lib/chat/trace-utils.ts docs/dev/llm-trace-manual-test.md
git commit -m "feat: add trace redaction helper"
```

---

### Task 3: Capture trace entries in `processMessages`

**Files:**
- Modify: `web/lib/chat/assistant.ts`
- Modify: `web/stores/chat/useConversationStore.ts`

**Step 1: Write the failing test (manual checklist)**

Extend checklist:
- Sending a message creates a new trace entry with input payload (expected FAIL).
- Tool calls appear in trace with args + output (expected FAIL).

**Step 2: Run test to verify it fails**

Manual: (after Task 1) send a chat message; confirm no trace entry exists.

**Step 3: Write minimal implementation**

In `processMessages()`:
- Create `const traceId = crypto.randomUUID()` per request.
- Before `handleTurn`, add a trace entry with:
  - `inputItems` (exact array)
  - `toolsSnapshot` (redacted)
  - `previousResponseId`
  - `systemPrompt` + `leagueContext` for display
  - `userMessage` (from conversationItems)
- In SSE handlers:
  - On tool call add/update, append/update `toolEvents` with arguments and outputs.
  - On response completion, set `assistantOutput` on the trace entry.
  - On errors, set `error` on the trace entry.
- Use `updateTraceEntry` to mutate by `traceId`.

**Step 4: Run test to verify it passes**

Manual: send a message and confirm trace entry captures:
- Prompt payload
- Tool events (if any)
- Final assistant output

**Step 5: Commit**

```bash
git add web/lib/chat/assistant.ts web/stores/chat/useConversationStore.ts docs/dev/llm-trace-manual-test.md
git commit -m "feat: capture llm trace entries"
```

---

### Task 4: Build the LLM Trace Dev Console UI

**Files:**
- Create: `web/components/chat/dev-console/llm-trace-section.tsx`
- Modify: `web/components/chat/dev-console/index.tsx`

**Step 1: Write the failing test (manual checklist)**

Extend checklist:
- LLM Trace section visible and expandable (expected FAIL).
- Each entry shows Prompt / Tools / Assistant Output blocks (expected FAIL).

**Step 2: Run test to verify it fails**

Manual: open `/chat` → no LLM Trace section.

**Step 3: Write minimal implementation**

- Create a new `CollapsibleSection` titled “LLM Trace”.
- Render entries newest-first with expand/collapse.
- Each entry shows:
  - Prompt Sent (pretty JSON + copy)
  - Tools (tool list + args/output + error)
  - Assistant Output (raw text + copy)

**Step 4: Run test to verify it passes**

Manual: send a message and confirm LLM Trace renders correct data.

**Step 5: Commit**

```bash
git add web/components/chat/dev-console/llm-trace-section.tsx web/components/chat/dev-console/index.tsx docs/dev/llm-trace-manual-test.md
git commit -m "feat: add llm trace dev console section"
```

---

### Task 5: Simplify chat header

**Files:**
- Modify: `web/components/chat/chat-header.tsx`

**Step 1: Write the failing test (manual checklist)**

Extend checklist:
- Header only shows logo, env badge, and user button (expected FAIL).

**Step 2: Run test to verify it fails**

Manual: open `/chat` → header shows account/league dropdowns.

**Step 3: Write minimal implementation**

- Remove AccountHeaderButton, EspnHeaderButton, LeagueDropdown, SeasonDropdown.
- Keep logo + environment badge + UserButton.

**Step 4: Run test to verify it passes**

Manual: open `/chat` → header is minimal.

**Step 5: Commit**

```bash
git add web/components/chat/chat-header.tsx docs/dev/llm-trace-manual-test.md
git commit -m "feat: simplify chat header for dev"
```

---

### Task 6: Export trace entries + update docs

**Files:**
- Modify: `web/components/chat/dev-console/debug-section.tsx`
- Modify: `web/README.md`

**Step 1: Write the failing test (manual checklist)**

Extend checklist:
- Export includes trace entries (expected FAIL).
- README mentions LLM Trace in dev console (expected FAIL).

**Step 2: Run test to verify it fails**

Manual: export session JSON → no trace data.

**Step 3: Write minimal implementation**

- Include `traceEntries` in exported JSON (redacted).
- Add a short note under Built-in Chat in `web/README.md` about LLM Trace.

**Step 4: Run test to verify it passes**

Manual: export JSON includes trace entries.

**Step 5: Commit**

```bash
git add web/components/chat/dev-console/debug-section.tsx web/README.md docs/dev/llm-trace-manual-test.md
git commit -m "feat: export llm trace and document dev console"
```

---

## Verification

- `npm run lint`
- Manual checklist in `docs/dev/llm-trace-manual-test.md`

---

Plan complete and saved to `docs/plans/2026-02-02-chat-llm-trace-implementation-plan.md`.

Two execution options:

1. Subagent-Driven (this session) — I dispatch fresh subagent per task, review between tasks, fast iteration
2. Parallel Session (separate) — Open new session with executing-plans, batch execution with checkpoints

Which approach?
