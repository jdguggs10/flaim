# OpenAI MCP 424 Incident Investigation (2026-02-08)

## TL;DR
The eval harness failures (`424 Error retrieving tool list from MCP server`) are **not** a simple reachability outage. The MCP server is reachable and responds to direct protocol calls, but OpenAI still rejects tool discovery. Evidence points to a **protocol/runtime compatibility issue** between OpenAI MCP connector expectations and Flaim's current wire behavior, with two high-probability candidates:

1. **Tool security metadata shape mismatch** (`_meta.securitySchemes` object vs expected array shape).
2. **Stream transport compatibility risk** (notably intermittent `GET /mcp` runtime hang exceptions in Cloudflare logs).

This document captures all findings, evidence, hypotheses, and a concrete remediation plan.

## Post-Remediation Update (2026-02-08)
The fix set has now been implemented, deployed, and validated end-to-end.

### Code/behavior changes shipped
- `GET /mcp` and `GET /fantasy/mcp` now return `405 Method Not Allowed` with `Allow: POST` (no hanging request path).
- MCP handler now runs in stream mode (`enableJsonResponse: false`) for connector compatibility.
- Tool `_meta.securitySchemes` now uses canonical array shape:
  - from object-style `{ oauth: { type: "oauth2", scope: "..." } }`
  - to array-style `[{ type: "oauth2", scopes: ["..."] }]`

### Deployment status
- Commit: `01f97b96f6df646f16498f5ab5ee2daecc328474`
- Branch: `main` (pushed to `origin/main`)
- GitHub Actions deploy: `Deploy Workers` run `21801039429` completed `success`

### E2E validation results
From `/Users/ggugger/Code/flaim-eval`:
- `npm run eval` (run id `2026-02-08T16-00-07Z`) => `9/9 completed`, `0 errored`
- Prior `424 Error retrieving tool list from MCP server` did not recur.
- `npm run accept -- 2026-02-08T16-00-07Z` => generated acceptance artifact but final status `FAIL`
- `npm run presubmit -- 2026-02-08T16-00-07Z` => `FAIL` (downstream coverage policy), not MCP discovery failure

### Remaining failures are downstream policy/coverage, not MCP connectivity
From `/Users/ggugger/Code/flaim-eval/runs/2026-02-08T16-00-07Z/acceptance-summary.json`:
- `DOWNSTREAM_COVERAGE_ESCALATION`
- `MISSING_AUTH_WORKER`
- `MISSING_FANTASY_MCP`
- warning: `MISSING_ESPN_CLIENT`

### Revised root-cause ranking after fix validation
1. **Primary**: MCP transport compatibility bug around `GET /mcp` handling (runtime hang path).
2. **Contributing correctness issue**: non-canonical `_meta.securitySchemes` shape.
3. **Context factor**: auth/API-key path issues can independently produce wrapped `424` (from upstream `401`), but this is separate from the discovery transport failure resolved above.

---

## Scope
Investigated the failure mode reported in `/Users/ggugger/Code/flaim-eval` where all scenarios fail before any tool call with:

`424 Error retrieving tool list from MCP server: 'flaim'`

### Repos inspected
- `/Users/ggugger/Code/flaim-eval`
- `/Users/ggugger/Code/flaim`

### Key docs reviewed first
- `/Users/ggugger/Code/flaim-eval/README.md`
- `/Users/ggugger/Code/flaim/README.md`
- `/Users/ggugger/Code/flaim-eval/docs/INDEX.md`
- `/Users/ggugger/Code/flaim/docs/INDEX.md`
- `/Users/ggugger/Code/flaim/docs/ARCHITECTURE.md`
- Worker docs and MCP/auth internals

---

## Reproduced Symptoms

## 1) Eval run is fully blocked at tool discovery
From `/Users/ggugger/Code/flaim-eval/runs/2026-02-08T12-43-20Z/summary.json`:
- `completed: 0`
- `errored: 9`
- each scenario error: `424 Error retrieving tool list from MCP server: 'flaim'`

No trace artifacts were produced for `accept`/`presubmit` because upstream trace generation never started.

## 2) Minimal OpenAI probe reproduces the same error
I reproduced the same failure from this environment using a single `responses.create()` call with an MCP tool.

