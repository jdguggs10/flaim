# Platform Integration Reference Audit (ESPN/Yahoo -> ESPN/Yahoo/Sleeper)

## Purpose
Provide a single, implementation-ready audit of active ESPN/Yahoo-only references across `flaim`, `flaim-eval`, and `flaim-marketing`, including context and exact recommended updates so all platform integration references acknowledge Sleeper support.

## Method
- Reviewed active project docs and code entry points in all three repos.
- Performed targeted line-level context checks for each required reference.
- Executed the required ripgrep double-check queries in each repo for:
  - `ESPN & Yahoo`, `ESPN/Yahoo`, `ESPN or Yahoo`, `only ESPN and Yahoo`
  - `'espn' | 'yahoo'`
  - `z.enum(['espn', 'yahoo'])`
- Classified findings into:
  - Active references requiring update.
  - Active references that are contextual/no-change.
  - Excluded references (historical/planning docs out of scope).

## Active References Requiring Update

| Repo | File | Line | Current Reference | Context Summary | Why It’s Inconsistent | Recommended Update | Update Type |
|---|---|---:|---|---|---|---|---|
| flaim | `flaim/server.json` | 5 | `Connect ESPN & Yahoo fantasy leagues...` | Public connector/server metadata description. | Product now supports Sleeper as first-class platform. | Replace with: `Connect ESPN, Yahoo, and Sleeper fantasy leagues to Claude, ChatGPT, and Gemini via MCP`. | copy |
| flaim | `flaim/gemini-extension.json` | 4 | `Connect your ESPN & Yahoo fantasy leagues...` | Gemini extension descriptor for end users. | Omits Sleeper from supported platform copy. | Replace with: `Connect your ESPN, Yahoo, and Sleeper fantasy leagues to Gemini. Get rosters, standings, matchups, free agents, and league info via MCP.` | copy |
| flaim | `flaim/docs/ARCHITECTURE.md` | 5 | `...service that connects ESPN fantasy leagues...` | Top-level architecture intro sentence. | Describes ESPN-only integration at doc entrypoint. | Replace sentence to: `Flaim is an MCP (Model Context Protocol) service that connects ESPN, Yahoo, and Sleeper fantasy leagues to AI assistants like Claude, ChatGPT, and Gemini CLI.` (retain remainder). | copy |
| flaim | `flaim/docs/ERROR-CODES.md` | 23 | `Use \`espn\` or \`yahoo\`` | User-action guidance for `PLATFORM_NOT_SUPPORTED`. | Guidance excludes supported `sleeper` platform value. | Replace with: `Use \`espn\`, \`yahoo\`, or \`sleeper\``. | copy |
| flaim | `flaim/docs/migrations/012_centralized_defaults.sql` | 13 | `"platform": "espn"|"yahoo"` | Migration comment documents JSON shape. | Comment lags current platform model and can mislead maintainers. | Replace comment example with: `{ "platform": "espn"|"yahoo"|"sleeper", "leagueId": "123", "seasonYear": 2024 }`. | copy |
| flaim | `flaim/web/app/layout.tsx` | 24 | `...ESPN & Yahoo fantasy leagues` | OpenGraph metadata description. | Public SEO/social metadata omits Sleeper. | Replace with: `MCP Connector for Fantasy Sports — Give AI access to your ESPN, Yahoo, and Sleeper fantasy leagues`. | copy |
| flaim | `flaim/web/app/layout.tsx` | 33 | `...ESPN & Yahoo fantasy leagues` | Twitter metadata description. | Public metadata omits Sleeper. | Replace with same Sleeper-inclusive string as line 24. | copy |
| flaim | `flaim/web/stores/chat/useLeaguesStore.ts` | 5 | `Supports ESPN and Yahoo leagues.` | File-level store description comment. | Chat store now should be modeled as 3-platform where supported. | Replace with: `Supports ESPN, Yahoo, and Sleeper leagues.` | copy |
| flaim | `flaim/web/stores/chat/useLeaguesStore.ts` | 12 | `platform: 'espn' | 'yahoo';` | Core chat league type contract. | Type excludes Sleeper and prevents complete platform representation. | Change to: `platform: 'espn' | 'yahoo' | 'sleeper';` and ensure downstream logic handles third value. | schema/type |
| flaim | `flaim/web/stores/chat/useLeaguesStore.ts` | 100 | `Fetch ESPN and Yahoo leagues in parallel` | Fetch strategy comment + binary fetch assumptions. | Copy/intent is two-platform and code path likely requires Sleeper fetch path. | Update comment and fetch flow to include Sleeper source where available; at minimum comment should read `Fetch ESPN, Yahoo, and Sleeper leagues`. | behavior |
| flaim | `flaim/web/lib/chat/league-mapper.ts` | 6 | `type Platform = 'ESPN' | 'Yahoo';` | Chat tool config mapper platform type. | UI mapping type excludes Sleeper label path. | Change to `type Platform = 'ESPN' | 'Yahoo' | 'Sleeper';` and validate any switch/map usage. | schema/type |
| flaim | `flaim/web/components/chat/assistant.tsx` | 159 | `activeLeague.platform === 'yahoo' ? 'Yahoo' : 'ESPN'` | UI derives tool platform label from active league. | Binary conditional forces non-Yahoo platforms to ESPN. | Replace with explicit 3-way mapping, e.g. `espn -> ESPN`, `yahoo -> Yahoo`, `sleeper -> Sleeper`. | behavior |
| flaim | `flaim/web/app/api/espn/leagues/default/route.ts` | 4 | `works for ESPN and Yahoo` | Route header comment for default setting endpoint. | Comment contradicts same file type at line 19 that already includes Sleeper. | Replace with: `works for ESPN, Yahoo, and Sleeper`. | copy |
| flaim | `flaim/workers/fantasy-mcp/src/mcp/tools.ts` | 914 | `.enum(['espn', 'yahoo'])` | `get_free_agents` input schema platform enum. | Contract currently excludes Sleeper while product claims 3-platform support. | If backend supports Sleeper free agents, change to `.enum(['espn', 'yahoo', 'sleeper'])`; otherwise update descriptive/docs copy to clearly state tool-level exception. | behavior |
| flaim | `flaim/workers/fantasy-mcp/src/mcp/tools.ts` | 915 | `describe(..."espn", "yahoo", "sleeper")` with 2-value enum | Adjacent description and enum are internally inconsistent. | Schema/description mismatch causes confusion for clients and evals. | Keep enum and description aligned: either both include Sleeper (preferred if supported) or both omit Sleeper with explicit rationale. | behavior |
| flaim | `flaim/web/README.md` | 63 | `Manage ESPN leagues and seasons` | Site routes table for `/leagues`. | `/leagues` is now unified multi-platform management. | Replace with: `Manage ESPN, Yahoo, and Sleeper leagues and seasons`. | copy |
| flaim | `flaim/workers/auth-worker/README.md` | 9 | `Credential Storage — ESPN cookies and league data...` | Worker responsibility summary. | Overview omits Yahoo/Sleeper storage responsibilities. | Replace with: `Credential/Connection Storage — ESPN credentials, Yahoo tokens, Sleeper connections, and league data, stored in Supabase.` | copy |
| flaim-eval | `flaim-eval/scenarios/wrong_platform.json` | 4 | `...only ESPN and Yahoo are supported.` | Negative scenario for unsupported platform handling. | Sleeper is now supported; scenario assertion is invalid. | Change scenario to truly unsupported platform (e.g., CBS/Fantrax), and update description accordingly. | test scenario |
| flaim-eval | `flaim-eval/README.md` | 50 | `espn-client.json` | Artifact layout example for trace logs. | Worker example set omits sleeper-client log file. | Keep ESPN/Yahoo entries but add Sleeper entry in same list. | copy |
| flaim-eval | `flaim-eval/README.md` | 51 | `yahoo-client.json` | Artifact layout example for trace logs. | Same omission: no `sleeper-client.json` listed. | Add `sleeper-client.json` after platform worker logs. | copy |
| flaim-eval | `flaim-eval/docs/TROUBLESHOOTING.md` | 40 | Missing-yahoo guidance only | Missing downstream-worker troubleshooting bullets. | No equivalent Sleeper routing guidance. | Add bullet: if no tool call used `platform: "sleeper"`, missing `sleeper-client` is expected. | copy |
| flaim-eval | `flaim-eval/docs/TROUBLESHOOTING.md` | 41 | Missing-espn guidance only | Same troubleshooting block. | Block should cover all supported platform workers. | Keep existing ESPN/Yahoo bullets and include Sleeper bullet in same section. | copy |
| flaim-marketing | `flaim-marketing/strategy/REDDIT-STRATEGY.md` | 191 | `connects ESPN/Yahoo leagues...` | Public messaging template in strategy doc. | Platform pitch is stale and under-represents support. | Replace with `connects ESPN, Yahoo, and Sleeper leagues...`. | copy |
| flaim-marketing | `flaim-marketing/strategy/REDDIT-STRATEGY.md` | 258 | `Which platform (ESPN or Yahoo)?` | Bug-report response template. | Prompt excludes Sleeper bug reports. | Replace with `Which platform (ESPN, Yahoo, or Sleeper)?`. | copy |
| flaim-marketing | `flaim-marketing/outreach/THREADS-CONTENT-TEMPLATES.md` | 230 | `connecting your ESPN/Yahoo league` | Threads post template CTA line. | User-facing marketing copy omits Sleeper. | Replace with `connecting your ESPN, Yahoo, or Sleeper league`. | copy |

