# Developer Console Specification

This document outlines the **replacement** of the current `/chat` right sidebar with an enhanced Developer Console for MCP debugging.

## Scope

**This is a replacement, not an addition.** The new Developer Console replaces:
- `components/chat/tools-panel.tsx` (current sidebar)
- `components/chat/mcp-config.tsx` (MCP configuration)

The chat area itself (left 70% on desktop) remains unchanged.

## Current State

The existing chat interface has a right-side "Tools Panel" (`components/chat/tools-panel.tsx`) with:
- Fantasy Teams list (league selector)
- MCP toggle with auto-configured server details
- Debug mode toggle (shows raw JSON and timing)

The current sidebar is functional but limited for debugging MCP integrations. Key pain points:
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

## Proposed Sidebar Architecture

### Layout Overview

```
┌─────────────────────────────────────┐
│  Environment Badge                  │
│  [DEV] localhost:3000               │
├─────────────────────────────────────┤
│  👤 Account                         │
│  ┌─────────────────────────────────┐│
│  │ user@email.com                  ││
│  │ user_abc123... [copy]           ││
│  │ Token: valid ✓ / expired ✗     ││
│  └─────────────────────────────────┘│
├─────────────────────────────────────┤
│  🔗 ESPN Connection                 │
│  ┌─────────────────────────────────┐│
│  │ SWID: ABC123... [copy]          ││
│  │ espn_s2: ●●●●●● [reveal/copy]   ││
│  │ Status: Valid ✓ / Expired ✗    ││
│  │ [Refresh Creds] [Test API]      ││
│  └─────────────────────────────────┘│
├─────────────────────────────────────┤
│  ⚾ Active League                   │
│  ┌─────────────────────────────────┐│
│  │ ▼ Dynasty Baseball League       ││
│  │   League ID: 123456 [copy]      ││
│  │   Team: My Team                 ││
│  │   Season: 2025                  ││
│  │   Sport: baseball               ││
│  └─────────────────────────────────┘│
│  Other leagues:                     │
│  │ ○ Football League (ffl)        ││
│  │ ○ Basketball League (fba)      ││
│  │ [Set as Default] [Manage →]     │
├─────────────────────────────────────┤
│  🔧 MCP Configuration              │
│  ┌─────────────────────────────────┐│
│  │ Server: baseball-espn-mcp       ││
│  │ URL: baseball-espn-mcp.flaim... ││
│  │ Status: [Test Connection]       ││
│  │ Mode: [●] Auto-approve tools    ││
│  └─────────────────────────────────┘│
├─────────────────────────────────────┤
│  📦 Available Tools                 │
│  ┌─────────────────────────────────┐│
│  │ ✓ get_espn_baseball_league_info││
│  │ ✓ get_espn_baseball_team_roster││
│  │ ✓ get_espn_baseball_matchups   ││
│  │ ✓ get_espn_baseball_standings  ││
│  │ [Enable All] [Disable All]      ││
│  │ [▼ Show Disabled]               ││
│  └─────────────────────────────────┘│
├─────────────────────────────────────┤
│  🐛 Debug Options                   │
│  ┌─────────────────────────────────┐│
│  │ [●] Show raw JSON               ││
│  │ [●] Show timing                 ││
│  │ [ ] Log to console              ││
│  │ [ ] Verbose MCP traces          ││
│  │ [Export Session Log]            ││
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
```

---

## Section Details

### 1. Environment Badge

**Purpose**: Always know which environment you're in at a glance.

**Implementation**:
- Detect environment from `NEXT_PUBLIC_VERCEL_ENV` or `NODE_ENV`
- Badge colors:
  - `DEV` (green) - localhost
  - `PREVIEW` (yellow) - Vercel preview deployments
  - `PROD` (red with warning) - production
- Show the base URL being used for API calls
- Show MCP server environment (dev vs prod workers)

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

### 2. Account Section

**Purpose**: Show current Clerk authentication state for debugging auth issues.

**Display**:
- User email (from Clerk)
- User ID (truncated with copy button)
- Token status indicator:
  - Green check if token is present and not expired
  - Red X if token is missing or expired
  - "Refreshing..." during token fetch
- Last token refresh timestamp

**Data sources**:
- `useUser()` from Clerk for email/ID
- `useAuth().getToken()` for token state
- `useToolsStore().clerkToken` for current token

**Actions**:
- Copy user ID to clipboard
- Force token refresh
- Link to Clerk dashboard (dev only)

---

### 3. ESPN Connection Section

**Purpose**: Verify ESPN credentials are valid without leaving the console.

**Display**:
- SWID (truncated, copyable)
- espn_s2 (masked by default, reveal toggle, copyable)
- Credential status:
  - `Valid` - credentials present and recently verified
  - `Unknown` - credentials present but not tested
  - `Expired` - last API call returned 401
  - `Missing` - no credentials stored

**Data sources**:
- `useToolsStore().espnSWID`, `espnS2` for local state
- `/api/auth/espn/status` for server verification
- Store credential validation results in session

**Actions**:
- **Refresh Creds**: Re-fetch from server (`/api/auth/espn/status`)
- **Test API**: Make a lightweight ESPN API call to verify credentials work
- **Re-sync**: Link to extension sync flow

---

### 4. Active League Section

**Purpose**: Quick league switching and visibility into league context.

**Display**:
- Dropdown showing all user leagues grouped by sport
- Active league details:
  - League name
  - League ID (copyable for API testing)
  - Team name
  - Season year
  - Sport badge
- Visual indicator for default league

**Data sources**:
- `useLeaguesStore()` for leagues and active selection
- Badge styling from `getSportConfig()`

