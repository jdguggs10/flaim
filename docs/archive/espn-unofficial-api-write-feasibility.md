# ESPN Unofficial API Write Feasibility (MCP / LLM)

**Date:** February 1, 2026  
**Status:** Research notes (no implementation)  
**Scope:** ESPN Fantasy (unofficial APIs), write actions like add/drop and roster changes

## Why this doc exists

We want to understand whether an MCP server could safely perform ESPN Fantasy write actions
(add/drop, lineup changes) using the unofficial ESPN API surface that community projects
have reverse engineered.

This document captures current public evidence, constraints, and a realistic assessment
of feasibility and risk. It is intentionally detailed so it can serve as a reference
when deciding whether to invest in a write-capable ESPN integration.

## Key questions

1. Do unofficial ESPN endpoints for *writes* exist and are they discoverable?
2. Can we authenticate reliably enough to perform writes?
3. What are the operational and product risks of building on this surface?

## Evidence summary (public / unofficial)

### 1) Community packages focus on read access

The popular Python wrapper `cwendt94/espn-api` explicitly describes itself as using
ESPN's Fantasy API to **extract data** from public or private leagues. It does not
claim write support or document write endpoints.  
Source: `cwendt94/espn-api` README.  
https://github.com/cwendt94/espn-api

The same project’s wiki shows that private leagues require manual cookies (SWID, ESPN_S2)
but still only documents read-style access (League object data).  
Source: `cwendt94/espn-api` wiki.  
https://github.com/cwendt94/espn-api/wiki

### 2) ESPN endpoints are explicitly undocumented and unstable

The ffscrapr ESPN vignette calls the API "an undocumented abyss" and lists
known *read* endpoints and views (mTeam, mRoster, mBoxscore, etc.). It also
explicitly encourages using browser DevTools to find endpoints.  
Source: ffscrapr "ESPN: Get Endpoint" article.  
https://ffscrapr.ffverse.com/articles/espn_getendpoint.html

This same document defines ESPN's common base URLs as `lm-api-reads...` and
lists the view parameter pattern, which is the core of current reverse-engineered
read access.  
Source: ffscrapr "ESPN: Get Endpoint" article.  
https://ffscrapr.ffverse.com/articles/espn_getendpoint.html

### 3) Private league access requires manual cookie extraction

The ffscrapr authentication vignette states that private league access depends on
retrieving ESPN_S2 and SWID cookies from a **live login**, and that this "cannot be
done programmatically at this time."  
Source: ffscrapr "ESPN: Private Leagues" article.  
https://ffscrapr.ffverse.com/articles/espn_authentication.html

### 4) Transactions are read via a special "communication" view

The `ffscrapr` source code for ESPN transactions shows a **read** request to:
`https://lm-api-reads.fantasy.espn.com/.../communication/?view=kona_league_communication`
with an `x-fantasy-filter` header to filter activity message types.  
Source: `ffscrapr` ESPN transactions source.  
https://rdrr.io/github/ffverse/ffscrapr/src/R/espn_transactions.R

This further reinforces that community tooling knows how to **read** activity, but
not write it.

### 5) ESPN UI clearly supports write actions (add/drop, waivers)

ESPN's support docs describe how users add/drop players and submit waiver claims
through the web and mobile UI, confirming these actions exist and are executed
through ESPN's backend.  
Sources: ESPN Fan Support.  
https://support.espn.com/hc/en-us/articles/115003848251-Add-or-Drop-a-Player  
https://support.espn.com/hc/en-us/articles/4669637127316-Add-or-Drop-a-Player

Additional ESPN docs describe waiver claim mechanics (timing, undroppables, etc.),
which matter for any write integration.  
Source: ESPN Fan Support.  
https://support.espn.com/hc/en-us/articles/360000093791-Claim-a-Player-Off-Waivers

## What is actually known about ESPN endpoints today

### Read endpoints (documented by community)

The core ESPN Fantasy read endpoint pattern for 2018+ is:

`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/{season}/segments/0/leagues/{league_id}`

The API is mostly driven by `view` query parameters (mRoster, mTeam, mBoxscore, etc.)
and sometimes by the `X-Fantasy-Filter` header for filtering and shaping responses.  
Source: ffscrapr "ESPN: Get Endpoint."  
https://ffscrapr.ffverse.com/articles/espn_getendpoint.html

### Read-only transactions endpoint

ESPN transaction activity is accessed via a read-only "communication" view:

`.../communication/?view=kona_league_communication` + `x-fantasy-filter`

This is not a write endpoint; it returns activity logs.  
Source: ffscrapr ESPN transactions source.  
https://rdrr.io/github/ffverse/ffscrapr/src/R/espn_transactions.R

### Authentication model in practice (unofficial)

