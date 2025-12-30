# Chat/Site Separation Plan

## Purpose

Create a clean boundary between the connector platform (site) and the chat app so the chat can be swapped or removed without impacting auth, connectors, or league management.

## Goals

- Site and chat are independent clients of the same platform APIs.
- Chat can be swapped with a different implementation without changing site logic.
- No cross-imports between site and chat code.
- Remove the onboarding wizard from chat entirely; setup is owned by the site.
- Keep shared code to an absolute minimum.

## Non-Goals (for now)

- Immediate subdomain split and separate deploys.
- Moving platform APIs into Cloudflare workers.
- Rewriting chat UX or tools.

## Definitions

- **Platform APIs**: `/api/auth/*`, `/api/onboarding/*`, `/api/oauth/*` — owned by site
- **Site**: marketing, leagues, connectors, account, consent screens
- **Chat**: `/chat` UI, chat tools, chat-only APIs

## Decisions (Resolved)

| Question | Decision |
|----------|----------|
| Keep deprecated `/api/onboarding/leagues`? | **No** — remove during migration (2-4 weeks after cutover) |
| Default team tracking? | **Yes** — add `is_default` flag to league records in Supabase |
| Chat setup UX when incomplete? | **Inline banner** — show message within chat UI, not a blocking modal |
| Wizard removal timing? | **Immediate** — remove from chat during migration |

**Inline vs modal CTA:** Inline = a non-blocking banner within the chat page; modal = a blocking popup dialog. We will use inline banners only.

Note: Default team support is intentionally Step 1 to reduce downstream rework in chat UI.

## Target State (Phase 1: Single App with Hard Boundaries)

### Directory Layout

```
openai/
├── app/
│   ├── (site)/                    # Site route group
│   │   ├── page.tsx               # Landing (/)
│   │   ├── leagues/
│   │   ├── connectors/
│   │   ├── account/
│   │   └── oauth/
│   │
│   ├── (chat)/                    # Chat route group
│   │   └── chat/
│   │       └── page.tsx           # Gated chat (/chat)
│   │
│   ├── api/
│   │   ├── auth/                  # PLATFORM (site owns)
│   │   ├── onboarding/            # PLATFORM (site owns)
│   │   ├── oauth/                 # PLATFORM (site owns)
│   │   └── chat/                  # CHAT-ONLY APIs
│   │       ├── turn_response/
│   │       ├── usage/
│   │       ├── vector_stores/
│   │       └── container_files/
│   │
│   ├── sign-in/
│   ├── sign-up/
│   └── layout.tsx
│
├── components/
│   ├── ui/                        # Shared shadcn (both can use)
│   ├── site/                      # Site-only components
│   │   └── connectors/
│   └── chat/                      # Chat-only components
│       ├── assistant.tsx
│       ├── chat.tsx
│       ├── tools-panel.tsx
│       ├── message.tsx
│       └── ...
│
├── lib/
│   └── chat/                      # Chat-only libraries
│       ├── assistant.ts
│       ├── prompts/
│       └── tools/
│
└── stores/
    └── chat/                      # Chat-only stores
        ├── useConversationStore.ts
        └── useToolsStore.ts
```

### Boundary Rules (Non-Negotiable)

- `components/chat/*` **never** imports from `components/site/*`
- `lib/chat/*` **never** imports from `lib/site/*`
- `stores/chat/*` **never** imports from `stores/site/*`
- Both site and chat **can** import from `components/ui/*`
- Chat accesses platform data via `fetch('/api/...')` only, never internal imports
- Prefer duplication over coupling — no shared packages

## Wizard Removal

### What Chat Does Instead

On load, chat calls `GET /api/auth/espn/status` (see API Reference below).

Based on the response, show an **inline banner** (not modal):

