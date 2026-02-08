# MCP Eval Harness — Scope & Design

## Status
- Revised after codebase audit + MCP tool discovery
- Date: 2026-02-06
- Owner: solo maintainer
- Note: This file is a scope/design reference. Day-to-day operations and runbooks are maintained in `../flaim-eval/docs/`.

## What this is
A separate repo (`flaim-eval`) that serves two purposes:

1. **Debugging:** Fire prompts at OpenAI with Flaim's MCP tools, capture the full tool-call chain, and get a single readable artifact showing the entire request lifecycle.
2. **Skill development:** Iterate on instruction/skill `.md` files and test how they change model behavior — building toward publishable SKILL.md files for Claude plugins, OpenAI skills, etc.

Manual operation only. You run it when you want to, look at the output yourself.

## Problem statement
When debugging model behavior with Flaim's MCP tools, there's no easy way to see the full lifecycle of a request in one place. Logs exist across OpenAI, Cloudflare, and Supabase, but stitching them together manually is tedious.

Separately, the industry is converging on skill/instruction files that ship alongside MCP servers. There's no good workflow for iterating on these — you write instructions, try them in a chat, and hope for the best. The harness makes this repeatable.

## Why a separate repo
The harness treats Flaim as a black box. It doesn't import Flaim code — it calls the public production MCP endpoint via OpenAI's Responses API. Keeping it separate:
- Keeps the Flaim repo focused on the product
- Avoids polluting Flaim's dependency tree with `openai` SDK, `tsx`, etc.
- Prevents accidental deployment of eval code with workers
- Works for any MCP server (change the URL)
- Winning skill files graduate into Flaim when ready to package

**Location:** `~/Code/flaim-eval/` (separate git repo)

## Key constraint: must hit production
OpenAI's Responses API connects to MCP servers over the public internet. It cannot reach `localhost`. The eval runner **must** target production (`api.flaim.app/mcp`) or a publicly accessible preview deployment.

This also means the eval runner is always testing real production behavior, which is actually what you want.

## What we already have in Flaim (verified)

### OpenAI Responses API handles MCP natively
The existing Flaim chat (`web/app/api/chat/turn_response/route.ts`) already uses OpenAI's `type: "mcp"` tool configuration. OpenAI connects to the MCP server directly — the caller just provides `server_url` and auth headers. The eval runner does the same thing without the Next.js/Clerk/SSE overhead.

### Correlation ID — exists and propagates
- `workers/shared/src/tracing.ts` exports `getCorrelationId()` and `withCorrelationId()`
- `workers/fantasy-mcp/src/router.ts` forwards `X-Correlation-ID` to ESPN/Yahoo workers via service bindings
- **Gap:** Not emitted via `console.log`, so Cloudflare Observability can't filter by it yet. One-line fix per worker (see Phase 1b).

### Programmatic log access via MCP tools
| Layer | How to query | What you get |
|-------|-------------|-------------|
| LLM decisions | OpenAI Responses API response object | Tool calls, args, results, final text, token usage — returned inline |
| Cloudflare Workers | `cloudflare-observability` → `query_worker_observability` | Request URL, status, wall time, CPU time, ray ID, console output |
| Supabase | `supabase` → `execute_sql` | Auth/credential state if needed |
| Vercel | `vercel` → `get_runtime_logs` | Frontend/OAuth surface if needed |

### Production workers (confirmed active)
- `fantasy-mcp` — unified MCP gateway
- `espn-client` — ESPN API client
- `yahoo-client` — Yahoo API client
- `auth-worker` — auth, credentials, leagues

## Design principles
- **Manual operation.** You run it when you want to, look at the output yourself.
- **Black-box client.** No Flaim code imports — just a public API consumer.
- **One artifact per scenario.** Human-readable, grep-able, diffable.
- **Use what exists.** OpenAI's Responses API already speaks MCP. Cloudflare Observability is already queryable via MCP tools.
- **No scoring rubrics, no analyzer agents.** You'll know a bad result when you see it. Automate later if patterns emerge.
- **Skill files are first-class.** The `instructions/` directory is a development workspace for SKILL.md content.

## How the runner works

### Core loop
By default, the runner mimics the real user experience: a Claude or ChatGPT user with Flaim's MCP tools connected, no Flaim-provided system prompt. The model only has the tool descriptions from MCP `tools/list` to figure out what to do — same as production.

