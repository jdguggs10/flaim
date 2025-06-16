# FLAIM Onboarding Flow Redesign - Implementation Plan

## Overview

This document outlines the comprehensive redesign of FLAIM's user onboarding experience to create a streamlined, guided setup flow that takes users from initial sign-up to active chat functionality in a logical sequence.

## Current State vs Desired State

### Current Flow (Problematic)
1. User signs in with Clerk
2. Chat immediately becomes available
3. User must manually navigate to tools panel
4. User must figure out sport/platform selection
5. User must manually enter ESPN credentials
6. User must manually enable MCP tools
7. Many users never complete setup properly

### Desired Flow (Streamlined)
1. **Clerk Sign-in/Sign-up** - Front and center authentication
2. **Platform Provider Selection** - Choose fantasy platform (ESPN, Yahoo, etc.)
3. **Platform Authentication** - Enter credentials for selected platform
4. **Auto League Discovery** - System finds all user leagues via platform API
5. **League Selection** - User picks specific league (ID + team number)
6. **Auto Sport Detection** - Frontend determines sport from league data
7. **Auto MCP Configuration** - System configures appropriate tools for platform
8. **Chat Activation** - Chat becomes available only after complete setup

## Technical Analysis

### Current Implementation Status

#### ✅ **FULLY IMPLEMENTED**

**1. Clerk Authentication System**
- Location: `/auth/clerk/web/`
- Components: `SignInButton`, `SignUpButton`, `AuthGuard`, `useAuth`
- Status: Production-ready with FLAIM branding
- Features: Modal authentication, server-side verification, usage tracking

**2. ESPN League Discovery Engine**
- Location: `/auth/espn/gambit/league-discovery.ts`
- Function: `discoverLeagues()`
- Status: Robust, production-ready
- Features:
  - Multi-sport support (baseball, football, basketball, hockey)
  - ESPN gambit dashboard API integration
  - Error handling and credential fallbacks
  - League data parsing and validation
- API Endpoint: Integrated in existing auth flow

**3. MCP Tools Backend Infrastructure**
- Location: `/openai/lib/tools/tools.ts`
- Status: Functional but requires manual configuration
- Features:
  - Baseball ESPN MCP server integration
  - Football ESPN MCP server (development)
  - Sport/platform filtering logic
  - Tool availability configuration

#### 🟡 **PARTIALLY IMPLEMENTED**

**4. ESPN Credential Management**
- Backend: ✅ Complete (`EspnStorage`, `EspnMcpProvider`)
- Frontend: ❌ Only manual tools panel input
- Location: `/auth/espn/`
- Missing: Guided credential collection UI

**5. Sport Auto-Detection Logic**
- Mapping: ✅ `ESPN_GAME_IDS` exists
- Logic: ❌ Manual selection only
- Location: `/openai/components/sport-platform-config.tsx`
- Missing: Automatic sport determination from league data

**6. Chat Activation Control**
- Basic: ✅ Requires Clerk authentication
- Advanced: ❌ No onboarding completion gating
- Location: `/openai/components/assistant.tsx`
- Missing: Progressive disclosure based on setup completion

#### ❌ **NOT IMPLEMENTED**

**7. Platform Provider Selection**
- No UI for choosing between fantasy platforms
- No platform comparison or feature explanation
- No extensible architecture for multiple platforms

**8. Onboarding Flow Orchestration**
- No centralized onboarding component
- No state management for onboarding progress
- No step-by-step guided experience

**9. League Selection Interface**
- No UI for displaying discovered leagues
- No league selection component
- No league details presentation

**10. API Endpoints for Onboarding**
- Missing platform selection endpoint
- Missing league fetching endpoint
- Missing onboarding state tracking
- Missing credential storage endpoint

## Implementation Plan

### Phase 1: Foundation Infrastructure

#### 1.1 Onboarding State Management
**File**: `/stores/useOnboardingStore.ts`

```typescript
interface OnboardingState {
  step: 'NOT_STARTED' | 'PLATFORM_SELECTION' | 'PLATFORM_AUTH' | 'LEAGUE_SELECTION' | 'COMPLETED'
  selectedPlatform: 'ESPN' | 'Yahoo' | null
  platformCredentials: {
    espn?: { swid: string; espn_s2: string }
    yahoo?: { accessToken: string; refreshToken: string }
  } | null
  discoveredLeagues: League[]
  selectedLeague: { leagueId: string; teamId: string; sport: string; platform: string } | null
  isComplete: boolean
  error: string | null
}
```

