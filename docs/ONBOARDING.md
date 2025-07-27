# FLAIM Onboarding Flow

> **Complete guide to the streamlined user onboarding experience**

## Overview

FLAIM's onboarding system guides new users from initial sign-up to active chat functionality in 8 seamless steps. The flow automatically configures fantasy sports tools, discovers leagues, and sets up AI assistants based on user selections.

## User Journey

### Step 1: Authentication
- **Component**: Clerk sign-in/sign-up modal
- **Action**: User creates account or signs in
- **Outcome**: Authenticated session established

### Step 2: Platform Selection  
- **Component**: `PlatformSelection.tsx`
- **Options**: ESPN (active), Yahoo (coming soon)
- **Features**: Platform comparison, sport listings, feature explanations
- **Action**: User selects ESPN
- **Outcome**: Platform stored, proceed to authentication

### Step 3: Platform Authentication
- **Component**: `EspnAuth.tsx` 
- **Required**: ESPN SWID and espn_s2 cookies
- **Features**: Clear instructions, privacy assurance, real-time validation
- **Storage**: Credentials stored securely in Supabase PostgreSQL via auth-worker
- **Action**: User enters ESPN credentials
- **Outcome**: Credentials validated and stored securely

### Step 4: League Discovery
- **Component**: `LeagueDiscovery.tsx`
- **Process**: Automatic discovery via ESPN Fantasy v3 API
- **Features**: Loading states, error handling, retry mechanisms
- **Action**: System discovers all user leagues
- **Outcome**: League list populated with sport auto-detection

### Step 5: League Selection
- **Component**: `LeagueSelector.tsx`
- **Display**: Leagues grouped by sport with team selection
- **Features**: Sport-specific colors, league details, team picker
- **Action**: User selects primary league and team
- **Outcome**: League and sport configuration stored

### Step 6: Auto-Sport Detection
- **Process**: Automatic sport identification from ESPN gameId
- **Mapping**: `flb`→Baseball, `ffl`→Football, `fba`→Basketball, `fhl`→Hockey
- **Outcome**: Sport-specific configuration determined

### Step 7: Auto-MCP Configuration  
- **Process**: Automatic tool configuration based on platform + sport
- **Configuration**: Server URLs, tool lists, approval settings
- **Integration**: Tools store automatically updated
- **Outcome**: AI assistant tools ready for selected sport

### Step 8: Chat Activation
- **Component**: `SetupComplete.tsx`
- **Display**: Configuration summary, available features
- **Action**: User clicks "Start Chatting"
- **Outcome**: Chat interface activated with configured tools

## Technical Architecture

**State Management**: Zustand store with step tracking, platform selection, credentials, and league data  
**Components**: OnboardingFlow orchestrates PlatformSelection → EspnAuth → LeagueDiscovery → LeagueSelector → SetupComplete  
**APIs**: `/api/onboarding/*` endpoints for platform/credentials/leagues/status with typed DTOs

### Auto-Configuration Logic
```typescript
// Sport detection from ESPN gameId
ESPN_GAME_IDS = {
  'flb': 'baseball',
  'ffl': 'football', 
  'fba': 'basketball',
  'fhl': 'hockey'
}

// MCP tool configuration
MCP_CONFIG[platform][sport] = {
  serverUrl: process.env.SPORT_ESPN_MCP_URL,
  tools: ['get_espn_league_info', 'get_espn_team_roster', ...]
}
```

## User Experience

### Progressive Disclosure
- Only show relevant options at each step
- Clear progress indication with step numbers
- Error states with helpful recovery options
- Mobile-responsive design throughout

### Visual Design
- Platform branding (ESPN colors, logos)
- Sport-specific themes and emojis
- Consistent shadcn/ui components
- Clear call-to-action buttons

### Error Handling
- Invalid credentials: Clear error message with retry
- No leagues found: Manual entry option
- API failures: Graceful fallbacks with support contact
- Network issues: Retry mechanisms with exponential backoff

## 🔧 Integration Points

### Assistant Component
```typescript
// Onboarding gate in main chat interface
if (!isSignedIn) return <SignInPrompt />
if (!onboarding.isComplete) return <OnboardingFlow />
return <Chat />
```

### Tools Panel
- Shows onboarding-based configuration
- Displays selected league and platform
- Provides reconfiguration option
- Maintains backward compatibility

### MCP Tools
- Auto-enables based on sport selection
- Configures appropriate server URLs
- Sets sport-specific tool permissions
- Integrates with existing tools store

## Deployment Considerations

### Environment Variables
MCP server URLs are configured as environment variables - see [Getting Started Guide](./GETTING_STARTED.md#complete-environment-variable-reference) for complete setup.

### Feature Flags
- Onboarding can be disabled for development
- Individual sport support can be toggled
- Manual configuration remains available as fallback

## Future Enhancements

### Yahoo Integration
- OAuth 2.0 flow implementation
- Yahoo API league discovery
- Multi-platform league management

### Enhanced Features
- Multiple league support per user
- Cross-platform league comparison
- Advanced sport analytics
- League switching without reconfiguration

---

**Built with**: Next.js 15, React 19, Zustand, Clerk Auth, shadcn/ui, ESPN API
**Last Updated**: 2025-06-18