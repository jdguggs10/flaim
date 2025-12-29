# Site Restructure Plan

## Vision

Shift FLAIM from a "chat app with AI assistant" to a "connector platform" where users bring their own Claude/ChatGPT subscription. The built-in chat becomes a hidden developer/beta feature.

## Goals

1. **Simplify the user journey** - Sign up → Add ESPN credentials → Connect Claude/ChatGPT
2. **Remove blocking onboarding** - No wizard flow required before using connectors
3. **Separate concerns** - League management, connector setup, and account settings each get dedicated pages
4. **Keep chat available** - Gated behind Clerk metadata for developers/beta testers
5. **Decouple, don't delete** - Preserve chat app code so it can be swapped/forked later

## Architecture Strategy

### The Problem
The current codebase has an onboarding wizard bolted onto a chat starter app. The wizard and chat are tightly coupled in `components/assistant.tsx`, which handles auth, onboarding, AND chat rendering in one component.

### The Solution: Build New, Don't Reorganize
Rather than refactoring the tangled code, we build fresh pages that don't depend on the old wizard:

1. **New pages are standalone** - `/leagues`, `/connectors`, `/account`, landing page use local state, not the wizard's global store
2. **Old code stays in place** - `components/onboarding/*`, `stores/useOnboardingStore.ts`, etc. remain untouched during build
3. **Chat is gated, not gutted** - Move to `/chat` with Clerk metadata check, internals unchanged
4. **Cleanup comes last** - Only after new site works E2E do we delete unused files
5. **Folder rename deferred** - `/openai` stays as-is for now; rename to `/web` is a future cleanup task

### Why This Works
- New pages don't import from old wizard code → no coupling
- Old code sits inert, not breaking anything → safe
- Progress over perfection → ship the connector site
- Structure clarity emerges through building, not planning

## Target Site Structure

```
/                  → Landing page (Marketing / Value Prop)
/leagues           → League management (ESPN credentials, discovered leagues)
/connectors        → Claude/ChatGPT setup instructions and active connection status
/account           → Account settings (Clerk UserProfile)
/chat              → Chat interface (gated via metadata, hidden from nav)
/sign-in           → Clerk sign-in (existing)
/sign-up           → Clerk sign-up (existing)
/oauth/consent     → OAuth consent for connectors (existing)
```

## User Journey (Connector Flow)

```
1. User lands on /
   ↓
2. Clicks "Get Started" → Sign up via Clerk
   ↓
3. Redirected to /leagues (Middleware/Clerk config)
   ↓
4. Sees Empty State → Adds ESPN credentials (SWID, espn_s2)
   ↓
5. System validates creds immediately → Leagues auto-discovered and displayed
   ↓
6. User clicks "Connectors" in nav → /connectors
   ↓
7. User copies MCP URL (Football/Baseball) to their AI Client
   ↓
8. User authorizes via OAuth → Sees "Active Connection" on /connectors
```

## Decisions Made

| Question | Decision | Rationale |
|----------|----------|-----------|
| **Post-signup redirect** | **`/leagues`** | Direct, actionable. No welcome modals (brittle). Use empty state cards to guide the user. |
| **Connector status** | **Active Tokens List** | Don't try to detect "Claude" vs "ChatGPT". Show opacity: "Active Connection created [Date]". Allow revocation. |
| **Mobile experience** | **Standard Responsive** | Use existing shadcn/Tailwind classes. No special mobile templates. Stack forms vertically. |
| **Invalid Creds** | **Validate on Sync** | Validate credentials when user triggers "Sync from ESPN". If sync fails (401/403), show error. Simple V1 approach. |
| **Multi-sport URLs** | **List Both** | Keep endpoints separate (`/football/mcp`, `/baseball/mcp`). Unified routing adds unnecessary complexity. |
| **Route Groups** | **No** | Keep structure flat (`app/leagues`, `app/connectors`). `layout.tsx` handles auth header logic fine. |
| **Component Reuse** | **Inline Logic** | Existing components are too coupled to wizard store. Build `/leagues` page with inline logic/state for V1. |
| **Folder Structure** | **No Reorganization** | Keep `/openai` as-is during build. Don't move files into `site/` vs `chat/` folders yet. Cleanup/rename after shipping. |

