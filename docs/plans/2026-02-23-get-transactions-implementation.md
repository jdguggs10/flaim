# Get Transactions Tool Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a new unified read-only MCP tool, `get_transactions`, that returns recent transactions (current week + previous week by default) across ESPN, Yahoo, and Sleeper, with platform-specific normalization and clear phase boundaries for enrichment work.

**Architecture:** Add `get_transactions` at the gateway (`fantasy-mcp`) and route to platform workers. Implement v1 transaction retrieval in each worker using the most reliable source per platform (ESPN activity feed, Yahoo league transactions feed, Sleeper week endpoint), normalize to a stable response shape, and enforce strict input constraints (`count` clamp, `type` filter). Keep ESPN `mTransactions2` enrichment, Yahoo pending-waiver fan-out, and Sleeper player-name enrichment in later phases.

**Tech Stack:** TypeScript, Zod, Hono, Cloudflare Workers, Vitest, existing worker-shared error/correlation conventions

---

## Scope and Phase Boundaries

- **Phase 1 (this plan):**
  - New MCP tool: `get_transactions`
  - Default window behavior: current week + previous week when `week` omitted
  - ESPN source: `kona_league_communication` only
  - Yahoo source: `/league/{league_key}/transactions;types=add,drop,trade`
  - Sleeper source: `/league/{league_id}/transactions/{round}`
  - Return IDs for Sleeper player references (name enrichment deferred)
- **Phase 2 (separate implementation phase):**
  - ESPN `mTransactions2` enrichment (FAAB/bid precision)
  - Yahoo pending waivers/pending trades team fan-out
  - Sleeper player-name enrichment and coupling with future Sleeper free-agent work

---

### Task 1: Extend Shared Tool Params and Platform Types

**Files:**
- Modify: `workers/fantasy-mcp/src/types.ts`
- Modify: `workers/espn-client/src/types.ts`
- Modify: `workers/yahoo-client/src/types.ts`
- Modify: `workers/sleeper-client/src/types.ts`

**Step 1: Write failing type-usage tests (gateway first)**

Add a small compile-time test fixture in `workers/fantasy-mcp/src/__tests__/types.test.ts` to reference `ToolParams.type` and fail until the property exists.

**Step 2: Run targeted test/type-check to verify fail**

Run: `cd workers/fantasy-mcp && npm run type-check`
Expected: type error indicating missing `type` on `ToolParams`.

**Step 3: Add minimal type fields**

Update type defs with:

```ts
// in ToolParams
week?: number;
count?: number;
type?: 'add' | 'drop' | 'trade' | 'waiver';
```

For Sleeper worker types, keep sport union unchanged (`football | basketball`).

**Step 4: Re-run type-check**

Run: `cd workers/fantasy-mcp && npm run type-check`
Expected: PASS

**Step 5: Commit**

```bash
git add workers/fantasy-mcp/src/types.ts workers/espn-client/src/types.ts workers/yahoo-client/src/types.ts workers/sleeper-client/src/types.ts workers/fantasy-mcp/src/__tests__/types.test.ts
git commit -m "feat: extend tool params for transactions inputs"
```

---

### Task 2: Add `get_transactions` to Gateway MCP Tool Registry

**Files:**
- Modify: `workers/fantasy-mcp/src/mcp/tools.ts`
- Modify: `workers/fantasy-mcp/src/__tests__/tools.test.ts`

**Step 1: Write failing gateway tests**

In `workers/fantasy-mcp/src/__tests__/tools.test.ts`:
- Add `get_transactions` to expected tool name list.
- Add test that tool routes to `routeToClient(env, 'get_transactions', ...)`.
- Add validation test for invalid `type` and count clamp expectations.

**Step 2: Run tests to verify fail**

Run: `cd workers/fantasy-mcp && npm test -- src/__tests__/tools.test.ts`
Expected: FAIL (tool missing).

**Step 3: Implement tool definition**

In `workers/fantasy-mcp/src/mcp/tools.ts`, add `get_transactions` block mirroring existing tool patterns:

```ts
{
  name: 'get_transactions',
  title: 'League Transactions',
  requiredScope: 'mcp:read',
  securitySchemes: buildSecuritySchemes('mcp:read'),
  openaiMeta: { invoking: 'Fetching transactions…', invoked: 'Transactions ready' },
  inputSchema: {
    platform: z.enum(['espn', 'yahoo', 'sleeper']),
    sport: z.enum(['football', 'baseball', 'basketball', 'hockey']),
    league_id: z.string(),
    season_year: z.number(),
    week: z.number().optional(),
    type: z.enum(['add', 'drop', 'trade', 'waiver']).optional(),
    count: z.number().optional(),
  } as ZodShape,
  handler: async (...) => {
    const count = Math.max(1, Math.min(100, Number(args.count ?? 25)));
    // build params, route, return routeResultToMcp(result)
  }
}
```

**Step 4: Re-run tests**

Run: `cd workers/fantasy-mcp && npm test -- src/__tests__/tools.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add workers/fantasy-mcp/src/mcp/tools.ts workers/fantasy-mcp/src/__tests__/tools.test.ts
git commit -m "feat: add get_transactions MCP tool in gateway"
```

---

### Task 3: Add Routing and Wire Contract for `get_transactions`

**Files:**
- Modify: `workers/fantasy-mcp/src/router.ts`
- Modify: `workers/fantasy-mcp/src/__tests__/router.test.ts`

**Step 1: Write failing router test**

Add case in `router.test.ts` for `tool='get_transactions'` and assert request body forwarded to platform worker.

**Step 2: Run test to verify fail**

Run: `cd workers/fantasy-mcp && npm test -- src/__tests__/router.test.ts`
Expected: FAIL

**Step 3: Implement minimal routing support**

No special routing branch needed; ensure any test assumptions include new tool and params.

**Step 4: Re-run test**

Run: `cd workers/fantasy-mcp && npm test -- src/__tests__/router.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add workers/fantasy-mcp/src/router.ts workers/fantasy-mcp/src/__tests__/router.test.ts
git commit -m "test: cover get_transactions routing path"
```

---

### Task 4: Create ESPN Shared Transactions Helper (Phase 1 Source = Activity Feed)

**Files:**
- Create: `workers/espn-client/src/shared/espn-transactions.ts`
- Modify: `workers/espn-client/src/types.ts`
- Create: `workers/espn-client/src/shared/__tests__/espn-transactions.test.ts`

**Step 1: Write failing parser tests**

Add tests for message type mappings:
- `178` => add
- `180` => waiver
- `179|181|239` => drop
- `244` => trade

And timestamp extraction from topic/message structure.

**Step 2: Run tests to verify fail**

Run: `cd workers/espn-client && npm test -- src/shared/__tests__/espn-transactions.test.ts`
Expected: FAIL

**Step 3: Implement helper**

Implement:
- header builder for `x-fantasy-filter`
- pagination (`offset` increments)
- mapping function from ESPN message payload to normalized transaction rows

```ts
export async function fetchEspnActivityTransactions(...) { /* paginated fetch */ }
export function mapEspnMessageTypeToTxnType(id: number): 'add'|'drop'|'trade'|'waiver'|null { ... }
export function normalizeEspnActivityTopic(topic: unknown): NormalizedTransaction[] { ... }
```

**Step 4: Re-run tests**

Run: `cd workers/espn-client && npm test -- src/shared/__tests__/espn-transactions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add workers/espn-client/src/shared/espn-transactions.ts workers/espn-client/src/types.ts workers/espn-client/src/shared/__tests__/espn-transactions.test.ts
git commit -m "feat: add espn activity-feed transaction normalizer"
```

---

### Task 5: Implement ESPN `get_transactions` in Football Handler

**Files:**
- Modify: `workers/espn-client/src/sports/football/handlers.ts`
- Create: `workers/espn-client/src/sports/football/__tests__/transactions.test.ts`

**Step 1: Write failing handler tests**

Cover:
- default window mode when `week` omitted (current + previous)
- explicit week mode when `week` provided
- `type` filtering
- `count` clamp and sort desc by timestamp

**Step 2: Run failing test**

Run: `cd workers/espn-client && npm test -- src/sports/football/__tests__/transactions.test.ts`
Expected: FAIL

**Step 3: Implement minimal handler**

- Add `get_transactions: handleGetTransactions` to `footballHandlers`.
- Use shared helper from Task 4.
- Normalize output shape and include window metadata.

**Step 4: Re-run tests**

Run: `cd workers/espn-client && npm test -- src/sports/football/__tests__/transactions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add workers/espn-client/src/sports/football/handlers.ts workers/espn-client/src/sports/football/__tests__/transactions.test.ts
git commit -m "feat: add espn football get_transactions handler"
```

---

### Task 6: Implement ESPN `get_transactions` for Baseball/Basketball/Hockey