**Features**:
- Persistent state across sessions
- Step validation and progression
- Error state management
- Integration with existing stores

#### 1.2 API Route Development
**New Endpoints**:

```
POST /api/onboarding/platform-selection
- Store selected platform (ESPN, Yahoo, etc.)
- Return platform-specific credential requirements
- Set up platform authentication flow

POST /api/onboarding/platform-credentials
- Store platform credentials (ESPN SWID/espn_s2, Yahoo tokens, etc.)
- Trigger league discovery for selected platform
- Return success/error status

GET /api/onboarding/leagues
- Fetch user's discovered leagues from selected platform
- Return league data with sport mapping
- Handle platform-specific authentication errors

POST /api/onboarding/league-selection
- Store selected league and team
- Auto-configure MCP settings for platform+sport
- Mark onboarding step complete

GET /api/onboarding/status
- Return current onboarding progress
- Check completion status
- Provide next step guidance

POST /api/onboarding/complete
- Mark onboarding as fully complete
- Enable chat functionality
- Store final platform+league configuration
```

### Phase 2: Core Components

#### 2.1 Platform Provider Selection
**File**: `/components/onboarding/PlatformSelection.tsx`

**Features**:
- Clean selection interface with platform cards
- ESPN card (active) vs Yahoo card (coming soon)
- Clear feature comparison and capabilities
- Visual branding for each platform
- Expandable "Why connect?" explanations

**Platform Options**:
```typescript
interface PlatformOption {
  id: 'ESPN' | 'Yahoo'
  name: string
  logo: string
  isActive: boolean
  comingSoon?: boolean
  features: string[]
  sports: string[]
}

const PLATFORMS = [
  {
    id: 'ESPN',
    name: 'ESPN Fantasy',
    logo: '/logos/espn.svg',
    isActive: true,
    features: ['League Discovery', 'Team Analysis', 'Matchup Insights'],
    sports: ['Baseball', 'Football', 'Basketball', 'Hockey']
  },
  {
    id: 'Yahoo',
    name: 'Yahoo Fantasy',
    logo: '/logos/yahoo.svg',
    isActive: false,
    comingSoon: true,
    features: ['League Discovery', 'Team Analysis', 'Trade Analysis'],
    sports: ['Baseball', 'Football', 'Basketball', 'Hockey']
  }
]
```

#### 2.2 Platform Authentication Components
**File**: `/components/onboarding/PlatformAuth.tsx`

This will be a dynamic component that renders platform-specific auth:

**ESPN Authentication** (`/components/onboarding/auth/EspnAuth.tsx`):

**Features**:
- Clean, guided SWID/espn_s2 input form
- Visual instructions for finding credentials
- Real-time validation and feedback
- Integration with existing `EspnStorage`
- Error handling for invalid credentials
- Loading states during verification

**UX Requirements**:
- Clear explanation of why credentials are needed
- Step-by-step instructions with screenshots
- Privacy assurance about credential storage
- Skip option with limitations explained

**Yahoo Authentication** (`/components/onboarding/auth/YahooAuth.tsx`):
**Features**:
- OAuth 2.0 flow integration
- "Connect with Yahoo" button
- Token management and refresh
- Privacy and permissions explanation
- Error handling for OAuth failures

#### 2.3 League Selection Interface
**File**: `/components/onboarding/LeagueSelector.tsx`

**Features**:
- Grid/list display of discovered leagues
- League cards showing:
  - League name and sport icon
  - Team name and position
  - League type (public/private)
  - Season and activity status
- Sport auto-detection from `gameId`
- Team selection within league
- Search/filter functionality for many leagues

**Data Structure**:
```typescript
interface League {
  leagueId: string
  name: string
  sport: 'baseball' | 'football' | 'basketball' | 'hockey'
  gameId: string // ESPN's internal sport identifier
  teams: Array<{
    teamId: string
    name: string
    isUserTeam: boolean
  }>
  isActive: boolean
  seasonYear: number
}
```

#### 2.4 Onboarding Flow Orchestrator
**File**: `/components/onboarding/OnboardingFlow.tsx`

**Features**:
- Simple step-by-step progression
- Basic validation between steps
- Dynamic content based on current step
- Mobile-responsive design

**Simple Flow Logic**:
```typescript
const steps = [
  { id: 'platform-selection', component: PlatformSelection },
  { id: 'platform-auth', component: PlatformAuth },
  { id: 'league-discovery', component: LeagueDiscovery },
  { id: 'league-selection', component: LeagueSelector },
  { id: 'setup-complete', component: SetupComplete }
]
```