```ts
const input = [];

// Optionally prepend instructions from a skill file
if (scenario.instructions) {
  const instructions = fs.readFileSync(scenario.instructions, "utf-8");
  input.push({ role: "developer", content: instructions });
}

input.push({ role: "user", content: scenario.prompt });

const response = await openai.responses.create({
  model: MODEL,
  input,
  tools: [{
    type: "mcp",
    server_url: "https://api.flaim.app/mcp",
    server_label: "flaim",
    headers: { Authorization: `Bearer ${token}` },
    require_approval: "never",
  }],
  store: true,
  parallel_tool_calls: false,
});
```

OpenAI handles the MCP protocol. The runner just sends the prompt and captures the complete response — every tool call, every argument, every result, the final text.

### Instructions / skill files
Scenarios can optionally reference a `.md` instructions file via the `instructions` field. This lets you test how different instruction sets change model behavior with the same prompt and tools — effectively A/B testing skill definitions.

Use cases:
- **Bare MCP (no instructions):** How does the model behave with just tool descriptions? This is today's real user experience.
- **With skill file:** Does adding "always call get_user_session first" actually fix the tool ordering problem? Does "never assume the sport" prevent cross-sport confusion?
- **Comparing skill files:** Run the same scenario with `instructions-v1.md` and `instructions-v2.md` to see which produces better behavior.

### Skill development workflow
```
1. Write instructions in instructions/fantasy-analyst-v2.md
2. Run: npm run eval                    # test all scenarios
3. Compare: diff runs/prev/ runs/new/  # see what changed
4. Iterate until behavior is right
5. Graduate: copy to flaim repo as SKILL.md when ready to package
```

### Post-run log enrichment (optional)
After the run, you can query Cloudflare Observability (via MCP tool or API) filtered by time window + service name to pull matching worker-side logs. This adds server timing, status codes, and any errors to the artifact. Not required for every run — useful when something looks wrong.

### Non-streaming
Unlike the chat, the runner uses non-streaming mode (omit `stream: true`). This returns the complete response object in one shot — easier to capture, parse, and write to disk.

## Authentication

### Decision: OAuth refresh token

The MCP endpoint accepts both Clerk JWTs and OAuth access tokens. For a headless eval script, OAuth is the right choice:
- Clerk JWTs expire in ~60 seconds and require browser-based session management
- OAuth access tokens are longer-lived (1 hour) with a 7-day refresh token

### How it works
Flaim's OAuth is full PKCE with browser consent (`workers/auth-worker/src/oauth-handlers.ts`):
1. Client registers via DCR → gets `client_id`
2. Browser redirect to `/oauth/consent` → user clicks "Allow" (Clerk session required)
3. Auth code exchanged for access token + refresh token
4. Refresh token valid for 7 days, renewable

### Bootstrap flow (one-time manual setup)
1. Create a dedicated test account on flaim.app
2. Add ESPN credentials and at least one league to the test account
3. Run `npm run bootstrap` — opens browser for consent, catches callback, saves tokens
4. Store the refresh token in `.env` (gitignored)

The runner uses the refresh token to get fresh access tokens on each run via `POST /auth/token` with `grant_type=refresh_token`. As long as you run the script at least once every 7 days, you never need to re-consent. If the refresh token expires, just run bootstrap again — it takes 30 seconds.