**Actions**:
- **Quick switch**: Click any league to make it active (updates MCP config automatically)
- **Set as Default**: API call to update server-side default
- **Manage**: Link to `/leagues` page
- **Copy League ID**: For use in manual API testing

---

### 5. MCP Configuration Section

**Purpose**: Visibility into MCP server configuration and connection testing.

**Display**:
- Server label (`fantasy-baseball`)
- Full server URL (truncated, expandable)
- Connection status indicator
- Auto-approval toggle state
- Headers being sent (redacted tokens)

**Data sources**:
- `useToolsStore().mcpConfig` for configuration
- Generated from `generateMcpToolsConfig()` when league changes

**Actions**:
- **Test Connection**: Hit MCP server health endpoint
- **Toggle Auto-approve**: Switch between requiring approval and auto-executing
- **Copy cURL**: Generate a cURL command for the MCP endpoint (useful for debugging outside the app)
- **View Full Config**: Expand to see all configuration details

---

### 6. Available Tools Section

**Purpose**: See and control which MCP tools are available to the AI.

**Display**:
- List of all tools for current sport
- Checkboxes to enable/disable individual tools
- Tool descriptions on hover
- Grouped by category if many tools

**Implementation**:
```typescript
// Current approach: CSV string in mcpConfig.allowed_tools
// New approach: Individual tool toggles stored separately
interface ToolToggle {
  name: string;
  enabled: boolean;
  description: string;
}
```

**Data sources**:
- `SPORT_CONFIG[sport].mcpTools` for available tools
- New store state for individual tool enablement

**Actions**:
- **Toggle individual tools**: Enable/disable specific tools
- **Enable All / Disable All**: Bulk operations
- **Test Tool**: Execute a tool with sample parameters
- **View Schema**: Show the tool's input schema

---

### 7. Debug Options Section

**Purpose**: Control debugging verbosity and export capabilities.

**Display**:
- Toggle switches for various debug features
- Session export button

**Options**:
| Option | Description |
|--------|-------------|
| Show raw JSON | Display full request/response JSON in tool calls |
| Show timing | Display execution duration on each tool call |
| Log to console | Mirror all tool calls to browser DevTools console |
| Verbose MCP traces | Include headers, full URLs in display |
| Pause on tool call | Require manual approval for each tool (even if auto-approve is on) |

**Actions**:
- **Export Session Log**: Download JSON file with:
  - All conversation messages
  - All tool calls with timings
  - Configuration state
  - Error details
- **Clear Session**: Reset conversation and local state

---

## Technical Implementation

### New Store Fields

```typescript
// Additions to useToolsStore.ts
interface DevConsoleState {
  // Environment
  detectedEnv: 'development' | 'preview' | 'production';

  // ESPN credential status
  espnCredentialStatus: 'valid' | 'unknown' | 'expired' | 'missing';
  lastCredentialCheck: number | null;

  // Individual tool toggles (replaces CSV string)
  toolToggles: Record<string, boolean>;

  // Enhanced debug options
  debugOptions: {
    showRawJson: boolean;
    showTiming: boolean;
    logToConsole: boolean;
    verboseTraces: boolean;
    pauseOnToolCall: boolean;
  };
}
```

### New Components

```
components/chat/dev-console/
├── index.tsx                 # Main sidebar container
├── environment-badge.tsx     # Environment indicator
├── account-section.tsx       # Clerk auth display
├── espn-section.tsx          # ESPN credentials display
├── league-section.tsx        # League selector (refactored from tools-panel)
├── mcp-section.tsx           # MCP config display
├── tools-section.tsx         # Tool toggles
├── debug-section.tsx         # Debug options
└── copy-button.tsx           # Reusable copy-to-clipboard
```

### API Additions

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/debug/test-espn` | GET | Lightweight ESPN API test |
| `/api/debug/test-mcp` | POST | MCP server health check |
| `/api/espn/leagues/[id]/set-default` | POST | Update default league |

---

## Migration Path

### Phase 1: Foundation (1-2 hours)
- [ ] Create new component structure under `dev-console/`
- [ ] Add environment detection and badge
- [ ] Move existing league selector to new location
- [ ] Keep existing functionality working

### Phase 2: Auth Visibility (1-2 hours)
- [ ] Add Account section with Clerk details
- [ ] Add ESPN Connection section with credential display
- [ ] Implement copy-to-clipboard utility
- [ ] Add credential test endpoint

### Phase 3: Tool Management (2-3 hours)
- [ ] Refactor tool toggles from CSV to individual state
- [ ] Add tool list with enable/disable
- [ ] Update `getTools()` to use new toggle structure
- [ ] Add tool schema viewing

### Phase 4: Debug Enhancements (1-2 hours)
- [ ] Add granular debug options
- [ ] Implement session export
- [ ] Add console logging option
- [ ] Add verbose trace mode

---

## Design Decisions

1. **Mobile layout**: Collapsible accordions. Each section expands/collapses independently. Environment + Active League expanded by default, others collapsed.
2. **Persistence**: Persist all debug options to localStorage via Zustand persist (already in use).
3. **Access control**: Same as chat - anyone with `chatAccess` sees full console. No additional flags needed.
4. **Tool testing**: Sample calls with hardcoded params (uses active league) + cURL export for external testing. No full parameter form.

---

## Success Criteria

- [ ] Developer can see all auth state at a glance without clicking around
- [ ] Developer can switch leagues without leaving the console
- [ ] Developer can enable/disable individual tools for testing
- [ ] Developer can export full session log for bug reports
- [ ] Environment is always visible to prevent prod accidents
- [ ] ESPN credential status is clear without manual API testing