**Files:**
- Modify: `workers/espn-client/src/sports/baseball/handlers.ts`
- Modify: `workers/espn-client/src/sports/basketball/handlers.ts`
- Modify: `workers/espn-client/src/sports/hockey/handlers.ts`
- Create: `workers/espn-client/src/sports/__tests__/transactions-routing.test.ts`

**Step 1: Write failing cross-sport wiring test**

Assert each sport handler map includes `get_transactions` and calls shared helper.

**Step 2: Run test to fail**

Run: `cd workers/espn-client && npm test -- src/sports/__tests__/transactions-routing.test.ts`
Expected: FAIL

**Step 3: Implement cross-sport wiring**

Apply same handler pattern as football with sport-specific `GAME_ID` already present in each file.

**Step 4: Re-run tests**

Run: `cd workers/espn-client && npm test -- src/sports/__tests__/transactions-routing.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add workers/espn-client/src/sports/baseball/handlers.ts workers/espn-client/src/sports/basketball/handlers.ts workers/espn-client/src/sports/hockey/handlers.ts workers/espn-client/src/sports/__tests__/transactions-routing.test.ts
git commit -m "feat: add espn get_transactions across all supported sports"
```

---

### Task 7: Create Yahoo Shared Transactions Helper

**Files:**
- Create: `workers/yahoo-client/src/shared/yahoo-transactions.ts`
- Create: `workers/yahoo-client/src/shared/__tests__/yahoo-transactions.test.ts`

**Step 1: Write failing helper tests**

Cover:
- matrix-param path builder for `types=add,drop,trade`
- optional `count`
- normalization from numeric-key player arrays to flat rows
- mapping transaction types to canonical set

**Step 2: Run failing tests**

Run: `cd workers/yahoo-client && npm test -- src/shared/__tests__/yahoo-transactions.test.ts`
Expected: FAIL

**Step 3: Implement helper**

```ts
export function buildYahooTransactionsPath(leagueKey: string, count?: number): string { ... }
export function normalizeYahooTransactions(raw: unknown): NormalizedTransaction[] { ... }
```

Use existing `asArray/getPath/unwrapLeague` helpers.

**Step 4: Re-run tests**

Run: `cd workers/yahoo-client && npm test -- src/shared/__tests__/yahoo-transactions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add workers/yahoo-client/src/shared/yahoo-transactions.ts workers/yahoo-client/src/shared/__tests__/yahoo-transactions.test.ts
git commit -m "feat: add yahoo transactions parser and path builder"
```

---

### Task 8: Implement Yahoo `get_transactions` in Football Handler

**Files:**
- Modify: `workers/yahoo-client/src/sports/football/handlers.ts`
- Create: `workers/yahoo-client/src/sports/football/__tests__/transactions.test.ts`

**Step 1: Write failing handler tests**

Cover:
- fetch path uses matrix params
- default count behavior
- optional `type` filter in post-processing
- excludes pending-waiver fan-out behavior (v1)

**Step 2: Run failing test**

Run: `cd workers/yahoo-client && npm test -- src/sports/football/__tests__/transactions.test.ts`
Expected: FAIL

**Step 3: Implement handler**

- Add `get_transactions` to `footballHandlers` map.
- Pull credentials via existing auth helper.
- Use shared helper from Task 7.

**Step 4: Re-run tests**

Run: `cd workers/yahoo-client && npm test -- src/sports/football/__tests__/transactions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add workers/yahoo-client/src/sports/football/handlers.ts workers/yahoo-client/src/sports/football/__tests__/transactions.test.ts
git commit -m "feat: add yahoo football get_transactions handler"
```

---

### Task 9: Implement Yahoo `get_transactions` for Baseball/Basketball/Hockey

**Files:**
- Modify: `workers/yahoo-client/src/sports/baseball/handlers.ts`
- Modify: `workers/yahoo-client/src/sports/basketball/handlers.ts`
- Modify: `workers/yahoo-client/src/sports/hockey/handlers.ts`
- Create: `workers/yahoo-client/src/sports/__tests__/transactions-routing.test.ts`

**Step 1: Write failing wiring tests**

Assert each sport handlers map exposes `get_transactions` and returns normalized data shape.

**Step 2: Run failing tests**

Run: `cd workers/yahoo-client && npm test -- src/sports/__tests__/transactions-routing.test.ts`
Expected: FAIL

**Step 3: Implement cross-sport wiring**