## Active References Verified As Contextual/No Change

| Repo | File | Line | Reference | Reason No Change |
|---|---|---:|---|---|
| flaim | `flaim/workers/fantasy-mcp/src/types.ts` | 12 | `Platform = 'espn' | 'yahoo' | 'sleeper'` | Already Sleeper-inclusive platform type. |
| flaim | `flaim/workers/fantasy-mcp/src/mcp/tools.ts` | 474 | `platform: 'espn' | 'yahoo' | 'sleeper'` | Already Sleeper-inclusive type annotation. |
| flaim | `flaim/workers/fantasy-mcp/src/mcp/tools.ts` | 606 | `platform?: 'espn' | 'yahoo' | 'sleeper'` | Already Sleeper-inclusive arg typing. |
| flaim | `flaim/workers/fantasy-mcp/README.md` | 56 | `platform: 'espn' | 'yahoo' | 'sleeper'` | Already documents all supported platforms. |
| flaim | `flaim/README.md` | 29 | `ESPN/Yahoo credentials; Sleeper uses username-only lookup` | Already acknowledges Sleeper in credential model. |
| flaim | `flaim/README.md` | 73 | `ESPN/Yahoo/Sleeper Clients` | Already Sleeper-inclusive architecture shorthand. |
| flaim | `flaim/web/app/(site)/privacy/page.tsx` | 29 | `ESPN/Yahoo credentials and Sleeper connection data` | Already explicitly includes Sleeper data handling. |
| flaim | `flaim/web/app/(site)/leagues/page.tsx` | 79 | `platform: 'espn' | 'yahoo' | 'sleeper'` | Unified league page already models Sleeper. |
| flaim | `flaim/web/app/api/espn/leagues/default/route.ts` | 19 | `platform?: 'espn' | 'yahoo' | 'sleeper'` | Runtime type already Sleeper-inclusive; only line-4 comment is stale. |