| Condition | Banner Message |
|-----------|----------------|
| `hasCredentials: false` | "Connect your ESPN account to get started. [Set up on Leagues →]" |
| `hasLeagues: false` | "Add a fantasy league to continue. [Go to Leagues →]" |
| `hasDefaultTeam: false` | "Select your team to get started. [Go to Leagues →]" |
| All true | Show chat normally |

### Files Deleted (wizard removal)

- `components/onboarding/*` (entire folder)
- `stores/useOnboardingStore.ts`
- `lib/onboarding/*` (entire folder)
- `app/api/onboarding/leagues/route.ts` (deprecated endpoint)
- `app/api/onboarding/platform-selection/` (if exists)
- `app/api/onboarding/status/` (if exists)

## Migration Steps

### Step 1: Add default team support ✅ COMPLETE

- ✅ Add `is_default` boolean column to `espn_leagues` table in Supabase (one default per user)
- ✅ Update `/api/auth/espn/status` to return `{ hasCredentials, hasLeagues, hasDefaultTeam }`
- ✅ Update `/leagues` page to allow setting a default league
- ✅ Add `POST /api/onboarding/espn/leagues/default` endpoint

**Files created/modified:**
- `docs/migrations/004_default_league_column.sql` (run manually in Supabase)
- `workers/auth-worker/src/espn-types.ts` — added `isDefault` to `EspnLeague`
- `workers/auth-worker/src/supabase-storage.ts` — added `setDefaultLeague()`, `getSetupStatus()`
- `workers/auth-worker/src/index.ts` — added `/leagues/default` endpoint
- `openai/lib/espn-types.ts` — added `isDefault` to frontend type
- `openai/app/api/auth/espn/status/route.ts` — returns full setup status
- `openai/app/api/onboarding/espn/leagues/default/route.ts` — new proxy route
- `openai/app/leagues/page.tsx` — star icon for default toggle

**Known limitations (acceptable for V1):**
- `setDefaultLeague()` uses two sequential updates (clear then set) rather than atomic transaction
- Migration assumes fresh column; if re-running after partial failure, may need manual NULL cleanup

### Step 2: Create folder structure ✅ COMPLETE

Created new directories:

```bash
mkdir -p openai/components/site/connectors
mkdir -p openai/components/chat
mkdir -p openai/lib/chat
mkdir -p openai/stores/chat
mkdir -p openai/app/api/chat
```

---

### Step 3: Move chat files ✅ COMPLETE

Moved all chat components, stores, and libraries to their new locations.

**Chat components moved** (`components/` → `components/chat/`):
- `assistant.tsx`, `chat.tsx`, `message.tsx`, `tool-call.tsx`, `annotations.tsx`
- `mcp-approval.tsx`, `mcp-tools-list.tsx`, `mcp-config.tsx`, `loading-message.tsx`
- `file-upload.tsx`, `file-search-setup.tsx`, `websearch-config.tsx`
- `sport-platform-config.tsx`, `usage-display.tsx`, `tools-panel.tsx`
- `panel-config.tsx`, `functions-view.tsx`, `platform-selector.tsx`
- `sport-selector.tsx`, `country-selector.tsx`

**Site components moved** (`components/connectors/` → `components/site/connectors/`):
- `ClaudeConnectionCard.tsx`, `ConnectInstructions.tsx`, `ConsentScreen.tsx`

**Stores moved** (`stores/` → `stores/chat/`):
- `useConversationStore.ts`, `useToolsStore.ts`

**Libraries moved** (`lib/` → `lib/chat/`):
- `assistant.ts`
- `prompts/*` (system-prompt.ts, league-context.ts, index.ts)
- `tools/*` (tools.ts, tools-handling.ts)

**Import updates applied to:**
- `app/chat/_components/ChatInterface.tsx`
- `app/connectors/page.tsx`
- `app/oauth/consent/page.tsx`
- All 20 moved chat components (internal imports)
- All moved chat libs (e.g., `@/lib/assistant` → `@/lib/chat/assistant`)
- All moved stores (e.g., `@/stores/useToolsStore` → `@/stores/chat/useToolsStore`)
- Fixed relative imports in `lib/chat/tools/` (e.g., `../../config/functions` → `@/config/functions`)

