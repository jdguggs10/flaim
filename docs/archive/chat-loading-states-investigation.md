# Chat Loading States Investigation

**Date:** January 29, 2026
**Status:** Implemented (2026-01-30)
**Priority:** UX Enhancement

## Problem Statement

The dev console chat has a "barren" user experience during response generation. Users see minimal feedback while waiting for responses, creating an impression that nothing is happening.

### Observed User Experience

**Timeline of a typical chat interaction:**
- **0-500ms:** Tiny, barely visible pulsing black dot (loading indicator)
- **500ms-2000ms:** Same tiny dot continues
- **2000ms-7700ms:** **EMPTY VOID** - dot disappears, nothing visible
- **7700ms:** Tool call UI finally appears with "Waiting for result..."
- Eventually: Full response appears

**The "barren" feeling:** 5+ seconds of staring at blank space with zero feedback.

## Investigation Process

### Tools Used
- **Playwright** for automated browser testing and screenshot capture
- **SSE event logging** in browser console
- **Screenshot analysis** at specific time intervals (100ms, 500ms, 2s, 7.7s)

### Test Configuration
- **Environment:** Production (flaim.app/chat)
- **Model:** `gpt-5-mini-2025-08-07`
- **MCP Tools:** 4 active (fantasy-football, baseball, basketball, hockey)
- **Test message:** "What are the standings in my football league?"

### Evidence Collected

Screenshots captured at:
1. `03-just-after-send.png` (100ms) - Shows tiny loading dot
2. `04-500ms-after-send.png` (500ms) - Same tiny dot
3. `05-2s-after-send.png` (2000ms) - **No loading, no content, empty space**
4. `06-complete.png` (7748ms) - Tool call UI visible with response

## Root Causes Identified

### Issue #1: Loading Indicator Turned Off Too Early

**Location:** `web/lib/chat/assistant.ts:279`

```typescript
case "response.output_item.added": {
  const { item } = data || {};
  if (!item || !item.type) {
    break;
  }
  setAssistantLoading(false);  // ← BUG: Turns off immediately!

  // Then handles different item types...
  switch (item.type) {
    case "mcp_call": {
      // Adds tool call to UI, but there's a rendering delay
      chatMessages.push({
        type: "tool_call",
        tool_type: "mcp_call",
        status: "in_progress",
        // ...
      });
      setChatMessages([...chatMessages]);
      break;
    }
  }
}
```

**The Problem:**
1. `response.output_item.added` event fires when OpenAI says "I'm going to call a tool"
2. Loading state is **immediately turned off** (line 279)
3. Tool call UI is added to `chatMessages`
4. **BUT:** There's a rendering/scroll delay before the tool call UI is actually visible
5. User sees: loading OFF, but nothing rendered yet = empty void

**Event Flow:**
```
User sends message
  ↓
setAssistantLoading(true)  // Tiny dot appears
  ↓
~2 seconds pass (waiting for OpenAI)
  ↓
response.output_item.added with mcp_call arrives
  ↓
setAssistantLoading(false)  // Dot disappears!
  ↓
Tool call UI added to state
  ↓
??? RENDERING DELAY ???
  ↓
~5+ seconds later, tool call UI finally visible
```

### Issue #2: Loading Indicator Too Subtle

**Location:** `web/components/chat/loading-message.tsx:9`

```typescript
const LoadingMessage: React.FC = () => {
  return (
    <div className="text-sm">
      <div className="flex flex-col">
        <div className="flex">
          <div className="mr-4 rounded-[16px] px-4 py-2 md:mr-24 text-foreground bg-card font-light">
            <div className="w-3 h-3 animate-pulse bg-foreground rounded-full" />
            {/* ↑ Just a tiny 12px dot! */}
          </div>
        </div>
      </div>
    </div>
  );
};
```

**The Problem:**
- Just a 12px (w-3 h-3) pulsing dot
- No text like "Thinking..." or "Processing..."
- Easy to miss, provides no context

### Issue #3: Missing SSE Event Handlers

**Critical Discovery:** We're not handling early SSE events that could provide better feedback!

**Events OpenAI Sends:**
1. ✅ `response.created` - Fires **immediately** when response starts
2. ✅ `response.in_progress` - Fires periodically with progress updates
3. ✅ `response.output_item.added` - When output starts (tool call, text, etc.)
4. ✅ `response.output_text.delta` - Text streaming
5. ... other events we DO handle