## Proposed Update Text (Exact Replacements)

- `ESPN & Yahoo` -> `ESPN, Yahoo, and Sleeper`
- `ESPN/Yahoo` -> `ESPN, Yahoo, and Sleeper` (or `ESPN, Yahoo, or Sleeper` when grammatically platform-choice)
- `Use \`espn\` or \`yahoo\`` -> `Use \`espn\`, \`yahoo\`, or \`sleeper\``
- `platform: 'espn' | 'yahoo'` -> `platform: 'espn' | 'yahoo' | 'sleeper'` (where Sleeper is truly supported in that path)
- Binary label map `activeLeague.platform === 'yahoo' ? 'Yahoo' : 'ESPN'` -> explicit 3-way mapping for `espn`/`yahoo`/`sleeper`
- `wrong_platform` eval scenario: unsupported platform should be a truly unsupported value (e.g., `cbs`) instead of Sleeper
- `flaim-eval` log artifact list should include `sleeper-client.json` alongside `espn-client.json` and `yahoo-client.json`

## Double-Check Checklist

- [x] Re-ran ripgrep in each repo with required patterns.
  - `flaim`: 30 matches
  - `flaim-eval`: 1 match
  - `flaim-marketing`: 3 matches
- [x] Verified each required reference is captured exactly once in `Active References Requiring Update`.
- [x] Confirmed each row has actionable, explicit recommended update text.
- [x] Reviewed matched lines and classified non-updated items as either contextual/no-change or out-of-scope historical docs.

