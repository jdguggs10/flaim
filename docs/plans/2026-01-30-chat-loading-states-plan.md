# Chat Loading States Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate the 5+ second empty void during chat response generation by handling new SSE events, streaming reasoning summaries, and showing a collapsible "Thinking..." pill.

**Architecture:** Replace the boolean `isAssistantLoading` with a richer `LoadingState` object (`idle` / `connecting` / `thinking` / `responding`). Handle three new SSE events (`response.created`, `response.in_progress`, `response.reasoning_summary_text.delta`). Add `reasoning: { summary: "auto" }` to the API call. Rewrite the loading UI as a collapsible thinking pill. The thinking pill is transient — it disappears when the response completes.

**Tech Stack:** React, Zustand, Next.js API routes, OpenAI Responses API (SSE streaming), Tailwind CSS

---

## Task 1: Add reasoning config to API route

**Files:**
- Modify: `web/app/api/chat/turn_response/route.ts:72-80`

**Step 1: Add reasoning parameter to API call**

In `route.ts`, add `reasoning` to the `openai.responses.create` call:

```typescript
events = await openai.responses.create({
  model: MODEL,
  input: messages,
  tools: tools || [],
  stream: true,
  store: true,
  parallel_tool_calls: false,
  reasoning: { summary: "auto" },
  ...(previous_response_id ? { previous_response_id } : {}),
});
```

**Step 2: Verify build**

Run: `cd /Users/ggugger/Code/flaim && npm run build`
Expected: Build succeeds (the reasoning param is accepted by the OpenAI SDK)

**Step 3: Commit**

```bash
git add web/app/api/chat/turn_response/route.ts
git commit -m "feat(chat): enable reasoning summaries in OpenAI API call"
```

---

## Task 2: Replace boolean loading state with LoadingState in Zustand store

**Files:**
- Modify: `web/stores/chat/useConversationStore.ts`

**Step 1: Add LoadingState type and update store interface**

Replace the `isAssistantLoading: boolean` field and its setter with:

```typescript
import { create } from "zustand";
import { Item } from "@/lib/chat/assistant";
import { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { INITIAL_MESSAGE } from "@/config/constants";

export type LoadingStatus = "idle" | "connecting" | "thinking" | "responding";

export interface LoadingState {
  status: LoadingStatus;
  thinkingText: string;
}

interface ConversationState {
  // Items displayed in the chat
  chatMessages: Item[];
  // Items sent to the Responses API (only used for first turn before we have a response ID)
  conversationItems: any[];
  // Loading state for assistant response
  loadingState: LoadingState;
  // Derived: backward-compatible boolean (true when not idle)
  isAssistantLoading: boolean;
  // Previous response ID for stored-responses flow (avoids rebuilding conversation history)
  previousResponseId: string | null;

  setChatMessages: (items: Item[]) => void;
  setConversationItems: (messages: any[]) => void;
  addChatMessage: (item: Item) => void;
  addConversationItem: (message: ChatCompletionMessageParam) => void;
  setLoadingState: (state: LoadingState) => void;
  setPreviousResponseId: (id: string | null) => void;
  clearConversation: () => void;
  rawSet: (state: any) => void;
}

const useConversationStore = create<ConversationState>((set, get) => ({
  chatMessages: [
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: INITIAL_MESSAGE }],
    },
  ],
  conversationItems: [],
  loadingState: { status: "idle", thinkingText: "" },
  get isAssistantLoading() {
    return get().loadingState.status !== "idle";
  },
  previousResponseId: null,
  setChatMessages: (items) => set({ chatMessages: items }),
  setConversationItems: (messages) => set({ conversationItems: messages }),
  addChatMessage: (item) =>
    set((state) => ({ chatMessages: [...state.chatMessages, item] })),
  addConversationItem: (message) =>
    set((state) => ({
      conversationItems: [...state.conversationItems, message],
    })),
  setLoadingState: (loadingState) => set({ loadingState }),
  setPreviousResponseId: (id) => set({ previousResponseId: id }),
  clearConversation: () =>
    set({
      chatMessages: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: INITIAL_MESSAGE }],
        },
      ],
      conversationItems: [],
      loadingState: { status: "idle", thinkingText: "" },
      previousResponseId: null,
    }),
  rawSet: set,
}));

export default useConversationStore;
```

Key changes:
- Removed `isAssistantLoading` as stored state and `setAssistantLoading` setter
- Added `loadingState: LoadingState` and `setLoadingState`
- Added derived `isAssistantLoading` getter via `get()` so existing consumers don't break
- Updated `clearConversation` to reset `loadingState`
- Added `get` to the store factory function signature

**Step 2: Verify build**

Run: `cd /Users/ggugger/Code/flaim && npm run build`
Expected: May fail due to `setAssistantLoading` references in `assistant.ts` — that's expected, fixed in Task 3.

**Step 3: Commit**

```bash
git add web/stores/chat/useConversationStore.ts
git commit -m "refactor(chat): replace boolean loading with LoadingState in store"
```

---

## Task 3: Update SSE event handler to use LoadingState