---

### Step 4: Move chat APIs ✅ COMPLETE

Moved API routes under `app/api/chat/`:

| From | To |
|------|-----|
| `api/turn_response/` | `api/chat/turn_response/` |
| `api/usage/` | `api/chat/usage/` |
| `api/vector_stores/` | `api/chat/vector_stores/` |
| `api/container_files/` | `api/chat/container_files/` |

**Fetch call updates:**
- `lib/chat/assistant.ts` — `/api/turn_response` → `/api/chat/turn_response`
- `components/chat/usage-display.tsx` — `/api/usage` → `/api/chat/usage`
- `components/chat/file-upload.tsx` — `/api/vector_stores/*` → `/api/chat/vector_stores/*`
- `components/chat/file-search-setup.tsx` — `/api/vector_stores/*` → `/api/chat/vector_stores/*`
- `components/chat/message.tsx` — `/api/container_files/*` → `/api/chat/container_files/*`
- `components/chat/tool-call.tsx` — `/api/container_files/*` → `/api/chat/container_files/*`
- `components/chat/annotations.tsx` — `/api/container_files/*` → `/api/chat/container_files/*`

---

### Step 5: Remove wizard from chat ✅ COMPLETE

**New store created:**

Created `stores/chat/useLeaguesStore.ts` — a simplified store for chat that:
- Fetches setup status via `GET /api/auth/espn/status`
- Fetches leagues via `GET /api/onboarding/espn/leagues`
- Manages active league selection
- No wizard/onboarding step logic

**Files completely rewritten:**

1. **`components/chat/assistant.tsx`** — Major rewrite:
   - Removed `OnboardingFlow` import and all onboarding logic
   - Added `SetupBanner` component for inline setup prompts
   - Uses new `useLeaguesStore` instead of `useOnboardingStore`
   - Fetches setup status on mount via API
   - Shows inline banner when setup incomplete (not blocking modal)
   - Chat always visible regardless of setup status

2. **`components/chat/tools-panel.tsx`** — Simplified:
   - Uses new `useLeaguesStore` instead of `useOnboardingStore`
   - Removed edit/pencil button (users edit via /leagues page now)
   - Settings button now links to `/leagues` page
   - Shows "Set up your leagues" link when no leagues configured

3. **`lib/chat/prompts/league-context.ts`** — Updated:
   - Uses `useLeaguesStore` instead of `useOnboardingStore`

4. **`app/chat/_components/ChatInterface.tsx`** — Simplified:
   - Removed `useOnboardingStore` import and related logic

**league-mapper moved:**
- `lib/onboarding/league-mapper.ts` → `lib/chat/league-mapper.ts`
- Updated imports in `tools-panel.tsx` and `assistant.tsx`

**Files deleted:**
- `components/onboarding/` — 10 files:
  - `OnboardingFlow.tsx`, `PlatformSelection.tsx`, `EspnLeagueForm.tsx`
  - `LeagueList.tsx`, `LeagueSelector.tsx`, `LeagueDiscovery.tsx`
  - `AutoPullSummary.tsx`, `SetupComplete.tsx`, `SkipStepBanner.tsx`
  - `auth/EspnAuth.tsx`
- `stores/useOnboardingStore.ts`
- `lib/onboarding/` (entire folder after moving league-mapper)

**API routes deleted:**
- `app/api/onboarding/leagues/route.ts` (deprecated)
- `app/api/onboarding/status/route.ts`
- `app/api/onboarding/platform-selection/route.ts`

**API routes kept** (used by /leagues page):
- `app/api/onboarding/espn/leagues/route.ts`
- `app/api/onboarding/espn/leagues/default/route.ts`
- `app/api/onboarding/espn/leagues/[leagueId]/team/route.ts`
- `app/api/onboarding/espn/auto-pull/route.ts`