Captured OpenAI request IDs:
- `req_c57200dd55fe476ca16454a3497f1b6b`
- `req_8e2b6ef57c3d42c28462f7e90544e483`
- `req_86d10ce6669b4061b07d00df015a537c`

Error shape:
- `type: external_connector_error`
- `code: http_error`
- `param: tools`
- message: `Error retrieving tool list from MCP server ... 424 (Failed Dependency)`

---

## Timeline and Regression Window

Using run summaries in `/Users/ggugger/Code/flaim-eval/runs/*/summary.json`:
- Last clearly healthy run in this series: `2026-02-07T02-28-06Z` (5/5 completed, 0 errored).
- Sustained full-failure runs begin: `2026-02-07T20-24-14Z` onward.
- By `2026-02-08T12-43-20Z`: `0/9` completed.

Relevant MCP-worker commits near this window:
- `84f81a0` (2026-02-07 11:02 EST): auth hardening + tool security metadata changes.
- Then handshake/metadata path fixes on 2026-02-08:
  - `63bf4c3`
  - `67a4cc0`
  - `d739bb8`

Interpretation:
- The later well-known path fixes improved metadata route behavior, but did **not** clear OpenAI connector rejection.

---

## Hard Evidence Collected

## A) Direct MCP protocol checks against production pass
Manual protocol checks against `https://api.flaim.app/mcp`:
- `initialize` => `200` JSON-RPC success.
- `tools/list` => `200` JSON-RPC success with tool list.
- Also works for `mcp-protocol-version: 2024-11-05` and `2025-11-25` in direct tests.

Implication:
- MCP endpoint is live and can answer protocol calls from standard clients.

## B) MCP SDK client can connect and list tools
Using `@modelcontextprotocol/sdk` `Client + StreamableHTTPClientTransport`, connection and `listTools()` succeeded against Flaim.

Implication:
- Compatibility issue is likely not with all MCP clients; it is specific to OpenAI's connector/runtime expectations.

## C) OpenAI MCP works in same environment with another server
Using `responses.create()` with `https://mcp.deepwiki.com/mcp` succeeded and returned `mcp_list_tools` output.

Implication:
- Not a global OpenAI MCP outage and not an account/API key baseline issue.

## D) During failing eval window, Flaim saw per-trace POST traffic with 200/202 request-end logs
Cloudflare observability for run `2026-02-08T12-43-20Z` shows many `/mcp` POST requests and `request_end` statuses in `{200, 202}` for trace IDs.

Implication:
- OpenAI did reach production endpoints during the failing run; this is not DNS/downstream reachability only.
- Failure likely happens in OpenAI-side validation/parsing of discovery session output rather than straightforward network failure.

## E) Additional signal: intermittent `GET /mcp` runtime exceptions exist
Cloudflare shows repeated `GET /mcp` exception events with message:

`The Workers runtime canceled this request because it detected that your Worker's code had hung and would never generate a response.`

Observed across multiple user agents, including:
- `openai-mcp/1.0.0 (Responses API)`
- `Claude-User`
- `claude-code/2.1.37`
- `node`

Notable counts in sampled window (2026-02-07 to 2026-02-08 13:10Z):
- large number of `GET /mcp` status `0` exception events
- at least some from `openai-mcp/1.0.0`

Implication:
- Stream lifecycle behavior on `GET /mcp` is unstable or at least noisy.
- Even if not the only root cause, this is a compatibility risk with connector implementations that use GET SSE stream establishment.

---

## Code-Level Findings

## 1) Tool security metadata shape is likely non-canonical for OpenAI
In `/Users/ggugger/Code/flaim/workers/fantasy-mcp/src/mcp/server.ts:42`, tools are registered with:

- `_meta: { securitySchemes: tool.securitySchemes }`

In `/Users/ggugger/Code/flaim/workers/fantasy-mcp/src/mcp/tools.ts:26-59`, `tool.securitySchemes` is modeled as:

- `{ oauth: { type: 'oauth2', scope: 'mcp:read' | 'mcp:write' } }`

OpenAI Apps SDK docs (official) show security schemes as an **array** with `scopes` list, e.g.:

