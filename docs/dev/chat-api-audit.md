# Chat API Audit: OpenAI Responses API Integration

**Date:** 2026-02-03
**Test:** Sent "Show me my current roster" from flaim.app/chat, reviewed full request/response logs on platform.openai.com.

---

## Response Metadata

| Field | Value |
|-------|-------|
| Response ID | `resp_07cfb09679ba3d6f006982ad69f830819093b3f058e29fc133` |
| Model | `gpt-5-mini-2025-08-07` |
| Total Tokens | 9,343 (Input: 7,591 / Output: 1,752) |
| Reasoning Effort | medium |
| Reasoning Summary | detailed |
| MCP Servers | fantasy-baseball, fantasy-football, fantasy-basketball, fantasy-hockey |
| Tool Calls | `get_user_session` (1.2s), `get_roster` (2.0s) |

---

## Issues

### 1. Four MCP Servers Mounted Instead of One (HIGH - Token Waste + Fragility)

**What:** The chat mounts 4 separate MCP server registrations (`fantasy-baseball`, `fantasy-football`, `fantasy-basketball`, `fantasy-hockey`), each pointing to the same unified gateway URL (`api.flaim.app/mcp`).

**Evidence from logs:** The output section shows 4 separate "MCP List Tools" blocks, each listing the same 7 tools. That's 28 tool definitions (7 x 4) sent to the model when only 7 are unique.

**Root cause:** `getAllEspnMcpServers()` in `web/lib/chat/league-mapper.ts:238-247` iterates over all 4 sports in `MCP_SERVER_CONFIG.ESPN` and creates a separate server entry for each. Since they all use the same `NEXT_PUBLIC_FANTASY_MCP_URL`, they all point to the same gateway.

**Impact:**
- 4x `list_tools` network calls on every new conversation
- 28 tools in context instead of 7 (wasted input tokens every turn)
- Model must decide which sport-labeled server to route to (e.g., it chose `fantasy-baseball` for a baseball query, but this routing is implicit and fragile)
- The unified gateway already handles sport routing via the `sport` parameter in each tool call

**Fix:** Mount a single MCP server with `server_label: "fantasy"` pointing to the unified gateway. The gateway's tools already accept `sport` as a parameter, so sport-specific server labels add no value.

**Files:**
- `web/lib/chat/league-mapper.ts:57-97` (MCP_SERVER_CONFIG)
- `web/lib/chat/league-mapper.ts:238-247` (getAllEspnMcpServers)
- `web/lib/chat/tools/tools.ts:117-181` (buildMcpToolsFromState)

---

### 2. Redundant `get_user_session` Call (MEDIUM - Wasted Latency)

**What:** The model calls `get_user_session` as its first action, even though the developer prompt already contains the full league context (active league, team ID, league ID, season year, all other leagues).

**Evidence from logs:** The `get_user_session` MCP call took 1.2s and returned data that was already present in the developer message. The model's reasoning even says "I need to start by calling the get_user_session tool, since it seems that's the first step."

**Root cause:** The system prompt at `web/lib/chat/prompts/system-prompt.ts:13,21` explicitly instructs:
```
- get_user_session: Fetch leagues + current season info (call this first)
- Call get_user_session first before other tool calls.
```
But the developer prompt (`league-context.ts`) already injects this exact data.

**Impact:**
- 1.2s added latency on every first message
- Extra tokens consumed for the tool call + response
- Contradictory instructions (context is already there, but prompt says to fetch it)

**Fix options:**
- **Option A (recommended):** Remove the "call this first" instruction from the system prompt. The developer prompt already has the data. Let `get_user_session` be available for when the model genuinely needs to refresh session data (e.g., multi-turn where leagues might have changed).
- **Option B:** Remove the league context from the developer prompt entirely and rely on `get_user_session`. Simpler but adds 1.2s latency to every conversation start.

**Files:**
- `web/lib/chat/prompts/system-prompt.ts:13,21`
- `web/lib/chat/prompts/league-context.ts` (entire file)

---

### 3. Duplicate Leagues in Developer Prompt (MEDIUM - Token Waste + Confusion)

**What:** The "OTHER LEAGUES AVAILABLE" section lists the same league multiple times without season year differentiation.

**Evidence from logs:**
```
Fantasy Baseball '24. Year 13 (baseball, ID: 30201)    <-- appears 2x
Victorious Secret (football, ID: 63634618)              <-- appears 3x
The Polski Club (football, ID: 24652)                   <-- appears 3x
```

**Root cause:** `league-context.ts:98-100` filters other leagues by `makeLeagueKey()`, but the "other leagues" template at line 46 only includes `leagueName`, `sport`, and `leagueId` — **not `seasonYear`**. So multi-season entries (2024 + 2025 for the same league) render as identical-looking duplicates.

**Impact:**
- Wasted tokens on visually identical entries
- Model confusion — it can't distinguish between seasons
- If the model picks one, it has no way to know which season it's selecting

**Fix:** Either:
- Add `seasonYear` to `OTHER_LEAGUE_ITEM_TEMPLATE` so entries are distinguishable
- Deduplicate by league ID and only show the most recent season (historical data is available via `get_ancient_history`)

**Files:**
- `web/lib/chat/prompts/league-context.ts:46` (OTHER_LEAGUE_ITEM_TEMPLATE)
- `web/lib/chat/prompts/league-context.ts:62-68` (formatOtherLeague)

---

### 4. Ancient/Historical Leagues Bloating the Developer Prompt (MEDIUM - Token Waste)

**What:** The developer prompt includes all historical leagues going back many years (Yahoo leagues from 2024, old ESPN seasons, etc.), consuming significant token budget.