**Files:**
- Modify: `web/lib/chat/assistant.ts`

This is the largest change. Three things happen:
1. Replace all `setAssistantLoading` calls with `setLoadingState` transitions
2. Add handlers for `response.created`, `response.in_progress`, `response.reasoning_summary_text.delta`
3. Fix the premature loading-off bug

**Step 1: Update store destructuring in processMessages**

At line 168-177 of `assistant.ts`, change the destructured store access:

Replace:
```typescript
const {
  chatMessages,
  conversationItems,
  setChatMessages,
  setConversationItems,
  setAssistantLoading,
  previousResponseId,
  setPreviousResponseId,
} = useConversationStore.getState();
```

With:
```typescript
const {
  chatMessages,
  conversationItems,
  setChatMessages,
  setConversationItems,
  setLoadingState,
  previousResponseId,
  setPreviousResponseId,
} = useConversationStore.getState();
```

**Step 2: Add new event handlers and fix existing ones**

Replace the entire switch statement inside the `handleTurn` callback (lines 228-650) with the updated version. The key changes are:

a) **Add new handlers** at the top of the switch:

```typescript
case "response.created":
case "response.in_progress": {
  setLoadingState({ status: "thinking", thinkingText: "" });
  break;
}

case "response.reasoning_summary_text.delta": {
  const { delta } = data;
  const current = useConversationStore.getState().loadingState;
  setLoadingState({
    status: "thinking",
    thinkingText: current.thinkingText + (delta || ""),
  });
  break;
}
```

b) **Fix `response.output_text.delta`** (line 272): Replace `setAssistantLoading(false)` with:

```typescript
setLoadingState({ status: "responding", thinkingText: "" });
```

c) **Fix `response.output_item.added`** (line 282): Remove the blanket `setAssistantLoading(false)`. Only transition for `message` type:

```typescript
case "response.output_item.added": {
  const { item } = data || {};
  if (!item || !item.type) {
    break;
  }
  // Only transition to "responding" for message items.
  // Tool calls keep the thinking/connecting state active
  // until actual text content arrives.
  if (item.type === "message") {
    setLoadingState({ status: "responding", thinkingText: "" });
  }
  // Handle differently depending on the item type
  switch (item.type) {
    // ... all existing cases remain unchanged
  }
  break;
}
```

d) **Fix `response.completed`** (line 592): Add loading state reset:

```typescript
case "response.completed": {
  console.log("response completed", data);
  setLoadingState({ status: "idle", thinkingText: "" });
  const { response } = data;
  // ... rest of existing handler unchanged
}
```

e) **Fix `error` handler** (line 645): Replace `setAssistantLoading(false)` with:

```typescript
setLoadingState({ status: "idle", thinkingText: "" });
```

**Step 3: Update the initial loading state trigger**

Find where `setAssistantLoading(true)` is called when the user sends a message. This is likely in the component that calls `processMessages()`. Search for it:

```bash
cd /Users/ggugger/Code/flaim && grep -rn "setAssistantLoading(true)" web/
```

Replace every `setAssistantLoading(true)` with:

```typescript
setLoadingState({ status: "connecting", thinkingText: "" });
```

**Step 4: Verify build**

Run: `cd /Users/ggugger/Code/flaim && npm run build`
Expected: Build succeeds. No remaining references to `setAssistantLoading`.

**Step 5: Verify no remaining references**

Run: `cd /Users/ggugger/Code/flaim && grep -rn "setAssistantLoading" web/`
Expected: Zero results.

**Step 6: Commit**

```bash
git add web/lib/chat/assistant.ts
git add -u  # catch any other files that reference setAssistantLoading
git commit -m "feat(chat): handle new SSE events and fix premature loading-off bug"
```

---

## Task 4: Rewrite LoadingMessage as ThinkingPill component

**Files:**
- Modify: `web/components/chat/loading-message.tsx`

**Step 1: Rewrite the component**

Replace the entire contents of `loading-message.tsx`:

```tsx
"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import useConversationStore from "@/stores/chat/useConversationStore";

const LoadingMessage: React.FC = () => {
  const { loadingState } = useConversationStore();
  const [expanded, setExpanded] = useState(false);

  // Only render during connecting or thinking states
  if (loadingState.status !== "connecting" && loadingState.status !== "thinking") {
    return null;
  }

  const hasThinkingText = loadingState.thinkingText.length > 0;
  const label = loadingState.status === "connecting" ? "Connecting..." : "Thinking...";

  return (
    <div className="text-sm">
      <div className="flex flex-col">
        <div className="flex">
          <div className="mr-4 rounded-[16px] px-4 py-2 md:mr-24 text-foreground bg-card font-light">
            {/* Pill header: spinner + label + optional expand toggle */}
            <button
              type="button"
              onClick={() => hasThinkingText && setExpanded(!expanded)}
              disabled={!hasThinkingText}
              className="flex items-center gap-2 disabled:cursor-default"
            >
              {/* Spinner */}
              <div className="w-4 h-4 border-2 border-foreground/30 border-t-foreground rounded-full animate-spin" />

              <span className="text-sm text-muted-foreground">{label}</span>

              {/* Expand chevron (only when there's thinking text) */}
              {hasThinkingText && (
                <span className="text-muted-foreground">
                  {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
              )}
            </button>

            {/* Expanded thinking text */}
            {expanded && hasThinkingText && (
              <div className="mt-2 pt-2 border-t border-border max-h-40 overflow-y-auto">
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                  {loadingState.thinkingText}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoadingMessage;
```

