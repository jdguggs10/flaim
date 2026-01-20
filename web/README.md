# Flaim Web App

Next.js 15 app with App Router. Handles site pages, OAuth consent, API routes, and optional built-in chat.

## Quick Start

```bash
npm run dev:frontend     # Just the web app
npm run dev              # Web + all workers
npm run build            # Production build
npm run lint             # ESLint
```

## Directory Structure

```
web/
├── app/
│   ├── (site)/              # Site pages (main layout)
│   │   ├── page.tsx         # Landing (/)
│   │   ├── leagues/         # League management (/leagues)
│   │   ├── privacy/         # Privacy policy (/privacy)
│   │   └── oauth/consent/   # OAuth consent screen
│   │
│   ├── (chat)/chat/         # Built-in chat UI (/chat)
│   │
│   └── api/
│       ├── auth/            # Platform auth APIs
│       ├── espn/            # League management APIs
│       ├── extension/       # Extension APIs
│       ├── oauth/           # OAuth APIs (status, revoke)
│       └── chat/            # Chat-only APIs
│
├── components/
│   ├── site/                # Site-only components
│   ├── chat/                # Chat-only components
│   └── ui/                  # Shared shadcn components
│
└── lib/
    ├── chat/                # Chat utilities
    └── ...                  # Shared utilities
```

## Component Boundaries

**Critical rule:** Site and chat code are isolated. No cross-imports.

| Directory | Can import from |
|-----------|-----------------|
| `components/site/` | `components/ui/`, `lib/` |
| `components/chat/` | `components/ui/`, `lib/chat/` |
| `components/ui/` | Nothing else in components |

Both site and chat can use shared `components/ui/` (shadcn).

## Routes

### Site Pages (`/(site)/`)

| Path | Purpose |
|------|---------|
| `/` | Landing page + onboarding flow (sign-in, sync credentials, MCP URLs) |
| `/leagues` | Manage ESPN leagues and seasons |
| `/privacy` | Privacy policy (CWS compliance) |
| `/oauth/consent` | OAuth authorization screen |

### API Routes (`/api/`)

| Path | Purpose |
|------|---------|
| `/api/auth/*` | Platform auth (Clerk) |
| `/api/espn/*` | League management, seasons, discovery, credentials |
| `/api/extension/*` | Extension APIs (Clerk JWT) |
| `/api/oauth/*` | OAuth status, revoke |
| `/api/chat/*` | Chat turn responses |

Most API routes proxy to auth-worker. See `docs/ARCHITECTURE.md` for the full flow.

## Season Years

Leagues are stored per season year. The `/leagues` UI defaults the season year based on America/New_York time:

- **Baseball (flb)**: Defaults to the previous year until Feb 1, then switches to the current year
- **Football (ffl)**: Defaults to the previous year until Jun 1, then switches to the current year

Deleting a league removes all seasons for that league.

## Environment Variables

Create `web/.env.local` from `.env.example`:

```bash
# OpenAI (for built-in chat)
OPENAI_API_KEY=sk-...

# Clerk Auth
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...

# Worker URLs
NEXT_PUBLIC_AUTH_WORKER_URL=https://api.flaim.app/auth
NEXT_PUBLIC_BASEBALL_ESPN_MCP_URL=https://api.flaim.app/baseball
NEXT_PUBLIC_FOOTBALL_ESPN_MCP_URL=https://api.flaim.app/football
```

For local development with workers, point to `http://localhost:8786` etc.

## Built-in Chat (Dev Only)

The `/chat` page is **not a product feature**. It exists solely for internal/dev use to test and debug MCP behavior. It's gated by Clerk metadata.

### Access Control

Users need `publicMetadata.chatAccess: true` in Clerk to access `/chat`.

Set in Clerk Dashboard → Users → [user] → Public metadata:
```json
{ "chatAccess": true }
```

Without this metadata, `/chat` redirects to home.

### Debug Mode

Toggle in the Developer Console to show:
- Raw JSON request/response for each tool call
- Execution timing (ms)
- MCP payload + tools list visibility for debugging

Keyboard shortcut: `Cmd+D` / `Ctrl+D`

## Build Notes

### Webpack cache warning (big strings)

- During `npm run build`, webpack may warn: `Serializing big strings (181kiB) impacts deserialization performance`.
- Likely cause: the client bundle includes `react-syntax-highlighter` (used in `web/components/chat/tool-call.tsx`), which pulls in large Prism language definitions and produces large module source strings for the cache.
- This is a filesystem cache performance warning (not a runtime error). If it ever becomes a problem, consider lazy-loading the syntax highlighter or using a lighter alternative.

## Conventions

- **TypeScript** everywhere
- **PascalCase** for components, `useX` for hooks
- **Lowercase** for App Router folders
- Match existing file-local style (no repo-wide formatter)
