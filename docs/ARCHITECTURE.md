# Flaim Architecture

Flaim is a connector platform that lets users link their ESPN fantasy leagues to AI assistants like Claude and ChatGPT. The core value is the MCP (Model Context Protocol) servers that provide live ESPN data - the built-in chat is a secondary feature.

## Core Pieces

- **Next.js web app (`/web`)**: Site pages (landing, leagues, connectors), chat UI, OAuth consent screens.
- **Auth worker (`/workers/auth-worker`)**: Supabase credential + league storage, JWT verification, OAuth token management, MCP rate limiting.
- **Sport MCP workers (`/workers/baseball-espn-mcp`, `/workers/football-espn-mcp`)**: ESPN API calls + MCP tools. Fetch creds/leagues from auth-worker; no local storage.
- **Supabase Postgres**: `espn_credentials`, `espn_leagues`, `oauth_tokens`, `oauth_codes`, `rate_limits`.

## Directory Structure

```
web/
├── app/
│   ├── (site)/              # Site pages
│   │   ├── page.tsx         # Landing (/)
│   │   ├── leagues/         # League management (/leagues)
│   │   ├── connectors/      # Connection status (/connectors)
│   │   ├── account/         # Account settings (/account)
│   │   └── oauth/consent/   # OAuth consent screen
│   │
│   ├── (chat)/chat/         # Built-in chat UI (/chat)
│   │
│   └── api/
│       ├── auth/            # Platform auth APIs
│       ├── espn/            # League management APIs
│       ├── oauth/           # OAuth APIs (status, revoke)
│       └── chat/            # Chat-only APIs (turn_response, etc.)
│
├── components/
│   ├── site/                # Site-only components (connectors/)
│   ├── chat/                # Chat-only components (assistant, tools-panel, etc.)
│   └── ui/                  # Shared shadcn components
│
├── lib/chat/                # Chat libraries
│   ├── prompts/             # System prompt, league context
│   └── tools/               # Tool definitions
│
└── stores/chat/             # Chat state (conversation, tools, leagues)
```

**Boundary rules:** Site and chat code are isolated. No cross-imports between `components/site/` and `components/chat/`, or between `lib/site/` and `lib/chat/`. Both can use `components/ui/`.

## Primary Focus: Connectors

The main user flow is:
1. Sign up and add ESPN credentials at `/leagues`
2. Add fantasy leagues and select teams
3. Connect Claude or ChatGPT at `/connectors`
4. Use MCP tools directly in Claude.ai, Claude Desktop, or ChatGPT

The built-in `/chat` is a convenience feature, not the core product.

## Claude + ChatGPT Direct Access (OAuth 2.1)

Users connect their own Claude or ChatGPT subscription to Flaim's MCP servers:

- **MCP URLs**: `https://api.flaim.app/football/mcp`, `https://api.flaim.app/baseball/mcp`
- **OAuth Flow**: Full OAuth 2.1 with PKCE, Dynamic Client Registration (RFC 7591), Protected Resource Metadata (RFC 9728)
- **Endpoints**: `/auth/register` (DCR), `/auth/authorize`, `/auth/token`, `/auth/revoke`
- **Metadata**: `/.well-known/oauth-authorization-server`, `/{sport}/.well-known/oauth-protected-resource`

**User flow**: Add MCP URL in Claude/ChatGPT → 401 triggers OAuth → user consents at `flaim.app/oauth/consent` → token exchange → tools available.

See `docs/MCP_CONNECTOR_RESEARCH.md` for full implementation details.

## MCP Tools

Tools available via the MCP servers:

- **Session**: `get_user_session` (both workers) — returns user's configured leagues, team IDs, current date/season.
- **Baseball**: `get_espn_league_info`, `get_espn_team_roster`, `get_espn_matchups`.
- **Football**: `get_espn_football_league_info`, `get_espn_football_team`, `get_espn_football_matchups`, `get_espn_football_standings`.

## Security

- JWKS-based Clerk JWT verification in auth-worker (5m cache). Prod rejects spoofed headers.
- MCP workers forward `Authorization`; auth-worker alone validates tokens.
- Per-user isolation via verified `sub`; credentials never sent back to client after setup.
- Rate limiting: 200 MCP calls/day per user via `rate_limits` table.
- OAuth tokens stored in Supabase with expiration tracking.

**Critical**: Worker-to-worker calls must use `.workers.dev` URLs. Custom domain (`api.flaim.app`) causes 522 timeouts for intra-zone requests.

## Data Flow

1. User sets up credentials and leagues via `/leagues` page → stored in Supabase via auth-worker.
2. User connects Claude/ChatGPT → OAuth flow → token stored in Supabase.
3. Claude/ChatGPT calls MCP tool → MCP worker fetches creds from auth-worker → calls ESPN → returns data.

## Built-in Chat (Secondary Feature)

The `/chat` page is gated by Clerk metadata and intended for developers/beta testers:

**Access control**: Users need `publicMetadata.chatAccess: true` in Clerk to access `/chat`. Set this in Clerk Dashboard → Users → [user] → Public metadata:
```json
{ "chatAccess": true }
```

Without this metadata, `/chat` redirects to the home page.

**LLM context injection**:
- **System prompt** (`lib/chat/prompts/system-prompt.ts`): Static instructions and tool descriptions.
- **League context** (`lib/chat/prompts/league-context.ts`): Dynamic context from `useLeaguesStore` — injects active league ID, sport, team name.
- Both injected as `developer` role messages before conversation history.

**Debug mode**: Toggle in the tools panel to show raw JSON request/response and execution timing on tool calls. Useful for debugging MCP servers before testing in Claude/ChatGPT.

## Deployment

- Frontend on Vercel; workers on Cloudflare.
- GitOps: PR → preview, main → prod.
- Keep `"workers_dev": true` on auth-worker prod for direct `.workers.dev` URL access.

See `docs/GETTING_STARTED.md` for environment setup.
