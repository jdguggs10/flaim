# Changelog (Condensed)

Follow Keep a Changelog; stamp a version when submitting to directories.

## [Unreleased]

### Yahoo and Sleeper Waiver Priority / FAAB Balance — Declared Schema and Tool Description (FLA-380, FLA-401)

- **Changed**: `get_standings` now declares `waiverPriority` and `faabBalance` in `standingsEntrySchema` and documents them in the tool description, including that the two are not mutually exclusive, that both are returned on Yahoo and Sleeper and absent (not `null`) on ESPN, that null can also mean the platform did not report a usable value rather than proving the league lacks FAAB or priority, that Sleeper's `faabBalance` already reflects FAAB traded between teams (so it can exceed the starting budget), and that `waiverPriority` is the team's live priority — distinct from `get_transactions`' `waiver_priority`, which is the priority a past claim used. The data itself shipped separately (Yahoo #287, Sleeper #294) as a passthrough-payload change with no contract impact; this entry is documentation only.
- **Fixed**: the same description said the `rank` sort position is computed by Flaim from win percentage on both ESPN and Sleeper. Only ESPN sorts that way (win percentage, then wins). Sleeper sorts by wins, with points for as the tie-breaker, so the two orders diverge whenever teams have played an unequal number of games or the league records ties. The description now states each platform's rule separately. Description text only — no sort behavior changed.
- **Fixed**: the same description defined `outcomeConfidence: 'derived'` as the value for a finish read off the final winners-bracket matchup, without saying which platforms use it. Only ESPN ever returns `'derived'`; Yahoo always returns `null`, and Sleeper returns `'explicit'` for any completed season whose winners bracket names a champion — including the case where the bracket carries no placement fields and the champion's rank is taken from the final matchup, which the old wording called `'derived'`. The description now says so. Description text only — no outcome logic changed.
- **Unchanged**: tool name, annotations, input schema, and behavior. Declared output schema is additive on a passthrough object. Shipped under the continuous-review lane; portal scan confirmation is recorded in the PR after deploy.

### get_transactions Description Matches Real Row Fields (FLA-374)

- **Fixed**: the `get_transactions` tool description claimed every normalized transaction includes a `date`. Since the pending-Yahoo fix, a Yahoo row that Yahoo has not stamped yet is returned without `date` and `timestamp` on `type=waiver` and `type=pending_trade` requests, and is left out and counted in `dropped_invalid_timestamp_count` on every other Yahoo request. The description now says so, states that ESPN and Sleeper rows always carry both fields, and notes that `week` is null on Yahoo rows and on Sleeper rows without one.
- **Fixed**: the description said Yahoo always uses a 14-day timestamp window. The `type=waiver` and `type=pending_trade` views return the user's own pending items with no timestamp window, and the description now says that too.
- **Unchanged**: tool name, annotations, input and output schemas, and behavior. Description text only, shipped under the continuous-review lane; portal scan confirmation is recorded in the PR.

### Yahoo H2H-Categories Matchup Detail (FLA-404)

- **Fixed**: Yahoo `get_matchups` reported only `team_points.total` on head-to-head **categories** leagues (`scoring_type: "head"`), where that number is the count of categories won. The model received it as a point total, with no per-category values, no winners, and no league-type flag — while the shipped `analyze-matchup` skill already promised a category record.
- **Added**: responses carry `scoringType` (`points`/`categories`/`roto`/`unknown`) and `scoringTypeRaw`. On a categories league each side also carries `categories[{statId,name,displayName,value,result,isDisplayOnly}]`, `categoryScore{wins,losses,ties}`, and `categoriesWon`, mirroring the existing ESPN baseball category shape.
- **Added**: a best-effort `/league/{key}/settings` fetch, sequential after the scoreboard and only on categories leagues, supplies category names; on failure categories keep their stat ids, `categoryNamesAvailable` is `false`, and a warning is attached. That settings path is now one shared helper, used by `get_league_info` too.
- **Added**: `matchupsUnavailableReason: "NOT_HEAD_TO_HEAD"` plus a warning when a roto or unrecognized scoring type returns an empty scoreboard, instead of a bare `matchups: []`.
- **Unchanged**: `points`, `projectedPoints`, and the live-points-derived `winner` are untouched on every league type. The gate is `scoring_type`, never the presence of `team_stats`, because a verified `headpoint` capture carries `team_stats` as well. `categoryScore` and per-category `result` come only from Yahoo's undocumented `stat_winners`; when it is absent they are `null`, never derived from the point total and never computed by comparing values.
- **Unchanged descriptor**: no tool name, annotation, or declared schema moved; every new field rides the existing passthrough objects. The description now notes that only some category leagues (Yahoo, and ESPN baseball) return per-category rows and a `categoryScore`, that where they do the side total is a category count or `null` rather than fantasy points, and that a `null` categoryScore/value/result means the provider didn't report it rather than a real zero — ESPN basketball, ESPN hockey, and Sleeper are unaffected and continue to emit neither field.
- **Not live-verified**: Yahoo API access is unavailable from the development environment (FLA-237) and no category-scoring league is reachable from the test identity, so fixtures are shaped from public Yahoo captures.

### ESPN Connector v1.6 Reliability and Setup Docs (FLA-403) - 2026-09-17

- **Fixed**: ESPN discovery now distinguishes a valid empty league list from authentication, rate-limit, timeout, network, malformed-response, and upstream failures. The extension route, website refresh, and scheduled reconciliation share that typed distinction, so a failed ESPN request can no longer appear successful by substituting previously saved leagues. Existing saved rows remain available separately and are not deleted by an empty result.
- **Improved**: Chrome extension 1.6.0 presents Flaim sign-in, ESPN detection, credential storage, and league discovery as separate states. It preserves safe retry details, keeps unavailable status unknown, gives specific recovery for ESPN authentication, cooldown, timeout, and zero-league outcomes, prevents late async results from an earlier account or setup run from replacing current state, and removes the cross-account global setup-state record while retaining account-scoped history status.
- **Added**: A dedicated `/docs/espn` page follows the existing Docs layout with same-Chrome-profile prerequisites, a five-step setup flow, account clarification, and state-specific troubleshooting. The Docs hub, platform docs, Your Leagues, setup email, and sitemap now route users to it, and Chrome Web Store links are labeled as store destinations instead of implying that a web button can open an installed popup.
- **Added**: After a league-confirmed sync, the extension may show one account-scoped, `Rate Flaim` invitation (decorative star icon, with the note "Flaim is free. A quick rating really helps.") after the primary `Your Leagues` action. It never asks for a star value, offers a reward, gates the link by sentiment, or treats a click as a submitted review.
- **Release gate**: The source and manifest are prepared as 1.6.0. Chrome Web Store packaging, checksum/provenance recording, upload, and submission remain separate reviewed steps; this changelog entry does not claim the store update is published.

### Fix Yahoo Market Ownership Rates in get_free_agents and get_players (FLA-9)

- **Fixed**: Yahoo `get_free_agents` and `get_players` never requested the rate they reported. Both built `league/{key}/players;...{filters}/ownership`, and Yahoo's `ownership` sub-resource carries league-level owner and waiver state only — the platform-wide rostered rate lives in a **sibling** `percent_owned` sub-resource that nothing in this repo asked for. Every `percentOwned`/`market_percent_owned` came back `null` in production on both sports, while the gateway envelope still advertised `capabilities.rosteredRate: true`. Both handlers now request `;out=ownership,percent_owned`; `ownership` is retained (rather than dropped in favor of `percent_owned` alone) to keep the request's behavior close to what it was before this fix, until live verification confirms `percent_owned` alone is sufficient.
- **Fixed**: with every rate `null`, `get_free_agents`' comparator fell through to its name tiebreak and re-ranked the whole list alphabetically, discarding the `sort=OR` overall-rank order Yahoo had already applied — a 25-player football response came back strictly A-to-Z. Rate-less entries now compare equal, so the stable sort leaves them in the provider's order; they still sort after rated entries, and the name/id tiebreak still applies between equal rates.
- **Fixed**: the extractor read `playerData[1].ownership.percent_owned`, a path that does not exist in Yahoo's payload, and the scalar parser accepted only a number or string. It now finds `percent_owned` by key at any sub-resource position and reads `value` out of Yahoo's array-of-single-key-objects form (`[{coverage_type}, {week|date}, {value}, {delta}]`), the flattened-object form, and the numeric-keyed container form. Only `value` is read, so football's `week` coverage and the daily sports' `date` coverage need no sport-specific code. A genuine `0` is preserved; a missing sub-resource or non-numeric value stays `null`.
- **Changed**: the gateway now derives `capabilities.rosteredRate` for Yahoo from the entries actually returned (true when at least one carries a finite rate) instead of asserting a per-platform constant, so a rate-less response can no longer tell clients to expect rates that are not there. ESPN and Sleeper keep their declared constants. Note the derivation is per response: a Yahoo response with zero entries reports `rosteredRate: false`, which is vacuous rather than wrong — there are no rows to quote a rate for.
- **Unchanged descriptor**: no tool name, description, annotation, or declared schema moved. `ordering` remains the declared two-value enum; in the degenerate case where Yahoo returns no rates at all, the response keeps the `platform_rostered_rate_desc` label over provider-ordered entries rather than introducing a third enum value. The primary fix should make that case rare, and `capabilities.rosteredRate: false` is what tells a client not to trust the rate ranking.
- **Tested**: the hand-built flat ownership fixtures are replaced with realistic Yahoo-shaped ones (array-of-single-key-objects, `ownership` and `percent_owned` as siblings, one `value` as a numeric string, one player with the sub-resource absent) across the free-agent and player-search suites, plus unit coverage for every accepted shape and a regression test that an all-`null` response preserves provider order and reports `rosteredRate: false` through the gateway normalizer.
- **Not live-verified**: Yahoo API access is unavailable from the development environment (OAuth), so the `;out=` request form is confirmed against Yahoo's `out` filter documentation and two independent production clients (uberfastman/yfpy, khaney64/yahoo-fantasy-baseball) rather than a live call from this worker. Production verification must observe non-null rates on both a football and a baseball league, a non-alphabetical list order, and `capabilities.rosteredRate: true`.

### Fix Yahoo Free-Agent Page-Size Cap in get_free_agents (FLA-9) - 2026-09-16

- **Fixed**: `get_free_agents` was hard-capped at 25 results no matter what `count` the caller passed, even though the MCP tool declares `count` 1-100. The handler requested `;count=100` per page and broke out of its pagination loop the moment a page came back shorter than that: `if (playersArray.length < YAHOO_PAGE_SIZE) break`. Yahoo's `players` collection silently clamps to 25 entries per response regardless of the requested `;count=` rather than erroring, so the very first page (25 < 100) always tripped that break — `start` never advanced past `0`, and nothing beyond the first 25 free agents was ever fetched. Verified in production tonight: `count: 40` against a pre-draft league with hundreds of available players returned exactly 25 entries and `truncated: null`, for two different positions.
- **Changed**: pagination no longer assumes any particular page size. The requested `;count=` is still `25` (renamed `YAHOO_PLAYERS_PAGE_SIZE`, matching Yahoo's real per-response cap, with a comment that the loop does not depend on Yahoo honoring it), but the loop now advances `start` by the number of entries a page actually returned and only stops on a genuinely empty page or once enough entries have been collected to satisfy `limit` — never merely because a page came back shorter than requested. A bounded page-count safety net (20 pages — 5x the 4 pages `limit`'s 100-entry max needs at a true 25/page) still applies, returning whatever was collected instead of looping forever if an upstream response misbehaves.
- **Cost note**: requesting more than 25 free agents now costs one additional Yahoo round trip per 25 entries — `count: 60` issues three upstream requests. The common `count <= 25` path, including the default, still costs exactly one.
- **Fixed**: Yahoo's `start`/`count` paging is not guaranteed stable across requests — if a player's availability changes between page fetches, pages can overlap and return the same player twice. Entries are now deduplicated by `playerKey` (falling back to `playerId`) as pages are collected, before the `limit` check, so a duplicate no longer consumes a caller's `count` slot and pushes out a unique player.
- **Fixed**: `leagueKey`/`leagueName` were reassigned from every page's response, including the terminal one; a genuinely empty terminal page can omit league metadata entirely, which previously came back as `undefined` even though players were collected. They are now captured from the first page that provides them and are no longer overwritten by a later page.
- **Unchanged**: `get_players` (already honestly capped at 25, unaffected by this bug), the `compareFreeAgents` sort, and the `;out=` sub-resources are untouched — this only fixes how many pages get fetched, and now dedupes and preserves league metadata across those pages.
- **Tested**: pagination coverage now includes `count: 60` against fake full 25-entry pages (three requests, `start` advancing 0 -> 25 -> 50), the default and other `count <= 25` values costing exactly one request, a short-but-non-empty page **not** ending the loop (the actual regression), the page-count safety bound tripping instead of looping forever against a fake that never returns an empty page, sorting holding across a page boundary, a duplicated player across overlapping pages collapsing to one entry without consuming a `limit` slot, and `leagueKey`/`leagueName` surviving a terminal empty page that omits them.

### Release Lanes for OpenAI Continuous Review (FLA-226) - 2026-09-16

- **Changed**: Release Lanes rewritten for OpenAI's continuous review model: tool-level metadata (names, descriptions, annotations, schemas, `_meta`, CSP, server instructions) ships by deploy-then-confirm; only skill text, portal listing fields, and (until observed passing a scan) adding a tool need a reviewed version. Test pins on tool count, annotations, widget `_meta`, and discovery bodies are kept as drift detectors.

### Rankable ESPN Free-Agent Scoring and a get_free_agents Size Guard (FLA-132)

- **Changed**: ESPN `get_free_agents` entries now carry `seasonPoints`, `pointsPerGame`, and `projectedSeasonPoints`, read from ESPN's `appliedTotal`/`appliedAverage` on the season split, which is pinned explicitly rather than taken by list position and rounded to two decimals so ESPN's raw float noise does not reach callers. All four ESPN sports gain the scalars; Yahoo and Sleeper handlers are unchanged. Each field is `null` when ESPN reports no usable value — a legitimate `0` is preserved.
- **Changed**: ESPN **football** free-agent entries no longer carry the raw per-stat dictionary. It was the wrong data three ways: it held no fantasy-points scalar at all, so the only rankable numbers on an entry were `percentOwned` and `percentStarted`; it dropped projections by filtering to `statSourceId === 0`; and because nothing filtered `statSplitTypeId`, it returned whichever split ESPN happened to list first, so a request could get season totals or a single week with no way to tell which. Baseball, basketball, and hockey keep the `stats` dictionary and gain the scalars on top of it. The dictionary they keep is now read from the same pinned actual-season split the scalars use, so it is deterministic instead of "whichever entry ESPN listed first".
- **Known limitation**: the three scalars are `null` in any league ESPN does not score in points. ESPN only computes `appliedTotal`/`appliedAverage` for points leagues, so category and rotisserie leagues — the norm in baseball, common in basketball and hockey — report nothing there. That is exactly why the raw dictionary stays on those three sports for now: removing it would leave them with no free-agent performance data at all. Replacing it with a league-scoring-aware, bounded set of category stats is follow-up work, not part of this change.
- **Added**: `get_free_agents` now bounds its serialized tool result on every platform. Over the limit it drops trailing entries, sets `count` to the number returned, and adds `truncated: true`; it does not error the way `get_matchups` player detail does, because every platform's list arrives already ordered (ESPN sorts provider-side by rostered rate with a draft-rank tiebreak, Yahoo re-sorts locally, Sleeper is alphabetical), so the dropped tail is the end of that order: lowest platform-wide rostered rate on ESPN and Yahoo, last alphabetically on Sleeper. The limit is a ceiling for anomalies, not a routine trimmer: a measured 100-player ESPN **football** response is ~105 KB typical and ~152 KB with maximally verbose entries, against a 200,000-byte limit. The same football payload before this change measured ~370 KB. That drop is football-specific: baseball, basketball, and hockey keep their per-stat dictionary, so their responses are not trimmed by this change and lean on the size guard instead.
- **Unchanged descriptor**: no tool description, annotation, or declared schema moved. `count` keeps its 1–100 range and its default of 25. `freeAgentEntrySchema` never declared `stats`, and both the new scalars and `truncated` ride the existing passthrough objects, so nothing was added to the declared output schema. The payload itself is not fully unchanged, though: ESPN football entries stop carrying `stats` on the wire, which is a passthrough-field removal rather than a descriptor change.
- **Tested**: the ESPN free-agent handlers had no test coverage at all before this. Split selection is now covered against a fixture carrying both split types and both stat sources in an order that would defeat the previous lookup, and the guard is covered for truncation, prefix preservation, `count`/`truncated`, and error passthrough on all three platforms.

### Fix Yahoo IDP Position Filter for Free Agents and Player Search

- **Fixed**: Yahoo football `get_free_agents` and `get_players` silently dropped the position filter for individual defensive player (IDP) positions (`D`, `DL`, `DE`, `DT`, `LB`, `DB`, `CB`, `S`) in leagues with defensive roster slots enabled, returning unfiltered top-owned (offensive) players instead of the requested defensive position or an error. `get_roster` already surfaced these positions correctly since it passes through Yahoo's `display_position` unmapped; the two search paths went through a separate `FA_POSITION_FILTER` allow-list in `workers/yahoo-client/src/sports/football/mappings.ts` that had no IDP entries, so `getPositionFilter` fell back to its "no filter" default for any unrecognized position. Found during support triage; caught only in IDP leagues, which are a minority of Yahoo leagues.

### Plunk Marketing Contact Sync (FLA-289)

- **Added**: Verified Clerk `user.created` events can now queue a default-off, non-blocking Plunk marketing-contact sync. It uses Plunk's public `/v1/track` endpoint without a `subscribed` field, which atomically creates a new contact subscribed while retaining an existing contact's current state, so webhook replays and identity enrichment cannot reactivate a Plunk opt-out.
- **Added**: A dry-run-first, resumable migration command builds the audience from the union of current Clerk users, the Resend all-status export, and live Resend suppressions. This explicitly includes post-cutover Clerk-only signups and retained Resend-only contacts; Resend unsubscribe/suppression and existing false Plunk state always win, false contacts are applied first, and the state file stores only hashes.
- **Hardened**: Plunk failures use the redacted structured email-operations log and a distinct Clerk retry marker. The welcome send remains independent, `user.updated` stays off the Plunk path, and no API key or production flag is added by the code change.
- **Documented**: Current provider ownership is now explicit: Fastmail receives human mail, Clerk owns authentication, Resend retains transactional product email, and Plunk owns marketing contacts and Broadcasts. The public privacy disclosure and operator Broadcast workflow reflect that split while Resend remains a temporary rollback lane.

### Repo-first Plunk Broadcast Preparation (FLA-289)

