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

### Step 2: Create folder structure

Create the new directories:
- `components/site/`
- `components/chat/`
- `lib/chat/`
- `stores/chat/`
- `app/api/chat/`

### Step 3: Move chat files

See **Appendix A: Files to Move** for exact paths.

### Step 4: Move chat APIs

Move these endpoints under `/api/chat/`:
- `turn_response/` → `chat/turn_response/`
- `usage/` → `chat/usage/`
- `vector_stores/` → `chat/vector_stores/`
- `container_files/` → `chat/container_files/`

Update imports in chat code accordingly.

### Step 5: Remove wizard from chat

- Delete `components/onboarding/*`
- Delete `stores/useOnboardingStore.ts`
- Delete `lib/onboarding/*`
- Update `components/chat/assistant.tsx` to remove OnboardingFlow import
- Add setup status check + inline banner to chat page

### Step 6: Create route groups

- Wrap site pages in `app/(site)/`
- Wrap chat in `app/(chat)/chat/`
- Keep `sign-in`, `sign-up`, `layout.tsx` at root

### Step 7: Verify boundaries

Run grep checks to confirm no cross-imports:
```bash
# Should return no results
rg "from.*components/site" openai/components/chat/
rg "from.*components/chat" openai/components/site/
```

### Step 8: Delete deprecated endpoints

- Remove `app/api/onboarding/leagues/route.ts`
- Remove any other wizard-only endpoints

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

### Components

| From | To |
|------|-----|
| `components/assistant.tsx` | `components/chat/assistant.tsx` |
| `components/chat.tsx` | `components/chat/chat.tsx` |
| `components/tools-panel.tsx` | `components/chat/tools-panel.tsx` |
| `components/message.tsx` | `components/chat/message.tsx` |
| `components/tool-call.tsx` | `components/chat/tool-call.tsx` |
| `components/annotations.tsx` | `components/chat/annotations.tsx` |
| `components/mcp-approval.tsx` | `components/chat/mcp-approval.tsx` |
| `components/mcp-tools-list.tsx` | `components/chat/mcp-tools-list.tsx` |
| `components/mcp-config.tsx` | `components/chat/mcp-config.tsx` |
| `components/file-upload.tsx` | `components/chat/file-upload.tsx` |
| `components/file-search-setup.tsx` | `components/chat/file-search-setup.tsx` |
| `components/websearch-config.tsx` | `components/chat/websearch-config.tsx` |
| `components/sport-platform-config.tsx` | `components/chat/sport-platform-config.tsx` |
| `components/usage-display.tsx` | `components/chat/usage-display.tsx` |
| `components/connectors/*` | `components/site/connectors/*` |

### Stores

| From | To |
|------|-----|
| `stores/useConversationStore.ts` | `stores/chat/useConversationStore.ts` |
| `stores/useToolsStore.ts` | `stores/chat/useToolsStore.ts` |

### Libraries

| From | To |
|------|-----|
| `lib/assistant.ts` | `lib/chat/assistant.ts` |
| `lib/prompts/*` | `lib/chat/prompts/*` |
| `lib/tools/*` | `lib/chat/tools/*` |

### Files to Delete

| Path | Reason |
|------|--------|
| `components/onboarding/*` | Wizard removed |
| `stores/useOnboardingStore.ts` | Wizard removed |
| `lib/onboarding/*` | Wizard removed |
| `app/api/onboarding/leagues/route.ts` | Deprecated |

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

*Last updated: 2025-12-29 (Step 1 complete)*
