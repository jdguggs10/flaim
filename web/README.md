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
- **Basketball (fba)** / **Hockey (fhl)**: Manual ESPN onboarding still stores the canonical start year (for example `2024` for the 2024-25 season) even though ESPN's upstream API uses the end year

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

The homepage cache refresh flow now runs outside this repo in an external private runner. `flaim/web` only defines the read path and shared cache contract.

Notes:

- The runner populates `demo_answer_cache` out of band on a schedule
- Each refresh attempt logs a row in `demo_refresh_runs`
- The website reads cached answers only; it never triggers refresh execution
- The shared contract is the cache key format plus matching preset IDs and version constants

### Scheduler And Health Scripts

Scheduling and health checks also live in that external runner now, not in this repo.

Notes:

- The website still surfaces freshness and latest-failure state from `demo_refresh_runs`
- Preset IDs and cache-version constants in `web/lib/public-chat.ts` must stay aligned with the external runner
- If a homepage preset is added, removed, or re-versioned here, the runner must be updated to match

Important: this cache does not include live sports-news lookups. The homepage serves cached answers only and does not run a live provider or `web_search` turn per visitor request.

## Conventions

- **TypeScript** everywhere
- **PascalCase** for components, `useX` for hooks
- **Lowercase** for App Router folders
- Match existing file-local style (no repo-wide formatter)