### Phase 3: Integration & Polish

#### 3.1 Assistant Component Integration
**File**: `/components/assistant.tsx`

**Changes Required**:
- Add onboarding completion check
- Gate chat functionality behind completed setup
- Show onboarding flow for incomplete users
- Maintain existing functionality for completed users

**Implementation**:
```typescript
// Before: Chat loads immediately after Clerk auth
if (!isSignedIn) return <SignInPrompt />

// After: Chat loads only after complete onboarding
if (!isSignedIn) return <SignInPrompt />
if (!onboarding.isComplete) return <OnboardingFlow />
return <Chat />
```

#### 3.2 Auto-Configuration Logic
**File**: `/lib/onboarding/auto-config.ts`

**Features**:
- Map selected league sport to MCP server
- Auto-populate MCP configuration
- Remove manual setup requirements
- Configure tool availability

**Platform + Sport Mapping**:
```typescript
const MCP_CONFIG = {
  ESPN: {
    baseball: {
      serverUrl: process.env.BASEBALL_ESPN_MCP_URL,
      tools: ['get_espn_league_info', 'get_espn_team_roster', 'get_espn_matchups']
    },
    football: {
      serverUrl: process.env.FOOTBALL_ESPN_MCP_URL,
      tools: ['get_espn_football_league_info', 'get_espn_football_team', 'get_espn_football_matchups']
    }
  },
  Yahoo: {
    baseball: {
      serverUrl: process.env.BASEBALL_YAHOO_MCP_URL,
      tools: ['get_yahoo_league_info', 'get_yahoo_team_roster', 'get_yahoo_matchups']
    },
    football: {
      serverUrl: process.env.FOOTBALL_YAHOO_MCP_URL,
      tools: ['get_yahoo_football_league_info', 'get_yahoo_football_team', 'get_yahoo_football_matchups']
    }
  }
}
```

#### 3.3 Tools Panel Simplification
**File**: `/components/tools-panel.tsx`

**Changes**:
- Remove manual sport/platform selection
- Remove manual ESPN authentication
- Show read-only configuration status
- Add "reconfigure" option for changing leagues
- Focus on usage display and advanced settings

### Phase 4: Enhanced User Experience

#### 4.1 Error Handling & Recovery
**File**: `/components/onboarding/ErrorRecovery.tsx`

**Features**:
- Graceful ESPN API failure handling
- Retry mechanisms with exponential backoff
- Alternative setup paths
- Clear error messages with solutions

#### 4.2 Empty State Handling
**File**: `/components/onboarding/NoLeaguesFound.tsx`

**Features**:
- Guidance for users with no leagues
- Instructions for joining leagues
- Manual league ID entry option
- Contact support integration

## File Structure Changes

### New Files to Create

```
/components/onboarding/
├── OnboardingFlow.tsx              # Main orchestrator component
├── PlatformSelection.tsx           # Platform provider selection
├── PlatformAuth.tsx                # Dynamic platform authentication
├── auth/
│   ├── EspnAuth.tsx                # ESPN credential collection
│   └── YahooAuth.tsx               # Yahoo OAuth integration
├── LeagueSelector.tsx              # League selection interface
├── LeagueDiscovery.tsx             # League discovery loading state
├── SetupComplete.tsx               # Completion celebration
├── ErrorRecovery.tsx               # Error handling UI
└── NoLeaguesFound.tsx              # Empty state handling

/stores/
└── useOnboardingStore.ts           # Onboarding state management

/lib/onboarding/
├── auto-config.ts                  # Auto-configuration logic
└── league-mapper.ts                # League data transformation

/api/onboarding/
├── platform-selection.ts          # POST selected platform
├── platform-credentials.ts        # POST platform credentials
├── leagues.ts                      # GET discovered leagues
├── league-selection.ts             # POST selected league
├── status.ts                       # GET onboarding status
└── complete.ts                     # POST mark complete

```

### Files to Modify

```
/components/assistant.tsx           # Add onboarding gating
/app/page.tsx                       # Integrate onboarding flow
/components/tools-panel.tsx         # Simplify to read-only status
/stores/useToolsStore.ts           # Auto-populate from onboarding
/app/layout.tsx                    # Add onboarding routing logic
```

## Data Flow Architecture

### Onboarding Sequence Diagram