> **TODO (Phase 2):** Consider renaming `/api/onboarding/espn/*` → `/api/espn/*` or `/api/leagues/*` since "onboarding" is a misnomer now that the wizard is gone. These are platform APIs for league management.

**Inline banner behavior:**
| Condition | Banner Message |
|-----------|----------------|
| `!hasCredentials` | "Connect your ESPN account to get started. [Set up on Leagues →]" |
| `!hasLeagues` | "Add a fantasy league to continue. [Go to Leagues →]" |
| `!hasDefaultTeam` | "Select your default team to get started. [Go to Leagues →]" |
| All true | No banner, chat works normally |

---

### Step 6: Create route groups ✅ COMPLETE

Reorganized `app/` into route groups:

```
app/
├── (site)/
│   ├── page.tsx              # Landing (/)
│   ├── leagues/
│   ├── connectors/
│   ├── account/
│   └── oauth/
├── (chat)/
│   └── chat/
│       └── page.tsx          # Chat (/chat)
├── api/                      # APIs stay at root
├── sign-in/
├── sign-up/
└── layout.tsx
```

**Note:** Route groups `(site)` and `(chat)` don't affect URLs — they're organizational only.

**Files moved:**
- `page.tsx` → `(site)/page.tsx`
- `leagues/` → `(site)/leagues/`
- `connectors/` → `(site)/connectors/`
- `account/` → `(site)/account/`
- `oauth/` → `(site)/oauth/`
- `chat/` → `(chat)/chat/`

**Verification:** Build passed, all routes work at same URLs.

---

### Step 7: Verify boundaries ✅ COMPLETE

Ran grep checks — all returned empty (no cross-imports):

```bash
# Chat should never import from site
rg "from.*components/site" openai/components/chat/  # ✅ empty
rg "from.*lib/site" openai/lib/chat/                # ✅ empty

# Site should never import from chat
rg "from.*components/chat" openai/components/site/  # ✅ empty
rg "from.*lib/chat" openai/lib/site/                # ✅ N/A (lib/site doesn't exist yet)
```

**Verification:** No boundary violations found.

---

### Step 8: Final cleanup ✅ COMPLETE

Reviewed and cleaned:
- Removed unused `selectedSport` from `tools-panel.tsx`
- No remaining deprecated files found
- No dead imports

**Verification:** `npm run lint` and `npm run build` pass.

---

## Phase 1 Complete 🎉

All 8 steps completed. The codebase now has:
- Hard boundaries between site and chat code
- Route groups `(site)` and `(chat)` for organization
- Chat-only APIs under `/api/chat/`
- Inline setup banners instead of blocking wizard
- No cross-imports between site and chat

## Phase 2 (Future): Subdomain Extraction

When ready to make chat fully independent:

1. Move `components/chat/`, `lib/chat/`, `stores/chat/`, `app/api/chat/`, `app/(chat)/` into separate `/chat` app
2. Chat calls platform APIs via HTTPS with `Authorization: Bearer <Clerk JWT>`
3. Add CORS for `chat.flaim.app` on platform API routes
4. Configure Clerk for primary (`flaim.app`) + satellite (`chat.flaim.app`) domains

## Testing Plan

**Site flows:**
- Sign-in/sign-up works
- `/leagues` — add credentials, add league, set default team
- `/connectors` — shows connection status, MCP URLs
- OAuth consent flow works

**Chat flows:**
- `/chat` — gated by Clerk metadata
- Shows inline banner when setup incomplete
- No onboarding wizard appears
- Chat works when setup is complete

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Boundary erosion via imports | Grep checks in CI |
| Chat breaks on API changes | Keep Appendix B updated; add versioning discipline |
| Users confused without wizard | Clear inline banners with links to `/leagues` |

---

## Appendix A: Files to Move

### Chat Components (`components/` → `components/chat/`)

