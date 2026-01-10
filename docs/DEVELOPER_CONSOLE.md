# Developer Console Specification

This document outlines the **replacement** of the current `/chat` right sidebar with an enhanced Developer Console for MCP debugging.

## Scope

**This is a replacement, not an addition.** The new Developer Console replaces:
- `components/chat/tools-panel.tsx` (current sidebar)
- `components/chat/mcp-config.tsx` (MCP configuration)

The chat area itself (left 70% on desktop) remains unchanged.

## Previous State (pre-console)

The previous chat interface used a right-side "Tools Panel" (`components/chat/tools-panel.tsx`) with:
- Fantasy Teams list (league selector)
- MCP toggle with auto-configured server details
- Debug mode toggle (shows raw JSON and timing)

That sidebar was functional but limited for debugging MCP integrations. Key pain points:
- No visibility into auth state (Clerk user, ESPN credentials)
- No easy way to test different leagues without navigating away
- MCP tools are hidden behind the config panel
- No environment awareness (are we hitting dev or prod MCPs?)
- Debug mode is buried and minimal

---

## Goals

Transform the Developer Console into a **first-class MCP debugging tool** that provides:

1. **Full visibility** into auth, credentials, and configuration state
2. **Quick actions** for common debugging workflows
3. **Environment awareness** to prevent accidental prod testing
4. **Tool introspection** to understand what the AI can do

---

## Current Architecture

### Header (chat-header.tsx)

The chat page has a minimal header (no site navigation) with:
- Flaim logo (link to `/`)
- Account badge (popover with token status and user details)
- ESPN badge (popover with credential status)
- League dropdown (select league group only; league name shown)
- Season dropdown (select season for active league; shows year + team name)
- Environment badge (DEV/PREVIEW/PROD)
- User avatar (Clerk)

### Sidebar Layout (3 sections)

```
┌─────────────────────────────────────┐
│  🔧 MCP Configuration              │
│  ┌─────────────────────────────────┐│
│  │ Server: baseball-espn-mcp       ││
│  │ URL: baseball-espn-mcp.flaim... ││
│  │ Status: [Test Connection]       ││
│  │ Mode: [●] Auto-approve tools    ││
│  └─────────────────────────────────┘│
├─────────────────────────────────────┤
│  📦 Available Tools      [↻]        │
│  ┌─────────────────────────────────┐│
│  │ ✓ get_espn_baseball_league_info││
│  │ ✓ get_espn_baseball_team_roster││
│  │ ... (fetched from MCP server)   ││
│  │ [Enable All] [Disable All]      ││
│  │ "4 of 4 tools enabled (live)"   ││
│  └─────────────────────────────────┘│
├─────────────────────────────────────┤
│  🐛 Debug Options                   │
│  ┌─────────────────────────────────┐│
│  │ [●] Show raw JSON               ││
│  │ [Export Session Log]            ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

Note: Account/ESPN status badges, environment badge, league dropdown, and season dropdown are in the header for space efficiency.

---

## Section Details

### 1. Header Controls

**Purpose**: Keep league/season context and environment visible without using sidebar space.

**Controls**:
- Account badge (popover: email, user ID, token status)
- ESPN badge (popover: credential status)
- League dropdown (league name only, copy league ID in popover)
- Season dropdown (year + team name)
- Environment badge (DEV/PREVIEW/PROD)

**Data sources**:
```typescript
// Detect environment
const env = process.env.NEXT_PUBLIC_VERCEL_ENV ||
            (process.env.NODE_ENV === 'development' ? 'development' : 'production');

// Display mapping
const ENV_BADGES = {
  development: { label: 'DEV', color: 'bg-green-500' },
  preview: { label: 'PREVIEW', color: 'bg-yellow-500' },
  production: { label: 'PROD', color: 'bg-red-500' }
};
```

---

### 2. MCP Configuration Section

**Purpose**: Visibility into MCP server configuration and connection testing.

**Display**:
- Server label (`fantasy-baseball`)
- Full server URL (truncated, expandable)
- Connection status indicator
- Auto-approval toggle state
- LLM payload preview (redacted headers)

**Data sources**:
- `useToolsStore().mcpConfig` for configuration
- Generated from `generateMcpToolsConfig()` when league changes

**Actions**:
- **Test Connection**: Calls MCP `tools/list` via `/api/debug/test-mcp`
- **Toggle Auto-approve**: Switch between requiring approval and auto-executing
- **Copy cURL**: Generate a cURL command for the MCP endpoint (useful for debugging outside the app)
- **Open URL**: Open MCP server URL in new tab

---

### 3. Available Tools Section

**Purpose**: See and control which MCP tools are available to the AI.

**Display**:
- List of tools fetched dynamically from MCP server via `tools/list`
- Checkboxes to enable/disable individual tools
- Tool descriptions on hover (from MCP only)
- Tool input schema preview (from MCP, when provided)
- Refresh button to re-fetch tools
- Status indicator: "(live)" when tools are present
- Empty state messaging when MCP returns zero tools or errors
- Connection status with last success/attempt and latency
- Effective allowlist view (post-disable)

**Implementation**:
```typescript
// Tools fetched from /api/debug/test-mcp which calls MCP server's tools/list
// No static fallback. MCP response is the source of truth.