**Events We're Currently Handling:**
- ❌ NOT handling `response.created`
- ❌ NOT handling `response.in_progress`
- ✅ Handling `response.output_item.added` (but incorrectly - see Issue #1)
- ✅ Handling `response.output_text.delta`
- ✅ Handling tool-specific events

**What We're Missing:**
```typescript
// These events arrive BEFORE any content!
case "response.created": {
  // Could show: "Response started..."
  // Update loading message to show status
  break;
}

case "response.in_progress": {
  // Could show: "Model processing..." or "Thinking..."
  // Periodic updates while waiting
  break;
}
```

**Source:** [OpenAI Responses API Streaming Events](https://platform.openai.com/docs/api-reference/responses-streaming)

## Code Locations

### Files Involved

1. **`web/lib/chat/assistant.ts`**
   - Line 224: Event handler switch statement
   - Line 269: `setAssistantLoading(false)` on text delta
   - Line 279: `setAssistantLoading(false)` on output item added ← **PRIMARY BUG**
   - Line 341-355: MCP call handling

2. **`web/components/chat/loading-message.tsx`**
   - Line 9: Tiny dot implementation ← **TOO SUBTLE**

3. **`web/components/chat/chat.tsx`**
   - Line 115: `{isAssistantLoading && <LoadingMessage />}`
   - Line 94-95: Tool call rendering

4. **`web/components/chat/tool-call.tsx`**
   - Line 160-162: "Calling {name}..." display
   - Line 219: "Waiting for result..." display

## Recommended Solutions

### Quick Fix (Option 1): Don't Turn Off Loading During Tool Calls

**Location:** `web/lib/chat/assistant.ts:279`

```typescript
case "response.output_item.added": {
  const { item } = data || {};
  if (!item || !item.type) {
    break;
  }

  // FIXED: Only turn off loading for text messages, not tool calls
  if (item.type === "message") {
    setAssistantLoading(false);
  }
  // Keep loading ON for tool calls until they complete

  switch (item.type) {
    // ... rest of handlers
  }
}
```

**Pros:**
- Simple one-line fix
- Keeps loading indicator visible during tool execution
- Eliminates the void

**Cons:**
- Still shows tiny dot instead of rich status
- Doesn't leverage `response.created` / `response.in_progress` events

### Better Fix (Option 2): Handle All SSE Events + Enhance Loading UI

**Step 1:** Add handlers for early events

```typescript
case "response.created": {
  // Show "Response started..." immediately
  setLoadingStatus("Response started...");
  setAssistantLoading(true);
  break;
}

case "response.in_progress": {
  // Show "Processing..." or other status
  setLoadingStatus("Processing...");
  break;
}

case "response.output_item.added": {
  const { item } = data || {};
  if (!item || !item.type) {
    break;
  }

  // Update status based on item type
  if (item.type === "mcp_call") {
    setLoadingStatus(`Calling ${item.name}...`);
    // Don't turn off loading - keep showing status
  } else if (item.type === "message") {
    // Only turn off loading when actual text starts
    setAssistantLoading(false);
  }

  // ... rest of handlers
}
```

**Step 2:** Enhance LoadingMessage component

```typescript
const LoadingMessage: React.FC<{ status?: string }> = ({ status = "Thinking..." }) => {
  return (
    <div className="flex items-start gap-3 p-4 bg-card rounded-lg">
      {/* Bigger, more visible spinner */}
      <div className="w-5 h-5 border-2 border-info border-t-transparent rounded-full animate-spin" />

      {/* Status text */}
      <div className="text-sm text-muted-foreground">
        {status}
      </div>
    </div>
  );
};
```

**Pros:**
- Rich status updates throughout the flow
- Leverages all available SSE events
- Much better UX

**Cons:**
- More code changes
- Need to manage loading status state

### Best Fix (Option 3): Progressive Status Updates

Combine both approaches with a more sophisticated state machine:

```typescript
type LoadingState =
  | { type: 'idle' }
  | { type: 'starting', message: string }
  | { type: 'processing', message: string }
  | { type: 'calling_tool', tool: string }
  | { type: 'waiting_for_tool', tool: string }
  | { type: 'complete' };

// Then update UI based on state
case "response.created": {
  setLoadingState({ type: 'starting', message: 'Response started...' });
  break;
}

case "response.in_progress": {
  setLoadingState({ type: 'processing', message: 'Thinking...' });
  break;
}

case "response.output_item.added": {
  if (item.type === "mcp_call") {
    setLoadingState({ type: 'calling_tool', tool: item.name });
  }
  break;
}
```

## Additional Findings

### MCP Tool Execution Feedback IS Good

The tool call UI (when it finally appears) actually provides good feedback:
- "Calling get_user_session via MCP tool..."
- "Waiting for result..." with clock icon
- Shows request/response in debug mode
- Timing badges on completion

**The problem isn't the tool UI** - it's that there's a long gap BEFORE it appears.

### Dev vs Prod Differences

**Important:** During investigation, we discovered that the dev console chat **cannot use MCP tools when running locally** because:
- OpenAI Responses API runs on OpenAI's servers (cloud)
- OpenAI cannot reach `localhost:8790` from the cloud
- Every request fails with 424 error (Failed Dependency)

**Solution:** Set `NEXT_PUBLIC_DISABLE_MCP=true` in `.env.local` for local dev testing.

## Testing Notes

### Playwright Test Setup

Created `test-chat-loading.spec.ts` for automated testing:
- Captures screenshots at 100ms, 500ms, 2s, 7.7s intervals
- Logs all browser console output
- Supports auth state persistence (no repeated sign-ins)
- Can run on localhost or production

**Run test:**
```bash
npx playwright test test-chat-loading.spec.ts --headed --debug
```

**Auth state persistence:**
- First run: Sign in manually, auth saved to `playwright-auth.json`
- Subsequent runs: Auto-loads saved auth

## Next Steps (When Implementing)

1. **Quick win:** Implement Option 1 to eliminate the void
2. **Add SSE event logging** in dev mode to verify events are arriving
3. **Implement Option 2 or 3** for rich status updates
4. **Test on production** (can't fully test MCP locally)
5. **Update TODO.md** to remove this from bugs

## References

- **OpenAI Responses API Docs:** https://platform.openai.com/docs/api-reference/responses-streaming
- **SSE Event Types:** response.created, response.in_progress, response.output_item.added, etc.
- **Related TODO Item:** `docs/dev/TODO.md` - "Devconsole chat clarity"

## Related Files

- `web/lib/chat/assistant.ts` - Main event handling
- `web/components/chat/loading-message.tsx` - Loading UI
- `web/components/chat/chat.tsx` - Chat container
- `web/components/chat/tool-call.tsx` - Tool execution UI
- `test-chat-loading.spec.ts` - Playwright test
- `screenshots/` - Visual evidence

---

**Last Updated:** January 30, 2026
**Investigated By:** Claude Code Assistant
**Next Action:** None — implemented

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
- `web/components/chat/assistant.tsx` — loading state trigger
- `web/components/chat/chat.tsx` — derived loading check