Verification Summary: total matches reviewed = **34**; total active references requiring update = **25**; total excluded = **9** (`already Sleeper-aware active references` or `historical/planning docs outside active-scope implementation`).

## Open Questions
None.

---

## Triage & Recommendations (2026-02-20)

Reviewer: AI assistant (full codebase context across flaim, flaim-eval, flaim-marketing)

### Priority Tiers

- **P0 — Do now (broken/misleading behavior or user-facing inaccuracy):** Items that could confuse users, break eval correctness, or create schema/description mismatches visible to AI clients.
- **P1 — Do soon (stale copy, low risk):** Simple string replacements in docs, comments, or metadata. No behavior change.
- **P2 — Defer or skip (historical artifacts, low-leverage):** Items where the cost of updating outweighs the benefit, or where the reference is correct in its original context.

---

### Item 1 — `server.json` line 5 (copy)
**File:** `flaim/server.json`
**Current:** `Connect ESPN & Yahoo fantasy leagues...`
**Verdict: P0 — Do now.**
This is the MCP Registry public listing description. It's the first thing directory reviewers and automated crawlers see. Sleeper omission is a factual inaccuracy in a published registry entry. Straightforward string replacement, zero risk.

---

### Item 2 — `gemini-extension.json` line 4 (copy)
**File:** `flaim/gemini-extension.json`
**Current:** `Connect your ESPN & Yahoo fantasy leagues...`
**Verdict: P0 — Do now.**
This is the Gemini Extensions Gallery descriptor. Same reasoning as Item 1 — it's published metadata that auto-indexes. The recommended replacement text in the audit is good.

---

### Item 3 — `docs/ARCHITECTURE.md` line 5 (copy)
**File:** `flaim/docs/ARCHITECTURE.md`
**Current:** `...service that connects ESPN fantasy leagues...`
**Verdict: P1 — Do soon.**
Internal developer doc, not user-facing. The intro sentence says "ESPN" when it should say "ESPN, Yahoo, and Sleeper." Easy fix. Note: the rest of the file already references all three platforms correctly (the Unified Gateway section, data flow, etc.), so only the opening sentence is stale.

---

### Item 4 — `docs/ERROR-CODES.md` line 23 (copy)
**File:** `flaim/docs/ERROR-CODES.md`
**Current:** `Use \`espn\` or \`yahoo\``
**Verdict: P0 — Do now.**
This is user-action guidance shown alongside an error code. If a user hits `PLATFORM_NOT_SUPPORTED` and reads this doc, they'd think Sleeper isn't valid. The fix is a one-line string change.

**Bonus finding:** Line 36 says `basketball and hockey ... ESPN/Yahoo support is still pending. Expect NOT_SUPPORTED/SPORT_NOT_SUPPORTED until those handlers ship.` This is stale — basketball and hockey shipped to production on 2026-02-13. That note should be removed or updated to reflect current reality (ESPN mappings unverified for lack of live credentials, but handlers exist and are deployed).

---

### Item 5 — `docs/migrations/012_centralized_defaults.sql` line 13 (copy)
**File:** `flaim/docs/migrations/012_centralized_defaults.sql`
**Current:** `{ "platform": "espn"|"yahoo", "leagueId": "123", "seasonYear": 2024 }`
**Verdict: P2 — Skip.**
This is a historical migration file that has already been executed. The comment documents what the schema looked like *at the time the migration was written* (Jan 2026, before Sleeper support). Editing executed migration comments is misleading — it implies the migration itself handled Sleeper, which it didn't. The runtime code and types already accept `"sleeper"` correctly. Leave this as-is. If clarity matters, add a one-line note below like `-- Note: "sleeper" is also valid as of 2026-02 (added post-migration).`

---

### Item 6 — `web/app/layout.tsx` lines 24 and 33 (copy)
**File:** `flaim/web/app/layout.tsx`
**Current:** `MCP Connector for Fantasy Sports — Give AI access to your ESPN & Yahoo fantasy leagues`
**Verdict: P0 — Do now.**
These are OpenGraph and Twitter Card meta descriptions. They control how Flaim appears when shared on social media, in search results, and link previews. User-facing, SEO-impactful, and factually incomplete. Both lines should say `ESPN, Yahoo, and Sleeper`. Also note line 20: `description: "Connect your AI assistant to ESPN fantasy sports"` — this is the `<meta name="description">` tag and should also be updated to include all platforms.