```
User -> Clerk Auth -> Platform Selection -> Platform Auth -> League Discovery -> League Selection -> MCP Config -> Chat Active

1. User signs up/in with Clerk
   ├── Success: Redirect to platform selection
   └── Failure: Show error, retry

2. Platform provider selection
   ├── Show ESPN (active) and Yahoo (coming soon)
   ├── User selects ESPN
   ├── Store platform choice
   └── Proceed to platform authentication

3. Platform credential collection
   ├── ESPN: User enters SWID/espn_s2
   ├── Yahoo: OAuth flow (future)
   ├── Validate credentials with platform
   ├── Success: Trigger league discovery
   └── Failure: Show error, allow retry

4. Automatic league discovery
   ├── Call platform API (ESPN gambit, Yahoo API, etc.)
   ├── Parse and categorize leagues by sport
   ├── Success: Show league selection
   └── Failure: Show manual entry option

5. League selection
   ├── Display discovered leagues grouped by sport
   ├── User selects primary league
   ├── Auto-detect sport from gameId
   ├── Store platform + league selection
   └── Proceed to completion

6. Auto-configuration
   ├── Configure MCP server based on platform + sport
   ├── Set up appropriate tools for platform
   ├── Mark onboarding complete
   └── Enable chat functionality

7. Chat activation
   ├── Show completion celebration
   ├── Activate chat interface with platform tools
   └── Hide onboarding flow
```

### State Management Flow

```
useOnboardingStore (Zustand)
├── step: Current onboarding step
├── selectedPlatform: Chosen platform (ESPN, Yahoo)
├── platformCredentials: Stored credentials by platform
├── discoveredLeagues: Available leagues from platform
├── selectedLeague: User's choice with platform info
├── isComplete: Setup completion status
└── error: Current error state

Integration with existing stores:
├── useAuthStore: Clerk authentication state
├── useToolsStore: MCP and tool configuration
└── useConversationStore: Chat functionality
```

## Technical Requirements

### Dependencies
- **Existing**: All required dependencies are already in place
- **New**: None required (leveraging existing UI components)

### Environment Variables
```bash
# Already configured
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
BASEBALL_ESPN_MCP_URL=https://...
FOOTBALL_ESPN_MCP_URL=https://...

# May need addition
ONBOARDING_SKIP_ENABLED=false  # For development
```

### Database Schema (if needed)
```sql
-- Extend user table or create onboarding table
CREATE TABLE user_onboarding (
  user_id VARCHAR(255) PRIMARY KEY,
  step VARCHAR(50) NOT NULL,
  completed_at TIMESTAMP NULL,
  espn_credentials_set BOOLEAN DEFAULT FALSE,
  selected_league_id VARCHAR(255) NULL,
  selected_team_id VARCHAR(255) NULL,
  selected_sport VARCHAR(50) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
```

## Development Approach

### Phase 1 - Foundation
- [ ] Create basic onboarding store
- [ ] Build platform selection component (ESPN active, Yahoo coming soon)
- [ ] Build ESPN credential collection component
- [ ] Add API routes for platform selection and credential storage

### Phase 2 - Core Flow
- [ ] Develop league discovery and selection UI
- [ ] Add league data API endpoints
- [ ] Implement auto-sport detection
- [ ] Basic flow orchestration

### Phase 3 - Integration
- [ ] Integrate with assistant component
- [ ] Add auto-MCP configuration
- [ ] Update tools panel for new flow

### Phase 4 - Testing
- [ ] Basic end-to-end testing
- [ ] Mobile responsiveness verification

## Testing Strategy

### Basic Testing
- Complete onboarding flow end-to-end
- ESPN API integration
- MCP tool configuration
- Mobile experience validation

## Deployment Strategy

### Development to Production
1. **Development**: Build and test locally
2. **Production**: Direct deployment (no existing users to migrate)

## Risk Mitigation

### Basic Risks
- **ESPN API changes**: Monitor ESPN gambit endpoints
- **Mobile responsiveness**: Test on mobile devices
- **ESPN credential confusion**: Clear instructions


## Future Enhancements

### Phase 2 Features
- **Yahoo Fantasy integration** (OAuth flow, API integration)
- **Multiple platform support** (Sleeper, CBS, etc.)
- Multiple league support within platforms
- Advanced team analytics
- League comparison tools
- Cross-platform league management

### Platform Expansions
- Mobile app onboarding
- Browser extension setup
- API-only client setup
- Slack bot integration

---

**Document Version**: 1.0  
**Last Updated**: 2025-01-16  
**Next Review**: After Phase 1 completion

This document should be updated as implementation progresses and requirements evolve.