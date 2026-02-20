# Fantrax Integration Research (Auth + Feasibility)

Date: 2026-02-20  
Scope: Flaim advisory research only (no implementation in this document)

## Why This Exists

This document captures Fantrax integration research for future product/engineering decisions, focused on:

1. What auth options appear available for private leagues.
2. What other fantasy tools are doing in production.
3. How Fantrax would fit Flaim's existing unified MCP architecture.
4. Recommended path given Flaim's maintenance and sustainability constraints.

## Flaim Architecture Constraints (Local Codebase Review)

Flaim currently integrates platforms through a unified gateway pattern:

- `workers/fantasy-mcp` exposes unified tools and routes by `platform`.
- Platform workers (`espn-client`, `yahoo-client`, `sleeper-client`) implement `/execute`.
- `auth-worker` manages platform credentials/tokens and user league state.

Key local references:

- `flaim/README.md`
- `flaim/docs/ARCHITECTURE.md`
- `flaim/docs/INDEX.md`
- `flaim/workers/fantasy-mcp/src/types.ts`
- `flaim/workers/fantasy-mcp/src/router.ts`
- `flaim/workers/fantasy-mcp/README.md`

Current platform union in gateway types is:

- `espn`
- `yahoo`
- `sleeper`

Adding Fantrax requires adding:

- New platform worker (expected: `workers/fantrax-client`)
- New service binding in `fantasy-mcp`
- New platform auth/credential storage and retrieval in `auth-worker`
- Mapping/normalization layer for consistent tool output

## External Findings: Fantrax Auth for Private Leagues

### Executive Summary

As of 2026-02-20, there is no clearly discoverable, public, first-party Fantrax OAuth-style developer flow (client registration, scopes, token exchange) comparable to Yahoo.

Observed practical options in the ecosystem:

1. Session/cookie-based auth (most established in unofficial tooling)
2. Secret-ID-based auth (`userSecretId`) (used by some third-party tools/libraries)
3. Potential partner/private API access by contacting Fantrax support (not publicly documented in a robust official portal)

### Option A: Session/Cookie Auth (High confidence for viability)

Evidence:

- Unofficial FantraxAPI documentation states private league/non-public endpoint access requires logged-in cookies/session handling.
- The project documents browser/Selenium cookie workflows for private data access.
- Third-party fantasy tools/extensions broadly align with cookie capture/sync patterns.

Implications:

- Works today for private leagues in many cases.
- Operationally brittle (session expiration, invalidation, anti-bot changes).
- Higher security and UX overhead (handling session artifacts).

### Option B: Secret ID (`userSecretId`) Auth (Medium confidence)

Evidence:

- A maintained Go package (`go-fantrax`) documents league retrieval via `userSecretId` and references Fantrax beta API docs (April 2025).
- Multiple commercial tool docs instruct users to provide Fantrax Secret ID instead of password.

Implications:

- Better UX than cookie export and likely lower maintenance burden.
- Needs endpoint-by-endpoint validation for required Flaim tool coverage.
- Unclear long-term guarantee without formal first-party public docs.

### Option C: Partner/Direct API Access via Fantrax Support (Low-medium confidence)

Evidence:

- Community signals suggest reaching out to Fantrax support for API information.

Implications:

- Could provide a more stable/official path.
- Not enough publicly verifiable detail to plan against immediately.

## What Other Fantasy Tools Appear To Be Doing

Patterns observed across public docs/help pages:

1. Cookie-based sync via extension/desktop browser session is common.
2. Secret ID flow is also common for account linking in paid tools.
3. Some products advertise Fantrax private-league sync without exposing mechanism.
4. Manual import remains fallback for unsupported sites/edge cases.

Interpretation:

- Market behavior is pragmatic, not standardized.
- Competitors appear to optimize for "works now" over formal API elegance.
- A dual-mode model (Secret ID first, cookie fallback) is consistent with ecosystem reality.

## Decision Guidance for Flaim

### Recommended Primary Path

Choose Secret ID as the primary private-league auth method for initial Fantrax integration.

Rationale:

- Lower maintenance burden than cookie/session management.
- Better UX and safety posture than asking users for session cookies.
- Aligns with Flaim's project principles (fun, pragmatic, sustainable).

### Recommended Fallback

Add cookie/session ingestion only if Secret ID cannot satisfy required tool coverage for real leagues.

### Suggested Delivery Sequence

1. Validate Secret ID against minimum required reads:
- league discovery / list
- league info
- standings
- roster
- matchups
- free agents (if endpoint support is clear)

2. Ship a read-only MVP on validated coverage.

3. Introduce cookie fallback only for missing private features.

4. Continue parallel attempt to secure explicit Fantrax official approval/docs.

## Risks and Unknowns

1. Terms/compliance ambiguity:
- Unofficial/reverse-engineered methods may carry policy risk.

2. Endpoint volatility:
- Unofficial endpoints can change without notice.

3. Coverage uncertainty:
- Secret ID may not unlock every endpoint needed for full parity with ESPN/Yahoo.

4. Support burden:
- Cookie flows can increase user support load due to expiration and browser variance.

## Source Notes

Confidence legend:

- High: repeated, direct, explicit documentation of behavior.
- Medium: credible sources but limited first-party corroboration.
- Low: anecdotal/community discussion.

All links last reviewed on 2026-02-20.

### Primary Technical Sources

1. FantraxAPI (unofficial Python)
- Repo: https://github.com/meisnate12/FantraxAPI
- Intro docs: https://fantraxapi.metamanager.wiki/en/latest/intro.html
- Package docs/version pages: https://pypi.org/project/fantraxapi/

2. go-fantrax (unofficial Go)
- Docs: https://pkg.go.dev/github.com/pmurley/go-fantrax
- Repo: https://github.com/pmurley/go-fantrax

### Third-Party Product / Integration Behavior Sources

1. LineupExperts (cookie requirement guidance)
- https://www.lineupexperts.com/Support/General-Help/6

2. Footballguys Fantrax login (Secret ID guidance)
- https://sportsguys.zendesk.com/hc/en-us/articles/7842753813531-Fantrax-Login

3. DraftBuddy Fantrax/NFBC sync article (Secret ID + league ID flow)
- https://www.draftbuddy.com/new-fantasy-baseball-league-sync-connects-fantrax-and-nfbc/

4. DraftSharks browser add-on metadata (cookie/session based sync behavior)
- https://addons.mozilla.org/en-US/firefox/addon/draftsharks-sync/

5. RotoBaller Team Sync add-on metadata (domain access indicates browser-assisted sync)
- https://addons.mozilla.org/en-US/firefox/addon/rotoballer-team-sync/

6. FantasySP sync page (private league support claim, method unspecified)
- https://www.fantasysp.com/sync

7. FantasyPros manual import fallback (ecosystem fallback pattern)
- https://support.fantasypros.com/hc/en-us/articles/115001316747-My-league-isn-t-on-any-of-the-websites-listed-Is-there-any-way-I-can-still-add-my-league-into-My-Playbook-Manual-Import

### Community Signal (Non-canonical)

1. Fantrax subreddit thread referencing API/support contact
- https://www.reddit.com/r/Fantrax/comments/1htd4oe

## Final Advisory Snapshot

If Flaim chooses a single auth method now:

- Use Secret ID first.
- Treat cookie/session as fallback.
- Keep scope read-only and minimal until endpoint reliability is proven in production.
- Continue trying to obtain official Fantrax confirmation to reduce long-term risk.