---

### Item 7 — `web/stores/chat/useLeaguesStore.ts` line 5 (copy)
**File:** `flaim/web/stores/chat/useLeaguesStore.ts`
**Current:** `Supports ESPN and Yahoo leagues.`
**Verdict: P1 — Do soon.**
File-level doc comment. Trivial fix, bundle it with Item 8.

---

### Item 8 — `web/stores/chat/useLeaguesStore.ts` line 12 (schema/type)
**File:** `flaim/web/stores/chat/useLeaguesStore.ts`
**Current:** `platform: 'espn' | 'yahoo';`
**Verdict: P0 — Do now, but verify downstream.**
The `ChatLeague` interface is the core type for the entire chat UI. If Sleeper leagues are fetched (see Item 9) but this type doesn't accept `'sleeper'`, TypeScript will reject them. The fix itself is trivial (`| 'sleeper'`), but you need to verify all consumers of `ChatLeague` handle the third value. I checked — `makeLeagueKey` is platform-agnostic (string interpolation), `setDefaultLeague` passes `platform` through to the API which already accepts sleeper, and `getLeaguesForSport` filters by sport, not platform. Safe to add.

---

### Item 9 — `web/stores/chat/useLeaguesStore.ts` line 100 (behavior)
**File:** `flaim/web/stores/chat/useLeaguesStore.ts`
**Current:** Fetches only ESPN and Yahoo leagues in parallel.
**Verdict: P0 — Do now. This is the highest-impact finding in the audit.**
The `/leagues` page already fetches Sleeper leagues via `/api/connect/sleeper/leagues` (confirmed in `web/app/(site)/leagues/page.tsx`). The chat store simply doesn't call it. A user who connects Sleeper on the landing page/leagues page will have their Sleeper leagues completely invisible in the chat UI. The fix is to add a third parallel fetch:

```typescript
const [espnRes, yahooRes, sleeperRes] = await Promise.all([
  fetch('/api/espn/leagues'),
  fetch('/api/connect/yahoo/leagues').catch(() => null),
  fetch('/api/connect/sleeper/leagues').catch(() => null),
]);
```

Then map the Sleeper response to `ChatLeague[]` with `platform: 'sleeper'`. The Sleeper leagues API returns `{ leagues: Array<{ league_id, sport, season_year, league_name, ... }> }` based on the leagues page code. Map accordingly. This depends on Item 8 (type must accept `'sleeper'`).

---

### Item 10 — `web/lib/chat/league-mapper.ts` line 6 (schema/type)
**File:** `flaim/web/lib/chat/league-mapper.ts`
**Current:** `type Platform = 'ESPN' | 'Yahoo';`
**Verdict: P1 — Do soon, but scope it carefully.**
This file has a lot of legacy per-platform logic (`MCP_SERVER_CONFIG` with per-sport Yahoo worker URLs, ESPN game ID detection, etc.). The `Platform` type gates what `MCP_SERVER_CONFIG` and `generateMcpToolsConfig` accept. However, `generateMcpToolsConfig` now just calls `getUnifiedMcpServer()` and ignores the platform/sport arguments entirely. So adding `'Sleeper'` to the type is safe — it won't break anything because the platform value isn't used in the unified path.

**Recommended approach:** Add `| 'Sleeper'` to the type. You do NOT need to add a Sleeper entry to `MCP_SERVER_CONFIG` since that config is effectively dead code (the unified gateway handles routing). Consider adding a `// TODO: Remove legacy MCP_SERVER_CONFIG once chat fully migrates to unified gateway` comment.

---

### Item 11 — `web/components/chat/assistant.tsx` line 159 (behavior)
**File:** `flaim/web/components/chat/assistant.tsx`
**Current:** `activeLeague.platform === 'yahoo' ? 'Yahoo' : 'ESPN'`
**Verdict: P0 — Do now.**
This binary ternary forces all non-Yahoo platforms to map to `'ESPN'`. A Sleeper league would be labeled "ESPN" in the tools store. The fix is a simple map:

```typescript
const platform = activeLeague.platform === 'yahoo' ? 'Yahoo'
  : activeLeague.platform === 'sleeper' ? 'Sleeper'
  : 'ESPN';
```

Or even cleaner, a lookup: `const platformMap: Record<string, string> = { espn: 'ESPN', yahoo: 'Yahoo', sleeper: 'Sleeper' };`

This is downstream of Items 8 and 9 — once Sleeper leagues appear in the chat, this line will be hit.

---

### Item 12 — `web/app/api/espn/leagues/default/route.ts` line 4 (copy)
**File:** `flaim/web/app/api/espn/leagues/default/route.ts`
**Current:** `works for ESPN and Yahoo`
**Verdict: P1 — Do soon.**
The comment is stale (line 19 already types platform as `'espn' | 'yahoo' | 'sleeper'`). Pure comment fix. Bundle with other copy changes.

---

### Item 13 — `workers/fantasy-mcp/src/mcp/tools.ts` lines 914–915 (behavior)
**File:** `flaim/workers/fantasy-mcp/src/mcp/tools.ts`
**Current:** Enum is `['espn', 'yahoo']` but description says `"espn", "yahoo", "sleeper"`.
**Verdict: P0 — Do now. Fix the description, keep the enum as-is.**

Sleeper does NOT support free agents. This is explicitly documented in `docs/STATUS.md`: *"No `get_free_agents` — Sleeper does not expose a free agent endpoint in Phase 1."* The enum is correct to exclude `sleeper`. The description is what's wrong — it lists `sleeper` as a valid value when the schema would reject it.

**Recommended fix:**
- Keep enum as `.enum(['espn', 'yahoo'])`.
- Change the `.describe(...)` to: `'Fantasy platform — "espn" or "yahoo" (Sleeper does not support free agents)'`.

This makes the exception explicit to both human readers and AI clients parsing the tool schema. The current mismatch is particularly dangerous because AI models reading the description would try `platform: "sleeper"` for free agents and get a schema validation error.

---

### Item 14 — `web/README.md` line 63 (copy)
**File:** `flaim/web/README.md`
**Current:** `Manage ESPN leagues and seasons`
**Verdict: P1 — Do soon.**
Internal dev doc route table. Straightforward copy fix.

---

### Item 15 — `auth-worker/README.md` line 9 (copy)
**File:** `flaim/workers/auth-worker/README.md`
**Current:** `Credential Storage — ESPN cookies and league data...`
**Verdict: P1 — Do soon.**
Internal dev doc. The auth-worker handles ESPN cookies, Yahoo tokens, and Sleeper connections. The recommended replacement text from the audit is accurate.

---

### Item 16 — `flaim-eval/scenarios/wrong_platform.json` (test scenario)
**File:** `flaim-eval/scenarios/wrong_platform.json`
**Current:** Prompt asks for Sleeper roster; description says "only ESPN and Yahoo are supported."
**Verdict: P0 — Do now. This eval scenario is factually broken.**

Sleeper IS supported. If this scenario runs, the model would (correctly) attempt to use Sleeper tools, which would succeed — making this "negative" scenario produce a false positive. The scenario needs to use a genuinely unsupported platform.

**Recommended fix:**
```json
{
  "id": "wrong_platform",
  "prompt": "Show my CBS fantasy football roster",
  "description": "Negative — requests unsupported platform (CBS). Model should explain only ESPN, Yahoo, and Sleeper are supported.",
  "expected_tools": [],
  "tags": ["negative", "error-handling"]
}
```

CBS Sports is a real fantasy platform that Flaim doesn't support, making it a realistic and evergreen test case. Fantrax would also work.

