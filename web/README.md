# Flaim Web App

Next.js 15 app with App Router, Tailwind CSS v4, and shadcn/ui. Handles site pages, OAuth consent, API routes, the homepage live demo, and the internal `/dev` lab.

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
│   ├── (chat)/dev/          # Internal dev/debug lab (/dev)
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

| Directory          | Can import from               |
| ------------------ | ----------------------------- |
| `components/site/` | `components/ui/`, `lib/`      |
| `components/chat/` | `components/ui/`, `lib/chat/` |
| `components/ui/`   | Nothing else in components    |

Both site and chat can use shared `components/ui/` (shadcn).

## Routes

### Site Pages (`/(site)/`)

| Path             | Purpose                                                                                      |
| ---------------- | -------------------------------------------------------------------------------------------- |
| `/`              | Discovery-first landing page with product explanation, setup CTA, and live demo              |
| `/leagues`       | Signed-in setup + management hub for platforms, AI connection details, leagues, and defaults |
| `/privacy`       | Privacy policy (CWS compliance)                                                              |
| `/sitemap.xml`   | XML sitemap for search engine discovery                                                      |
| `/robots.txt`    | Crawl rules + sitemap location for search engines                                            |
| `/oauth/consent` | OAuth authorization screen                                                                   |

### Chat Surfaces (`/(chat)/`)

| Path    | Purpose                          |
| ------- | -------------------------------- |
| `/chat` | Legacy redirect to `/#live-demo` |
| `/dev`  | Internal dev/debug chat surface  |

### API Routes (`/api/`)

| Path                 | Purpose                                                          |
| -------------------- | ---------------------------------------------------------------- |
| `/api/auth/*`        | Platform auth (Clerk)                                            |
| `/api/espn/*`        | League management, seasons, discovery, credentials               |
| `/api/extension/*`   | Extension APIs (Clerk JWT)                                       |
| `/api/oauth/*`       | OAuth status, revoke                                             |
| `/api/chat/*`        | Internal dev chat turn responses                                 |
| `/api/public-chat/*` | Public chat server routes (preset-driven demo-account execution) |

Most API routes proxy to auth-worker. See `docs/ARCHITECTURE.md` for the full flow.

## Season Years

Leagues are stored per season year. The `/leagues` UI defaults the season year based on America/New_York time:

- **Baseball (flb)**: Defaults to the previous year until Feb 1, then switches to the current year
- **Football (ffl)**: Defaults to the previous year until Jul 1, then switches to the current year

Deleting a league removes all seasons for that league.

## Environment Variables

Create `web/.env.local` from `.env.example`:

```bash
# OpenAI (for homepage live demo and internal /dev lab)
OPENAI_API_KEY=sk-...

# Clerk Auth
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...

# Worker URLs (unified gateway is primary)
NEXT_PUBLIC_AUTH_WORKER_URL=https://api.flaim.app/auth
NEXT_PUBLIC_FANTASY_MCP_URL=https://api.flaim.app/mcp
# Shared internal token for server-to-worker helper calls
INTERNAL_SERVICE_TOKEN=...
# Yahoo MCP client (not called by web directly; useful for local debugging)
NEXT_PUBLIC_YAHOO_CLIENT_URL=https://yahoo-client.gerrygugger.workers.dev
```

For local development with workers, point to `http://localhost:8786` etc.

## Public Chat Demo

The homepage live demo, reachable at `/#live-demo` and via the legacy `/chat` redirect, is intentionally constrained in v1:

- Runs against a dedicated demo account (`demo@flaim.app`)
- Uses server-owned auth with `DEMO_API_KEY`
- Accepts preset prompt IDs only
- Is rate-limited server-side and allows only one in-flight run per visitor
- Streams live MCP tool activity and assistant output back to the browser

This is separate from the internal `/dev` surface. The browser never receives reusable demo-account credentials.

## Internal Dev Chat

The `/dev` page is the internal dev/debug surface for manual MCP tool testing and exploratory debugging. It is not the public product chat experience. For structured, repeatable testing, use the eval harness (`flaim-eval/`). The two are complementary — `/dev` is the visual scratchpad, eval is the structured test bench.

### Access Control

Both the `/dev` page and all `/api/chat/*` routes require `publicMetadata.chatAccess: true` in Clerk. Without it:

- `/dev` page → redirects to home
- API routes → 403 Forbidden

Set in Clerk Dashboard → Users → [user] → Public metadata:

```json
{ "chatAccess": true }
```

### Debug Mode

Toggle in the Developer Console to show:

- Raw JSON request/response for each tool call
- Execution timing (ms)
- MCP payload + tools list visibility for debugging

Keyboard shortcut: `Cmd+D` / `Ctrl+D`

### LLM Trace

The Developer Console includes an LLM Trace panel that captures prompt payloads, tool calls, and assistant output
for each turn. Exporting a session includes a redacted copy of these trace entries, but exports can still contain
sensitive data—share with care.

### Public Chat Warmup

The public live demo opportunistically hits `/api/public-chat/bootstrap` on page load. That route prewarms:

- cached Gerry session/default-league context (short TTL)

The live `/api/public-chat/turn` route still works without bootstrap, but a warm session-context cache hit makes the demo feel faster without doing hidden extra model work before the real turn starts.

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