- `securitySchemes: [{ type: "oauth2", scopes: ["..."] }]`
- mirrored in `_meta["securitySchemes"]` as array.

This mismatch is the strongest protocol-shape suspect.

## 2) Current MCP handler defaults to JSON response mode
`/Users/ggugger/Code/flaim/workers/fantasy-mcp/src/mcp/create-mcp-handler.ts:12`:

- `enableJsonResponse = true`

The MCP transport can work in JSON mode, but some runtimes/connectors are stricter around stream behavior and response content type handling. This is a medium-likelihood interoperability factor.

## 3) Current tests assert internal shape, not OpenAI compatibility shape
`/Users/ggugger/Code/flaim/workers/fantasy-mcp/tests/integration/index.integration.test.ts:90+` currently validates `_meta.securitySchemes.oauth.scope` object shape.

This bakes in the current non-array schema and does not guard against OpenAI's expected descriptor format.

## 4) Observability blind spot for exact failing JSON-RPC step
Current structured logs capture phases (`request_start/request_end/tool_*`) but not JSON-RPC method names/results for handshake/list calls.

This makes it hard to prove exactly which connector validation step is rejected (initialize vs tools/list vs stream follow-up).

---

## Hypotheses and Confidence

## H1: Endpoint/downstream outage
- **Status**: Rejected
- **Why**: direct calls succeed; production receives requests; POST responses are mostly `200/202`.

## H2: OAuth metadata path mismatch only
- **Status**: Partially addressed, not sufficient
- **Why**: well-known aliases are now `200`, yet OpenAI still returns `424`.

## H3: Invalid/expired eval token
- **Status**: Low confidence as primary cause for the run in question
- **Why**: failing run still shows many successful request-end `200/202` traces.
- Note: later in this session, local refresh token became invalid, which prevented re-running authenticated eval right now; that is separate from the captured failing run.

## H4: Tool descriptor security metadata shape incompatibility
- **Status**: High confidence candidate
- **Why**:
  - regression aligns with auth-hardening metadata changes,
  - Flaim emits non-canonical `securitySchemes` object shape,
  - OpenAI docs show array/scopes shape.

## H5: Stream transport / GET `/mcp` instability contributes to rejection
- **Status**: Medium confidence candidate
- **Why**:
  - repeated Worker exceptions on `GET /mcp` including `openai-mcp/1.0.0` user-agent,
  - connector behavior may include GET stream steps during discovery/session lifecycle.

## H6: OpenAI connector runtime bug independent of Flaim
- **Status**: Possible but lower confidence
- **Why**: deepwiki MCP works in same environment; failure appears server-specific.

---

## Why this issue is hard

1. Standard MCP clients and direct curl probes can pass while OpenAI still rejects discovery.
2. OpenAI returns a generic connector `424` envelope that hides the exact internal parse/validation step.
3. Existing logs do not record JSON-RPC method-level request/response bodies for eval-tagged calls.

---

## Recommended Fix Plan (Ordered)

## Phase 1: Metadata schema correction (lowest blast radius)
1. Change tool descriptor security metadata to OpenAI-compatible array format.
2. Keep both descriptor-level and `_meta["securitySchemes"]` mirrors in canonical array shape.
3. Update tests accordingly.

Target files:
- `/Users/ggugger/Code/flaim/workers/fantasy-mcp/src/mcp/tools.ts`
- `/Users/ggugger/Code/flaim/workers/fantasy-mcp/src/mcp/server.ts`
- `/Users/ggugger/Code/flaim/workers/fantasy-mcp/tests/integration/index.integration.test.ts`

## Phase 2: Streamability compatibility hardening
1. Test turning off JSON mode (`enableJsonResponse=false`) in preview.
2. Re-run single OpenAI probe before full eval.
3. If successful, keep and document behavior.

Target file:
- `/Users/ggugger/Code/flaim/workers/fantasy-mcp/src/mcp/create-mcp-handler.ts`

## Phase 3: Instrumentation for definitive root-cause proof
Add short-lived debug logs (eval-tagged only) for:
- incoming JSON-RPC method,
- response status,
- response content-type,
- presence of `mcp-session-id`, `mcp-protocol-version` headers.