Key design decisions:
- Keeps the same export name (`LoadingMessage`) and default export so `chat.tsx` needs zero changes
- Reads `loadingState` directly from the store (no prop drilling)
- Shows spinner + "Connecting..." or "Thinking..." text (bigger than old 12px dot)
- Expand/collapse chevron only appears when reasoning text is available
- Max height 40 (160px) with scroll for long thinking text
- Uses existing design system: `bg-card`, `text-muted-foreground`, `border-border`
- Uses `lucide-react` which is already in the project (see chat.tsx imports)

**Step 2: Verify build**

Run: `cd /Users/ggugger/Code/flaim && npm run build`
Expected: Build succeeds.

**Step 3: Commit**

```bash
git add web/components/chat/loading-message.tsx
git commit -m "feat(chat): rewrite loading indicator as collapsible thinking pill"
```

---

## Task 5: Verify `chat.tsx` needs no changes

**Files:**
- Read (verify only): `web/components/chat/chat.tsx:30,115`

**Step 1: Confirm backward compatibility**

Verify that `chat.tsx` still works without changes:
- Line 30: `const { isAssistantLoading, clearConversation } = useConversationStore();` — works because we added a derived getter
- Line 115: `{isAssistantLoading && <LoadingMessage />}` — works because the getter returns true for non-idle states, and `LoadingMessage` handles its own rendering logic

Run: `cd /Users/ggugger/Code/flaim && npm run build`
Expected: Build succeeds with zero changes to `chat.tsx`.

If the derived getter approach doesn't work with Zustand's `create` (since getters on plain objects in Zustand can be tricky), the fallback is to change line 30 to:

```typescript
const { loadingState, clearConversation } = useConversationStore();
const isAssistantLoading = loadingState.status !== "idle";
```

And keep line 115 the same. This is a one-line change in `chat.tsx` only if needed.

**Step 2: Commit (only if fallback was needed)**

```bash
git add web/components/chat/chat.tsx
git commit -m "fix(chat): derive isAssistantLoading from loadingState in chat component"
```

---

## Task 6: Manual smoke test

**No code changes. Verification only.**

**Step 1: Run dev server**

Run: `cd /Users/ggugger/Code/flaim && npm run dev:frontend`

**Step 2: Test on production** (MCP tools don't work locally)

Since MCP tools can't reach localhost, the full flow can only be tested in production. However, locally you can verify:

1. Send a message in the chat
2. Confirm "Connecting..." appears immediately with a spinner (not a tiny dot)
3. Confirm "Thinking..." appears when model starts processing
4. If using a reasoning model: confirm the expand chevron appears and clicking shows thinking text
5. Confirm the loading indicator disappears when the response text starts streaming
6. Confirm no empty void between loading disappearing and content appearing

**Step 3: Check browser console**

Open DevTools console. The `[SSE EVENT]` logs should now show:
- `response.created` — fires first
- `response.in_progress` — fires second
- `response.reasoning_summary_text.delta` — fires during thinking (if model supports it)
- `response.output_item.added` — fires when output starts
- `response.output_text.delta` — text streaming

---

## Task 7: Update docs

**Files:**
- Modify: `docs/dev/chat-loading-states-investigation.md`

**Step 1: Update the investigation doc status**

Change the header status from "Documented for future implementation" to "Implemented" and add a summary of what was done at the bottom:

```markdown
**Status:** Implemented (2026-01-30)
```

Add a section at the bottom:

```markdown
## Implementation (2026-01-30)

Implemented all four recommendations:

1. **Bug fix:** `setAssistantLoading(false)` replaced with `setLoadingState` transitions. Loading only turns off when actual text content arrives or response completes.
2. **New SSE handlers:** `response.created` and `response.in_progress` now trigger "Thinking..." state immediately.
3. **Reasoning summaries:** Added `reasoning: { summary: "auto" }` to API call. `response.reasoning_summary_text.delta` events stream into a collapsible thinking pill.
4. **Enhanced loading UI:** Replaced 12px pulsing dot with a spinner + text label + expandable reasoning text panel.

**Files changed:**
- `web/app/api/chat/turn_response/route.ts` — reasoning config
- `web/stores/chat/useConversationStore.ts` — LoadingState type
- `web/lib/chat/assistant.ts` — SSE event handlers
- `web/components/chat/loading-message.tsx` — thinking pill UI
```

**Step 2: Consult `docs/INDEX.md` for any other docs to update**

Check if any other docs reference the chat loading behavior and update accordingly.

**Step 3: Commit**

```bash
git add docs/dev/chat-loading-states-investigation.md
git commit -m "docs: mark chat loading states as implemented"
```