**Evidence from logs:** The developer message includes leagues like:
```
Year 1 (football, ID: 314.l.544195)
Year 1 (football, ID: 331.l.662928)
Year 1 (football, ID: 348.l.767261)
Head first into third base (football, ID: 380.l.1388703)
Victorious Secret (football, ID: 390.l.942668)
...
```
These are historical Yahoo leagues spanning many seasons. The `get_ancient_history` tool exists specifically for this purpose.

**Root cause:** `league-context.ts:98-100` includes ALL leagues except the active one. There's no filtering by recency or current-season status.

**Impact:**
- Estimated 2,000+ tokens wasted per request on rarely-referenced historical data
- The system prompt already mentions `get_ancient_history` as the tool for this
- With 11 league-seasons and growing, this will only get worse

**Fix:** Only include current-season leagues in the developer prompt. Add a note like "For historical leagues/seasons, use `get_ancient_history`."

**Files:**
- `web/lib/chat/prompts/league-context.ts:98-114`
- Consider filtering by `seasonYear` against current season defaults

---

### 5. Season Year Mismatch in Developer Prompt (LOW - Stale Data)

**What:** The active league context says `Season: 2025` but the `get_user_session` response shows `seasonYear: 2026` for the same league.

**Evidence from logs:**
- Developer prompt: `Season: 2025`
- `get_user_session` response: `"seasonYear": 2026`
- The model correctly used 2026 from the tool response for `get_roster`

**Root cause:** `league-context.ts:94` uses `activeLeague.seasonYear` which comes from the client-side store. The store may have a stale value if the season rolled over (baseball switches from previous year to current year on Feb 1 per the deterministic season defaults). The user's browser may have cached the old value.

**Impact:** Low — the model was smart enough to use the fresher data from `get_user_session`. But it creates a contradiction in the prompt that could cause issues with less capable models or edge cases.

**Fix:** This may resolve itself if Issue #2 is fixed (removing the redundant `get_user_session` call would mean the developer prompt is the sole source of truth, so it needs to be correct). Alternatively, ensure the leagues store refreshes season year on page load using the deterministic defaults.

**Files:**
- `web/lib/chat/prompts/league-context.ts:94`
- Leagues store initialization (wherever `seasonYear` is set)

---

### 6. `teamName` Returns Generic "Team 7" (LOW - ESPN API Behavior)

**What:** The `get_roster` response returned `teamName: "Team 7"` instead of "The Champs."

**Evidence from logs:**
- `get_user_session` correctly returns `"teamName": "The Champs"`
- `get_roster` returns `"teamName": "Team 7"`

**Root cause:** Likely an ESPN API behavior for the 2026 season — team names may not be set until the season officially starts. The `get_user_session` data comes from Flaim's Supabase storage (which has the name from the previous season), while `get_roster` comes live from ESPN.

**Impact:** Minor cosmetic issue. The model has the correct name from context and `get_user_session`.

**Fix:** The espn-client worker could fall back to the team name from the user session if the ESPN API returns a generic name. Low priority.

**Files:**
- `workers/espn-client/` (roster handler)

---

### 7. Empty `stats` Objects in Roster Response (LOW - Expected but Undocumented)

**What:** Every player in the roster response has `stats: {}`.

**Evidence from logs:** All 23 players have empty stats objects.

**Root cause:** The 2026 baseball season hasn't started yet, so there are no stats to return.

**Impact:** The model doesn't explain why stats are empty. It just shows the roster without stats.

**Fix:** Consider adding a note in the response when stats are empty (e.g., `"note": "Season has not started yet"`) or handle this in the system prompt with guidance like "If stats are empty, the season likely hasn't started."

**Files:**
- `workers/espn-client/` (baseball roster handler)
- `web/lib/chat/prompts/system-prompt.ts` (optional guidance)

---

### 8. System Prompt Says "ESPN Fantasy Leagues" Only (LOW - Stale Copy)

**What:** The system prompt opens with "You are Flaim, a fantasy sports AI assistant specializing in ESPN fantasy leagues" — but Flaim now supports Yahoo too.

**Evidence:** `system-prompt.ts:10` says ESPN-only, but the user has Yahoo leagues visible in the `get_user_session` response (Get Chopped, Football and Chain, Car Ramrod).

**Fix:** Update to "specializing in ESPN and Yahoo fantasy leagues" or just "specializing in fantasy leagues."

**Files:**
- `web/lib/chat/prompts/system-prompt.ts:10`

---

## What's Working Well

- **Stored-responses flow** (`store: true` + `previous_response_id`): Correctly implemented, avoids rebuilding conversation history on subsequent turns.
- **MCP tool call structure**: Request/response JSON is clean and well-formed. Parameters (`platform`, `sport`, `league_id`, `season_year`, `team_id`) are correctly extracted and passed.
- **SSE streaming**: Events properly handled for reasoning summaries, tool calls, and text output.
- **Developer prompt separation**: System prompt (static behavior) and league context (dynamic user data) are cleanly separated as two developer messages.
- **Tool call timing**: Response times are reasonable (1.2s session, 2.0s roster).
- **Debug/trace infrastructure**: The LLM Trace panel in the Developer Console provides good visibility.

---

## Recommended Fix Order

1. **Issue #1** (4 MCP servers -> 1) — Biggest token savings, simplest fix, most impactful
2. **Issue #3 + #4** (Deduplicate + trim leagues) — Can be done together, significant token savings
3. **Issue #2** (Remove redundant get_user_session instruction) — Saves 1.2s latency per conversation
4. **Issue #8** (Update ESPN-only copy) — One-line fix
5. **Issue #5** (Season year staleness) — May self-resolve with other fixes
6. **Issue #6 + #7** (ESPN API cosmetics) — Low priority, nice-to-have
