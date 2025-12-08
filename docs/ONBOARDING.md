# FLAIM Onboarding (Short)

AI responses come from the OpenAI **Responses API** (not legacy chat completions).

Eight-step flow from sign-in to live chat with ESPN data.

## Steps
1) Clerk auth (sign in/up)
2) Platform selection (ESPN active; others later)
3) ESPN cookies (SWID, espn_s2) → stored in Supabase via auth-worker
4) League discovery (auto via ESPN v3)
5) League selection + team pick
6) Sport detection from ESPN gameId (`flb`, `ffl`, `fba`, `fhl`)
7) Auto MCP config (server URLs + tools per sport)
8) Chat activation (SetupComplete → Chat)

## Architecture Notes
- State: Zustand store tracks step, platform, credentials, leagues.
- Components: OnboardingFlow orchestrates PlatformSelection → EspnAuth → LeagueDiscovery → LeagueSelector → SetupComplete.
- APIs: `/api/onboarding/*` plus `/api/auth/espn/*` proxies to auth-worker.

## Integration
- Gate chat: if not signed in → `SignInPrompt`; if onboarding incomplete → `OnboardingFlow`; else `Chat`.
- Tools panel shows selected platform/sport and allows reconfigure.

## Deployment Considerations
- MCP server URLs come from env vars (see `docs/GETTING_STARTED.md`).
- Feature flags: onboarding or sports can be toggled for development.