- **Added**: Broadcast campaigns can now be defined as a typed local manifest paired with their React Email template. The local Plunk-preparation command renders provider-safe HTML and plain text, injects Plunk's per-recipient unsubscribe token only at export time, and writes a reviewed campaign metadata file. It has no Plunk credential, API, draft, schedule, proof, or send capability.
- **Hardened**: Preparation fails closed if a Resend unsubscribe token survives, a visible Plunk unsubscribe link is absent from either HTML or plain text, a Flaim-owned domain link is non-HTTPS or loses the manifest's `ref`, or a declared Flaim CTA is removed. New Plunk source-template previews use the reserved fail-obvious `unsubscribe.invalid` URL, while archived Resend templates retain their historical rollback token.
- **Added**: Every campaign artifact now exposes a typed release gate. The repo now contains the post-approval-only Flaim 3.0 ChatGPT launch draft, initially pending OpenAI app approval. It covers completed draft results, original-selection versus current pick ownership for traded Sleeper picks, and richer ESPN football matchup context while preserving Flaim's read-only promise. It cannot be proofed or sent until portal approval evidence clears its gate.

### Direct Transactional Welcome Mode (FLA-273)

- **Added**: One mutually exclusive `FLAIM_WELCOME_DELIVERY_MODE` now selects the hosted Resend automation, a direct transactional Resend send, or disabled delivery. Leaving it unset preserves the legacy `RESEND_WELCOME_AUTOMATION_ENABLED` behavior, while invalid explicit values fail closed. Direct mode uses a stable `welcome/<clerk-user-id>` idempotency key and the existing structured failure/retry-marker path, so one signup cannot intentionally select both delivery lanes.
- **Changed**: The direct welcome omits the marketing unsubscribe link and creates no Resend Audience contact. The hosted automation still renders the same React Email template with its recipient-specific Resend unsubscribe token for rollback.
- **Hardened**: Direct mode blocks the legacy `user.updated` Resend contact repair even if its old flag is accidentally enabled. Resend contact backfill, quota-event recovery, and hosted-automation setup write paths also fail closed in direct mode so an old command cannot restart marketing-contact growth after cutover.

### Yahoo Weekly Player Points in get_roster

