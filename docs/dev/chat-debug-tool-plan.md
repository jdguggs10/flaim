# Chat Debug Tool Plan

## Status

**Phase 1 Implemented** (2025-12-29)

The built-in `/chat` is now a developer debugging tool for MCP servers with:
- Timing badges on all tool calls (ms display)
- Debug Mode toggle in tools panel
- REQUEST/RESPONSE labels when debug mode is on

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

## Future Enhancements (Low Priority)

If debug tooling needs more features:
- Error metadata capture (error codes, suggestions)
- System prompt viewer
- Request history with filtering

---

*Created: 2025-12-29*
*Status: Phase 1 Implemented*