### Bootstrap helper
The runner includes a `npm run bootstrap` command that:
1. Registers a client via DCR (`POST /auth/register`)
2. Generates a PKCE code challenge
3. Opens the browser to the authorize URL
4. Spins up a tiny local HTTP server on `localhost:3000/oauth/callback` (already in Flaim's allowed redirect URI list)
5. Catches the callback, exchanges the code for tokens
6. Writes the refresh token to `.env`

## Trace schema (per-scenario artifact)
```json
{
  "schema_version": "1.0",
  "run_id": "2026-02-06T20-30-00Z",
  "scenario_id": "who_is_on_my_roster",
  "timestamp_utc": "2026-02-06T20:30:22.801Z",
  "model": "gpt-5-mini-2025-08-07",
  "prompt": "Who is on my roster?",
  "instructions_file": "instructions/fantasy-analyst-v1.md",
  "llm_response": {
    "response_id": "resp_abc123",
    "tool_calls": [
      {
        "tool_name": "get_user_session",
        "args": {},
        "result_preview": "returned 3 leagues",
        "latency_ms": 210
      },
      {
        "tool_name": "get_roster",
        "args": {
          "platform": "espn",
          "sport": "baseball",
          "league_id": "12345",
          "season_year": 2025
        },
        "result_preview": "returned 23 players",
        "latency_ms": 590
      }
    ],
    "final_text": "Here is your roster...",
    "usage": { "input_tokens": 1200, "output_tokens": 450 }
  },
  "server_logs": {
    "fantasy-mcp": [
      { "timestamp": "...", "message": "POST /mcp", "status": 200, "wall_time_ms": 11 }
    ],
    "espn-client": [
      { "timestamp": "...", "message": "get_roster baseball 12345", "wall_time_ms": 580 }
    ]
  },
  "notes": []
}
```

The `server_logs` section is optional enrichment — the `llm_response` alone tells you what the model did and why.

## Repo structure
```
flaim-eval/                    # separate git repo
  src/                         # runner source
    run.ts                     # CLI entry point
    enrich.ts                  # post-run log re-enrichment
    runner.ts                  # single scenario executor
    auth.ts                    # OAuth token refresh + PKCE helpers
    bootstrap.ts               # one-time OAuth setup
    cloudflare-logs.ts         # Workers Observability query client
    trace.ts                   # trace id generator
    artifacts.ts               # per-trace artifact IO helpers
    types.ts                   # type definitions
    scenarios.ts               # scenario loader
  scenarios/                   # scenario definitions (checked in)
    who_is_on_my_roster.json
    standings_and_playoff_outlook.json
    ...
  instructions/                # skill / instruction files (checked in)
    fantasy-analyst-v1.md
    fantasy-analyst-v2.md
  runs/                        # run output (gitignored)
    2026-02-06T20-30-00Z/
      manifest.json            # model, timestamp, scenario list, instructions used
      summary.json             # pass/fail, timing, token totals
      trace_who_is_on_my_roster_000/
        trace.json
        logs/
          fantasy-mcp.json
          espn-client.json
          yahoo-client.json
          auth-worker.json
  .env                         # refresh token, client_id (gitignored)
  .env.example
  package.json
  tsconfig.json
```

## Scenario definitions
Each scenario is a small JSON file:
```json
{
  "id": "who_is_on_my_roster",
  "prompt": "Who is on my roster?",
  "description": "Basic happy path — should call get_user_session then get_roster",
  "expected_tools": ["get_user_session", "get_roster"],
  "instructions": "instructions/fantasy-analyst-v1.md",
  "tags": ["espn", "happy-path"]
}
```

- `expected_tools` is for your eyeball comparison, not automated scoring. The runner includes it in the artifact so you can quickly see if the model did what you expected.
- `instructions` is optional. Omit it to test bare MCP behavior (no skill file). Include it to test how a specific instruction set changes model behavior. Path is relative to repo root.

## Suggested first scenarios
- `who_is_on_my_roster` — happy path, basic tool chain
- `standings_and_playoff_outlook` — standings tool
- `best_waiver_adds` — free agents tool
- `cross_sport_confusion` — adversarial: football question with baseball defaults
- `no_league_context` — adversarial: vague question, see how model handles missing context

## Implementation plan
See `docs/plans/2026-02-06-mcp-eval-harness.md` in the Flaim repo for step-by-step implementation tasks.

### Phase 1a: Structured logging in fantasy-mcp — DONE
- Added `withToolLogging` helper wrapping all 7 tool handlers with correlation ID, tool name, context, and duration
- Added correlation ID to `fetchUserLeagues` logs
- File: `workers/fantasy-mcp/src/mcp/tools.ts`

### Phase 1b: Cloudflare log enrichment in eval harness — DONE
- `flaim-eval/src/cloudflare-logs.ts` queries Workers Observability Telemetry API with:
  - timeframe in epoch milliseconds
  - response extraction from `result.events.events`
- Opt-in via `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` in `.env`
- Runner performs bounded retry for delayed log indexing.

### Phase 2: Per-question trace observability — IN PROGRESS
- `flaim-eval` now generates deterministic `trace_id` per scenario and sends:
  - `X-Flaim-Eval-Run`
  - `X-Flaim-Eval-Trace`
- Worker code propagates these headers through:
  - `fantasy-mcp` gateway
  - `espn-client`
  - `yahoo-client`
  - `auth-worker`
- Structured JSON eval logs are emitted in all four workers with `run_id`, `trace_id`, and `correlation_id`.
- `npm run enrich -- <run_id> [trace_id]` re-fetches delayed logs without re-running model calls.

## Trace observability contract

### Required request headers
- `X-Flaim-Eval-Run`: stable run ID for a full eval invocation.
- `X-Flaim-Eval-Trace`: per-question trace ID.

### Required log fields (JSON payload in `console.log`)
- `service`
- `phase`
- `run_id`
- `trace_id`
- `correlation_id`

### Artifact contract
- Per scenario trace artifact path: `runs/<run_id>/<trace_id>/trace.json`
- Worker logs path: `runs/<run_id>/<trace_id>/logs/<worker>.json`
- Trace file should remain readable without server logs (`server_logs` optional).

## Failure runbook

### No logs found
- Confirm `CLOUDFLARE_ACCOUNT_ID` and token are set in `flaim-eval/.env`.
- Confirm token includes Workers Observability query permissions.
- Run `npm run enrich -- <run_id> [trace_id]` to handle indexing delay.

### Only one worker has logs
- Verify worker deployments include header propagation and structured eval logging.
- Confirm downstream worker calls preserve `X-Flaim-Eval-Run` and `X-Flaim-Eval-Trace`.

### Cross-trace contamination
- Confirm queries filter on `trace_id` first, not only time window.
- Confirm logs actually include `trace_id` field in emitted JSON.

### Future directions
- **Supabase/Vercel log pulling:** Add enrichment from other observability sources.
- **Correlation ID filtering:** Once OpenAI surfaces MCP response headers, filter server logs by exact correlation ID instead of time window.
- **Automated analysis agent:** After 10+ runs reveal patterns, build a CLI agent that reads artifacts and flags issues.
- **Gated verbose traces:** Detailed JSON logs gated by `X-Flaim-Eval: 1` header, only if time-window correlation proves insufficient.

## Cost
Each scenario run costs OpenAI API tokens. Rough estimate: 5 scenarios × ~2000 tokens each = ~10K tokens per full run. At current pricing that's pocket change. But it's not zero — don't leave it running in a loop.

## Security and privacy
- Use a dedicated eval/test account, not your personal account
- Don't persist access tokens in artifacts — only the refresh token in `.env`
- Never log `swid`, `espn_s2`, or full auth headers
- Keep `runs/` and `.env` gitignored

## Future direction: skills + MCP convergence

The eval harness's `instructions/` directory maps directly to an emerging industry standard. As of early 2026, all major AI platforms are converging on the same pattern: MCP provides tools, skill/instruction files tell the model how to use them.

### Current state of the ecosystem

- **Anthropic (Claude):** Plugins bundle `SKILL.md` files + `.mcp.json` into installable packages. Skills use YAML frontmatter + markdown body. Plugins ship to a directory.
- **OpenAI (ChatGPT/Codex):** Agent Skills use an identical `SKILL.md` format. Codex has official support; ChatGPT is leveraging skills internally. Skills complement MCP — "one equips your agent with domain-specific workflows (Skills); the other facilitates connections to your services (MCP)."
- **Google (Gemini):** Conductor extension stores developer context as versioned Markdown. Gemini CLI supports MCP servers. Managed MCP servers cover Google Cloud services.
- **MCP spec itself:** MCP Apps (Jan 2026) extend tools beyond plain text into interactive UIs via sandboxed iframes.

### What this means for Flaim

The eval harness doubles as a **skill development and testing workflow**:

1. **Write** an instruction file in `instructions/`
2. **Test** it against scenarios with `npm run eval`
3. **Iterate** by comparing artifacts from different instruction versions
4. **Ship** the winning version as a formal `SKILL.md` (or Claude plugin, or OpenAI skill) alongside Flaim's MCP server

When the industry matures to the point where MCP servers bundle instructions, Flaim will already have battle-tested skill definitions ready to package.

## Open questions
- **Yahoo scenarios:** Include in phase 1 or ESPN-only first?
- **Model selection:** gpt-5-mini to match production? Test multiple models per scenario?

## Bottom line
The infrastructure exists. OpenAI's Responses API speaks MCP natively — the runner is a few dozen lines that replicate what the chat already does, pointed at production. OAuth refresh token handles auth with minimal maintenance. The separate repo keeps Flaim clean while providing both a debugging tool and a skill development workspace. Build the runner, run it manually, read the output. Add complexity only when the simple version stops being useful.