## API Audit (Completed)

All required endpoints already exist:

| Endpoint | Purpose | Status |
|----------|---------|--------|
| `GET /api/auth/espn/credentials` | Check if creds exist | ✅ Exists |
| `POST /api/auth/espn/credentials` | Save credentials | ✅ Exists |
| `GET /api/auth/espn/status` | Check credential status | ✅ Exists |
| `GET /api/onboarding/espn/leagues` | List saved leagues | ✅ Exists |
| `GET /api/onboarding/leagues` | Discover new leagues | ✅ Exists |
| `POST /api/onboarding/espn/leagues` | Save selected leagues | ✅ Exists |
| `DELETE /api/onboarding/espn/leagues` | Remove a league | ✅ Exists |
| `GET /api/oauth/status` | List active connections | ✅ Updated (returns token list) |
| `POST /api/oauth/revoke` | Revoke single token | ✅ Exists |
| `POST /api/oauth/revoke-all` | Revoke all tokens | ✅ Exists |

**Note**: The `/api/onboarding/*` routes will continue to work for `/leagues` page. Consider renaming to `/api/leagues/*` during cleanup phase.

## Detailed Implementation Plan

### 1. League Management (`/leagues`)
**Goal**: Single dashboard page for credentials and leagues.
- **State**: Local `useState` (no global store).
- **Components (In-file or local)**:
    - `CredentialCard`: View/Edit/Delete SWID & s2. Masked by default.
    - `LeagueList`: Grid of cards.
        - *Action*: "Sync from ESPN" (Trigger discovery endpoint).
        - *Action*: "Delete" (Remove from DB).
    - `DiscoveryResults`: Section appearing after sync if new leagues found.
- **API**:
    - `GET /api/auth/espn/credentials` (Check status)
    - `POST /api/auth/espn/credentials` (Save)
    - `GET /api/onboarding/espn/leagues` (List saved)
    - `GET /api/onboarding/leagues` (Discover new)
    - `POST /api/onboarding/espn/leagues` (Save selected)

### 2. Connector Hub (`/connectors`)
**Goal**: Single source of truth for connecting AI clients. Enhance existing page.
- **Content**:
    - **Football Card**: `https://api.flaim.app/football/mcp` + Copy button.
    - **Baseball Card**: `https://api.flaim.app/baseball/mcp` + Copy button.
    - **Instructions**: Accordion/Tabs for "Claude Desktop", "Claude.ai", "ChatGPT".
- **Status Section**:
    - "Active Connections" table.
    - Columns: Resource, Scope, Expires At, Actions (Revoke).
    - **API**: Uses `GET /api/auth/oauth/status` (updated to return list).

### 3. Landing Page (`/`)
**Goal**: Marketing face. Replace current protected chat interface.
- **Content**:
    - Hero: "Fantasy Sports Context for your AI."
    - Value Prop: "Bring your own Claude/ChatGPT subscription. We provide the data."
    - CTA: "Get Started" (Links to `/sign-up`).
- **Auth State**:
    - If signed in: CTA changes to "Go to Dashboard" (`/leagues`).

### 4. Gated Chat (`/chat`)
**Goal**: Preserve existing chat for internal use/beta.
- **Action**: Move `app/page.tsx` (Client Component) to `app/chat/_components/ChatInterface.tsx`.
- **Gating**: Create `app/chat/page.tsx` (Server Component) as wrapper:
    ```typescript
    // app/chat/page.tsx (Server Component)
    import { currentUser } from "@clerk/nextjs/server";
    import { redirect } from "next/navigation";
    import ChatInterface from "./_components/ChatInterface";

    export default async function ChatPage() {
      const user = await currentUser();
      if (user?.publicMetadata?.chatAccess !== true) {
        redirect("/");
      }
      return <ChatInterface />;
    }
    ```

