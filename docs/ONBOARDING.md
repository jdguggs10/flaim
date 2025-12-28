# FLAIM Onboarding (Short)

Step-by-step configuration flow to connect FLAIM to your ESPN account.

## Steps
1) Clerk auth (sign in/up)
2) Platform selection (ESPN active; others later)
3) ESPN cookies (SWID, espn_s2) → stored in Supabase via auth-worker
4) League discovery (auto via ESPN v3)
5) League selection + team pick
6) Sport detection from ESPN gameId (`flb`, `ffl`, `fba`, `fhl`)
7) Auto MCP config (server URLs + tools per sport)
8) **Test & Debug** (Chat interface opens to verify tool connectivity)

## Architecture Notes
- State: Zustand store tracks step, platform, credentials, leagues.
- Components: OnboardingFlow orchestrates PlatformSelection → EspnAuth → LeagueDiscovery → LeagueSelector → SetupComplete.
- APIs: `/api/onboarding/*` plus `/api/auth/espn/*` proxies to auth-worker.

## Integration
- **Configuration Hub**: The onboarding flow is primarily about setting up the `espn_credentials` and `espn_leagues` in Supabase so that external MCP clients (Claude, etc.) can access them.
- **Debugging**: The final chat step is a developer convenience to ensure that the credentials and league IDs are working correctly with the MCP workers before connecting an external AI.
- Active league from `useOnboardingStore` is injected into LLM context via `lib/prompts/league-context.ts` so assistant knows which league_id to use for tool calls.

## Deployment Considerations
- MCP server URLs come from env vars (see `docs/GETTING_STARTED.md`).
- Feature flags: onboarding or sports can be toggled for development.