**Important:** After changing this scenario, you MUST re-run the eval suite and verify the scenario still passes (model correctly explains CBS isn't supported). Update acceptance baselines accordingly.

---

### Item 17 — `flaim-eval/README.md` lines 50–51 (copy)
**File:** `flaim-eval/README.md`
**Current:** Artifact layout lists `espn-client.json` and `yahoo-client.json` but not `sleeper-client.json`.
**Verdict: P1 — Do soon.**
Documentation example. Add `sleeper-client.json` after `yahoo-client.json` in the artifact layout block.

---

### Item 18 — `flaim-eval/docs/TROUBLESHOOTING.md` lines 40–41 (copy)
**File:** `flaim-eval/docs/TROUBLESHOOTING.md`
**Current:** Only ESPN and Yahoo missing-worker guidance.
**Verdict: P1 — Do soon.**
Add a third bullet: `- If no tool call used \`platform: "sleeper"\`, missing \`sleeper-client\` is expected.` This parallels the existing ESPN/Yahoo bullets exactly.

---

### Item 19 — `flaim-marketing/strategy/REDDIT-STRATEGY.md` line 191 (copy)
**File:** `flaim-marketing/strategy/REDDIT-STRATEGY.md`
**Current:** `connects ESPN/Yahoo leagues...`
**Verdict: P1 — Do soon.**
Marketing copy template. Should say `ESPN, Yahoo, and Sleeper`. This is a template that gets posted publicly, so accuracy matters, but it's not urgent since it's a draft template, not a live post.

---

### Item 20 — `flaim-marketing/strategy/REDDIT-STRATEGY.md` line 258 (copy)
**File:** `flaim-marketing/strategy/REDDIT-STRATEGY.md`
**Current:** `Which platform (ESPN or Yahoo)?`
**Verdict: P1 — Do soon.**
Bug-report response template. Should say `ESPN, Yahoo, or Sleeper`. Same reasoning as Item 19.

---

### Item 21 — `flaim-marketing/outreach/THREADS-CONTENT-TEMPLATES.md` line 230 (copy)
**File:** `flaim-marketing/outreach/THREADS-CONTENT-TEMPLATES.md`
**Current:** `connecting your ESPN/Yahoo league`
**Verdict: P1 — Do soon.**
Threads post template. Should say `ESPN, Yahoo, or Sleeper`. Template accuracy matters for when posts are generated from it.

---

### Execution Summary

| Priority | Count | Items |
|---|---|---|
| **P0 — Do now** | 9 | 1, 2, 4, 6, 8, 9, 11, 13, 16 |
| **P1 — Do soon** | 11 | 3, 7, 10, 12, 14, 15, 17, 18, 19, 20, 21 |
| **P2 — Skip** | 1 | 5 |

### Recommended Execution Order

**Batch 1 (behavior changes — test together):**
1. Item 8 — Add `'sleeper'` to `ChatLeague.platform` type
2. Item 9 — Add Sleeper fetch to `useLeaguesStore.fetchLeagues`
3. Item 11 — Fix binary platform label in `assistant.tsx`
4. Item 10 — Add `'Sleeper'` to league-mapper `Platform` type
5. Smoke-test the chat UI with a Sleeper-connected account

**Batch 2 (MCP tool schema — redeploy worker):**
6. Item 13 — Fix `get_free_agents` description to match enum (no Sleeper)

**Batch 3 (eval — re-run suite):**
7. Item 16 — Replace `wrong_platform` scenario with CBS
8. Re-run `npm run eval` and `npm run accept`

**Batch 4 (copy — all repos, no behavior risk):**
9. Items 1, 2, 3, 4, 6, 7, 12, 14, 15 (flaim copy)
10. Items 17, 18 (flaim-eval copy)
11. Items 19, 20, 21 (flaim-marketing copy)

**Batch 5 (optional cleanup):**
12. Item 5 — Add post-migration note if desired (or skip entirely)
13. ERROR-CODES.md line 36 — Remove stale basketball/hockey "pending" note

### Additional Findings (Not in Original Audit)

1. **`docs/ERROR-CODES.md` line 36** — Says basketball/hockey ESPN/Yahoo support is "still pending." This shipped to production on 2026-02-13. Should be updated to: `Note: ESPN basketball and hockey mappings are deployed but unverified (no live league credentials for testing yet).`

2. **`web/app/layout.tsx` line 20** — The base `description` meta tag says `"Connect your AI assistant to ESPN fantasy sports"` which omits both Yahoo and Sleeper. Not captured in the audit. Should be updated to something like `"Connect your AI assistant to ESPN, Yahoo, and Sleeper fantasy sports leagues via MCP"`.

3. **`web/components/chat/assistant.tsx` lines 209–210** — The features list in the sign-in prompt says `"ESPN league integration"` only. Should say `"ESPN, Yahoo, and Sleeper league integration"` or just `"Fantasy league integration"` to be platform-agnostic.