- **Added**: Yahoo football `get_roster` requests now append the week-scoped player stats sub-resource and emit an additive `points` per player, a response-level `pointsCoverage`, and `limitations.playerPointsAvailable: false` when nothing usable came back. This supersedes the earlier attempt (#298), reverted the same day because it parsed the wrong `player_points` JSON shape (coverage metadata is nested under a numeric `"0"` key, sibling to a string `total`, not flat on the object) and, for current rosters, built a URL ending in `/players/stats;type=week` with no week selector at all — Yahoo rejects that with a 400, breaking every current-week Yahoo football roster in production. The corrected selectors are `/team/{team_key}/roster;week={N}/players/stats` for a week snapshot and `/team/{team_key}/roster;week=current/players/stats` for the current roster (no `;type=`, no second `;week=`) — verified against yfpy's `get_team_roster_player_stats_by_week` and a real captured NFL response.
- **Added**: A fallback safety net around the stats-augmented request: if it comes back non-ok, this worker logs one line and retries with the plain legacy roster URL rather than failing the whole roster read, continuing without points and `limitations.playerPointsAvailable: false`. The legacy URL's own failure still surfaces the normal Yahoo error response.
- **Unchanged gate**: a week snapshot requires Yahoo's echoed `coverage.type === 'week'` and `coverage.week` to exactly match the requested week; a current snapshot resolves one positive-integer week from the first usable player and drops any player whose echoed week differs. `0.00` totals are preserved as `0`, never omitted.
- Additive passthrough only — no MCP output schema or skill text change; existing fixtures without stats continue to pass unchanged.
- The new `roster-points-fixture.ts` fixture is shaped from a real Yahoo NFL roster+stats response (format=json) captured by a third-party client, not a live call from this worker — Yahoo API access has been unavailable here since 2026-07-27 (FLA-237).

### Permanent Signup Log Capture (FLA-396)

- **Added**: The verified Clerk webhook now writes one row per signup to a permanent Supabase log before it does anything else. For both `user.created` and `user.updated` the route maps the snake_case payload, validates `created_at` as an integer millisecond epoch inside a sane range, normalizes and bounds the client-supplied first-touch attribution from `unsafe_metadata`, and awaits a single `record_signup` RPC. The write sits above the welcome-email feature flag, so turning welcome email off no longer turns signup capture off, and it is awaited rather than deferred to `after()`, which is best-effort and cancelled on timeout. A mapping or write failure returns `500` and schedules no `after()` work at all, so Svix retries the delivery and the retry cannot double-send a welcome email. The Supabase request is key-class aware: a new-style `sb_secret_` key is sent as `apikey` only, a legacy JWT service key in both `apikey` and `Authorization`. `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are now required for the Clerk webhook in production.
- **Added**: `web/scripts/probe-supabase-key-class.mjs`, a non-secret pre-deploy probe that prints only which class of Supabase service key an environment holds and never any character of the value.

### Custom Client Docs and Relay Label

- **Changed**: OAuth connections authorized through the allowlisted user-hosted relay callback (`https://flaim-relay.onrender.com/oauth/callback`) are now labeled `Tasklet Relay` instead of the generic `MCP Client`, matching how Littlebird's exact callback is labeled. Only the exact callback gets the label; other Render hosts still fall back to `MCP Client`. Existing connection rows are not backfilled.
- **Fixed**: `docs/CONNECTOR-DOCS.md` said only a pinned loopback callback path worked. It now describes the actual rule: plain `http://` on `localhost`, `127.0.0.1`, or `[::1]`, any port and path, no query string or fragment. It also notes that Cloudflare can return `403` with `error code: 1010` to default HTTP-library user agents, and lists `support@flaim.app` as the support contact to match the site.

### Sleeper Waiver Priority / FAAB Balance in Standings (FLA-401)

- **Added**: Sleeper `get_standings` team entries now carry `waiverPriority` (from the roster's `waiver_position`, 1 = first) and `faabBalance` (the league's `waiver_budget` minus the roster's `waiver_budget_used`), with the same names and meaning as Yahoo's (FLA-380). Both inputs were already in the league and rosters responses the handler fetches, so there's no new Sleeper API call. `faabBalance` is `null` unless the league's `waiver_type` is FAAB (`2`): Sleeper sends a default `waiver_budget` of 100 even for rolling-waiver leagues, so the budget being present doesn't mean the league uses FAAB. `waiverPriority` is reported in FAAB leagues too, where it acts as the tie-breaker. `waiver_budget_used` is Sleeper's own running total and already includes FAAB traded between teams and commissioner adjustments (checked read-only against completed public leagues), so no extra transaction lookup is needed. A team that received budget in a trade can show more than the starting amount. No output schema change: `standingsEntrySchema` is a passthrough object. The declared schema and tool-description wording ship with the held FLA-380 contract change. Reported via support@flaim.app.

### Post-prune Analytics Hygiene (FLA-388)

- **Changed**: The nightly UTC analytics rollup now recomputes the trailing seven completed days instead of only yesterday. Its date bounds are explicitly UTC, and the bounded replay repairs short missed or incomplete runs before raw-event pruning without touching the open day.
- **Changed**: The history-backed dashboard payload now fails closed after 60 days without a successful ET-history close, leaving roughly 30 days to recover from retained raw events before the 90-day pruning boundary. The existing Pi monitor continues to provide the immediate daily failure alert.

### Dashboard Snapshot Query Cost (FLA-378)

- **Changed**: The history-backed dashboard payload now converts the last closed Eastern day to its exact next-midnight UTC instant before filtering raw events. This lets the existing `mcp_tool_events(ts)` index read only the still-open portion of history instead of scanning and sorting the full retained event table every five minutes. America/New_York daylight-saving boundaries remain exact.
- **Changed**: User concentration now calculates every user's call-weighted client mode in one grouped pass and joins it to per-user totals. The previous correlated subquery reread the complete materialized history once per user; on the measured production shape, that section alone took 36.8 seconds and read roughly 1.56 million temporary blocks. The replacement preserves the same NULL handling and call-count-then-lexical tie-break without changing any payload field, source, window, cadence, grant, or retention policy.
- **Changed**: The reviewed production schedule now refreshes the human dashboard every fifteen minutes instead of every five, reducing its daily executions by two thirds after the query-cost fix. `provider-flags-snapshot` remains independent at five minutes, so provider-health alert freshness is unchanged; the tradeoff is that human dashboard activity can be up to fifteen minutes behind.

### Sleeper Player Search League Availability (FLA-382)

- **Added**: Sleeper's `get_players` now resolves each matched player against that league's current rosters and adds four additive fields: `league_status` (`"ROSTERED"` | `"FREE_AGENT"` | `null`) and `league_team_id` / `league_team_name` / `league_owner_name` (populated when rostered, `null` when a free agent or when ownership is unresolvable). Previously `get_players` could only return player identity — it had no way to answer "who owns Player X in my league?" or "is Player X available?". `league_id` is now required for `get_players`; a request without it returns `MISSING_PARAM`. Sleeper's existing market-ownership fields (`market_percent_owned: null`, `ownership_scope: "unavailable"`) are untouched — league availability (this-league-only) and market ownership (cross-league popularity, which Sleeper doesn't expose) are deliberately kept separate.
- **Fixed**: `get_players`' underlying player search had no deterministic ordering and depended on player-index `Map` iteration order. It now sorts an exact full-name match first, then alphabetically, then by `player_id` as a final tiebreak, so a query's best match reliably survives the result-count cap.
- **Fixed (cross-model audit)**: During an active Sleeper draft, rosters exist but their `players` lists stay empty until the draft completes — in-progress picks live only on `/draft/{draft_id}/picks` — so `get_players` was reporting a player drafted moments ago as `FREE_AGENT`, the exact false-negative this feature must never produce. `get_players` now also fetches the league's status and fails the whole call with `SLEEPER_DRAFT_IN_PROGRESS` while a draft is actively `"drafting"`, pointing the caller at `get_draft` for selections made so far. `pre_draft`, `in_season`, `complete`, and any unrecognized future status are all deliberately unaffected — only an exact `"drafting"` match trips the guard, since a genuinely pre-draft league has nobody drafted yet (aside from keepers, which already resolve correctly) and failing the tool for an unknown status would be worse than the problem. Merging in-progress picks into ownership is out of scope here (tracked as FLA-385).
- **Fixed (cross-model audit)**: Two malformed-but-200 roster shapes previously failed open — `players` sent as a string instead of an array (iterated character-by-character, so the real id never entered the ownership map) and a rosters array of non-roster objects (passed the existing length guard and yielded an empty map) both silently reported every matched player as `FREE_AGENT`. Each roster entry is now validated (object, numeric `roster_id`, `players` absent/null or an array); a malformed entry fails the whole call rather than being skipped, since a silently skipped roster's players would themselves resolve as available.
- **Fixed (cross-model audit)**: A player id appearing on two different rosters in the same response (inconsistent upstream data, e.g. a trade mid-processing) previously resolved to whichever roster was encountered first — a guess that wasn't stable across calls and reported a specific owner with false confidence. It now resolves as `league_status: null` with every team/owner field `null`; `null` is contract-legal (`league_status` is documented as `ROSTERED`, `FREE_AGENT`, or `null` when unavailable) and routes the caller to `get_roster` for verification.
- **Fixed**: `get_players` failed the entire call — no player identity, not even the cache-only lookup that previously always succeeded — whenever league ownership couldn't be resolved for any reason: a network/HTTP failure on the league, rosters, or users fetch, a malformed response body, an unreadable league status, or a malformed roster entry. Sleeper was the outlier here; ESPN's and Yahoo's equivalent ownership builders already catch these failures, log a warning, and return `null` so the caller still gets full player identity. `get_players` now matches that behavior: on any ownership-load failure other than an active draft, the call still succeeds with full player identity and every matched player's `league_status`/`league_team_id`/`league_team_name`/`league_owner_name` as `null`, plus a top-level `SLEEPER_OWNERSHIP_UNAVAILABLE` warning — `null` was already documented as "ownership unresolved, fall back to `get_roster`," so degrading to it makes no claim that could be wrong. The one deliberate exception is an active draft: `SLEEPER_DRAFT_IN_PROGRESS` is rethrown unchanged and still fails the whole call, because during a live draft rosters are structurally incomplete rather than merely unreachable, and the `null`-then-`get_roster` fallback doesn't help either since rosters are equally incomplete during a draft — a specific, actionable error pointing at `get_draft` remains more useful than a silent null there.

### Yahoo Waiver Priority / FAAB Balance in Standings (FLA-380)

- **Added**: Yahoo `get_standings` team entries now carry `waiverPriority` (the team's current waiver-claim priority, 1 = first) and `faabBalance` (remaining free-agent budget). Yahoo's `/league/{id}/standings` response already included both on the team object — `unwrapTeam()` merges all team metadata generically — but the handler wasn't selecting them into the mapped result. Either can be `null` and they are not mutually exclusive: a FAAB league may still report `waiverPriority` as its tie-breaker. `waiverPriority` is a 1-based ordinal, so a `0` or placeholder from Yahoo reads as `null` rather than a priority ahead of first — it now shares `parsePositiveOrdinal` with `playoffSeed`; `faabBalance` is a quantity, so its `0` (spent out) is preserved. No output schema change: `standingsEntrySchema` is a passthrough object, so the fields validate as-is. The declared schema and tool-description documentation for these fields ship separately with the next contract release. Reported via support@flaim.app.

### Yahoo Trade Details

- **Fixed**: Yahoo `get_transactions` reported pending trades as `status: "unknown"` with no players. Yahoo's `proposed` and `accepted` trade statuses weren't recognized, and trade players are marked `trade`/`pending_trade` with source and destination team keys rather than `add`/`drop`, so the normalizer skipped them. Pending trades now report `status: "pending"`, and pending and completed Yahoo trades fill `trade_sides` with each team's acquired and given-up players. No output schema change: `trade_sides` was already declared.

### DMARC Aggregate Reporting

- **Changed**: `postmaster@flaim.app` was removed from the `_dmarc.flaim.app` `rua` tag, leaving Cloudflare DMARC Management as the only report destination. The Fastmail move gave that alias a real mailbox for the first time, so roughly a dozen aggregate report emails a day began arriving in the support inbox. Policy, alignment, and coverage are unchanged at `p=quarantine; adkim=r; aspf=r; pct=100`.
- **Changed**: `docs/EMAILS.md` now records where DMARC reports are read, which domains the root policy actually governs and why the bounce subdomains are not among them, and the validation criterion for any future move to `p=reject`.

### Support Inbox Provider

- **Changed**: `docs/EMAILS.md` now lists Fastmail as the provider for real inboxes, aliases, and replies at `support@flaim.app`, replacing Zoho. Addresses, Clerk, and Resend sending are unchanged.

### Pending Yahoo Trades Dropped for Missing Timestamp

- **Fixed**: `get_transactions` was excluding pending Yahoo trades/waivers entirely whenever Yahoo hadn't yet stamped them with a timestamp, reporting them only as `dropped_invalid_timestamp_count` with no way to see the pending item itself. Yahoo doesn't assign a transaction timestamp until it resolves, so a genuinely still-pending trade legitimately has none — and the 14-day cutoff filter that timestamp validity exists for was never applied to the pending path anyway. Pending rows are no longer dropped for this reason; their `timestamp`/`date` fields are simply omitted (both already optional in the tool's output schema) instead of showing a misleading `0`/`1970-01-01`. Found via a user support report of a pending trade Flaim couldn't see.

### Email Readability

- **Changed**: Shared email cards use 20px top padding and darker callout text across welcome, ESPN setup-link, and broadcast templates.
- **Added**: September football update and Yahoo restoration Broadcast templates with concise update bullets and a closing Yahoo status box.

### Empty-String Error Code Fallback Fix (Yahoo logging)

- **Fixed**: The `code=${error.code ?? 'unknown'}` pattern FLA-363/FLA-368 introduced across `yahoo-storage.ts` (and its `yahoo-support-diagnostics.ts` equivalent) silently lost signal on the single most common failure class. `@supabase/postgrest-js` sets `code: ''` (an empty string, not `undefined`) for client-side fetch/parse failures, so `??` let it through and produced a bare `code=` with nothing after it. Found during FLA-370's cross-model audit. Switched to `||`, which correctly falls back to `'unknown'` for both the missing and empty-string cases. No behavior change beyond the log line itself; a new test pins the empty-string case specifically (not just the missing-`code` case the existing tests already covered).

### Loopback OAuth Redirect Path Acceptance (FLA-369)

- **Fixed**: MCP OAuth loopback redirect URIs (`http://127.0.0.1:<port>/...`, `http://localhost:<port>/...`) are now accepted with any callback path, not just a hardcoded allowlist (`/callback`, `/oauth/callback`, `/oauth2callback`, `/windsurf-auth-callback`, `/`). Msty Studio (and any future desktop MCP client) was rejected with `invalid_redirect_uri` at DCR because its path wasn't on that list, even though its loopback host and dynamic port were already accepted per RFC 8252. The path allowlist didn't add real security — DCR already lets any client self-register any `redirect_uri`; the actual boundary is loopback-only reachability plus PKCE — so this closes the whole bug class instead of adding one more path.
- **Added**: IPv6 loopback (`http://[::1]:<port>/...`) is now also accepted alongside `127.0.0.1` and `localhost`.

### Retention Weekly Tracking Start (FLA-361)

- **Fixed**: `retention_weekly.week_partial_start` in the analytics dashboard payload now compares against the authoritative day tracking began, not a minimum over the ET-day rows that happen to exist. A covered day with zero calls at the very start of tracking is invisible to a row-presence minimum, so a fully covered first week could be reported as partial. This is the same fix, for the same reason, that FLA-357 applied to `mau_30d_partial` — the one other place the payload discloses left-truncation.
- **Fixed**: `retention_weekly`'s week series now starts at the week containing that same authoritative tracking-start day. It previously started at the week of the earliest ET-day row, so a first calendar week of tracking with zero calls on every day in it was dropped from the response entirely rather than returned as a zero-querier week flagged partial — the same root cause, losing a row instead of mis-flagging one.
- **Added**: The analytics history proof gains a fixture where tracking starts mid-week and the whole first calendar week is empty, asserting that week is the earliest one emitted, that it is flagged partial, and that the first week actually holding rows is not. Both fixes are currently inert: the authoritative start day and the earliest row's day resolve to the same date in production, so no emitted row or flag changes. Payload shape, keys, windows, and sources are unchanged.

### Temporary Yahoo Recovery Route Removal (FLA-355)

- **Removed**: The temporary `POST /internal/backfill/yahoo-recovery` route and its `yahoo-targeted-recovery.ts` module. It repaired an exact 59-account cohort left with zero synced leagues by an earlier Yahoo discovery bug and self-expired on 2026-09-09T12:00 UTC (every call had been returning 410 since); this removes the now-dead code rather than leaving it live. No behavior change — the route was already inert.

### Archive Storage Logging Redaction (FLA-370)

- **Fixed**: The five `archive-storage.ts` sites that handed a raw Supabase/PostgREST driver error to `console.error` now log the closed-set error `code` plus a masked user id, the same substitute FLA-363/FLA-368 established. This table is the higher-severity case those two flagged but did not cover: `archived_leagues` stores `league_name` alongside `recurring_league_id`, so the archive UPSERT had three separate channels quoting customer data back — a `23505` naming the `(clerk_user_id, platform, sport, recurring_league_id)` key tuple, a `23514` whose DETAIL is `Failing row contains (...)` including the league name, and the account-deletion trigger raising `account <clerk_user_id> was deleted`. The unarchive DELETE and the two read paths have no written payload, but their filter values reach PostgREST's grammar unescaped, so a `PGRST100` echoes the offending `recurring_league_id` or unmasked `clerk_user_id`; the `select('*')` read additionally surfaces a `JSON.parse` `SyntaxError` quoting a prefix of its own response body, which is the caller's league-name rows.
- **Fixed**: `getArchivedMap` throws a static `Failed to get archived map` instead of interpolating the raw Postgres `.message`. This was the root cause behind the transitive leak FLA-368 patched defensively downstream in `yahoo-connect-handlers.ts` — the throw propagates to fail-open callers that log the caught error, so the payload traveled across files. Verified nothing pattern-matches beyond the message prefix before making it static.
- **Fixed**: The three method-level catch-alls narrow to the error name. Traced: `postgrest-js` resolves network, HTTP, and response-parse failures into the returned `error` object rather than throwing, so no driver object can reach them — they are defensive guards against a generic JS throw, and are narrowed on that basis rather than the `code=` basis.
- **Preserved**: No response, status code, or behavior change — log content only, plus the throw-text change called out above.
- **Added**: Tests pinning each redacted site, asserting both that the closed-set substitute is present and that the specific sentinel `league_name`/`recurring_league_id`/user id that used to leak is absent.

### Yahoo Connect/Storage Logging Redaction (FLA-368)

- **Fixed**: Eleven Yahoo auth-worker call paths no longer pass a raw Postgres/PostgREST driver error, a raw JS error, or a raw customer `league_key` to `console.*`, where it reaches Cloudflare Logs. Four of them — the credential upsert, the credential update, the credential recovery RPC, and the refresh-lease acquire RPC — ran statements carrying a customer's Yahoo access or refresh token as a written column or an RPC argument, and a Postgres error quotes the offending value; they now log the closed-set error `code` plus a masked user id, the same substitute FLA-363 established. The OAuth-state insert did the same with an unmasked `clerk_user_id` and the state nonce. Two discovery paths interpolated a customer `league_key` directly, one of them twice — the recurring-grouping fallback now logs a closed reason set (`no_meta`, `unresolved_chain`, `cycle`, `depth_cap`) and no key at all. Three catch-alls (discovery, read-only discovery, and the league-response parser) surfaced a `JSON.parse` `SyntaxError` whose message quotes a prefix of Yahoo's raw response body; they now log the error name only. The parser site directly contradicted the comment one line above it, which is the reason its `thrownErrorName` field exists.
- **Fixed**: `persistYahooRecurringRoot` throws a static message instead of embedding the raw Postgres error message, making it the last non-static throw in `yahoo-storage.ts` to be closed; the status handler additionally narrows its catch-all to the error name, so an upstream non-static throw cannot leak through it either.
- **Preserved**: No response, status code, or behavior change anywhere — log content only. The discovery 5xx raw-body log added by FLA-338 is deliberately kept: it is the only thing that makes a deterministic upstream Yahoo failure diagnosable, and it is bounded and pinned by test. The structured refresh diagnostics have their own sanitizer and are unchanged.
- **Added**: Tests pinning each redacted site — every one asserts both that the closed-set substitute is present and that the specific raw value that used to leak is absent.

### Yahoo Shared Logging Redaction (FLA-363)

- **Fixed**: Three log lines shared by every normal Yahoo refresh/discovery request, and by the FLA-360 support tool's `diagnose`/`refresh` actions, no longer carry free-form upstream text or a raw driver error object. Found during the FLA-360 cross-model audit. Token-refresh failures log the existing closed-set `diagnosticClass` instead of Yahoo's raw `error_description`; a discovery `access_denied` 403 logs only the boolean app-level-denial classification instead of up to 500 raw characters of Yahoo's response body; a league-upsert failure logs the Postgres/PostgREST error `code` only, never the raw driver error object (whose `message`/`details` can name the conflicting `league_key` on a unique-violation). No response or behavior change — log content only.

### ESPN Connection Timestamps (FLA-359)

- **Added**: `public.espn_credentials` gains `created_at timestamptz not null default now()`, the creation timestamp `yahoo_credentials` and `sleeper_connections` already had. ESPN previously recorded only `updated_at`, which every credential re-sync moves, so nothing said when an ESPN connection was first established.
- **Fixed**: Replacing a user's ESPN leagues no longer resets `espn_leagues.created_at` for leagues that survive the replace. The endpoint deletes and re-inserts every row, so an edit to one league restamped all of them as new; the replace now reads each league's existing timestamp first and writes it back, and stamps the current time only on leagues that are genuinely new. A failure to read those timestamps aborts before the delete rather than destroying values it could not capture.
- **Added**: `POST`/`PUT /leagues` now type-checks each supplied league and returns `400` naming the offending index when `leagueId` or `sport` is not a non-empty string, or `seasonYear` is present and not an integer. The body was previously cast without validation, so a `seasonYear` sent as the string `"2026"` built an identity key that could not match the integer the column reads back — the surviving league looked new and its `created_at` was reset anyway. Malformed requests are rejected rather than coerced, and are rejected before the mutation lease is taken.
- **Fixed**: A league row whose `created_at` is NULL now survives a replace with its NULL intact. The pre-read skipped such rows, so an existing league was treated as new and stamped with the current time — the same corruption, reached from the other side. Presence in the map, not truthiness of the value, now decides whether a league already existed.
- **Preserved**: Yahoo and Sleeper are untouched — their league writers already upsert on real column constraints and never delete a surviving row. Normal ESPN discovery was also already correct: it goes through the fenced `persist_espn_league_with_lease` RPC, which updates in place.
- **Limited**: No backfill. Rows that exist when the migration runs carry the migration's own run time, not their true creation time, and nothing in the database records the real value; treat them as censored at that timestamp rather than as connections made that day.

### Yahoo Discovery Drop Logging (FLA-365)

- **Added**: The normal persisted Yahoo discovery path and the read-only reconciliation path now emit one structured warning log (`yahoo_discovery_drop`) whenever a discovery response may have had real league data silently dropped — an unrecognized sport code, a declared-zero-but-populated level, or a parse exception. Previously this was only visible via the FLA-360 support tool's `diagnose` action, and only when an operator went looking for a specific account. Counts and Yahoo-global sport codes only; never a league key, league name, team name, or customer identifier.
- **Added**: A regression test locking in that an account with a CFB league alongside a supported-sport league still syncs the supported league — the parser drops an unrecognized sport code per-game, never account-wide. No behavior changed; this guards against a future refactor turning that per-game skip into a whole-account failure.
- **Added**: Auth-worker README documents that Yahoo's `game_types=full` discovery filter is not scoped to Flaim's four supported sports. Yahoo Fantasy College Football (`cfb`) is a confirmed source of unsupported-sport-code drops in production; the legacy `pnfl`/`pmlb`/`pnba`/`pnhl` "Plus" codes (pre-2010 football/baseball) are noted as an unconfirmed historical edge case.

### Cursor Web/Cloud Agents OAuth Callback (FLA-367)

- **Fixed**: Accept Cursor's fixed web and Cloud/Background Agents OAuth callback, `https://www.cursor.com/agents/mcp/oauth/callback`, for registration and authorization. Prompted by a support report that tools listed (11 discovered) but every authenticated call failed with `invalid_redirect_uri`. Cursor's separate desktop-IDE `cursor://` callback was already accepted and is unchanged.

### Supported Sports FAQ (FLA-365)

- **Added**: A "Does Flaim support college sports or other fantasy formats?" entry on the `/docs/sports` FAQ, stating plainly that Flaim currently supports NFL, MLB, NBA, and NHL leagues only. Prompted by a real support case where a customer's Yahoo college-football leagues silently failed to sync — this documents the existing, already-shipped scope; it does not change any behavior.

### Operator Support Diagnostics (FLA-360)

- **Added**: Three internal auth-worker routes — `/internal/support/yahoo/inspect`, `/internal/support/yahoo/diagnose`, and `/internal/support/yahoo/refresh` — investigate a single account's Yahoo sync state without an active session for that account. Inspect projects a redacted snapshot of stored state, diagnose makes at most two bounded read-only Yahoo discovery calls and reports what they mean, and refresh runs the ordinary guarded league refresh and reports the saved state either side of it.
- **Added**: The routes require two independent service secrets, the shared internal service token and a dedicated support token, because they take their target account from the request body rather than from a session. They fail closed when either secret is unconfigured, and no end-user credential is an alternative to either.
- **Added**: A fourth route, `/internal/support/yahoo/probe-league`, for the case diagnose cannot reach — a specific stored league that fails on a live per-league fetch rather than on discovery. It renews the token through the same guarded path, makes exactly one GET to Yahoo's `/league/{id}/teams` with the operator-supplied identifier substituted verbatim, and reports Yahoo's classified response, including a capped copy of Yahoo's own error text when it rejects the request.
- **Limited**: Internal-service only, and not part of the public API or MCP surface: no tool, schema, or client-visible contract changed. Reads name their columns explicitly, so league, team, and token columns never enter a response, and both responses and audit logs carry only a masked account id, closed-set error codes, statuses, and counts.

### Funnel Day History (FLA-358)

- **Added**: `analytics.funnel_daily` records one row per America/New_York day and funnel stage. The existing five-minute dashboard snapshot refresh upserts today's rows from the payload it just stored, so an open day tracks intraday and a completed day keeps the value observed at its final refresh. The funnel was previously current-state only, with no trend for any stage.
- **Preserved**: The dashboard payload, its `funnel` key, the `analytics.funnel_snapshot` view, the provider-flags path, and the cron schedule are unchanged. Only the scheduled no-argument refresh writes history; the explicit boolean overload, which can rebuild the internal-excluding row, does not.
- **Preserved**: No backfill. Disconnects hard-delete their league and credential rows, so reconstructing earlier days from `created_at` would undercount each of them by everyone who has since disconnected; history begins at the first scheduled refresh after the migration lands.

### MAU Trend Line (FLA-357)

- **Added**: Each `usage_trend` day in the analytics dashboard payload carries `mau_30d`, a rolling 30-day distinct-user count built from the same preserved ET-day history and the same window shape as the existing `wau_7d`, plus `mau_30d_partial` disclosing the days whose 30-day window reaches back before history begins. Every other key, window, and source in the payload is unchanged, and the current-value `rolling.mau` scalar keeps its trailing-720-hour meaning.

### Yahoo Full-Game Discovery (FLA-355)

- **Fixed**: Yahoo league discovery now requests full fantasy games explicitly, preserving supported football, baseball, basketball, and hockey history while avoiding an upstream Yahoo server error observed on an unfiltered all-history request.
- **Added**: A temporary, service-token-only endpoint can retry one member of the cryptographically committed 59-account recovery cohort per request. It defaults to a database-only dry run, reuses the normal Yahoo refresh guardrails and persistence path, and expires on September 9.

### Yahoo Draft Player Names

- **Fixed**: Yahoo draft results resolve missing player names through bounded player-key lookups, so confirmed selections can include names for every drafting team. If Yahoo cannot resolve all names, the response preserves confirmed picks and explicitly reports the incomplete lookup.

### MCP Server Icon Theming (FLA-350)

- **Fixed**: The `fantasy-mcp` server declares both `icon-light.png` (`theme: 'light'`) and `icon-dark.png` (`theme: 'dark'`) per the MCP Icon spec (SEP-973), so clients that honor `theme` show the light-colored logo variant on a dark background instead of the dark logo washing out.

### API Domain Routes (FLA-348)

- **Fixed**: The unprefixed `/health` check and the `/widgets/*` (including `/widgets/user-session`) fallback paths now have explicit Worker Routes on `api.flaim.app`, so they reach the fantasy-mcp gateway instead of returning Cloudflare 522 for a route with no matching origin.

### Opt-in Connector Discovery

- **Added**: The exact opt-in MCP path `/mcp?auth=required` requires OAuth during connector discovery in production and preview for clients that need authentication at the initial handshake. The canonical `/mcp` resource and its default discovery behavior are unchanged.
- **Verified**: Grok completes the Flaim authorization flow through the exact observed OAuth callback, `https://grok.com/connectors-oauth-exchange-code/`, and can use the authenticated `get_user_session` tool without calling `refresh_leagues`.

### Consistent Sport Icons

- **Changed**: Sport indicators use monochrome Tabler outline icons across league management, the public demo, and the extension popup. Hockey uses the matching ice-skate icon. Existing sport labels remain, and icon-only popup indicators have accessible names.
- **Changed**: The ChatGPT "Your Leagues" widget is redesigned and ships through the existing v1–v3 resources rather than a new URI. It gains a compact header, full-width sport heading bands with the Tabler sport icons, fixed-height league rows with soft provider badges, a single continuous footer whose first sentence is the refresh control, an accessible refresh status region, and a dark palette driven by the host theme with a `prefers-color-scheme` fallback.
- **Changed**: The frozen-widget-body policy is retired. A backward-compatible content update at an already-published resource URI needs no resubmission, and cached client copies refresh on their own. What stays frozen per URI is the read-result metadata OpenAI snapshots (`ui.csp`, `openai/widgetDescription`, `openai/widgetCSP`), which is unchanged here.
- **Preserved**: v1 and v2 declare only `https://flaim.app` as a redirect domain, so their body names Yahoo Fantasy, ESPN, and Sleeper as plain text; v3 also declares `https://sports.yahoo.com`, so only its body links the Yahoo Fantasy credit. The tool descriptor still targets v3, and tool names, descriptions, schemas, and annotations are untouched.

### Gemini Custom Connector Callback

- **Fixed**: Accept all six callbacks Gemini Spark registers for Flaim's MCP endpoint: `/r/` and `/a/` user-bound paths on each of its exact production, test, and sandbox Google redirect hosts. Only the numeric identifier varies; sibling hosts, other paths, ports, queries, fragments, and alternate suffixes remain blocked.
- **Removed**: All temporary Gemini redirect diagnostics after they identified the complete callback set.

### Custom Connector Docs

- **Changed**: AI setup docs group Perplexity, Gemini, and Grok settings and documentation links separately from the shared four-step custom connector setup.
- **Changed**: Setup docs simplify hero navigation and name all three custom connector options in the AI page introduction.
- **Changed**: Grok now has its own authenticated-discovery URL and setup steps, and the custom-connector HowTo includes the verified Grok flow.
- **Changed**: The shared setup fields now have labeled copy buttons for the connector name and app-specific URLs.

### Claude League Setup

- **Added**: The Your Leagues AI Apps panel now offers the same direct Claude Connector Directory link as ChatGPT, so connected users can open either official Flaim Fantasy channel from setup.
- **Added**: The panel now points Perplexity, Gemini, and Grok users to the custom-connector setup guide.

### Paced Yahoo Recovery (FLA-338)

- **Added**: A temporary, service-token-only auth-worker endpoint can re-run Yahoo league discovery for accounts connected before the September 7 recovery cutoff, one account per request. It defaults to a database-only dry run, uses stable opaque cursor pagination, reuses normal per-user Yahoo leases and cooldowns, and returns sanitized provider stop signals for a renewed app denial or rate limit.
- **Added**: Yahoo league discovery now logs a bounded slice of the upstream response body when Yahoo answers 5xx or an unclassified status, so a deterministic provider failure records Yahoo's own reason instead of a bare status. Diagnostics only: error codes, HTTP statuses, and response payloads are unchanged.
- **Limited**: The recovery path has no cron, schema change, or permanent configuration. It preserves league archive and hidden state, never deletes omitted leagues, and expires in code after September 14 ET.
- **Removed**: The temporary recovery endpoint, its runner script, and their tests were deleted after the one-time sweep finished. The body-logging diagnostics above stay.

### Yahoo Availability Restored

- **Changed**: Removed the temporary Yahoo outage notice from Support and restored Yahoo to the standard homepage platform pill now that provider access is available again.

### ET-Day Analytics History Preservation (FLA-265)

- **Changed**: The canonical analytics dashboard payload now delegates to the proven ET-history implementation. Fresh local resets initialize synthetic history through yesterday before the first snapshot refresh; hosted backfill and scheduling remain separately controlled operations.
- **Added**: A pre-backfill forward refinement retains nullable platform and sport in ET user-day summaries, preserving future attributed-provider/sport cohort analysis without changing current dashboard metrics. The migration rejects populated or initialized history rather than silently mislabelling older summaries.
- **Added**: An owner-only permanent aggregate preserves MCP call counts at America/New_York day and user grain while retaining environment, authentication type, and nullable client identity. A private singleton records the explicit initial history date and last fully closed ET day; its serialized close/backfill function catches up missed days, rejects partial or no-longer-fully-retained ranges, and advances the marker only after replacement succeeds.
- **Added**: An owner-only `dashboard_payload_history(boolean)` implementation reads the aggregate through its marker and raw events after it without overlap. It fails closed until the first explicit backfill succeeds or when the marker falls beyond the recoverable raw window.
- **Changed**: Historical health summary and per-tool health use exact trailing 30-day raw events and disclose `health_window_days: 30`. Existing seven-day health, recent 1/7/30-day usage, UTC client mix, operational metrics, raw 90-day retention, snapshot refresh signatures, and cron schedules are unchanged.

### Inclusive Dashboard Refresh (FLA-264)

- **Changed**: The five-minute dashboard refresh computes the internal-inclusive human analytics payload once and updates only snapshot row id=2. The external row remains available for explicit comparison or manual recovery through the existing boolean refresh overload.
- **Preserved**: Dashboard and provider-flags cron schedules remain every five minutes. Provider flags keep their independent relation, refresh function, variants, permissions, and freshness timestamp.
- **Removed**: The superseded hourly/nightly dashboard cutover artifact and its dedicated guard test.

### Sleeper Connected-League Authorization (FLA-104)

- **Changed**: Sleeper league-scoped MCP reads now verify the requested league, sport, and season against the authenticated user's stored, discovered records for their current configured Sleeper identity before calling Sleeper's public API. The authorization lookup does not run provider discovery or enrich legacy rows. Historical discovered seasons remain available; explicitly hidden leagues remain unavailable. League-wide analysis inside an authorized league, including opponent rosters and matchups, is unchanged.

### Reuse Session Context on Follow-Ups

- **Changed**: The shipped skills and MCP routing guidance reuse successful session context within a chat instead of repeating `get_user_session` on ordinary follow-ups or switches to an already-known league. New chats, missing context, confirmed account/league/default changes, explicit status requests, and successful refreshes still allow session lookup. Current roster, score, and player data are fetched independently when needed. **[tool-contract]**

### User-Hosted Relay Callback

- **Added**: The exact `https://flaim-relay.onrender.com/oauth/callback` URL is accepted for user-authorized MCP connections. Other Render hosts and callback variations remain blocked; OAuth consent, PKCE, and scope requirements are unchanged.

### Littlebird Custom Connector Support

- **Added**: Flaim now accepts Littlebird's exact production OAuth callback for user-authorized custom MCP connections. The redirect remains exact-match only; other `lilbird.co` hosts, paths, query strings, and fragments are rejected.

## [9.0.0] - 2026-08-31

### Bounded Draft Results (FLA-318)

- **Changed**: Completed Sleeper drafts no longer repeat a full ownership-board row for every completed selection. Team and owner names now appear once in the top-level `teams` and `teamOwners` maps instead of being repeated on pick and ownership rows; changed-picks-only and future ownership ledgers remain available.
- **Added**: `get_draft` accepts optional positive `round` and nonempty `team_id` filters. The team filter applies to the historical selecting team on completed selections and to the current owner on ownership rows.
- **Clarified**: Sleeper `get_league_info.futureDraftRounds` describes the configured round count for future drafts. The selected draft's actual round count remains `get_draft.draft.rounds`.
- **Tested**: A 14-team, 25-round completed draft fixture guards serialized response size without imposing a runtime byte ceiling on normal draft results.

### Bounded ESPN Football Matchup Player Detail (FLA-313)

- **Added**: `get_matchups` now accepts opt-in `detail: 'players'` for ESPN football seasons 2018 and later. It requires an explicit positive `week` and nonempty `team_id`, selects one matchup containing that team, and returns both present sides with compact player entries: `playerId`, `name`, `lineupSlot`, nullable `started`, and nullable weekly `points`.
- **Guarded**: The detail path returns no raw ESPN payloads and does not cache or truncate player detail. Its serialized MCP tool result (`content` plus `structuredContent`) has a 24,000-byte hard limit, excluding the outer JSON-RPC envelope and SSE transport framing; an oversized result fails closed with `MATCHUP_DETAIL_TOO_LARGE` instead of dropping players or the opponent.
- **Limited**: Player detail is unavailable for ESPN football seasons before 2018 and for all other platform/sport combinations. `team_id` without `detail: 'players'` is rejected as ambiguous instead of being silently ignored.

### Provider-Grounded Draft Results (FLA-285)

- **Added**: The unified MCP exposes `get_draft` as its eleventh tool and tenth read-only league-data tool. The common response keeps round selection, stable draft-board column, historical selecting team, original team, and current pick owner as separate fields, with explicit confirmed, projected, or unavailable placement provenance.
- **Added**: ESPN returns confirmed draft results across football, baseball, basketball, and hockey. Yahoo returns confirmed draft results across the same sports when provider access is available. Sleeper returns confirmed NFL/NBA results and can materialize current-season pick ownership when the provider supplies a complete board order and traded-pick evidence.
- **Changed**: Sleeper future seasons without a draft can return only the provider's changed-picks ledger. Flaim no longer derives an exact round slot from a roster ID or assumed snake order when provider order is unavailable. Standard snake, third-round reversal, and linear projections are labeled projected rather than confirmed.
- **Changed**: ESPN and Yahoo fail closed when a provider marks a draft complete but supplies no usable selections. If only some completed rows are malformed, valid selections remain available with a `DRAFT_PICKS_PARTIAL` warning instead of silently presenting a complete result.
- **Added**: The shipped Flaim skill and MCP instructions route draft-result and pick-ownership questions to `get_draft`, distinguish a value such as 12.15 from stable board column 2, and prohibit current-owner inference from completed selection history.
- **Changed**: The deferred keeper guidance now documents platform-specific keeper fields and the league-rules boundary for traded-player cost. Tool descriptions disclose that keeper fields are additive and platform-dependent.
- **Changed**: `get_transactions` now warns callers that a response hitting its `count` cap may omit older rows inside the requested window, and `get_ancient_history` scopes all-time claims to seasons actually returned rather than treating `thresholdYear` as a retrieval floor.
- **Limited**: Yahoo draft support is fixture-tested but not live-verified while provider access remains unavailable. ESPN and Yahoo expose completed selections but not a current future-pick ownership ledger.

### Self-Service Account Deletion (FLA-311)

- **Added**: Users can permanently delete their Flaim account through Clerk's native self-serve UI (account menu, then Manage account, then Security, then Delete account). A dedicated, Svix-verified `user.deleted` webhook on auth-worker triggers an atomic Postgres purge of connected ESPN, Yahoo, and Sleeper credentials and league data. Usage-analytics tables remain untouched, and a permanent deletion record (Clerk user ID and timestamp) is retained.
- **Added**: A generic anti-resurrection guard trigger, bound to all 13 in-scope tables, rejects any write for an account after its deletion is recorded, closing the race between an in-flight sync and a deletion.
- **Changed**: The privacy policy's Data Retention section and the account-deletion FAQ now describe the self-serve flow and its actual retention behavior (pseudonymous usage records, a permanent deletion record, unaffected marketing contacts) instead of the prior email-request process.

### Paced Legacy ESPN Backfill (FLA-310)

- **Added**: A default-off backend migration can proactively repair legacy ESPN history one account at a time without waiting for a user refresh. A fixed cohort cutoff and an optional private allowlist make staged rollout explicit.
- **Added**: An atomic service-role claim enforces one globally active scheduled job, five-minute minimum spacing, exact ESPN lease ownership, credential-version fencing, nonempty saved league roots, bounded retries, and global pause behavior after upstream planning or chunk exhaustion failures.
- **Changed**: Auth-worker now routes its daily reconciliation and five-minute ESPN migration crons explicitly. Unknown schedules fail closed, and disabling the migration stops scheduled work without changing interactive web, extension, or MCP refresh behavior.

### Durable ESPN History Refresh (FLA-308)

- **Added**: Sync all on Your Leagues and Sync or Re-sync in the Chrome extension save current ESPN leagues first. Durable historical discovery is rollout-gated and default-off; when enabled for an allowlisted account, it continues in a background workflow after the web page or extension closes, and both surfaces show the latest queued, running, completed, partial, or failed status.
- **Changed**: The first background scan repairs all historical seasons ESPN still makes available. Later refreshes use the same button but skip league-season rows already stored, so routine team-name and current-season updates do not re-fetch immutable history.
- **Changed**: ESPN league storage now uses keyset pagination instead of a fixed 100-row read, so accounts with more than 100 league-season rows are not silently truncated. The public MCP `refresh_leagues` path remained synchronous while its advertised contract was under directory review at the time.
- **Changed**: Server-verified discovery can store complete ESPN history, while caller-supplied league replacement and addition routes retain a separate 1,000-row abuse boundary. Team selection, manual addition, replacement, deletion, and credential changes all take over the ESPN write lease before changing saved rows.
- **Fixed**: Unexpected background workflow failures now mark the affected history job failed and release its ESPN refresh lease, so a rare infrastructure error cannot leave future syncs blocked behind a permanently running job.

### Broadcast Deliverability and Yahoo Update (FLA-299)

- **Added**: A concise, name-neutral Yahoo access-status Broadcast template uses a compact `Yahoo Update` in-body heading, the verified `news.flaim.app` marketing sender, first-party campaign attribution, and Resend's unsubscribe placeholder.
- **Added**: A dry-run-first, pagination-safe Yahoo Segment preparation script derives the approved outage-era/current-season cohort without selecting OAuth tokens, uses a unique row tie-breaker across Supabase pages, excludes internal users by hash, and applies Clerk verification plus Resend contact, unsubscribe, and suppression gates. Its default output contains aggregate counts only. Apply mode requires the exact Segment identity and reviewed eligible count, refreshes provider eligibility immediately before and after population, adds only existing eligible contacts, rejects drift or foreign Segment members, invalidates a partially or ambiguously populated Segment after any write-path failure, and cannot create contacts, resubscribe, remove suppressions, create a Broadcast, or send.
- **Changed**: Broadcasts use `Flaim <updates@news.flaim.app>` with click tracking isolated to the marketing subdomain. Product and lifecycle email remains on `flaim.app` with provider click tracking off and first-party `ref=` attribution retained.
- **Changed**: The shared email layout now balances Flaim's existing optimized transparent mark in the top-right corner with the card eyebrow, or with the title when no eyebrow is used, and removes the separate logo-and-wordmark row above the card.
- **Changed**: Provider-availability Broadcasts use the durable public `Service updates` subscription Topic, while campaign cohorts such as the Yahoo access-update audience remain Segments.

### Resend API Key Hygiene (FLA-296)

- **Changed**: The documented broadcast-draft workflow now requires an intentionally sourced `RESEND_BROADCASTS_API_KEY` with full access instead of reusing the sending-only `RESEND_API_KEY` from `web/.env.local`. Local visual preview remains the copy and layout editing surface, and the provider remains the audience, proof, and send surface.
- **Clarified**: Resend does not offer a read-only API-key permission. A suppression-reconciliation credential therefore requires full access even though Flaim's reconciliation script itself remains report-only; the credential is loaded from the password manager only for that command and is not stored in `.env.local` or deployed environments.

### ESPN Refresh Timeout Alignment (FLA-122)

- **Fixed**: The public `refresh_leagues` MCP path now gives auth-worker up to 60 seconds to complete league discovery, matching the Chrome extension's existing discovery timeout. This replaces the previous 15-second cutoff that could report failure after a long-history ESPN account had already saved only part of its available seasons. The timeout remains bounded so a stuck refresh still terminates.

### ESPN Historical League Recovery (FLA-307)

- **Fixed**: ESPN league discovery and historical league reads now use ESPN's `leagueHistory` route for seasons before 2018 and retry that route when the modern route incorrectly returns 401 for a later historical season. The alternate route's one-item array response is normalized before league info, standings, matchups, rosters, or past-season membership are processed. Current-season requests keep the existing route and authentication behavior.
- **Changed**: ESPN setup guidance now explains that Sync or Re-sync in the Flaim Chrome extension refreshes connected leagues and looks for past seasons ESPN makes available. Your Leagues also provides Sync all for connected platforms.

### Welcome Email Name-Neutral (FLA-300)

- **Changed**: The welcome template now uses the fixed greeting "Hi there," and the Resend event, template, and automation carry no given-name field or variable. Optional first/last-name contact enrichment remains limited to the `user.updated` repair path and contact backfill.

### Email Reliability and Delivery Feedback (FLA-295, FLA-298)

- **Added**: Clerk-to-Resend welcome-event and contact-sync failures now emit stable, privacy-bounded structured email-operation logs and leave independent retry markers in Clerk private metadata. The flagged-only backfill mode can inspect or explicitly recover those markers without treating an unrelated contact-sync success as a welcome-event recovery.
- **Added**: A signature-verified Resend delivery-feedback route records bounced, complained, failed, and delayed delivery events from the exact raw Svix body; a read-only paginated suppression reconciliation script compares masked Resend suppression addresses to Clerk users and has no write mode.
- **Fixed**: The production CSRF middleware now allows originless Resend delivery webhook POSTs through to the route's raw-body Svix signature verification. Only the exact `/api/webhooks/resend` path is exempt; other unauthenticated API mutations remain protected.
- **Changed**: Direct Resend email sends accept a caller-supplied semantic idempotency key only for genuinely one-time events. Repeatable ESPN setup-link requests omit the key so a legitimate resend is not provider replay-cached. Flagged welcome recovery checks for the automation-created contact before resending and can be deliberately overridden with `--force-resend`; custom automation events remain outside Resend's email idempotency support.

### Sleeper Backfill Chain-Walk Depth Cap (FLA-303)
- **Changed**: The Sleeper recurring-id backfill's chain-walk depth cap is now its own constant, `BACKFILL_MAX_CHAIN_DEPTH` (10), split from `MAX_HISTORY_YEARS` (still 5 — discovery's per-league history-persistence cap is a product choice and is unchanged). A classification of all 438 unresolved prod rows (2026-08-25) showed the previous shared 5-hop walk cap misclassifying legitimately long-running leagues, which grow more common every season; nearly all unresolved rows are upstream Sleeper 404s no cap can fix, so the walk cap only needs to stop malformed non-cyclic chains.

### Homepage Yahoo Outage Indicator (FLA-305)
- **Added**: The homepage "Fantasy platforms" pill row marks Yahoo with a small dot indicator and an accessible popover (new `YahooOutagePill` client component, `web/components/site/yahoo-outage-pill.tsx`) explaining that Yahoo connections are temporarily unavailable while Yahoo reviews third-party API access, with a "Learn more" link to the existing `/support#yahoo-outage-heading` explanation. Self-contained — comes out once the underlying Yahoo outage (FLA-237) resolves.

### Homepage Football-Demo Coming-Soon Note (FLA-290)
- **Added**: A small, muted note below the homepage live demo — "Football demos are on the way — ESPN and Sleeper league previews land as soon as drafts wrap up." — sets expectations while the ESPN and Sleeper football demo targets are staged but not yet live in the `live-demo` capabilities feed. Self-contained and removable in one deletion once those targets go live.

### Sleeper Recurring-ID Backfill Orchestrator (FLA-168)
- **Added**: `backfillSleeperRecurringIds` (auth-worker) accepts an optional `{ dryRun }` flag. Only rows whose stored `recurring_league_id` is NULL are candidates — a row that already has a value, even a stale one, is left for the sync path to correct on its next refresh, never overwritten here. For each NULL candidate it re-walks the `previous_league_id` chain, and either persists the resolved root (or, in dry-run, returns per-row `{ userId, leagueId, currentRecurringId: null, wouldSetRecurringId }` detail) or — when the walk is unresolved (a cycle, a transient fetch error, or the backfill-only chain-walk depth cap described below (now `BACKFILL_MAX_CHAIN_DEPTH`, see FLA-303)) — leaves the row NULL and counts it in a new `unresolved` field rather than persisting a fallback value, so a later healthy run can retry it instead of the row being poisoned with a wrong terminal value the null-only selector would never revisit. A live write goes through a new `SleeperStorage.backfillRecurringLeagueId` — a narrow conditional `UPDATE` scoped to the exact `(clerk_user_id, league_id, season_year)` row and guarded on `recurring_league_id IS NULL` — rather than the general-purpose full-row upsert, so a row the user deleted (or that normal sync already filled) between this function's snapshot read and its write is never resurrected or clobbered; a zero-row match there is a clean no-op counted in a new `skippedConcurrent` field. The chain resolver's depth cap is threaded as an optional `maxDepth` (unbounded by default) and applied only to this backfill call site — UI reads, archive resolution, and discovery's own history walk all still resolve the true (potentially deep) recurring root, matching this resolver's original shared behavior. Hitting the cap on one row's walk no longer writes a negative cache entry for the intermediate leagues it visited — only positive (resolved-root) entries are cached in the shared per-run map — so a different row in the same batch whose own chain passes through one of those same intermediate leagues, but resolves within its own depth budget, is unaffected. A new orchestrator (`sleeper-recurring-backfill.ts`) finds distinct users with a NULL `recurring_league_id` via a select-only `sleeper_leagues` query paginated by keyset on `clerk_user_id` (not numeric offset — concurrent normal sync filling earlier NULLs can no longer shift page boundaries and silently skip a block of users), then backfills them in small batches with per-user failure isolation, emitting a structured `sleeper_recurring_backfill` log event per run. Live (non-dry-run) runs single-flight via the existing `provider_sync_state` lease (`sync-state.ts`), keyed on a reserved pseudo-user id, acquired with an explicit 15-minute TTL (rather than the 120s default sized for a single provider refresh) — a second concurrent live run is refused rather than racing writes against the first; dry runs skip the guard entirely. Acquisition opts into a new `acquireLease` `{ onStorageError: 'fail' }` mode (round-4 audit finding) rather than `acquireLease`'s default fail-open posture — every other caller still fails open on a storage error unchanged, but a `provider_sync_state` outage failing open here would let multiple live backfill runs proceed leaseless, so a storage-error acquisition failure now returns outcome `'failed'` (not `'blocked'`, which specifically means another run holds the lease); the orchestrator itself never calls its own row cleanup on this path (`deleteLeaseRow` is only reached after a *held* lease) — see the round-6 fix below for the stray-row gap that left open and how `acquireLease` itself now closes it. Once acquired, the lease is renewed on a time-based cadence (round-4 audit finding, replacing the prior once-per-batch renewal): a shared checkpoint helper renews at most once every 5 minutes (TTL/3) and is checked after every snapshot page, before every row (not once per user — a single user's rows are processed sequentially and each row's own chain walk can itself make several Sleeper requests, so per-user work is not bounded by a fixed count), and after every batch, so the worst-case gap between renewals is one row's chain walk rather than an entire user's or batch's worth of unbounded work. Renewal is fail-closed — `extendLease` now reports a storage error back as `false` instead of failing open — so a `false` return for any reason (lease already expired and taken by a new run, or the renewal call itself erroring) halts new writes at the next checkpoint with a `lease_lost` outcome carrying whatever partial counts completed. This bounds wasted duplicate work once a lease loss is suspected; it is not what prevents corruption from an actual overlapping write — two runs resolving the same `previous_league_id` chain always compute the same deterministic root, and `backfillRecurringLeagueId`'s conditional `UPDATE` (scoped to one exact row, guarded on `recurring_league_id IS NULL`) makes an overlapping write a clean no-op on its own, lease or no lease; see the round-5 fix below for closing the remaining gaps in how promptly a detected loss actually stops new writes. On a normal finish the synthetic lease row is deleted outright (a new owner-guarded `deleteLeaseRow`, used only by this backfill path) rather than released back to an unheld state, so it doesn't linger in `provider_sync_state` inflating `sync_7d.users_attempted` or phantoming a Sleeper entry in `sync_recent` between runs — it remains visible only for the run's own (manual, minutes-long) duration. `deleteLeaseRow` now reports its own success/failure rather than swallowing a storage error, surfaced on the response as `leaseCleanup: 'ok' | 'failed'` (present only when a live run held the lease) and logged with a `console.warn` on failure, without changing the run's own `outcome`.
- **Fixed**: The per-run `leagueCache` inside `backfillSleeperRecurringIds` (`sleeper-connect-handlers.ts`) caches Sleeper league fetch promises across every row processed for a user; a rejected promise (a transient 503, a timeout) used to stay cached for the rest of that run, so one row's failure fetching a shared intermediate league in a `previous_league_id` chain made a later row's walk through that same league fail instantly too, even after Sleeper had recovered (round-4 audit finding). A rejection now evicts its own cache entry as soon as it settles, so the next row through the same league gets a fresh fetch instead of the stale rejection; the row whose own walk hit the failure still fails/skips exactly as before.
- **Fixed** (round-5 audit finding — write fencing, renewal correctness): the per-row lease checkpoint only ran BEFORE a row's `previous_league_id` chain walk, so a lease loss detected by a concurrent batch lane while that walk was still in flight didn't stop the row's write — `backfillSleeperRecurringIds` now re-consults the same checkpoint a second time immediately before the persist call, so "no further writes once loss is detected" now holds at write granularity, not just at the start of each row. `createLeaseRenewer` (`sleeper-recurring-backfill.ts`) now single-flights concurrent renewal calls from the two `Promise.all` batch lanes — a lane whose own checkpoint finds renewal due while another lane's `extendLease` request is already in flight awaits that same in-flight promise instead of issuing a redundant call, closing a window where one call could latch the lease lost while a second, now-pointless call still reported it held. Renewal cadence is now measured from a clock base captured immediately BEFORE issuing each `extendLease` request (and, at acquisition, before calling `acquireLease` at all), matching how `sync-state.ts` computes the stored row expiry pre-request; measuring from completion time instead let a slow renewal round-trip (there is no configured DB timeout) push the in-memory cadence later than the stored expiry, opening a window where the row was already expired in storage but the next checkpoint didn't think renewal was due yet. `acquireLease`'s strict (`{ onStorageError: 'fail' }`) path now surfaces a failure of its own diagnostic "who's blocking?" read as `state: 'error'` instead of silently falling through to `'in_progress'` — a `provider_sync_state` outage on that specific read no longer gets misreported to the backfill as a 409 `'blocked'` instead of `'failed'`; the three default-mode callers (`league-refresh.ts`, `index-hono.ts`, `reconciliation.ts`) are unaffected. None of this is what prevents corruption from an actual overlapping write — that's `backfillRecurringLeagueId`'s conditional `UPDATE` and the deterministic chain resolution, unconditionally, lease or no lease (see above) — these fixes only make the lease detect and react to its own loss faster and more accurately, which is all it was ever meant to do: bound duplicate work between concurrent runs, not serve as a hard mutex.
- **Added**: A new internal route, `POST /internal/backfill/sleeper-recurring-ids`, gated by the existing service-token check, triggers a run on demand. The request body defaults to dry-run (`{ dryRun: true }`) and refuses a malformed body, a non-object JSON body (`null`, an array, a number, a string), or a non-boolean `dryRun` rather than silently falling back to the safe default; returns 409 when a concurrent live run already holds the backfill lease.
- **Fixed** (PR #206 review, round-6): `acquireLease`'s strict (`{ onStorageError: 'fail' }`) path upserts a fresh, unowned row for `(clerk_user_id, provider)` before its own guarded update ever runs — if that guarded update then throws (a transient PostgREST failure), or the update matches zero rows and the follow-up diagnostic read throws, the method returned `state: 'error'` without ever setting an owner. The orchestrator's own cleanup (`deleteLeaseRow`) is only reached after a lease was actually *held*, so on either of those error exits the synthetic `__backfill__` row was left behind indefinitely, inflating the dashboard's `sync_7d` metric. Both strict-mode error exits now attempt a best-effort, conditional `DELETE` scoped to `(clerk_user_id, provider) AND sync_lease_owner IS NULL` first — the `IS NULL` guard means it can never remove a lease genuinely held by another run, and it's additionally hard-scoped to the backfill's literal synthetic user id so it can never touch a real user's row even if a future caller adopts strict mode. Cleanup failures are logged and swallowed; the original acquisition error is always returned unchanged.
### Broadcast Workflow (FLA-288)
- **Added**: The August football kickoff broadcast is now a repo-owned React Email template, matching the sent update's copy, attribution-tagged Flaim links, three-action layout, and Resend unsubscribe placeholder. `email:export` now also produces a plain-text fallback beside each broadcast HTML export.
- **Changed**: The shared `FlaimEmailLayout` uses a 36px Flaim mark and a 29px card-aligned header inset across the welcome, league-connected, ESPN setup-link, and broadcast templates, not just the August broadcast.
- **Added**: The documented, pinned Resend CLI v2 draft invocation reads the local HTML and text exports and uses an explicitly supplied, manually verified Segment ID. It deliberately omits send/schedule flags, so the dashboard remains the proof and Send surface. The workflow never substitutes an audience ID for a Segment ID. Content stays in the repository because dashboard edits lock future code-side revisions.

### Email Template Single Source (FLA-300)
- **Changed**: The Resend welcome-automation setup script now renders both HTML and plain text directly from `web/emails/welcome.tsx` through `@react-email/render`, so automation content cannot drift from the React email template. The retired unused league-connected product-email template and send helper were removed; welcome and ESPN setup-link email support remain.

### Gateway Copy and Widget-Read Telemetry (FLA-257, FLA-258)
- **Fixed**: The `mcp:write` insufficient-scope error (`refresh_leagues` denials) now tells the caller how to fix it — "Disconnect and reconnect the Flaim connector in your AI app to grant this permission" — instead of stating only that the scope is missing. The copy is client-neutral ("your AI app"), since this error reaches Claude and custom MCP clients as well as ChatGPT.
- **Added**: A sample of widget resource reads (`user-session-widget`, `-v2`, `-v3`) — sampled 1-in-50 via `sample_rate` in the payload, so absolute rates are `count × 50` — now emit a structured `widget_resource_read` log line (`uri`, `resource_name`, `correlation_id`, `sample_rate`) so v1's share of reads — and thus its retirement readiness — is computable from observability data instead of guessed at.
### Provider Plumbing Hygiene (FLA-223, FLA-126, FLA-188)
- **Fixed**: Yahoo `get_standings` guards `playoff_seed` with a finiteness check before `Number()` conversion — a non-numeric upstream value (e.g. `"N/A"`) now yields `playoffSeed: null` (and therefore `madePlayoffs: null`) instead of `NaN`, which would have failed the gateway's `z.number().nullable()` descriptor validation. Matches the existing guards on `current_week`/`playoff_start_week`.
- **Changed**: auth-worker stores Yahoo access-token expiry with a 60-second write-time safety buffer (`computeYahooExpiresAt` in `yahoo-storage.ts`, floor-clamped to 60s), correcting for token-exchange round-trip latency between Yahoo minting the token and the worker's `Date.now()`. The existing 5-minute read-time `REFRESH_BUFFER_MS` is unchanged — the two buffers guard different latency sources (write: exchange round-trip; read: subsequent-call duration).
- **Fixed**: auth-worker's Sleeper and Yahoo league-discovery fetches (`sleeperGet`, the leagues fetch in `fetchYahooLeaguesReadOnly`) now carry `AbortSignal.timeout(10000)`, matching ESPN discovery — a hung provider call can no longer hold the 120s `provider_sync_state` lease for its full TTL. Timeouts classify as `sleeper_timeout`/`yahoo_timeout` (retryable), feeding the existing `_timeout` backoff handling. `probeSleeper` in reconciliation now classifies `retryable` from `httpStatus` (undefined/429/5xx → true, other 4xx → false) instead of hardcoding `true`.

### Sleeper Roster Draft-State Disclosure (FLA-293)
- **Added**: Sleeper `get_roster` now fetches `GET /league/{league_id}` alongside its existing rosters/users fetches (started at the same time, but not joined into their `Promise.all` and never awaited on an error path, so a slow or black-holed league call can't delay a required rosters/users error) and surfaces the league's raw `status` (`pre_draft` | `drafting` | `in_season` | `complete`) as `snapshot.leagueStatus`, on both the single-team and no-`team_id` roster-summary branches (not the historical week branch — a past week's league is by definition no longer drafting). Mid-draft (`drafting`), `starters`/`bench` are empty and `record` is `0-0-0` with no indication why; `leagueStatus` lets a caller explain that instead of guessing at a bug. The league fetch degrades independently: if it fails, returns non-OK, or lacks a usable status string, `leagueStatus` is omitted and a `LEAGUE_STATUS_UNAVAILABLE` warning is added to the response's top-level `warnings: string[]` rather than failing the whole `get_roster` call. `workers/fantasy-mcp` required no schema change — `snapshot` is a passthrough `looseObject` and `leagueStatus` is additive, following the FLA-284 precedent.
- **Added**: The companion `get_ancient_history` descriptor sentence discloses its historical-coverage floor.

### get_transactions Truncation Signal (FLA-291)
- **Fixed**: `get_transactions` caps rows at `count` (default 25, max 100) but previously left callers unable to tell a capped result from a complete one — `limitations` stayed `{}` and `window` carried no row count. ESPN now sets `limitations.possibly_truncated: true` whenever matching transactions exceed `count` (mirroring the existing top-level `truncated` field) and adds `window.returned_rows` (the actual row count after the cap). Yahoo sets `limitations.possibly_truncated: true` when either the pre-cap filtered row count exceeds `count`, or (general, non-pending path only) the raw upstream fetch returned a full page at the requested (clamped) count that does **not** reach back past the 14-day window start — the second condition catches a false negative unique to Yahoo: its general path applies no server-side type filter, so a full page can hide additional matching rows the client-side `type` filter never saw. That condition is suppressed when the page's own timestamps prove full window coverage: Yahoo returns rows newest-first, so if the oldest valid-timestamp row in a full page is already older than the cutoff, every row inside the window was necessarily fetched — without this, a long-lived league with a quiet fortnight would report `possibly_truncated` on every call even though nothing was missed. The pending path (`type=waiver`/`pending_trade`) has no cutoff/window concept, so a full page there always means more may exist upstream and the suppression never applies. Yahoo also adds `window.returned_rows` and, matching its prior behavior, omits `limitations` entirely when nothing was cut rather than emitting an empty object. Sleeper sets `limitations.possibly_truncated: true` when its per-week (uncapped) fetch yields more matching rows than `count`, and adds `window.returned_rows`. `workers/fantasy-mcp` required no schema change — `window` and `limitations` are `.passthrough()` objects, so the new fields ride the existing output schema. The `get_transactions` tool descriptor sentence documents the cap behavior.

### Keeper / League-Format Context (FLA-284)
- **Added**: ESPN `get_league_info` surfaces keeper/draft-format settings: `keeperSettings` (`keeperCount`, `keeperCountFuture`, `keeperOrderType`, `keeperDeadlineDate` as ISO or `null`) plus `isKeeperLeague` (`keeperCount > 0`) whenever ESPN reports a numeric `keeperCount`; always-present `draftSettings` (`type`, `auctionBudget`, `pickTradingEnabled` — ESPN's underlying flag toggles draft-*pick* trading only, not in-season player trades) and `tradeSettings` (`deadlineDate` ISO or `null`, `revisionHours`, `vetoVotesRequired`, `allowOutOfUniverse`, `max`); and per-team `keeperPlayerIds`/`futureKeeperPlayerIds` — raw ESPN player IDs, this season's keepers and next-season self-only designations. Every epoch-ms date field is converted through a shared, guarded helper (`workers/espn-client/src/shared/dates.ts`): a positive finite number becomes an ISO string, an explicit `null` from ESPN stays `null`, and an absent source block stays `undefined` (never guessed at as `null`) so it matches its undefined sibling fields. `get_roster` adds `mSettings` to its existing ESPN fetch and emits `keeperValue`/`keeperValueFuture` per roster entry plus response-level `keeperValueUnit` (`AUCTION`→`auction_dollars`; `SNAKE`/`AUTOPICK`→`draft_round`; any other/unknown draft type, e.g. `OFFLINE`, omits `keeperValueUnit` rather than guessing) and `isKeeperLeague`. Verified live against real ESPN keeper leagues: `keeperValue` is this season's keeper cost; `keeperValueFuture` is next season's cost (this season's auction $/draft round), follows the player through trades, and resets to `0` via free agency; `0` means no cost defined or not keeper-eligible. On a historical snapshot (`week`/`date`), `keeperValueFuture` isn't yet fixed as of that past date, so it's withheld entirely (`keeperValue` is unaffected — it's season-stable) and the response's `limitations` block adds `keeperValueFutureAvailable: false`, mirroring the FLA-278 `playerProTeamAvailable` pattern.
- **Added**: Sleeper `get_league_info` adds a `leagueFormat` block (`typeRaw`, `typeNote`, `maxKeepers`, `tradeDeadlineWeek`, `tradesDisabled`, `pickTrading`, `taxi { slots, years, allowVets, deadline }`, `reserveSlots`) built from the league's raw `settings`, plus raw `keepers` player-id arrays per team with `null`/`[]` preserved exactly as Sleeper sends them (unresolved — no name lookup at this call site). `tradesDisabled`, `pickTrading`, and `taxi.allowVets` are emitted only when Sleeper sends the underlying field as exact numeric `0`/`1`; missing, `null`, or any other value omits the key rather than defaulting to `false`. `get_roster` resolves `keepers` the same way as `starters`/`bench`/`reserve`/`taxi` on the current-roster (`team_id`) branch, using the player index already loaded for that call. `settings.type` (the redraft/keeper/dynasty convention) remains undocumented by Sleeper — an observed `3` means "guillotine" per the league's own owner — so `typeNote` warns callers against gating behavior on it alone.
- **Added**: Yahoo `get_roster`, `get_free_agents`, and `get_players` emit an optional `isKeeper: { status, cost, kept }` per player when Yahoo's undocumented `is_keeper` field is present, with `status`/`kept` normalized from Yahoo's inconsistent boolean encodings (native booleans, `"0"`/`"1"` strings, `"true"`/`"false"` strings case-insensitive/trimmed, `0`/`1` numbers). An encoding `toYahooBoolean` doesn't recognize normalizes `status`/`kept` to `undefined` (omitted from the JSON response) rather than being coerced to `true`. `get_league_info` adds a `GET /league/{key}/settings` fetch — run **sequentially after** `/teams`, not concurrently, since Yahoo's throttling (HTTP 999) is sensitive to concurrent requests — yielding `draftType`, `isAuctionDraft`, `canTradeDraftPicks`, `tradeEndDate`, `tradeRatifyType`, `tradeRejectTime`, `usesFaab` (plus `isProLeague`, already available from the existing `/teams` metadata); a failed or malformed settings fetch degrades to a `warning` string with `/teams` data unaffected — the request never fails because of it. The settings-extraction helper now also accepts a flat settings object (`{ draft_type: ..., ... }`, no array/wrapper) in addition to the previously-handled nested-array and numeric-keyed-object shapes. **Fixture-tested only, not live-verified** — Yahoo API access has been cut since 2026-07-27 (FLA-237).
- **Unchanged**: No platform computes or carries a keeper's cost through a trade as a rule of its own — Flaim surfaces each provider's own facts (ESPN's carried-forward `keeperValueFuture`, Sleeper's raw designations, Yahoo's per-player flag) without asserting draft outcomes; deriving actual draft-round results from this data is FLA-285. `workers/fantasy-mcp` required no schema change — every field above is additive passthrough.

### Sleeper Transactions Team Names and Warning Consistency (FLA-280)
- **Added**: Sleeper `get_transactions` now fetches `GET /league/{league_id}/rosters` and `GET /league/{league_id}/users` in parallel with the transaction-window and player-index fetches, and surfaces two top-level maps keyed by the same string roster ids used in `team_ids`: `teams` — `{ "<rosterId>": "<teamName>" }` — is exactly ESPN's transactions `teams` shape (`Record<string, string>`), since `GET_TRANSACTIONS_OUTPUT_SCHEMA` is a frozen, reviewed tool descriptor and `teams` was already typed that way for ESPN; `teamOwners` — `{ "<rosterId>": "<ownerName>" }` — is a new additive key for owner names, which ESPN's map has no equivalent for. Together these mean the caller doesn't have to cross-reference `get_league_info` to say who moved whom. Each row also gets an additive `team_names: string[]` parallel to `team_ids`, resolved through `teams` and falling back to the raw roster id when a particular id has no matching roster. If the rosters/users fetch fails, both `teams` and `teamOwners` are omitted and a `TEAMS_UNAVAILABLE` warning is added instead — the transaction rows themselves are unaffected and the request never fails because of it. No existing field (`team_ids`, `players_added`, `players_dropped`, `draft_picks`, etc.) changed, and `workers/fantasy-mcp/src/mcp/tools.ts` required no schema change.
- **Added**: Sleeper `get_transactions` now reports player-index enrichment failures via a top-level `warnings: string[]` (`PLAYER_ENRICHMENT_UNAVAILABLE`) instead of degrading to id-only player entries silently, mirroring `get_roster`/`get_matchups`. Sleeper `get_free_agents` additionally emits `warnings: [warning]` alongside its existing legacy singular `warning` field, which is retained unchanged for published clients — every Sleeper tool now exposes degradation via `warnings: string[]`, with `get_free_agents`'s `warning` kept as a backward-compatible alias.

### Historical Roster Temporal Purity — ESPN and Yahoo (FLA-278)
- **Changed**: ESPN `get_roster` historical snapshots (`week` for football, `as_of_date` for baseball/basketball/hockey) now omit `proTeam` and `injuryStatus` from every roster entry instead of returning them from the top-level player object. ESPN's `mRoster` payload only exposes each player's CURRENT club and CURRENT injury state there — never a value as of the requested past week/date — so a player traded or whose status changed since would otherwise show present-day facts mislabeled as historical. The response's `limitations` block now always adds `playerProTeamAvailable: false` on a historical snapshot, alongside the existing `acquisitionMetadataAvailable: false` when acquisition detail is also missing. Current-roster responses are unchanged.
- **Changed**: Yahoo `get_roster` historical snapshots (`week` for football, `date` for baseball/basketball/hockey) now omit `team` and `status` from every player entry for the same reason — Yahoo's roster player object exposes `editorial_team_abbr`/`status` as current-only fields. Historical responses now add a `limitations: { playerProTeamAvailable: false }` block (new for Yahoo). Current-roster responses are unchanged.
- **Changed**: `workers/fantasy-mcp/README.md`'s `get_roster` limitations description now states that `playerProTeamAvailable: false` applies to every platform's historical roster (Sleeper weekly history, ESPN week/date snapshots, Yahoo week/date snapshots), not just Sleeper — no provider's roster payload can recover a player's real club as of a past snapshot, only their present-day club.

### Sleeper Traded Draft-Pick Ownership (FLA-276)
- **Added**: Sleeper `get_league_info` now fetches `GET /league/{league_id}/traded_picks` and surfaces `tradedPicks` — traded draft-pick ownership: only picks that changed hands (Sleeper does not list untraded picks, so this is not an exhaustive picture of every future draft), each entry resolved to names (`originalOwnerName`/`originalTeamName`, `currentOwnerName`/`currentTeamName`) via the same user directory used elsewhere, sorted by season/round/originalRosterId. Also adds `futureDraftRounds` (from `league.settings.draft_rounds`) so future drafts can be reasoned about, and a one-sentence `pickOwnershipNote` — present only when `tradedPicks` is non-empty — noting that Sleeper allows pick trading for the current season plus up to three future seasons depending on league settings, so seasons beyond what's listed are unverified. Redraft leagues (and any league with nothing traded) return `tradedPicks: []` with no note. Every raw entry is runtime-validated before use (non-empty string `season`; integer `round`/`roster_id`/`previous_owner_id`/`owner_id`); malformed entries are dropped and valid ones kept, with a `TRADED_PICKS_PARTIAL` count warning in a top-level `warnings: string[]`. If the fetch fails, the body isn't an array, or no entry is valid, `tradedPicks`/`pickOwnershipNote` are omitted and a `TRADED_PICKS_UNAVAILABLE` warning is added instead — the rest of `get_league_info` still succeeds and the handler never throws on malformed upstream data, matching the FLA-275 degradation pattern.

### Sleeper Roster/Matchup Player Names and Team Names (FLA-275)
- **Changed**: Sleeper `get_roster` current roster (`starters`, `bench`, `reserve`, `taxi`) and `get_matchups` (`starters` per side) now return enriched player entries (`{ id, name, position, team }`) instead of bare player-ID strings, using the same KV-backed player index already used by `get_free_agents`/`get_transactions`. The historical week roster path (`starters`, `bench` only — `reserve`/`taxi` classification was never available historically) enriches with `{ id, name, position }` but **never** `team`: the player index only tracks each player's CURRENT club, so showing it on a past-week roster could show a club joined after that week; the response's `limitations` block adds `playerProTeamAvailable: false` alongside the existing `reserveAndTaxiClassificationAvailable: false`. `get_matchups` applies the same rule: starters carry `team` only when `week` is omitted (live week); an explicitly passed `week` omits `team` and sets `limitations.playerProTeamAvailable: false`. Sleeper's `"0"` empty-lineup-slot sentinel returns `{ id: "0", empty: true }`; an unknown id or an unavailable player index returns `{ id }` only — array order and length are always preserved and the request never fails because of enrichment. When the player index is unavailable, the response still succeeds and adds a top-level `warnings: string[]`.
- **Added**: Sleeper `get_league_info`, `get_standings`, `get_roster`, and `get_matchups` now include `teamName` alongside `ownerName`, sourced from `users[].metadata.team_name`. Unlike ESPN/Yahoo, most Sleeper managers never set a custom team name; when it is unset, `teamName` is Sleeper's own default `Team <display name>` — the name league members actually see in the Sleeper app (e.g. `Team ProGunn`) — so every Sleeper team always has a `teamName`.
- **Fixed**: The Sleeper player-index cache (`SLEEPER_PLAYERS_CACHE`) now memoizes the parsed player `Map` per sport in module scope instead of re-parsing the cached JSON string on every call, and dedupes concurrent loads for the same sport into a single KV read/Sleeper fetch. `get_roster`/`get_matchups` also kick off that index load in parallel with their own roster/matchup/user fetches (skipped on the roster-summary path, which never enriches). The cache no longer persists a structurally invalid index — empty, or more than half of its entries unusable — from a malformed-but-200 Sleeper payload; it fails closed with a descriptive error instead of poisoning the 24h cache for the mostly-corrupt result.

### Public Site Refresh and Docs Rename (FLA-205, FLA-271)
- **Changed**: The setup pages moved from `/guide` to `/docs` (`/docs`, `/docs/flaim`, `/docs/platforms`, `/docs/ai`, `/docs/sports`) and are labeled "Docs" rather than "guide" or "help". Every old URL — including the legacy `/guide/espn|yahoo|sleeper|chatgpt|claude|perplexity|gemini` shortcuts — permanently redirects to its `/docs` target. `/inspirations` moved to `/about`. Sitemap, canonicals, `llms.txt`, and `llms-full.txt` point at the new routes.
- **Changed**: Public copy now names both official consumer channels — ChatGPT's Plugin Store and Claude's Connector Directory — with Perplexity and other AIs as custom connectors; "Yahoo sign-in" replaces "OAuth" in consumer copy; docs and tool copy say "available players" and "recent moves". The homepage prompt ticker is a continuous marquee again, the football page uses authentic screenshots, and `/support` carries a notice about the ongoing Yahoo Fantasy API access outage.
- **Changed**: The shipped `flaim-fantasy` skill, welcome and league-connected emails, `ai-plugin.json`, connector docs, and README use the same language (Claude named alongside ChatGPT, docs URLs, vocabulary).

## [8.3.0] - 2026-08-20

Corresponds to ChatGPT plugin listing v2.2 submission.

### ESPN Structured Transactions Restored (FLA-140)
- **Fixed**: ESPN `get_transactions` once again serves its structured `mTransactions2` source as primary. The transport now sends only the minimal `filterType` fantasy-filter: ESPN returns HTTP 400 for any filter carrying `limit`/`offset` (with or without sort fields), which is why the structured path was previously unusable. The view exposes no pagination; each pinned scoring period returns ESPN's own full result set for that period, fetched once.
- **Added**: Structured trade rows (`TRADE_ACCEPT`/`TRADE_UPHOLD`) with complete movement items now expose directional `trade_sides` built directly from ESPN's from/to team data; flat `players_added`/`players_dropped` remain. Structured trades missing directional detail are filled from the activity feed (`source: mTransactions2_with_activity_trade_details`), and mixed rows keep their own flat lists while taking activity-derived sides. Failed bids, trade proposals/declines/vetoes/upholds, and FAAB bid amounts are served again via the structured source.
- **Changed**: Response `source` distinguishes `mTransactions2`, `mTransactions2_with_activity_trade_details`, and the `activity_feed` fallback (which remains fully functional and contract-correct if the undocumented primary regresses). `limitations.structured_details_incomplete` is now set only when trade detail is actually incomplete or the fallback served the rows — a complete structured response carries no such limitation. Any structured failure — including partial window coverage — falls back entirely rather than serving silent gaps.

### Provider Attribution (FLA-261)
- **Added**: A new v3 league widget (`ui://widget/user-session-v3.html`) ends with a muted footer crediting "Fantasy data provided by Yahoo Fantasy, ESPN, and Sleeper", with Yahoo Fantasy linking to the official Yahoo Fantasy site (allowlisted in the v3 widget CSP redirect domains only); the tool descriptor now targets v3. Because template URIs are immutable ChatGPT cache keys, the published v1 and v2 resources stay byte-identical to their scanned snapshots (the v2 body is not edited in place). The version-less HTTP fallback widget routes deliberately serve the current (attributed) body. The web app footer already carries the same attribution.

### Normalized Free-Agent Contract (FLA-216)
- **Added**: `get_free_agents` responses now carry a canonical gateway-normalized layer on every platform: an always-present envelope (`leagueId`, `seasonYear`, `position`, `count`, `ordering`, `capabilities`, `ownershipScope`) and, where the platform capability allows, per-entry `acquisitionState` (`free_agent`/`waivers`/`null`, fail-closed on unknown ESPN status values), `waiverClearsAt` (ISO 8601, valid provider timestamps only), `id` (platform-local player id as string), and `team` (real club, `null` when none). Capability gaps are machine-stated (`capabilities`, `ownershipScope: unavailable`) instead of prose-only.
- **Unchanged**: Every legacy platform field — including Sleeper's `players` array key, ESPN's `proTeam`/`FA` sentinel and `status`/`waiverProcessDate`, and Yahoo's `leagueKey` — remains in place indefinitely for published pinned clients. Two shared keys are the deliberate exception, normalized in place: Sleeper's `id` (coerced to string) and Yahoo/Sleeper's `team` (empty or missing becomes `null`). Malformed provider field values map to `null` or are omitted, never guessed; a structurally malformed provider success (non-object payload, missing or non-array player list, non-object entry) now returns a corrective `MALFORMED_PROVIDER_RESPONSE` error instead of an unvalidatable payload. Request echoes (`seasonYear`, `position`) and `count` derive from the validated request and actual returned length, not provider envelope claims.
- **Changed**: Tool description, server instructions, and skill guidance now teach the canonical fields first; measured payload cost is envelope-only for Sleeper (~+2% at 100 rows) and mid-teens to high-twenties percent for ESPN depending on stats blocks.
- **Fixed**: Available-player assistant responses now omit injury detail unless the user asks for it, translate internal ownership-scope enums into provider-wide wording, avoid null-field dumps and all unrequested closing offers, and pass requested result counts exactly within the 100-player limit. ESPN baseball injured-list codes are translated before they reach the response, and requested injury context must still be checked against current web evidence.

### ESPN Daily-Sport Matchup Scoring-Period Metadata (FLA-194)
- **Fixed**: ESPN daily-sport (baseball, basketball, hockey) `get_matchups` with an explicit `week` no longer pins `scoringPeriodId` in the provider request, so the response's `currentScoringPeriod` reports the league's true current scoring period instead of echoing the requested matchup week (e.g. baseball week 15 previously reported scoring period 15 — an April day — in midsummer). Matchup teams and scores are unchanged; they were already filtered by matchup period. Football keeps the pin, where week and scoring period coincide. Closes the `week`-vs-scoring-period conflation family (FLA-192 rosters, FLA-193/198 transactions).

## [8.2.0] - 2026-08-06

Corresponds to ChatGPT plugin listing v2.1.0; also includes the annotation correction shipped in listing v2.0.1.

### Sleeper Transaction Week Validation (FLA-198)
- **Fixed**: Sleeper `get_transactions` with `week: 0` no longer silently returns the recent-activity window. Invalid Sleeper weeks (zero, negative, fractional, non-finite) now fail closed before any provider fetch with a corrective `INVALID_TRANSACTION_WINDOW` error naming both valid request forms (a positive matchup week, or omitting `week` for the recent window). ESPN `week: 0` remains valid preseason; Yahoo behavior is unchanged.

### ESPN Transaction Matchup Windows (FLA-193)
- **Fixed**: ESPN daily-sport transaction selectors now treat public `week` as a matchup period and expand it through the actual daily keys in the `mMatchupScore` schedule instead of mistaking it for one calendar-day scoring period. ESPN's similarly named `scheduleSettings.matchupPeriods` field groups weekly/playoff periods and is not a daily-scoring map.
- **Guarded**: The legacy daily-scoring compatibility path refuses values that are known future matchup IDs, preventing a future week from being reinterpreted as an unrelated historical scoring day.
- **Added**: ESPN transaction responses report the normalized matchup window, exact provider scoring periods, Eastern-time date bounds when available, source, and explicit limitation/omission metadata.
- **Changed**: The activity feed is the authoritative live source while the structured endpoint remains disabled. Rows without trustworthy window evidence are omitted, and structured-only failed-bid/trade-lifecycle filters return `ESPN_TRANSACTION_TYPE_UNAVAILABLE` instead of a false empty result.
- **Changed**: ESPN activity-feed waiver rows now report `faab_bid: null`; the former message-field heuristic could not prove a bid amount. Structured FAAB amounts remain unavailable until FLA-140 restores the structured transaction source.

### MCP Annotation Correction (FLA-252)
- **Changed**: Tool annotations now match each call boundary. The seven read-only analysis tools routed to ESPN, Yahoo, or Sleeper and the provider-reading `refresh_leagues` tool declare `openWorldHint: true`; the two Flaim-registry-only reads (`get_user_session`, `get_ancient_history`) remain `false`. `refresh_leagues` also stays non-read-only, non-destructive, and non-idempotent because each call can update registry timestamps and provider metadata. Supersedes the blanket `openWorldHint: false` declared under FLA-177, which read open-world as publicly-visible internet writes; current OpenAI guidance applies it to any tool that interacts with external systems or accounts.

### Eval Static Key Gains Bounded Write Scope
- **Changed**: The eval static API key now introspects with `mcp:read mcp:write` so the eval harness can exercise the full ten-tool contract, including the bounded `refresh_leagues` registry rewrite. The demo static key remains read-only (`mcp:read`).

### MCP Descriptor Modernization (FLA-177)
- **Added**: All ten MCP tools now declare an `outputSchema`, and every success path emits matching `structuredContent` alongside the unchanged text content.
- **Added**: Top-level per-tool `securitySchemes` on the tools/list wire shape, alongside the existing `_meta.securitySchemes` mirror.
- **Changed**: Tool calls with a valid token that merely lacks the required scope now answer with an RFC 6750 `insufficient_scope` challenge (previously `invalid_token`), so clients can run a consent upgrade instead of a full re-auth.
- **Changed**: HTTP 401 `WWW-Authenticate` responses append `error="invalid_token"`/`error_description` when a presented token fails; requests carrying no credentials keep the bare discovery-only header (RFC 6750 §3.1).
- **Changed**: Tool annotations corrected: `openWorldHint` was set to `false` across all tools (closed-system reads against connected leagues). `refresh_leagues` stays non-idempotent — each call re-runs provider discovery and can update registry timestamps/metadata. *Superseded by the FLA-252 annotation correction above.*
- **Added**: The v2 widget resource now carries `openai/widgetDescription`; the frozen published-v1 widget resource stays byte-identical to the scanned snapshot.

### Published-Client Week Compatibility for Daily-Sport Rosters (FLA-209)
- **Changed**: `get_roster` no longer rejects a well-formed `week` on ESPN/Yahoo daily sports (baseball, basketball, hockey). Clients pinned to an older tool schema — where `week` was valid for every sport — can only send `week`, so those requests now return the current roster instead of an `INVALID_ROSTER_SNAPSHOT_SELECTOR` error. The response's `snapshot` block reports `requested_week` and a human-readable `note` stating the week selector was ignored because the sport tracks roster history by date (`as_of_date`), so nothing is silently dropped. All other validation is unchanged: `week` + `as_of_date` together, malformed weeks, wrong-selector `as_of_date` on weekly sports, and unsupported sports still return corrective errors. This behavior must remain until no published client depends on the week-for-daily-sports request shape.

### Roster Snapshot Contract (FLA-192)
- **Fixed**: `get_roster` no longer conflates matchup weeks with ESPN's daily scoring periods. Passing a `week` for an ESPN baseball/basketball/hockey league previously returned a snapshot from early in the season (e.g. matchup week 15 → an April roster) presented as current; it now returns a corrective error naming the right selector.
- **Added**: `as_of_date` (`YYYY-MM-DD`) selector for historical calendar-day rosters on ESPN and Yahoo daily sports. ESPN dates resolve through a validated season-calendar anchor (constant Eastern-time day-offset, off-days included, fail-closed on invariant violations); Yahoo daily sports now emit `;date=` instead of the football-only `;week=`.
- **Added**: Sleeper historical weekly rosters (NFL weeks, NBA legs) from the matchups endpoint — frozen starters, derived bench, points, and player points — instead of silently ignoring `week`.
- **Added**: Every roster response carries a `snapshot` block (`current` | `week` | `date`, plus `providerScoringPeriodId` diagnostics on ESPN); historical responses flag `acquisitionMetadataAvailable` / `reserveAndTaxiClassificationAvailable` when provider history omits that detail.
- **Fixed**: Sleeper taxi-squad players are no longer misclassified as bench; current rosters now report a `taxi` list.
- **Changed**: Worker deploys are ordered in CI — platform workers first, then the fantasy-mcp gateway — so contract changes can't race ahead of providers.

### Yahoo App Fingerprint Guard (FLA-133)
- **Added**: Yahoo credential rows now record a non-secret fingerprint of the Yahoo app that minted the stored tokens (first 12 hex chars of SHA-256 of the client id — never the client id, secrets, or tokens). Stamped on reconnect and on every successful refresh, which backfills legacy rows.
- **Added**: A pre-refresh guard skips the doomed Yahoo token call when the stored fingerprint doesn't match the runtime app and returns a coded `app_fingerprint_mismatch` reconnect-required error, so app-secret swaps no longer masquerade as generic refresh failures. Legacy rows without a fingerprint refresh as before.
- **Added**: The internal credential-health endpoint and structured refresh diagnostics report stored/runtime fingerprints with a `match`/`mismatch`/`legacy_null` status.

### Provider Refresh Cooldown + Sync Telemetry (FLA-121)
- **Added**: League refresh and ESPN discovery now run under a per-user, per-provider single-flight lease with post-refresh cooldowns (~75s normal; 5 minutes or the provider's `Retry-After` after upstream 429s/timeouts), backed by a new `provider_sync_state` table that also records last attempt/success/failure telemetry for each provider.
- **Changed**: When every requested provider is cooling down, refresh endpoints return a consistent `429 refresh_cooldown` with `retry_after` and a `Retry-After` header (partially blocked syncs still return 200 with per-provider results); the ESPN refresh proxy now preserves `Retry-After` to the browser.
- **Added**: One structured `provider_sync` log line per provider refresh (provider, masked user, source, status, duration, league count, error code, retry seconds, correlation id) queryable in Workers Logs.

### League Refresh Hardening
- **Changed**: Consent is now scope-aware: read-only requests disclose read access, while `mcp:write` requests disclose that refresh may add or update Flaim registry records without changing provider data.
- **Fixed**: OAuth authorization transactions now use exact, atomic request binding and validation.
- **Changed**: Refresh widgets now report complete, unchanged, partial, retry, and reconnect outcomes accurately.
- **Fixed**: ESPN league refresh now groups matching league IDs by sport to avoid cross-sport collisions.
- **Changed**: `refresh_leagues` is now marked non-idempotent to reflect its write behavior.

### ESPN Historical Championship Outcomes (FLA-136)
- **Fixed**: Historical `get_standings` seasons where ESPN leaves every team's final rank at 0 no longer report false outcomes with `outcomeConfidence: "explicit"`. When explicit final ranks are absent, the champion and runner-up are now derived from the final `WINNERS_BRACKET` matchup and reported with `outcomeConfidence: "derived"`; teams without rank or bracket evidence stay null (unknown) instead of false. Applies to all four ESPN sports.

### ESPN Tie-Rule Settings and Tied-Final Resolution (FLA-176)
- **Added**: `get_league_info` now surfaces the league's tiebreaker configuration from ESPN settings: `matchupTieRule`/`matchupTieRuleBy` (regular season), `playoffMatchupTieRule`/`playoffMatchupTieRuleBy` (playoffs), and `homeTeamBonus`/`playoffHomeTeamBonus`.
- **Changed**: A tied championship game in a completed season is now resolved using the league's playoff tie rule instead of returning unknown — `NONE` (ESPN's default) advances the higher seed, `HOME_TEAM_WINS` the home finalist; unrecognized rules or missing seeds still return unknown. Results keep `outcomeConfidence: "derived"` because league managers can manually override playoff advancement. The settings ride the existing bracket lookup, adding no extra ESPN calls.

### ESPN Transactions Error Handling (FLA-171)
- **Fixed**: Prior-season ESPN transaction requests now return a clear `ESPN_SEASON_NOT_SUPPORTED` error (guarded before any upstream calls) instead of a misleading `ESPN_NOT_FOUND`; the message directs a retry only when the user meant the ongoing season.
- **Changed**: `season_year` tool descriptions no longer hard-code example years (which invited models to pass stale seasons); they now steer to the season returned by `get_user_session`.
- **Fixed**: Auth-worker 429 responses surface as `AUTH_RATE_LIMITED` instead of `INTERNAL_ERROR`.

### ChatGPT Signup Round-Trip (FLA-173)
- **Fixed**: Post-signup destination is now `/leagues` instead of the marketing home page (component `fallbackRedirectUrl` + Vercel env; a `redirect_url` param such as the OAuth consent round-trip still takes precedence).
- **Added**: Widget manage-leagues links carry a host-neutral `?from=widget`; `/leagues` shows a 3-step finish-setup banner (create account → connect a league → return to your AI assistant) for signed-out or zero-league visitors, with screen-reader-accessible step states.
- **Changed**: `.env.example` moved off deprecated Clerk `AFTER_SIGN_*` redirect vars to the current `*_FALLBACK_REDIRECT_URL` names.

### League Visibility — Active / Inactive / Hidden (FLA-124, FLA-150, FLA-151, FLA-152)
- **Added**: Three-state league visibility across ESPN, Yahoo, and Sleeper. From `/leagues`, users can **Archive** a recurring league (dropped from the active `get_user_session` view but still browsable via `get_ancient_history`) or **Hide** it (suppressed from both AI tools), and Restore at any time. Keyed on a stable recurring-league identity (`archived_leagues` table with a `mode` column) so it survives annual re-syncs; the AI-facing read fails closed (a lookup error never leaks a suppressed league) and tolerates the pre-migration schema. Migration 025 adds `mode`, backfilling existing archived rows to `hidden`.
- **Changed**: `/leagues` now groups leagues into **Active**, **Inactive** (auto-aged-out + manually archived), and **Hidden**, replacing the earlier separate Old Leagues / Archived sections.

### Season Rollover (FLA-148)
- **Changed**: Football's current-season rollover moved from July 1 to June 1, so the upcoming season surfaces as active a month earlier (a longer pre-draft window). Other sports unchanged (baseball Feb 1, basketball/hockey Aug 1).

## [8.1.0] - 2026-06-10

### Chrome Extension v1.5.2
- **Fixed**: Non-JSON error responses no longer crash the extension API client; fetch timeouts added (15s default, 60s for discovery) so failures surface instead of spinning indefinitely; discover step re-fetches the Clerk JWT to avoid stale-token failures.
- **Added**: Sender-origin validation in the background service worker with strict origin matching (no subdomain bypass); allowed origins derived from `VITE_SITE_BASE` so preview builds work automatically.
- **Changed**: Popup error messages sanitized and length-capped; support-copy payload minimizes PII.

### MCP OAuth
- **Changed**: MCP OAuth refresh-token inactivity window is now 1 year by default (`OAUTH_REFRESH_TOKEN_TTL_SECONDS`, default `31536000`, clamped to 1 hour minimum and 1 year maximum) while access tokens remain 1 hour and refresh tokens continue rotating on successful refresh.
- **Fixed**: `/oauth/status` now reports an active AI connector when a non-revoked refresh token is still valid, even after the current 1-hour access token expires.

### Documentation
- **Changed**: Updated repo docs to reflect the current chat split: public `/chat` live demo and internal `/dev` lab.
- **Fixed**: Removed stale dev-only chat framing and cleaned unresolved merge-conflict markers from `docs/ARCHITECTURE.md`.

### Yahoo Connection Reliability
- **Added**: Yahoo token-refresh diagnostics now emit structured non-secret refresh events with failure classes, outcomes, request-timeout/lease-budget fields, and an internal credential-health endpoint for production incident triage.
- **Added**: Yahoo token-refresh diagnostics now distinguish Yahoo-provided `Retry-After` headers from Flaim fallback cooldowns with `retry_after_source`, and log non-secret token request shape fields (grant type, callback URL/host/path, redirect URI presence, caller auth type, and Yahoo client credential presence) to investigate recurring refresh failures.
- **Added**: Yahoo connection management on `/leagues` now separates **Sync leagues** from **Reconnect Yahoo** and shows coarse temporary-unavailable/reconnect-needed states.
- **Changed**: Yahoo refresh-token grants now omit `redirect_uri`, returning lazy refresh to the simpler March-era request shape while keeping `redirect_uri` on authorization-code exchange.
- **Changed**: Yahoo access tokens now use the original 5-minute proactive refresh buffer again so user-facing tool calls avoid landing exactly on the 1-hour access-token expiry boundary.
- **Changed**: Yahoo token refresh now performs a single token-endpoint request per lease owner and leaves the short lease in place on transient failures so concurrent waiters back off instead of immediately retrying Yahoo.
- **Changed**: Yahoo rate-limit-like token refresh failures (`429`/`999`) now convert the active lease into a short shared cooldown marker, using Yahoo's `Retry-After` header when present and a 60-second fallback when Yahoo omits it.
- **Changed**: Permanent Yahoo token-refresh failures now release the per-user refresh lease and surface upstream status/retry metadata immediately instead of writing a persisted cooldown marker that can mask malformed/permanent failures.
- **Changed**: Yahoo lazy token refresh still uses a per-user lease for concurrency, but only rate-limit-like refresh failures become shared persisted cooldowns.
- **Changed**: Yahoo successful refresh handling now recovers rotated refresh-token writes when the lease-owner guard misses but the row still contains the old refresh token, preventing a valid Yahoo refresh response from being discarded after Yahoo revokes the previous refresh token.
- **Changed**: Yahoo reconnect now stores the authorization-code token response directly and no longer spends the returned refresh token in a same-callback validation refresh before the first real post-expiry lazy refresh.
- **Changed**: Yahoo **Sync leagues** on `/leagues` now uses the stored connection to rediscover leagues instead of starting a fresh OAuth flow every time.
- **Changed**: Yahoo refresh lease waiters now return an explicit retryable response before the MCP gateway timeout budget is exhausted.
- **Added**: Yahoo token-endpoint failure diagnostics now capture sanitized body excerpts, `WWW-Authenticate`, content type, Yahoo response headers, numeric Yahoo error codes, and seconds since the stored credential update.
- **Removed**: Unconditional raw Yahoo response debug logs from successful yahoo-client tool calls; production diagnostics should use structured non-secret auth-worker events and request/completion metadata instead of roster/league payload slices.
- **Fixed**: Repeated Yahoo failures after the 1-hour access token expired now preserve upstream status and sanitized upstream body text in diagnostics instead of collapsing into a generic cooldown state.
- **Fixed**: Yahoo league discovery rate limits (`429`/`999`) and transient upstream failures now return retryable responses with `Retry-After` instead of generic refresh failures.
- **Fixed**: Yahoo token-refresh failures preserve upstream status and retry metadata through MCP tool errors.
- **Fixed**: Yahoo retry metadata now propagates through yahoo-client and fantasy-mcp instead of collapsing into generic tool errors.
- **Fixed**: Yahoo discovery now persists `team_key` for pending waiver/trade transaction lookups.

### Security Hardening
- **Fixed**: OAuth authorization code race condition — atomic `UPDATE...WHERE used_at IS NULL` prevents double-exchange attacks.
- **Fixed**: PKCE `code_verifier` validation — enforces 43-128 char length and unreserved charset per RFC 7636, with constant-time challenge comparison.
- **Changed**: Rate limiting replaced from Supabase `rate_limits` table to Cloudflare Workers native `rate_limits` bindings (zero-latency, no DB round-trips). Token endpoint: 10 req/60s per IP. Credentials endpoint: 15 req/60s per user.
- **Fixed**: SSRF allowlist in debug route — pins `workers.dev` check to Flaim CF account subdomain (blocks `fantasy-mcp.evil.workers.dev`), gates localhost behind `NODE_ENV=development`.
- **Changed**: Error messages in platform clients sanitized — details logged server-side only.
- **Changed**: Yahoo OAuth redirect validated against `*.yahoo.com` to prevent open redirects.

### ESPN Transaction Enrichment
- **Changed**: ESPN `get_transactions` now uses `mTransactions2` endpoint as primary data source instead of the activity feed. Provides structured FAAB bid amounts, failed/losing waiver bids (`type=failed_bid`), and full trade lifecycle (`trade_proposal`, `trade_decline`, `trade_veto`, `trade_uphold`).
- **Changed**: Accepted/upheld trade player details automatically supplemented from activity feed (ESPN bug workaround — accepted trade `items` arrays are empty).
- **Added**: New transaction types: `failed_bid`, `trade_proposal`, `trade_decline`, `trade_veto`, `trade_uphold`.

### Yahoo Pending Transactions
- **Added**: Yahoo `get_transactions` now supports `type=waiver` (pending waiver claims) and `type=pending_trade` (proposed trades). These fetch the authenticated user's own team's pending items using stored team_key.
- **Added**: `waiver_priority` and `pending_trade` type to transaction responses.

### Session & History Tool Contract
- **Changed**: `get_user_session` now returns only current-season leagues (was top 2 seasons). Smaller payload, no contradictory instructions. **[tool-contract]**
- **Changed**: `get_ancient_history` now includes last season (was only 2+ years old). Closes the gap where last season appeared in neither tool.
- **Removed**: Widget client-side dedupe logic (no longer needed — server sends one season per league).
- **Changed**: Scope-resolution guidance now explicitly distinguishes vague singular prompts from plural/comparative fan-out, and synced the Flaim skill copies to the current MCP contract. **[tool-contract]**

### Plugin Distribution
- **Changed**: Claude/Cowork plugin now loads skills from `.agents/skills/` directly via `plugin.json`, removing the duplicated top-level `skills/` copy and making `.agents/skills/` the single source of truth.
- **Added**: Dedicated plugin skills (`activity-brief`, `analyze-matchup`) migrated from the legacy `commands/` workflows and explicitly bundled in `plugin.json`.
- **Added**: Model invocation support for `activity-brief` and `analyze-matchup` in Cowork after runtime testing showed `disable-model-invocation: true` still surfaced auto-selection attempts, but the runtime rejected execution before the skill workflow could run.

### Season Year Defaults
- **Fixed**: Manual "Add League" dialog now defaults to the sport-aware current season year instead of the calendar year. Football/basketball/hockey now correctly default to 2025 in March 2026 (rollover not yet hit). Baseball correctly shows 2026 (Feb 1 rollover passed). Affects initial state, "This season" button, and sport-change reset.
- **Added**: `web/lib/season-utils.ts` — `getDefaultSeasonYear(sport)` mirroring the auth-worker rollover logic for use in the web layer.

## [8.0.0] - 2026-03-04

### Search Players Tool
- **Changed**: Renamed MCP tool `search_players` -> `get_players` for naming consistency with `get_*` tool conventions. **[tool-contract][breaking]**
- **Changed**: Updated worker routing, tests, and docs to use `get_players`.
- **Changed**: `get_players` now includes market ownership fields (`market_percent_owned`, `ownership_scope`) with explicit scope semantics.
- **Changed**: Ownership guardrails clarified — market ownership is platform/global context only and must not be used to infer league ownership.
- **Changed**: Sleeper `get_players` explicitly returns ownership unavailable semantics (`market_percent_owned: null`, `ownership_scope: "unavailable"`).

### Plugin Commands
- **Changed**: Renamed plugin slash commands `/activity` -> `/activity-brief` and `/matchup` -> `/analyze-matchup` to reduce ambiguity with MCP tools.

### Transactions Tool
- **Added**: `get_transactions` tool shipped in unified gateway (`fantasy-mcp`) and ESPN, Yahoo, and Sleeper clients.
- **Changed**: ESPN and Sleeper honor explicit `week` parameter; default to current + previous week when omitted.
- **Changed**: Yahoo uses a recent 14-day timestamp window and ignores explicit `week` (v1 limitation documented).
- **Note**: Yahoo `type=waiver` filtering intentionally unsupported in v1.

### OpenAI Submission Prep
- **Added**: Demo account (`demo@flaim.app`) with password auth via Clerk for OpenAI reviewer access.
- **Added**: Domain verification route (`/.well-known/openai-apps-challenge`) in `fantasy-mcp`; reads token from `OPENAI_APPS_VERIFICATION_TOKEN` Wrangler secret.

### Terms of Service
- **Added**: `/terms` page live at `https://flaim.app/terms`.
- **Changed**: Footer, sitemap, and connector docs updated with Terms link.

### MCP Tool Annotations
- **Added**: `openWorldHint: true` and `destructiveHint: false` annotations on all MCP tools for OpenAI directory compatibility.

### ESPN Transaction Enrichment
- **Changed**: Player name enrichment now uses ESPN's global `/players?view=players_wl` endpoint with `filterIds` instead of the mRoster + FA pool workaround. Single request, no auth required, works for all sports.
- **Added**: `teams` map (team ID → display name) included in `get_transactions` response so the LLM can resolve numeric team IDs to human-readable names.
- **Changed**: `getCurrentEspnScoringPeriod` replaced with `getEspnLeagueContext` which returns both `scoringPeriodId` and teams in one call (`mSettings` + `mTeam` views).

### Added
- Sleeper fantasy platform support (Phase 1): `get_league_info`, `get_standings`, `get_roster`, `get_matchups` for NFL and NBA
- Sleeper username-based onboarding with historical season discovery (up to 5 years)
- New `sleeper-client` Cloudflare Worker
- `sleeper_connections` and `sleeper_leagues` database tables
- **Sleeper Phase 2**: `get_free_agents` for Sleeper NFL and NBA through unified gateway
- **Sleeper Phase 2**: KV-backed player index cache (`SLEEPER_PLAYERS_CACHE`) with 24h TTL and in-memory fallback
- **Sleeper Phase 2**: Sleeper transactions now enriched with player name, position, and team from KV cache
- **Sleeper Phase 2**: `get_free_agents` gateway schema updated to accept `platform: "sleeper"` alongside ESPN and Yahoo

### MCP
- **Added**: OpenAI `toolInvocation` status messages on all MCP tools — ChatGPT now shows contextual status text (e.g., "Fetching standings…") instead of generic "Called tool" while tools run.

### Chrome Extension v1.5.1
- **Added**: ESPN login status checklist in popup ready state — shows "Signed in to Flaim" and "ESPN detected" before syncing.
- **Fixed**: Discovery message no longer includes redundant "ESPN" prefix ("Found 3 leagues + 6 past seasons").
- **Fixed**: `getCredentials` and `getCredentialMetadata` use `.maybeSingle()` — no longer logs spurious PGRST116 errors for new users with no credentials.

### SEO
- **Added**: Next.js metadata routes for `/sitemap.xml` and `/robots.txt` in `web/app/sitemap.ts` and `web/app/robots.ts`.
- **Fixed**: Search Console sitemap submission now has a real crawl target instead of `404` for missing sitemap/robots endpoints.

### Basketball & Hockey Support
- **Added**: ESPN basketball handlers (5 tools) with position, team, and stat mappings.
- **Added**: ESPN hockey handlers (5 tools) with skater/goalie stat split mappings.
- **Added**: Yahoo basketball handlers (5 tools) with position mappings.
- **Added**: Yahoo hockey handlers (5 tools) with position mappings.
- **Added**: Basketball/hockey now routable in both ESPN and Yahoo clients.
- **Added**: Basketball/hockey enabled for ESPN onboarding (discover-seasons).
- **Note**: All ESPN mappings sourced from `cwendt94/espn-api` — marked unverified pending live league testing.

### Distribution
- **Added**: Published Flaim to the official MCP registry (`registry.modelcontextprotocol.io`) as `app.flaim/mcp` v1.0.1 with DNS-based domain verification.
- **Added**: Listed on MCP.so as `flaim-fantasy`. Listed on Glama (auto-indexed from GitHub).
- **Added**: Submitted to awesome-mcp-servers (PR #1918, pending review). PulseMCP auto-indexes from official registry.
- **Added**: `server.json` in repo root for MCP registry publishing.

### MCP Interoperability
- **Fixed**: Resolved MCP connector discovery failures (`424`) by hardening transport behavior at `/mcp`.
- **Changed**: MCP protocol endpoint now rejects non-POST requests with `405 Allow: POST` to avoid hanging GET stream paths.
- **Changed**: Fantasy MCP handler now uses stream-mode responses (`enableJsonResponse: false`) for improved connector compatibility.
- **Changed**: Tool security metadata normalized to canonical array-based `securitySchemes` shape.

### OAuth
- **Fixed**: Resolved intermittent `Invalid or expired state` failures during MCP connector approval (Codex/ChatGPT) when returning from sign-in to consent.
- **Changed**: Authorization redirect now includes `oauth_state` (while preserving legacy `state`) to avoid collisions with auth-provider query params during consent round-trips.
- **Added**: More specific auth-worker logging for OAuth state validation failures (missing lookup, expiry, redirect URI mismatch, client ID mismatch).
- **Added**: Eval API key auth path in auth-worker for headless eval-harness execution (optional allowlist for MCP-read routes).

### Infrastructure
- **Changed**: Upgraded Tailwind CSS v3 → v4. Migrated config from `tailwind.config.ts` to CSS-based `@theme` in `globals.css`. Replaced `tailwindcss-animate` with `tw-animate-css`. Updated PostCSS to use `@tailwindcss/postcss`.
- **Removed**: Codebase audit — deleted legacy KV auth archive, 5 orphaned UI components, abandoned vector store feature (components + API routes), extension v1.2.x backwards-compat fields, and deprecated `GambitLeague` type (renamed to `DiscoveredEspnLeague`).
- **Fixed**: Resolved all Supabase security advisor warnings — enabled RLS on `oauth_states` table and pinned `search_path` on all 7 public functions. Migration: `013_security_advisor_fixes.sql`.
- **Changed**: Replaced all `as any` type assertions in `espn-client` with typed ESPN API response interfaces (`EspnLeagueResponse`, `EspnPlayerPoolResponse`, etc.). Covers football, baseball, and onboarding handlers.
- **Removed**: Legacy sport MCP workers (`baseball-espn-mcp`, `football-espn-mcp`) archived and removed from repository. Unified gateway (`fantasy-mcp`) is now the sole MCP endpoint.
- **Changed**: Removed legacy workers from CI/CD pipeline, local dev scripts, and documentation.
- **Preserved**: Legacy worker code preserved in git tag `legacy-sport-mcp-workers` for reference. Access via `git checkout legacy-sport-mcp-workers` or browse on GitHub.

### Documentation
- **Added**: `docs/STYLE-GUIDE.md` — Comprehensive frontend style guide covering design tokens, typography, spacing, component guidelines, accessibility standards, and code conventions.
- **Added**: `workers/yahoo-client/README.md` — Yahoo client worker documentation covering OAuth, JSON normalizers, and sports handlers.
- **Changed**: Promoted UI consistency rules from `docs/dev/ui-consistency.md` to permanent documentation with expanded scope.
- **Changed**: Archived `docs/dev/ADD_YAHOO_PLATFORM.md` to `docs/archive/` (Phase 3 complete).
- **Changed**: Consolidated current execution/sprint state into `docs/dev/CURRENT-EXECUTION-STATE.md` and archived superseded Feb 2026 sprint/incident plans.
- **Changed**: Refreshed docs source-of-truth routing in `docs/INDEX.md`, `docs/STATUS.md`, and `docs/dev/TODO.md`.
- **Changed**: Externalized stale `docs/archive/*.md` and `docs/plans/*.md` out of the public repo for lightweight checkouts.

### Branding
- **Changed**: New flaming baseball logo for site favicon, apple-touch-icon, and Chrome extension icons.
- **Changed**: Extension version bumped to 1.4.2.

### Site Loading States
- **Fixed**: Leagues page no longer shows full-page spinner while checking ESPN credentials. Page structure renders immediately after Clerk auth loads.
- **Added**: "Loading your leagues..." label on league list spinner for clearer feedback.
- **Added**: Inline "Checking..." badge in ESPN maintenance section while credential status loads.
- **Fixed**: Homepage ESPN and Yahoo platform columns no longer shift height when status checks complete (added `min-h`).
- **Changed**: ESPN maintenance buttons restyled to match Yahoo — side-by-side `sm` buttons instead of stacked full-width.

### Developer Console
- **Added**: Per-turn token usage display in LLM Trace section — shows input, output, total tokens (plus cached/reasoning subtotals when present). Ephemeral, in-memory only.
- **Added**: Session-level token totals in LLM Trace section header.

### Chat UX
- **Added**: Default sport and team selector pills in chat status bar. Users can click to switch sport/team without leaving the chat. Persists to Supabase via existing preference APIs.
- **Changed**: Replaced static active-league pill with two interactive `Popover`-based pills (sport + team).
- **Fixed**: Chat loading indicator no longer disappears 5+ seconds before content appears. Loading state stays visible until actual text or tool call UI renders.
- **Added**: Collapsible "Thinking..." pill replaces the tiny 12px pulsing dot. Shows a spinner with status text. When using reasoning models, the pill can be expanded to show live reasoning summary text.
- **Added**: Handles new SSE events (`response.created`, `response.in_progress`, `response.reasoning_summary_text.delta`) for richer loading feedback.
- **Added**: `reasoning: { summary: "auto" }` to OpenAI API call to enable reasoning summary streaming.

### UI Consistency
All frontend components now use semantic design tokens instead of hard-coded Tailwind palette classes, ensuring consistent light/dark theme support.

- **Added**: Semantic CSS tokens (`success`, `warning`, `info`) in `globals.css` and `tailwind.config.ts`.
- **Added**: `success`, `warning`, `info` variants for Alert and Badge components.
- **Added**: `npm run ui:check` script to detect hard-coded color violations.
- **Added**: `docs/dev/ui-consistency.md` developer guide.
- **Changed**: All chat, landing, leagues, and config components migrated to design tokens.
- **Removed**: Dead components (`panel.tsx`, `StepSyncEspn.tsx`, `EspnCredentialsCard.tsx`).

### Yahoo Fantasy Platform Support
Yahoo Fantasy now works through the unified gateway alongside ESPN. **Full feature parity achieved for both football and baseball (5/5 tools each).**

- **Added**: `yahoo-client` worker - Yahoo Fantasy API client for all sports
- **Added**: Yahoo OAuth token refresh flow via auth-worker
- **Added**: Yahoo-specific JSON normalizers for quirky API format (numeric-keyed objects, nested arrays)
- **Added**: Yahoo football handlers: `get_league_info`, `get_standings`, `get_roster`, `get_matchups`, `get_free_agents`
- **Added**: Yahoo baseball handlers: `get_league_info`, `get_standings`, `get_roster`, `get_matchups`, `get_free_agents` (Phase 3 complete)
- **Added**: Baseball position mappings (C, 1B, 2B, 3B, SS, OF, SP, RP, P, Util)
- **Added**: Position filter mapping for Yahoo free agent searches (football + baseball)
- **Added**: `YAHOO` service binding in fantasy-mcp gateway
- **Added**: `yahoo-client` to CI/CD pipeline (test + deploy) and `docs/STATUS.md`
- **Added**: Unit tests for Yahoo normalizers (27 tests)
- **Fixed**: Snake_case/camelCase mismatch between auth-worker and yahoo-client credentials
- **Fixed**: Yahoo matchup parsing for numeric-keyed object structure
- **Fixed**: Team key construction for roster endpoint (Yahoo requires full key, not just numeric ID)

### Chrome Extension v1.4.1 - Clerk Sync Host Fix
Critical fix for extension authentication - users can now sign in successfully via Clerk Sync Host.

- **Fixed**: Clerk Sync Host now correctly points to `https://clerk.flaim.app` instead of `https://flaim.app`, resolving authentication failures where extension couldn't detect signed-in status from flaim.app.
- **Changed**: Extension version bumped to 1.4.1.

### Chrome Extension Simplification
Default league selection removed from extension - defaults are now managed exclusively via the web UI at `/leagues`.

- **Removed**: Default league selection step from extension setup flow.
- **Removed**: `POST /extension/set-default` endpoint (both Next.js proxy and auth-worker handler).
- **Changed**: Extension flow simplified to: sync → discover → complete.
- **Changed**: Extension version bumped to 1.4.0.

### Unified Gateway Architecture (Phase 0) - Complete
Major architectural restructure implementing a unified gateway pattern for multi-platform fantasy sports support. **Validated and promoted as primary endpoint (Jan 2026).**

- **Added**: `fantasy-mcp` worker - unified MCP gateway with platform-agnostic tools
- **Added**: `espn-client` worker - internal ESPN API client for all sports
- **Added**: Service bindings between gateway and platform workers
- **Added**: Unified MCP tools: `get_user_session`, `get_league_info`, `get_standings`, `get_matchups`, `get_roster`, `get_free_agents`
- **Added**: `/fantasy/*` routes on `api.flaim.app` for gateway access
- **Added**: `platform` field to auth-worker league responses
- **Added**: Request logging in `espn-client` for observability (tool, sport, league, timing)
- **Changed**: ESPN handlers consolidated from per-sport workers into `espn-client`
- **Changed**: Auth binding renamed from `AUTH` to `AUTH_WORKER` for consistency
- **Changed**: Frontend updated to show unified gateway URL as primary connector
- **Fixed**: Football season rollover date (March 1 → June 1) to match documentation
- **Deprecated**: Legacy workers (`baseball-espn-mcp`, `football-espn-mcp`) - still functional as fallback

Historical implementation plans are maintained outside this public repo.

### Worker Infrastructure: Hono + MCP SDK
Migrated all 3 Cloudflare Workers to Hono routing framework and official MCP SDK. Cleaner code, better testing support, ~400 lines removed.

- **Added**: Hono routing framework to all workers (auth-worker, baseball-mcp, football-mcp).
- **Added**: Official MCP SDK (`@modelcontextprotocol/sdk`) for protocol handling in MCP workers.
- **Added**: `@flaim/worker-shared` package with CORS middleware, auth-fetch helper, and shared types.
- **Added**: Zod schemas for all MCP tool inputs with runtime validation.
- **Added**: Tool annotations (`readOnlyHint`, `title`) for Claude/ChatGPT directory compatibility.
- **Changed**: MCP workers now use `WebStandardStreamableHTTPServerTransport` (no Node shims).
- **Changed**: Manual `if (pathname === ...)` routing replaced with Hono routes.
- **Changed**: Manual JSON-RPC parsing replaced with SDK handlers.
- **Removed**: Old `index.ts` entry points (3 workers).
- **Removed**: Old MCP agent files (`agent.ts`, `football-agent.ts`).

### Developer Console Overhaul
Replaced the chat sidebar with an enhanced Developer Console for MCP debugging. Includes dynamic tool fetching and UI optimizations.

- **Added**: Developer Console with 3 collapsible sections (MCP, Tools, Debug).
- **Added**: Compact header popovers for Account and ESPN status.
- **Added**: Minimal chat header with league dropdown, season dropdown, and environment badge.
- **Added**: Dynamic tool fetching from MCP server via `tools/list` (no static fallback).
- **Added**: `/api/debug/test-mcp` endpoint for MCP connection testing (SSRF-protected), with latency + timestamps.
- **Added**: LLM MCP payload preview (redacted), tool schema previews, and session-scoped tool call log.
- **Added**: `mcpAvailableTools` and `disabledMcpTools` store fields for tool management.
- **Changed**: Environment badge, league selector, season selector, Account/ESPN status moved from sidebar to header.
- **Changed**: Tool toggles now use `disabledMcpTools` array instead of CSV `allowed_tools`.
- **Fixed**: Developer Console sidebar now scrolls correctly when multiple sections are expanded.
- **Removed**: `components/chat/tools-panel.tsx` and `components/chat/mcp-config.tsx` (replaced).

### Chrome Extension v1.3.0 - Clerk Direct Auth
Replaces custom pairing-code token exchange with direct Clerk authentication via Sync Host. Users signed into flaim.app automatically authenticate in the extension.

- **Added**: `@clerk/chrome-extension` SDK integration with Sync Host.
- **Added**: `ClerkProvider.tsx` wrapper component for extension popup.
- **Added**: Clerk session sync from flaim.app to extension (no pairing codes needed).
- **Added**: `createClerkClient` in background service worker for ping responses.
- **Added**: `signedIn` and `userId` fields in extension ping response.
- **Changed**: Extension popup uses Clerk `useAuth()` hook instead of custom token storage.
- **Changed**: All extension API endpoints now accept Clerk JWTs (not custom extension tokens).
- **Changed**: Web `/extension` page simplified (removed pairing code UI, disconnect button).
- **Changed**: `extension-ping.ts` updated for new `signedIn`/`userId` response format.
- **Removed**: Pairing code generation (`/api/extension/code`).
- **Removed**: Code exchange (`/api/extension/pair`).
- **Removed**: Token revocation (`/api/extension/token`).
- **Removed**: `extension-storage.ts` (extension token CRUD).
- **Removed**: Custom extension token validation in auth-worker.

### Chrome Extension v1.2.1 - Extension Status Ping
Adds direct website-to-extension ping to show real-time connection status, with better non-Chrome fallbacks and local dev support.

- **Added**: `externally_connectable` ping from `flaim.app` and `localhost` for real-time status checks.
- **Added**: Extension background service worker responds to external ping requests.
- **Added**: Local dev support via `NEXT_PUBLIC_EXTENSION_IDS` to ping unpacked extensions.
- **Changed**: Extension status UI now prefers ping results over server records; non-Chrome browsers show server fallback.

### Chrome Extension v1.2.0 - Fan API Discovery Refactor
ESPN deprecated the `mUserLeagues` endpoint, breaking auto-discovery. This release switches to the new Fan API endpoint, massively simplifying the code while fixing the issue.

- **Fixed**: League auto-discovery now works again (ESPN deprecated old endpoint).
- **Changed**: Replaced `lm-api-reads.fantasy.espn.com` with `fan.api.espn.com/apis/v2/fans/{SWID}`.
- **Changed**: Discovery now uses single API call instead of 4+ calls (one per sport + N per league).
- **Changed**: All league data (leagueId, teamId, teamName, seasonId, sport) returned in one response.
- **Added**: SWID normalization to ensure brace format `{UUID}` for Fan API compatibility.
- **Added**: ESPN-recommended headers (`x-p13n-swid`, `X-Personalization-Source`) for API parity.
- **Added**: Numeric-to-string game ID mapping (1→ffl, 2→flb, 3→fba, 4→fhl).
- **Removed**: Sport iteration loop (no longer needed).
- **Removed**: PII from logs (partial SWID, league names).

### Chrome Extension v1.1.1 - Improved Discovery Messaging
Fixes confusing messaging during league discovery and re-sync. Now shows granular counts for leagues and past seasons.

- **Added**: `SeasonCounts` type with `found`/`added`/`alreadySaved` for granular messaging.
- **Added**: `currentSeason` and `pastSeasons` objects in discovery API response.
- **Added**: `getDiscoveryMessage()` helper for context-aware discovery status.
- **Added**: `getCompletionSummary()` helper for setup completion summary.
- **Added**: Legacy field migration for popup recovery from v1.1 state.
- **Fixed**: "Found 0 leagues" shown incorrectly when re-syncing (now shows "N leagues already saved").
- **Fixed**: Past seasons `found` count now only includes seasons where user was actually a member.
- **Changed**: Discovery messages now distinguish new vs already-saved for both leagues and past seasons.
- **Changed**: Renamed "historical" to "past seasons" for clarity.
- **Changed**: Extension version bumped to 1.1.1.

### Chrome Extension v1.1 - Auto-Discovery
After syncing ESPN credentials, the extension now automatically discovers all your leagues and lets you pick a default - no manual league entry required.

- **Added**: Auto-discovery of all ESPN leagues after syncing credentials.
- **Added**: Historical season discovery for each league (all previous seasons saved automatically).
- **Added**: Default league selection in extension popup before completing setup.
- **Added**: Progress UI showing sync/discovery/select steps with progress bar.
- **Added**: Popup close recovery (setup state persisted in chrome.storage.local).
- **Added**: `POST /extension/discover` endpoint for league discovery.
- **Added**: `POST /extension/set-default` endpoint for setting default league.
- **Added**: `leagueExists()` and `getCurrentSeasonLeagues()` storage helpers.
- **Added**: `discoverAndSaveLeagues()` and `discoverHistoricalSeasons()` in league-discovery.ts.
- **Added**: Historical season membership validation via ESPN team list fetch (prevents incorrect historical entries).
- **Changed**: "Sync to Flaim" now runs full setup flow (sync + discover + select default).
- **Changed**: Extension version bumped to 1.1.0.

### Maintenance
- **Removed**: `/account` page — redundant with Clerk's `<UserButton>` modal which provides identical account management functionality.
- **Changed**: Dependency restructure — removed frontend deps from root package.json, aligned versions (jest 30, typescript 5.6.2), deleted orphaned root jest.config.js, fixed auth-worker jest config.

## [7.2.0] - 2026-01-05

### Multi-Season League Support
Users can now track historical seasons alongside current ones. Each league is stored per season year, enabling year-over-year analysis and historical data access.

### Leagues & Seasons
- **Added**: Season year pass-through across web, API, and MCP workers.
- **Added**: Deterministic season default helper (baseball Feb 1, football Jun 1, America/New_York).
- **Added**: Multi-season league storage (unique on user + sport + league + season year).
- **Added**: Discover-seasons flow to auto-add historical league seasons.
- **Changed**: League deletion removes all seasons for a league (no per-season delete).
- **Changed**: `get_user_session` now returns seasonYear per league and the default league.
- **Added**: Migration `007_espn_leagues_unique_season_year.sql` to update the unique constraint.

## [7.1.1] - 2025-12-31

### Chrome Extension
- **Added**: Chrome extension for automatic ESPN credential capture (Manifest V3, React popup).
- **Added**: Extension pairing flow with 6-character codes (10-minute expiry).
- **Added**: `/extension` page for pairing code generation and connection management.
- **Added**: Extension API routes (`/api/extension/*`) proxying to auth-worker.
- **Added**: `extension_pairing_codes` and `extension_tokens` tables in Supabase.
- **Added**: Rate limiting for extension pairing (5 codes/hour per user, 10 attempts/10min per IP).
- **Added**: Build-time localhost stripping in `vite.config.ts` for production builds.
- **Added**: Dev/prod detection via `chrome.management.getSelf()` API.
- **Submitted**: Chrome Web Store submission (Dec 31, 2025) - awaiting review.

### Privacy & Compliance
- **Added**: Privacy policy page at `/privacy` for Chrome Web Store compliance.
- **Added**: ESPN non-affiliation disclaimer.
- **Added**: Data retention and user rights documentation.

### Chat Debug Mode
- **Added**: Debug mode toggle in chat tools panel for MCP debugging.
- **Added**: Timing badges on all tool calls (shows execution duration in ms).
- **Added**: REQUEST/RESPONSE labels when debug mode is enabled.
- **Added**: `ToolCallMetadata` interface for tracking tool execution timing.

### Chat Debug UI Improvements (Phase 2)
- **Added**: Copy buttons on request/response JSON blocks.
- **Added**: Clear conversation button (trash icon) to reset chat.
- **Added**: Keyboard shortcut `Cmd+D` / `Ctrl+D` to toggle debug mode.
- **Added**: Collapsible JSON blocks with chevron toggle.
- **Added**: Error styling with red borders, error banners, and actionable suggestions.
- **Added**: MCP server URL display in debug mode.
- **Added**: Debug mode badge (amber "DEBUG" pill in chat header).
- **Added**: Active league indicator badge (blue pill with league name).
- **Fixed**: Page scrolling broken by `overflow-hidden` on main layout.

### Chat Simplification
- **Removed**: Usage tracking from built-in chat (message limits, free tier tracking).
- **Removed**: `/api/chat/usage` endpoint and `UsageDisplay` component.
- **Removed**: "Account & Usage" section from chat tools panel.
- **Changed**: Chat now requires only Clerk auth, no usage limits enforced.

### Documentation
- **Updated**: README.md reframed Flaim as MCP/auth service (not chatbot).
- **Updated**: ARCHITECTURE.md added extension architecture, APIs, and deployment (merged from GETTING_STARTED.md).
- **Moved**: Chrome extension docs to `extension/README.md`.
- **Removed**: GETTING_STARTED.md (consolidated into ARCHITECTURE.md).
- **Updated**: All docs de-emphasize chat as secondary feature.

## [7.1.0] - 2025-12-28

### ChatGPT Direct Access - Now Working!
Users can connect Flaim to ChatGPT as a custom MCP connector with OAuth 2.1, bringing their own subscription.

### OpenAI ChatGPT OAuth Support
- **Added**: ChatGPT redirect URIs to OAuth allowlist.
- **Added**: RFC 8707 `resource` propagation through OAuth code/token storage.
- **Added**: `securitySchemes` on all MCP tool definitions.
- **Added**: `_meta["mcp/www_authenticate"]` on 401 responses (initial connect + invalid tokens).
- **Fixed**: Refresh token flow preserves `resource` for audience-aware tokens.

## [7.0.0] - 2025-12-28

### Claude Direct Access - Now Working!
Users can now connect Flaim to Claude.ai or Claude Desktop as a custom MCP connector. This enables "bring your own Claude subscription" usage, shifting AI costs to users while providing full access to ESPN fantasy data.

### OAuth 2.1 for Claude Direct Access
- **Added**: Full MCP OAuth 2.1 implementation for Claude Desktop/Claude.ai integration.
- **Added**: Dynamic Client Registration (RFC 7591) - `/register` and `/auth/register` endpoints.
- **Added**: Protected Resource Metadata (RFC 9728) - `/.well-known/oauth-protected-resource` on MCP workers.
- **Added**: Authorization Server Metadata (RFC 8414) - includes `registration_endpoint`.
- **Added**: Support for loopback redirect URIs (RFC 8252) for Claude Desktop.
- **Added**: `get_user_session` tool - returns user's configured leagues, team IDs, and current season context.
- **Changed**: MCP servers now return 401 on `initialize` to trigger OAuth immediately on connect.
- **Changed**: WWW-Authenticate header points to Protected Resource Metadata URL.
- **Added**: Rate limiting (200 calls/day per user) with appropriate headers.
- **Added**: Consent screen at `/oauth/consent` for user authorization.
- **Added**: Connectors page at `/connectors` for connection management.

### Critical Fix: Worker-to-Worker Routing
- **Fixed**: MCP workers now use `.workers.dev` URLs for auth-worker calls instead of custom domain.
- **Root cause**: Custom domain (`api.flaim.app`) caused HTTP 522 timeouts for intra-zone Cloudflare requests.
- **Impact**: `get_user_session` and all MCP tools now work correctly via Claude direct access.

### Other Fixes
- Note: OpenAI usage now references the **Responses API** (not legacy chat completions).
- Fix: Strip custom-domain prefixes for auth/baseball/football workers; avoid 404s.
- Fix: Credential check returns 200 with `hasCredentials: false` instead of 404.
- Fix: Trailing slash env URLs no longer break onboarding; timeouts resolved by direct URLs.
- Security: JWKS-based JWT verification enforced in prod; workers forward `Authorization`.
- Infra: Secrets for prod workers set via Cloudflare Dashboard (not `wrangler secret put`).
- Docs: Added onboarding explanation, DNS setup, and timeout/404 troubleshooting.

## [6.1.0] - 2025-07-08
- Updated to React 19.1.0 / Next.js 15.3.4.
- Migrated worker configs to `wrangler.jsonc`; fixed Next.js route handler builds.

## [6.0.0]
- Added unified dev/prod scripts (now replaced by GitOps); centralized auth-worker; moved credentials to Supabase.

## [4.1.1]
- Added automatic ESPN league discovery.

## [4.1.0]
- Extracted modular `flaim/auth`; added football MCP worker.

## [4.0.0]
- Security fix: removed header spoofing by enforcing server-side Clerk verification.

## [3.0.0]
- Integrated Clerk auth; added secure credential management.

## [2.0.0]
- Introduced Stripe-first microservices architecture with OpenAI chat (later simplified).

## [1.0.0]
- Initial release with basic ESPN data and simple web UI.
