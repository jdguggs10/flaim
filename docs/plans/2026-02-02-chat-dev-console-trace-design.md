# Chat Dev Console LLM Trace Design

Date: 2026-02-02

## Summary

Add a dedicated "LLM Trace" section to the chat dev console so testing shows exactly what the model was prompted with and what tool responses were injected back to the model. Simplify the chat header to keep dev-only context in one place. All changes are client-side in the dev-only /chat UI.

## Goals

- Show the exact payload sent to /api/chat/turn_response per turn.
- Show tool calls and tool outputs that were injected back to the LLM.
- Make traces easy to scan and copy for debugging.
- Redact sensitive tokens in any trace payloads.

## Non-goals

- No backend persistence.
- No worker or API behavior changes.
- No team picker or league mutation flows.

## Current Issues

- Header dropdowns (account/platform/league/team) are stale or incomplete and split context across UI.
- No visibility into the exact prompt or tool outputs injected into the LLM.

## Proposed UI Changes

### Chat Header (minimal)

- Keep logo + environment badge + UserButton.
- Remove AccountHeaderButton, EspnHeaderButton, LeagueDropdown, SeasonDropdown.

### Dev Console: New "LLM Trace" Section

- Position at top of dev console.
- List turns (newest first) with a compact summary row:
  - timestamp
  - user message excerpt
  - tool count / error status
- Each row expands into three blocks with copy actions:
  1) Prompt Sent (exact input items + stored response banner)
  2) Tools (calls, args, outputs)
  3) Assistant Output (final text + annotations)

## Data Flow and Trace Capture

Add a trace store in `web/stores/chat/useConversationStore.ts`:

- `traceEntries: LlmTraceEntry[]` (bounded to last N turns, default 50)
- `addTraceEntry(entry)` and `clearTraces()`

Capture points in `web/lib/chat/assistant.ts`:

1) Before `handleTurn`:
   - Build `inputItems` and `tools` as normal.
   - Add trace entry with:
     - `sentAt`
     - `previousResponseId`
     - `inputItems` (exact payload)
     - `toolsSnapshot` (redacted)
     - `systemPrompt` + `leagueContext` (for display)
     - `userMessage` (best-effort from conversation items)

2) When tool outputs are injected:
   - When `conversationItems` is set to `function_call_output` and the next `processMessages()` is triggered, add a trace entry marked `kind: "tool_output"` that includes:
     - `call_id`
     - `output` (string)
     - link to the original turn (by `turnId`)

## Redaction

Implement a `redactSensitive(obj)` helper (new file `web/lib/chat/trace-utils.ts`) to scrub:

- Authorization headers
- Clerk tokens/headers
- Any string field matching /token|jwt|secret/i

Use it before storing any trace payloads or export.

## Error Handling

- If /api/chat/turn_response errors, still add a trace entry with the attempted payload and error.
- Tool call failures should be displayed inline with error text in the Tools block.

## Export

Extend existing Debug export to include `traceEntries` (redacted).

## Testing (manual)

1) First turn: Prompt Sent shows system + league context + user message.
2) Subsequent turns: Prompt Sent shows stored response banner + delta items only.
3) Tool call success: tools show args + outputs; assistant output captured.
4) Tool call failure: error shown and output captured.
5) Redaction: tokens do not appear in trace or export.

## Files Likely Touched

- `web/lib/chat/assistant.ts`
- `web/stores/chat/useConversationStore.ts`
- `web/components/chat/dev-console/index.tsx`
- `web/components/chat/dev-console/llm-trace-section.tsx` (new)
- `web/components/chat/chat-header.tsx`
- `web/lib/chat/trace-utils.ts` (new)
- `web/components/chat/dev-console/debug-section.tsx` (export includes trace)
- `web/README.md` (dev-only chat note)

## Rollout

- Dev-only and client-only. No worker changes.
- Ship behind the existing /chat access gate.