This converts conjecture into exact step-level evidence.

---

## Validation Plan

## Step A: Fast probe (single request)
- Run one `responses.create()` with MCP tool against preview.
- Pass condition: no `external_connector_error`; receive `mcp_list_tools` output item.

## Step B: Harness probe
- Run single-scenario eval.
- Pass condition: scenario completes and writes trace artifacts.

## Step C: Full eval
- `npm run eval`
- `npm run enrich -- <run_id>`
- `npm run accept -- <run_id>`
- `npm run presubmit -- <run_id>`

Pass condition:
- nonzero completed scenarios,
- no global discovery-blocking 424,
- acceptance-summary generated.

---

## Risks / Unknowns

1. OpenAI connector behavior may have changed recently and is not fully documented at error-surface level.
2. We cannot yet confirm exactly which internal OpenAI validation rule is tripping without more wire-level logging.
3. Current auth credentials in local eval env were later observed to have refresh issues; reruns may require re-bootstrap.

---

## Concrete Next Actions for Engineering

1. Implement Phase 1 metadata shape fix in preview and redeploy.
2. Immediately run Step A probe and record OpenAI request ID.
3. If still failing, apply Phase 2 JSON/SSE transport switch in preview and re-test.
4. Add Phase 3 instrumentation if failure persists after both fixes.
5. Once passing in preview, promote to prod and rerun full eval acceptance flow.

---

## Appendix: Key Artifacts and Files

## Eval artifacts
- `/Users/ggugger/Code/flaim-eval/runs/2026-02-08T12-43-20Z/manifest.json`
- `/Users/ggugger/Code/flaim-eval/runs/2026-02-08T12-43-20Z/summary.json`

## Relevant code
- `/Users/ggugger/Code/flaim-eval/src/runner.ts`
- `/Users/ggugger/Code/flaim/workers/fantasy-mcp/src/index.ts`
- `/Users/ggugger/Code/flaim/workers/fantasy-mcp/src/mcp/auth-gate.ts`
- `/Users/ggugger/Code/flaim/workers/fantasy-mcp/src/mcp/create-mcp-handler.ts`
- `/Users/ggugger/Code/flaim/workers/fantasy-mcp/src/mcp/server.ts`
- `/Users/ggugger/Code/flaim/workers/fantasy-mcp/src/mcp/tools.ts`
- `/Users/ggugger/Code/flaim/workers/fantasy-mcp/tests/integration/index.integration.test.ts`

## Reference OpenAI request IDs from this investigation
- `req_01666f1541fc45b888df9cab36522be8` (user-provided)
- `req_c57200dd55fe476ca16454a3497f1b6b`
- `req_8e2b6ef57c3d42c28462f7e90544e483`
- `req_86d10ce6669b4061b07d00df015a537c`

---

## Remediation Execution Log (2026-02-08, after initial write-up)

This section records the actual production changes applied and observed outcomes.

### Change set applied

1. `GET /mcp` handling fixed (no more hanging GET stream in stateless mode):
   - `GET /mcp` and `GET /fantasy/mcp` now return `405` with `Allow: POST`.
   - Confirmed by direct curl and Cloudflare logs (`status: 405`, `outcome: ok`).

2. Transport mode switched from JSON mode to SSE mode:
   - `createMcpHandler(..., { enableJsonResponse: false })` in gateway route path.
   - `POST /mcp` now responds with `Content-Type: text/event-stream`.

3. Tool `_meta.securitySchemes` normalized to canonical array/scopes shape:
   - from object form (`oauth.scope`) to array form (`[{ type: "oauth2", scopes: [...] }]`).
   - Unit + integration tests updated and passing.

### Production deploy versions

- GET/405 change deploy: `b1c90a26-a5f1-4082-bfe1-9965689fe180`
- SSE + metadata fixes deploy: `2f7b14ca-1903-436e-af13-6a811a4d547f` (current at time of write)

### Probe results

#### Before metadata fix (SSE only)
- OpenAI probe still failed:
  - request id: `req_db76861a635345d5998ecc871c829f49`
  - error: `424 ... Http status code: 424 (Failed Dependency)`