// Store state for tool management (Zustand):
mcpAvailableTools: string[];      // All tool names (for allowlist building)
disabledMcpTools: string[];       // Tools the user has disabled
```

**Data sources**:
- `/api/debug/test-mcp` → MCP server `tools/list` for live tools
- `useToolsStore().disabledMcpTools` for disabled state

**Actions**:
- **Refresh**: Re-fetch tools from MCP server
- **Toggle individual tools**: Enable/disable specific tools
- **Enable All / Disable All**: Bulk operations

---

### 4. Debug Options Section

**Purpose**: Control debugging verbosity and export capabilities.

**Display**:
- Toggle for raw JSON display
- Session export and clear buttons
- Recent tool call log (session-scoped)

**Options**:
| Option | Description |
|--------|-------------|
| Show raw JSON | Display request/response JSON and timing for tool calls |

**Actions**:
- **Export Session Log**: Download JSON file with:
  - All conversation messages
  - All tool calls with timings
  - Configuration state
  - Error details
- **Clear Session**: Reset conversation and local state

---

## Technical Implementation

### Store Fields

```typescript
// Additions to useToolsStore.ts
interface ToolsState {
  // MCP tool management
  mcpAvailableTools: string[];    // All tool names from MCP server
  disabledMcpTools: string[];     // Tools user has disabled

  // Debug options
  debugMode: boolean;             // Shows raw JSON + timing
}
```

### Components

```
components/chat/
├── chat-header.tsx           # Minimal header for /chat (logo, league, season, env, avatar)
├── league-dropdown.tsx       # League selector popover
├── season-dropdown.tsx       # Season selector for active league
└── dev-console/
    ├── index.tsx             # Main sidebar container (3 sections)
    ├── collapsible-section.tsx # Accordion wrapper
    ├── copy-button.tsx       # Reusable copy-to-clipboard
    ├── mcp-section.tsx       # MCP config + connection test
    ├── tools-section.tsx     # Tool toggles (fetches from MCP)
    └── debug-section.tsx     # Debug options + session export
components/chat/
├── account-header-button.tsx # Account status badge (popover)
├── espn-header-button.tsx    # ESPN status badge (popover)
```

Note: `environment-badge.tsx` exists but is currently unused.

### API Additions

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/debug/test-mcp` | POST | MCP server tools/list (SSRF-protected allowlist) |

Note: ESPN credential status is checked via the existing `/api/auth/espn/status` endpoint.

---

## Migration Path

### Phase 1-4: Core Implementation ✅ Complete
- [x] Create component structure under `dev-console/`
- [x] Add environment detection and badge
- [x] Add Account status surface (Clerk details via popover)
- [x] Add ESPN credential status surface (popover)
- [x] Add MCP section with connection testing
- [x] Implement copy-to-clipboard utility
- [x] Add tool list with enable/disable
- [x] Add debug options and session export

### Phase 5: UI Space Optimization ✅ Complete
- [x] Move environment badge to chat header
- [x] Move league selector to header dropdown
- [x] Add season dropdown to header
- [x] Move Account + ESPN status to header popovers
- [x] Streamline sidebar to 3 sections

### Phase 6: Dynamic Tool Fetching ✅ Complete
- [x] Extend `/api/debug/test-mcp` to return tool names
- [x] Fetch tools from MCP server on load
- [x] Remove static tool fallback (MCP response is source of truth)
- [x] Add refresh button to tools section
- [x] Migrate from CSV `allowed_tools` to `disabledMcpTools` array

### Phase 7: Source-of-Truth Enhancements ✅ Complete
- [x] Show exact MCP payload sent to the LLM (server URL, headers, require_approval, allowed_tools)
- [x] Display last successful tools/list timestamp + latency
- [x] Preview tool schemas (name + input parameters) from MCP
- [x] Show effective tool list after local disables
- [x] Add session-scoped tool invocation log (last called + last error)
- [x] Connection status pill with reason (auth missing, allowlist blocked, server error, empty tools)

---

## Design Decisions

1. **Mobile layout**: Collapsible accordions. Each section expands/collapses independently. All sections collapsed by default.
2. **Persistence**: Persist debug options and disabled tools to localStorage via Zustand persist.
3. **Access control**: Same as chat - anyone with `chatAccess` sees full console.
4. **Tool fetching**: Dynamic from MCP server only; no static fallback. Refresh button for manual re-fetch.
5. **Header placement**: Account/ESPN status, league/season, and environment moved to the header for sidebar space efficiency.

---

## Success Criteria

- [x] Developer can see all auth state at a glance without clicking around
- [x] Developer can switch leagues without leaving the console (header dropdown)
- [x] Developer can enable/disable individual tools for testing
- [x] Developer can export full session log for bug reports
- [x] Environment is always visible to prevent prod accidents (header badge)
- [x] ESPN credential status is clear without manual API testing
- [x] Tools list fetched dynamically from MCP server
- [x] No static tool list fallback (errors surfaced instead)