Reuse same handler logic as football across sports; only mapping file differences should remain unrelated.

**Step 4: Re-run tests**

Run: `cd workers/yahoo-client && npm test -- src/sports/__tests__/transactions-routing.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add workers/yahoo-client/src/sports/baseball/handlers.ts workers/yahoo-client/src/sports/basketball/handlers.ts workers/yahoo-client/src/sports/hockey/handlers.ts workers/yahoo-client/src/sports/__tests__/transactions-routing.test.ts
git commit -m "feat: add yahoo get_transactions across all supported sports"
```

---

### Task 10: Create Sleeper Shared Transactions Helper

**Files:**
- Create: `workers/sleeper-client/src/shared/sleeper-transactions.ts`
- Create: `workers/sleeper-client/src/shared/__tests__/sleeper-transactions.test.ts`

**Step 1: Write failing helper tests**

Cover:
- explicit week path generation
- default two-week merge inputs
- sorting and stable `transaction_id` string handling
- mapping `free_agent|waiver|trade` to canonical type

**Step 2: Run failing tests**

Run: `cd workers/sleeper-client && npm test -- src/shared/__tests__/sleeper-transactions.test.ts`
Expected: FAIL

**Step 3: Implement helper**

```ts
export async function fetchSleeperTransactionsWindow(...) { ... }
export function normalizeSleeperTransaction(raw: unknown): NormalizedTransaction { ... }
```

Use existing `sleeperFetch` utility; do not add player-name fetch in v1.

**Step 4: Re-run tests**

Run: `cd workers/sleeper-client && npm test -- src/shared/__tests__/sleeper-transactions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add workers/sleeper-client/src/shared/sleeper-transactions.ts workers/sleeper-client/src/shared/__tests__/sleeper-transactions.test.ts
git commit -m "feat: add sleeper transactions helper for week windows"
```

---

### Task 11: Implement Sleeper `get_transactions` in Football + Basketball

**Files:**
- Modify: `workers/sleeper-client/src/sports/football/handlers.ts`
- Modify: `workers/sleeper-client/src/sports/basketball/handlers.ts`
- Create: `workers/sleeper-client/src/sports/football/__tests__/transactions.test.ts`
- Create: `workers/sleeper-client/src/sports/basketball/__tests__/transactions.test.ts`

**Step 1: Write failing handler tests**

Cover:
- explicit `week`
- default current+previous week mode
- `type` filtering
- `count` clamping

**Step 2: Run failing tests**

Run: `cd workers/sleeper-client && npm test -- src/sports/football/__tests__/transactions.test.ts src/sports/basketball/__tests__/transactions.test.ts`
Expected: FAIL

**Step 3: Implement handlers**

Add `get_transactions` to both handler maps and call shared helper.

**Step 4: Re-run tests**

Run: `cd workers/sleeper-client && npm test -- src/sports/football/__tests__/transactions.test.ts src/sports/basketball/__tests__/transactions.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add workers/sleeper-client/src/sports/football/handlers.ts workers/sleeper-client/src/sports/basketball/handlers.ts workers/sleeper-client/src/sports/football/__tests__/transactions.test.ts workers/sleeper-client/src/sports/basketball/__tests__/transactions.test.ts
git commit -m "feat: add sleeper get_transactions handlers"
```

---

### Task 12: Wire Worker Entrypoints and Unknown Tool Handling

**Files:**
- Modify: `workers/espn-client/src/index.ts`
- Modify: `workers/yahoo-client/src/index.ts`
- Modify: `workers/sleeper-client/src/index.ts`
- Modify: `workers/fantasy-mcp/src/__tests__/router.test.ts`

**Step 1: Write failing behavior tests**

Add tests confirming `get_transactions` dispatches as known tool, and unsupported sport/platform errors remain deterministic.

**Step 2: Run tests to fail**

Run:
- `cd workers/espn-client && npm test`
- `cd workers/yahoo-client && npm test`
- `cd workers/sleeper-client && npm test`

Expected: at least one FAIL around unknown tool maps.

**Step 3: Implement minimal routing updates**

Ensure each sport handler map now includes `get_transactions`; avoid route-level special cases.

**Step 4: Re-run tests**

Run:
- `cd workers/espn-client && npm test`
- `cd workers/yahoo-client && npm test`
- `cd workers/sleeper-client && npm test`

Expected: PASS

**Step 5: Commit**