#### After metadata normalization
- OpenAI probe succeeded:
  - response id: `resp_06bb3509911e4cdd006988a773ee4c819393f231fe867c0db4`
  - output included: `mcp_list_tools`
  - no connector 424

### What remains blocked

- `flaim-eval` harness run still fails in this local environment when using existing eval auth key:
  - `424 ... Http status code: 401 (Unauthorized)`
  - one-scenario run id: `2026-02-08T15-11-02Z`
- Refresh token path currently fails locally:
  - `invalid_grant` on token refresh

Interpretation:
- MCP discovery compatibility appears fixed.
- Remaining harness blocker is credential state (`FLAIM_EVAL_API_KEY` / refresh token), not MCP protocol discovery.

---

## External References
- OpenAI Apps SDK auth guide: https://developers.openai.com/apps-sdk/build/auth
- OpenAI Apps SDK reference (`securitySchemes` / `_meta["securitySchemes"]`): https://developers.openai.com/apps-sdk/reference
- MCP TypeScript SDK docs (tool registration / transport): https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md

---

## Addendum (2026-02-08): Review of Cursor Opus Analysis

This section re-evaluates the hypothesis ranking after additional observability queries and SDK source review.

### New evidence gathered

1. During the failing eval window (`2026-02-08T12:40:00Z` to `2026-02-08T12:46:00Z`), OpenAI traffic to `/mcp` was confirmed on `POST` with:
   - user-agent: `openai-mcp/1.0.0 (Responses API)`
   - response statuses: `200` and `202`
   - protocol header: `mcp-protocol-version: 2025-11-25`

2. In the same failing window, `GET /mcp` exceptions were present, but available user-agent values for those GETs were:
   - `curl/7.88.1`
   - no OpenAI user-agent observed in that exact slice.

3. OpenAI `GET /mcp` with user-agent `openai-mcp/1.0.0 (Responses API)` was observed earlier (`2026-02-07T01:58:34.950Z`) and did hang, but this predates the sustained failure window that begins around `2026-02-07T20:24:14Z`.

4. MCP SDK client source indicates `GET` SSE open is optional for clients and `405` is an expected server response path:
   - `dist/esm/client/streamableHttp.js:81-103`
   - comment explicitly treats `405` as non-fatal for GET stream setup.

5. MCP SDK server examples for stateless/json modes explicitly return `405` on GET:
   - `dist/esm/examples/server/simpleStatelessStreamableHttp.js:105-115`
   - `dist/esm/examples/server/jsonResponseStreamableHttp.js:126-131`

### What this changes

- The Cursor observation that `GET /mcp` hang is a **real bug** is correct.
- The claim that `GET /mcp` hang is the **primary cause for the referenced failing eval run** is not strongly supported by the run-window evidence, because OpenAI traffic in that window appears POST-only while GET hangs were from `curl`.

### Revised confidence ranking

1. **H5 (GET /mcp hang): high severity platform defect, medium confidence as root cause for this specific run**
   - Must be fixed regardless (return `405` or support full GET stream lifecycle).
   - Current evidence ties it strongly to curl/other probes in the failing window, not definitively to OpenAI for that run.

2. **H4 (tool metadata compatibility): medium-high confidence**
   - `_meta.securitySchemes` currently uses non-canonical object shape with `scope` (singular).
   - This may still be rejected by stricter connector parsing if that key is interpreted.

3. **H7 (JSON-vs-SSE response interoperability): medium-high confidence**
   - Flaim currently runs `enableJsonResponse=true` (JSON body responses).
   - Successful third-party MCP servers tested with OpenAI commonly return SSE (`text/event-stream`) on POST.
   - This difference remains a plausible incompatibility axis.

4. **H3/H6** remain lower-confidence primaries for the captured run.

### Updated execution order

1. Fix `GET /mcp` handling first (low-risk correctness fix):
   - switch route to `POST` only for stateless mode, and return `405` + `Allow: POST` for GET.
2. Immediately run a single OpenAI MCP probe.
3. If still failing, test transport mode change:
   - set `enableJsonResponse=false` (SSE response mode) in preview and re-test.
4. If still failing, normalize/remove `securitySchemes` metadata shape and re-test.
5. Keep method-level instrumentation enabled during this sequence to isolate the exact failing step.
