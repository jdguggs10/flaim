# Chat Debug Tool Plan

## Status

**Phase 2 Complete** (2025-12-30)

The built-in `/chat` is now a developer debugging tool for MCP servers with:
- Timing badges on all tool calls (ms display)
- Debug Mode toggle in tools panel
- REQUEST/RESPONSE labels when debug mode is on
- Copy buttons on request/response JSON blocks
- Clear conversation button (trash icon)
- Keyboard shortcut `Cmd+D` / `Ctrl+D` to toggle debug mode
- Collapsible JSON blocks (chevron toggle)
- Error styling with red borders, suggestions, and action links
- MCP Server URL display in debug mode
- **NEW**: Debug mode badge (amber "DEBUG" pill, clickable to disable)
- **NEW**: Active league indicator badge (blue pill with league name)

---

## Session Summary (2025-12-29)

### Completed This Session

1. **Debug Mode Implementation**
   - Added `debugMode` toggle to tools store (persisted)
   - Added `ToolCallMetadata` with timing capture
   - Added timing badges + REQUEST/RESPONSE labels to tool-call.tsx

2. **Removed Usage Tracking**
   - Deleted `usage-display.tsx` component
   - Deleted `/api/chat/usage` route
   - Removed `SimpleUsageTracker` from `turn_response/route.ts`
   - Removed "Account & Usage" panel section
   - Chat now has no message limits

3. **Fixed Chat Layout Bug**
   - Problem: Chat input was below viewport, required scrolling
   - Root cause: `h-[90vh]` in chat.tsx didn't account for header/input
   - Fix: Changed to `flex-1 min-h-0`, added `overflow-hidden` to main

4. **Documentation Updates**
   - Updated CHANGELOG.md with unreleased changes
   - Updated ARCHITECTURE.md (removed usage refs, added debug mode)
   - Updated this plan with implementation details

### Files Changed

```
web/stores/chat/useToolsStore.ts      # Added debugMode
web/lib/chat/assistant.ts             # Added ToolCallMetadata, timing
web/components/chat/tool-call.tsx     # TimingBadge, debug labels
web/components/chat/tools-panel.tsx   # Debug Mode toggle, removed UsageDisplay
web/components/chat/assistant.tsx     # Fixed layout, updated sign-in text
web/components/chat/chat.tsx          # Fixed h-[90vh] → flex-1 min-h-0
web/app/layout.tsx                    # Added overflow-hidden to main
web/app/api/chat/turn_response/route.ts  # Removed usage tracking
web/types/api-responses.ts            # Removed UsageActionRequest
docs/CHANGELOG.md                     # Added unreleased section
docs/ARCHITECTURE.md                  # Updated for changes
```

### Deleted Files

```
web/components/chat/usage-display.tsx
web/app/api/chat/usage/route.ts
```

### To Resume

- Review "Low-Hanging Fruit UI Improvements" section below for next steps
- Test locally with `npm run dev` to verify layout fix
- Deploy to see changes on flaim.app

---

## What's Implemented

### Debug Mode Toggle

Located in tools panel (when MCP is available):
- Toggle to enable/disable debug mode
- Persisted in localStorage via Zustand

### Timing Capture

All tool calls now track execution time:
- `metadata.startedAt` - timestamp when tool call started
- `metadata.completedAt` - timestamp when completed
- `metadata.durationMs` - calculated duration

Displayed as a badge (e.g., "142ms") next to completed tool calls.

### Debug Mode Features

When debug mode is ON:
- REQUEST/RESPONSE labels shown in tool output
- Timing badges visible on all tool call types
- JSON request/response already displayed (existing behavior)

---

## Files Modified

| File | Changes |
|------|---------|
| `stores/chat/useToolsStore.ts` | Added `debugMode` state |
| `lib/chat/assistant.ts` | Added `ToolCallMetadata` interface, timing capture in `processMessages()` |
| `components/chat/tools-panel.tsx` | Added Debug Mode toggle section |
| `components/chat/tool-call.tsx` | Added `TimingBadge`, debug mode labels |

---

## Deferred Features

### Tool Invoker (If Needed)

If direct tool invocation is needed later, build as standalone `/debug/tools` page:
- Dropdown of available tools
- JSON parameter editor with auto-fill from active league
- Direct MCP server calls bypassing OpenAI
- Gate with `chatAccess: true` like `/chat`

**Not embedded in chat** - simpler to build and maintain as separate page.

### Skipped

- **Auth Status Panel** - Already exists at `/connectors`
- **Context Inspector** - Lower priority; league context visible in Fantasy Teams section
- **MCP Health Check** - Can use browser DevTools Network tab

---

## Usage

1. Go to `/chat` (requires `chatAccess: true` in Clerk metadata)
2. Enable "Debug Mode" toggle in the right panel
3. Send a message that triggers a tool call
4. Observe timing badge and REQUEST/RESPONSE labels

---

## Low-Hanging Fruit UI Improvements

### Implemented (Phase 2 - 2025-12-30)

- ✅ **Copy Buttons** - Copy JSON to clipboard with visual feedback
- ✅ **Clear Conversation** - Trash icon button to reset chat
- ✅ **Keyboard Shortcut** - `Cmd+D` / `Ctrl+D` toggles debug mode
- ✅ **Collapsible JSON** - Chevron toggle to collapse/expand tool call details
- ✅ **Error Styling** - Red border, error banner with suggestions and action links
- ✅ **MCP Server URL Display** - Shows server URL in debug mode
- ✅ **Visual Distinction for Debug Mode** - Amber "DEBUG" badge, clickable to disable
- ✅ **Active League Indicator** - Blue badge showing active league name

### All Low-Hanging Fruit Complete! 🎉

---

## Future Enhancements (Lower Priority)

If debug tooling needs more features:
- Error metadata capture (error codes, suggestions)
- System prompt viewer
- Request history with filtering
- Tool Invoker standalone page (`/debug/tools`)

---

*Created: 2025-12-29*
*Updated: 2025-12-30*
*Status: Phase 2 Implemented*
