# Flaim Web App

Next.js 15 app with App Router, Tailwind CSS v4, and shadcn/ui. Handles site pages, OAuth consent, API routes, and the homepage live demo.

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
│   └── api/
│       ├── auth/            # Platform auth APIs
│       ├── espn/            # League management APIs
│       ├── extension/       # Extension APIs
│       └── oauth/           # OAuth APIs (status, revoke)
│
├── components/
│   ├── site/                # Site-only components
│   └── ui/                  # Shared shadcn components
│
└── lib/                     # Shared utilities
```

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

### API Routes (`/api/`)

| Path                 | Purpose                                                          |
| -------------------- | ---------------------------------------------------------------- |
| `/api/auth/*`        | Platform auth (Clerk)                                            |
| `/api/espn/*`        | League management, seasons, discovery, credentials               |
| `/api/extension/*`   | Extension APIs (Clerk JWT)                                       |
| `/api/oauth/*`       | OAuth status, revoke                                             |
| `/api/public-chat/*` | Public chat server routes (preset-driven demo-account execution) |

Note: `/chat` redirects to `/#live-demo` (legacy URL support).

Most API routes proxy to auth-worker. See `docs/ARCHITECTURE.md` for the full flow.

## Season Years

Leagues are stored per season year. The `/leagues` UI defaults the season year based on America/New_York time:

- **Baseball (flb)**: Defaults to the previous year until Feb 1, then switches to the current year
- **Football (ffl)**: Defaults to the previous year until Jul 1, then switches to the current year

Deleting a league removes all seasons for that league.

## Environment Variables

Create `web/.env.local` from `.env.example`:

```bash
# Clerk Auth
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...

# Worker URLs (unified gateway is primary)
NEXT_PUBLIC_AUTH_WORKER_URL=https://api.flaim.app/auth
NEXT_PUBLIC_FANTASY_MCP_URL=https://api.flaim.app/mcp
# Shared internal token for server-to-worker helper calls
INTERNAL_SERVICE_TOKEN=...
```

For local development with workers, point to `http://localhost:8786` etc.

`NEXT_PUBLIC_FANTASY_MCP_URL` is the current web-app env for the unified `fantasy-mcp` gateway. The older `FANTASY_MCP_URL` name was a legacy server-side alias for the same endpoint and is no longer read by `web/`. `DEMO_API_KEY` still exists, but it now belongs to `workers/auth-worker`, not the Vercel web project.

## Public Chat Demo

The homepage demo, reachable at `/#live-demo` and via the legacy `/chat` redirect, is intentionally constrained in v1:

- Runs against a dedicated demo account (`demo@flaim.app`)
- Uses server-owned auth via `auth-worker` (`DEMO_API_KEY` lives there, not in `web`)
- Accepts preset prompt IDs only
- Reads from server-owned cached answers when available
- Surfaces freshness state instead of doing live provider inference on every visitor click

The browser never receives reusable demo-account credentials. The interactive dev console has been extracted to a separate repo (`flaim-chat` / `chat.flaim.app`).

### Public Chat Warmup

The existing `demo_context_cache` table and `/api/public-chat/bootstrap` route still exist as legacy groundwork from the live-turn version of the public demo.

Current homepage behavior reads stored answers from `/api/public-chat/cache` only. The live-turn path (`/api/public-chat/turn`) has been removed.

### Manual Refresh Runner

Phase 2 adds a standalone manual cache-refresh command that runs outside the visitor request path:

```bash
npm run refresh -- --preset lite-standings --sport baseball
```

Notes:

- Runs Gemini CLI headlessly from an isolated temp workspace
- Injects the same cached Gerry session context used by the web app
- Writes one row into `demo_answer_cache`
- Logs the attempt in `demo_refresh_runs`
- Rejects answers that fail to use Flaim league data when the preset requires MCP grounding
- Preserves the last good answer and marks the cache row degraded if a later refresh fails
- Supports `--dry-run`, `--print-prompt`, `--model`, `--expires-minutes`, and `--stale-minutes`

This command is the bridge to Pi automation. For now it is intentionally manual and single-run.

### Scheduler And Health Scripts

Phase 3 adds the first Pi-facing automation layer:

```bash
npm run refresh-next -- --sport baseball
npm run health -- --sport baseball
```

Notes:

- `refresh-next` selects exactly one preset for the requested sport each time it runs
- Missing or degraded rows are prioritized first
- If nothing is degraded or expired, the script keeps moving by selecting the oldest ready row
- This keeps the first rollout conservative and predictable at a `12m` cron cadence
- `health` reports per-preset cache state plus the latest failure context from `demo_refresh_runs`
- `refresh-next -- --select-only --sport baseball` is the cheapest way to inspect which preset the queue would choose next without spending provider tokens
- The production refresh worker now runs the same queue/health logic from a dedicated standalone runner repo on the Pi, with the scripts in this repo retained as the implementation reference and local/manual path

Important: this warmup cache does not include sports news. The live public-chat turn uses a fresh Responses API `web_search` tool call for current-context sports details.

## Conventions

- **TypeScript** everywhere
- **PascalCase** for components, `useX` for hooks
- **Lowercase** for App Router folders
- Match existing file-local style (no repo-wide formatter)