| File | Notes |
|------|-------|
| `assistant.tsx` | Main chat orchestrator |
| `chat.tsx` | Chat message list |
| `message.tsx` | Individual message |
| `tool-call.tsx` | Tool execution display |
| `annotations.tsx` | Message annotations |
| `mcp-approval.tsx` | MCP tool approval |
| `mcp-tools-list.tsx` | MCP tools listing |
| `mcp-config.tsx` | MCP configuration |
| `loading-message.tsx` | Loading states |
| `file-upload.tsx` | File upload handler |
| `file-search-setup.tsx` | Vector store config |
| `websearch-config.tsx` | Web search settings |
| `sport-platform-config.tsx` | Sport/platform config |
| `usage-display.tsx` | Token usage display |
| `tools-panel.tsx` | Tools sidebar |
| `panel-config.tsx` | Panel configuration |
| `functions-view.tsx` | Function execution view |
| `platform-selector.tsx` | Platform selection |
| `sport-selector.tsx` | Sport selection |
| `country-selector.tsx` | Country selector |

### Site Components (`components/connectors/` → `components/site/connectors/`)

| File | Notes |
|------|-------|
| `ClaudeConnectionCard.tsx` | Claude connection UI |
| `ConnectInstructions.tsx` | MCP setup instructions |
| `ConsentScreen.tsx` | OAuth consent screen |

### Stores (`stores/` → `stores/chat/`)

| File | Notes |
|------|-------|
| `useConversationStore.ts` | Chat conversation state |
| `useToolsStore.ts` | Tools configuration state |

### Libraries (`lib/` → `lib/chat/`)

| File | Notes |
|------|-------|
| `assistant.ts` | Chat assistant logic |
| `prompts/*` | System prompts |
| `tools/*` | Tool definitions |
| `league-mapper.ts` | ✅ Moved from `lib/onboarding/` |

### New Files Created

| Path | Purpose |
|------|---------|
| `stores/chat/useLeaguesStore.ts` | Simplified store for chat league data (replaces onboarding store) |

### Files Deleted ✅

| Path | Reason |
|------|--------|
| `components/onboarding/*` (10 files) | Wizard removed |
| `stores/useOnboardingStore.ts` | Wizard removed |
| `lib/onboarding/` (entire folder) | Wizard removed |
| `app/api/onboarding/leagues/route.ts` | Deprecated |
| `app/api/onboarding/status/route.ts` | Wizard removed |
| `app/api/onboarding/platform-selection/route.ts` | Wizard removed |

---

## Appendix B: Platform API Quick Reference

These are the minimum platform endpoints chat must rely on (HTTP only). Treat as stable contract.

### Setup Status Check

```
GET /api/auth/espn/status

Response:
{
  "hasCredentials": boolean,
  "hasLeagues": boolean,        // NEW
  "hasDefaultTeam": boolean     // NEW
}
```

### Get Leagues

```
GET /api/onboarding/espn/leagues

Response:
{
  "leagues": [
    {
      "leagueId": "123456",
      "sport": "football",
      "leagueName": "My League",
      "teamId": "7",
      "teamName": "My Team",
      "isDefault": boolean
    }
  ]
}
```

### Set Default League

```
POST /api/onboarding/espn/leagues/default

Request:
{
  "leagueId": "123456",
  "sport": "football"
}

Response (success):
{
  "success": true,
  "message": "Default league set successfully",
  "leagues": [...]  // Updated leagues array
}

Response (error 400):
{
  "error": "Cannot set default: no team selected for this league"
}

Response (error 404):
{
  "error": "League not found"
}
```

### OAuth Status

```
GET /api/oauth/status

Response:
{
  "hasConnection": boolean,
  "connections": [
    {
      "id": "abc...",
      "expiresAt": "2025-12-29T00:00:00Z",
      "scope": "mcp:read",
      "resource": "https://api.flaim.app/football/mcp"
    }
  ]
}
```

---

*Last updated: 2025-12-29 (Phase 1 complete — all 8 steps done)*