### 5. Account Settings (`/account`)
**Goal**: Simple profile management.
- **Content**: Use Clerk's `<UserProfile />` component.
- **Navigation**: Accessible via UserButton or Footer link.

### 6. Navigation & Layout
- **Header**:
    - Left: Logo (Link to `/`).
    - Right (Signed Out): Sign In / Sign Up.
    - Right (Signed In): Leagues | Connectors | Account | UserButton.
- **Mobile Nav**: Simple hamburger if needed, or just wrap links.

### 7. Cleanup (After E2E Verification)

**Files to delete (wizard/chat cruft):**
```
openai/components/onboarding/*     ← Wizard components
openai/stores/useConversationStore.ts
openai/stores/useToolsStore.ts
openai/lib/onboarding/*
openai/lib/prompts/*
openai/lib/assistant.ts
openai/app/api/vector_stores/*     ← Unused template cruft
openai/app/api/container_files/*   ← Unused template cruft
openai/app/api/turn_response/*     ← Chat API (keep if /chat remains)
openai/app/api/usage/*             ← Chat usage tracking
openai/app/api/onboarding/leagues/route.ts  ← Deprecated endpoint (returns 410)
```

**Files to KEEP while /chat exists:**
```
openai/stores/useOnboardingStore.ts ← Still used by ChatInterface
```

**Files to keep:**
```
openai/app/api/auth/*              ← ESPN credential APIs
openai/app/api/oauth/*             ← Connector OAuth
openai/app/api/onboarding/*        ← League APIs (rename to /api/leagues later)
openai/components/ui/*             ← shadcn components
openai/app/leagues/*               ← NEW
openai/app/connectors/*            ← Enhanced
openai/app/account/*               ← NEW
openai/app/chat/*                  ← Gated chat (preserved for future use)
openai/app/sign-in, sign-up, oauth/consent
```

**Deferred to later:**
- Rename `/openai` folder to `/web`
- Rename `/api/onboarding/*` to `/api/leagues/*`
- Reorganize into `components/site/` vs `components/chat/` if needed

## Execution Order

1.  ✅ **Preparation**: Update `auth-worker` to support listing tokens.
2.  🔲 **Page**: Build `app/leagues/page.tsx` with inline logic. Verify (Creds → Sync → Display).
3.  🔲 **Page**: Enhance `app/connectors/page.tsx`. Add "Active Connections" list.
4.  🔲 **Page**: Build `app/account/page.tsx` with Clerk UserProfile.
5.  🔲 **Page**: Build `app/page.tsx` (Landing).
6.  🔲 **Layout**: Update `app/layout.tsx` navigation.
7.  🔲 **Move**: Move current chat to `app/chat/page.tsx` + add Server Component Gating.
8.  🔲 **Test**: E2E verification of all new pages.
9.  🔲 **Cleanup**: Delete unused files (only after E2E passes).

---

## Implementation Notes for Gemini

When implementing pages, follow these guidelines:

### Do:
- Use local `useState` for form state
- Use `useAuth()` from Clerk for user context
- Use existing `/api/*` endpoints (see API Audit above)
- Use shadcn components from `@/components/ui`
- Keep components simple and inline in page files for V1
- Use Tailwind responsive classes (`w-full md:w-1/2`)

### Don't:
- Import from `stores/useOnboardingStore.ts`
- Import from `components/onboarding/*`
- Import from `lib/assistant.ts` or `lib/prompts/*`
- Create new global stores
- Over-engineer component extraction

### Reference Files:
- `openai/app/connectors/page.tsx` - Existing page structure example
- `openai/app/oauth/consent/page.tsx` - Auth-aware page example
- `openai/components/ui/*` - Available shadcn components
- `openai/app/layout.tsx` - Current layout/nav structure

---

*Created: 2025-12-28*
*Last updated: 2025-12-28*
