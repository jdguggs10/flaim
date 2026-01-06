# Backlog

Ideas and tasks to consider. Not commitments, just a list.

## Maintenance

- **Dependencies**: Last checked Jan 2026. Removed unused `agents` package (fixed 2 vulns). Run `npm outdated` quarterly.
- [ ] **Local Node version** — Align local runtime with Node 24 (`.nvmrc` + `engines`). Decide on Homebrew permissions fix vs user-level manager (fnm/nvm/asdf) to avoid `EBADENGINE` warnings.

## Medium Priority

- [ ] Review privacy page for human element — plain English summary, who's behind it
- [x] Security/trust messaging on credentials entry — reassurance on leagues page
## Low Priority / Ideas

- [ ] User-facing "What's New" section — simple way to communicate updates
- [ ] FAQ expansion on other pages
- [ ] Test coverage for critical paths (OAuth, credential sync, MCP tools)
- [ ] End-to-end manual test of full flow
- [ ] Mobile responsiveness check
- [ ] Loading states audit

## Completed

- [x] Dependency restructure — Removed frontend deps from root, aligned versions (jest 30, typescript 5.6.2), deleted orphaned jest.config.js, fixed auth-worker jest config
- [x] Historic season team mapping — Multi-season entries now store correct teamId/teamName for specific season
- [x] Landing page indie blurb added
- [x] Footer CTA softened ("Want to try it?")
- [x] Project Mission added to CLAUDE.md, AGENTS.md, GEMINI.md
- [x] docs/README.md restructured (user-facing first, contributors section)
- [x] web/README.md created
- [x] workers/README.md created
- [x] ARCHITECTURE.md simplified
- [x] CLAUDE.md removed from git tracking
- [x] Site footer added ("Built by Gerry")
- [x] Support expectations added to README
- [x] Pairing code errors improved (expired vs invalid)
- [x] Retry buttons added for status check failures (extension, connectors)
- [x] Help hints added for credential errors
- [x] Connectors page refactored (separate cards for Claude, ChatGPT, Gemini)
- [x] Per-platform connection status (shows "Connected" only for actual platform)
- [x] Per-connection revoke functionality (revoke individual connections)
- [x] Connectors UI polish (visible revoke button, relative expiry times, auto-renewal note)