Private leagues require two cookies from a live login:
- `SWID`
- `ESPN_S2`

These are not programmatically accessible per ffscrapr, and are typically captured via
browser DevTools and then used in API calls.  
Source: ffscrapr "ESPN: Private Leagues."  
https://ffscrapr.ffverse.com/articles/espn_authentication.html

## Plausibility of writes (architectural assessment)

### Why writes are *possible* in theory

The ESPN web app can perform add/drop and lineup changes, so the backend must expose
write-capable endpoints. Those endpoints are not documented publicly, but they likely
exist behind the web UI.

### Why writes are *not currently documented* in the unofficial ecosystem

None of the community docs above (ffscrapr, espn-api, etc.) document any write endpoints,
and the known base host (`lm-api-reads`) suggests read-only intent.  
This implies that write calls either:
1) use a different host or path than `lm-api-reads`, or  
2) require additional auth/CSRF mechanisms not present in current community tooling.

### Discovery is feasible but fragile

The ffscrapr docs explicitly suggest using browser DevTools (Network tab) to find ESPN
API calls triggered by UI actions. That same strategy could be used to capture
add/drop or lineup change requests.  
Source: ffscrapr "ESPN: Get Endpoint."  
https://ffscrapr.ffverse.com/articles/espn_getendpoint.html

However, write requests may require:
- CSRF tokens
- additional headers
- anti-bot protections
- tighter validation rules for waivers, undroppables, or roster caps

If any of those change, the integration would break.

## Practical constraints and risk

### Authentication fragility

Private league access requires manual cookie extraction and is not programmatic.
That is manageable for a developer, but a poor UX for end users and unreliable
for automation.  
Source: ffscrapr "ESPN: Private Leagues."  
https://ffscrapr.ffverse.com/articles/espn_authentication.html

### Rule complexity (not optional for writes)

ESPN rules include waivers, undroppable lists, roster caps, and other constraints.
Any write implementation would need to pre-check these to avoid failing calls or
surprising users.  
Sources: ESPN Fan Support.  
https://support.espn.com/hc/en-us/articles/115003848251-Add-or-Drop-a-Player  
https://support.espn.com/hc/en-us/articles/360000093791-Claim-a-Player-Off-Waivers

### API stability risk

Even ESPN read endpoints are described as undocumented and unstable. This is a
critical risk factor for writes, where breakage results in failed user actions
instead of stale data.  
Source: ffscrapr "ESPN: Get Endpoint."  
https://ffscrapr.ffverse.com/articles/espn_getendpoint.html

## What this means for MCP write support

**Possible, but high-risk and brittle.**  
An MCP server could execute write calls *if*:
- you discover the write endpoint via DevTools,
- you keep valid SWID/ESPN_S2 cookies (and possibly CSRF tokens),
- you replicate all required headers, and
- you re-validate all league rules before submitting.

But this would be inherently unstable and require ongoing maintenance,
which violates the "keep it fun" and low-maintenance principles unless
the ROI is very high.

## Recommended experiment plan (low-risk)

If you want to validate feasibility without committing to production:

1. **Create a test league** (do not use a real league).
2. **Open DevTools** on the ESPN Fantasy UI and record network activity
   when performing:
   - add player
   - drop player
   - lineup change
3. **Identify write requests**:
   - HTTP method (POST/PUT/PATCH)
   - URL host (is it still `lm-api-reads` or another host?)
   - required headers (CSRF, referer, etc.)
   - request payload (player IDs, lineup slots, etc.)
4. **Replay with curl** using the same cookies and headers.
5. **Test failure cases** (undroppable, waiver period, roster cap).
6. **Document all moving parts** and estimate maintenance cost.

If any step requires fragile browser automation or frequent re-authentication,
this should be treated as a red flag for production.

## Conclusions

1. The unofficial ESPN ecosystem is **read-only** in public documentation.
2. Writes are *theoretically* possible (the UI must do it), but no public
   write endpoint is documented.
3. Auth is manual and fragile, which makes durable automation difficult.
4. Any write integration would be high-risk, high-maintenance, and likely
   violate the project's low-maintenance goals unless ESPN ever publishes
   supported write APIs.

## Sources

- https://github.com/cwendt94/espn-api
- https://github.com/cwendt94/espn-api/wiki
- https://ffscrapr.ffverse.com/articles/espn_getendpoint.html
- https://ffscrapr.ffverse.com/articles/espn_authentication.html
- https://rdrr.io/github/ffverse/ffscrapr/src/R/espn_transactions.R
- https://support.espn.com/hc/en-us/articles/115003848251-Add-or-Drop-a-Player
- https://support.espn.com/hc/en-us/articles/4669637127316-Add-or-Drop-a-Player
- https://support.espn.com/hc/en-us/articles/360000093791-Claim-a-Player-Off-Waivers