```bash
git add workers/espn-client/src/index.ts workers/yahoo-client/src/index.ts workers/sleeper-client/src/index.ts workers/fantasy-mcp/src/__tests__/router.test.ts
git commit -m "test: verify get_transactions dispatch across workers"
```

---

### Task 13: Add End-to-End Gateway Integration Test for New Tool

**Files:**
- Modify: `workers/fantasy-mcp/tests/integration/index.integration.test.ts`

**Step 1: Write failing integration test**

Add checks that `tools/list` includes `get_transactions` and that `tools/call` skeleton routes cleanly under mocked worker responses.

**Step 2: Run failing integration test**

Run: `cd workers/fantasy-mcp && npm test -- tests/integration/index.integration.test.ts`
Expected: FAIL

**Step 3: Implement missing metadata and annotations parity**

Ensure tool has the same annotation pattern as other read-only tools (`readOnlyHint/openWorldHint/destructiveHint` inherited via server registration path).

**Step 4: Re-run integration test**

Run: `cd workers/fantasy-mcp && npm test -- tests/integration/index.integration.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add workers/fantasy-mcp/tests/integration/index.integration.test.ts workers/fantasy-mcp/src/mcp/tools.ts
git commit -m "test: add integration coverage for get_transactions tool"
```

---

### Task 14: Update Documentation and Product Status

**Files:**
- Modify: `README.md`
- Modify: `docs/STATUS.md`
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/CONNECTOR-DOCS.md`
- Modify: `workers/README.md`
- Modify: `workers/fantasy-mcp/README.md`
- Modify: `workers/espn-client/README.md`
- Modify: `workers/yahoo-client/README.md`
- Modify: `workers/sleeper-client/README.md`

**Step 1: Write doc TODO checklist and fail on omissions**

Create an internal checklist in commit message draft or scratch notes; validate every public tool table includes `get_transactions` where appropriate.

**Step 2: Run grep checks before edits**

Run:
- `rg -n "get_transactions" README.md docs workers -S`
Expected: missing in many docs.

**Step 3: Apply documentation updates**

Update:
- Tool tables and endpoint capability notes
- Sleeper sport support caveats for this tool
- Phase note that enrichment work remains deferred

**Step 4: Validate with grep**

Run:
- `rg -n "get_transactions" README.md docs workers -S`
Expected: references present in all intended docs.

**Step 5: Commit**

```bash
git add README.md docs/STATUS.md docs/ARCHITECTURE.md docs/CONNECTOR-DOCS.md workers/README.md workers/fantasy-mcp/README.md workers/espn-client/README.md workers/yahoo-client/README.md workers/sleeper-client/README.md
git commit -m "docs: document get_transactions tool and phase boundaries"
```

---

### Task 15: Full Verification Pass (Required Before Completion)

**Files:**
- No code changes required unless failures are found.

**Step 1: Run all worker tests**

Run:
- `cd workers/fantasy-mcp && npm test`
- `cd workers/espn-client && npm test`
- `cd workers/yahoo-client && npm test`
- `cd workers/sleeper-client && npm test`

Expected: all PASS

**Step 2: Run type checks**

Run:
- `cd workers/fantasy-mcp && npm run type-check`
- `cd workers/espn-client && npm run type-check`
- `cd workers/yahoo-client && npm run type-check`
- `cd workers/sleeper-client && npm run type-check`

Expected: all PASS

**Step 3: Optional local integration smoke**

Run:
- `npm run dev:workers`
- execute `tools/list` and one `get_transactions` call against local gateway.

Expected: tool appears and returns platform-normalized payload.

**Step 4: If any failure, fix and re-run this task**

No completion claims until all checks pass.

**Step 5: Final commit (if fixes were needed)**

```bash
git add -A
git commit -m "fix: resolve verification issues for get_transactions rollout"
```

---

## Phase 2 Backlog (Do Not Implement in This Plan)

1. ESPN enrichment via `mTransactions2` merge strategy (add FAAB/bid + structured add/drop pairing).
2. Yahoo pending-waiver and pending-trade retrieval with team fan-out and budget controls.
3. Sleeper player-name enrichment using cached `/players/{sport}` index aligned with future Sleeper free-agents effort.

## Completion Criteria

- `get_transactions` available in `tools/list`.
- Routes correctly for ESPN, Yahoo, Sleeper.
- Default behavior uses current+previous week when `week` omitted.
- `type` and `count` filters enforced consistently.
- Tests and type-check pass across all touched workers.
- Docs updated to reflect capability and explicit deferred enrichments.
