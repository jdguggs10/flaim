import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { 
  EspnLeague,
  EspnLeagueInfo,
  SportName
} from '@/lib/espn-types';

export type OnboardingStep = 
  | 'NOT_STARTED'
  | 'PLATFORM_SELECTION' 
  | 'LEAGUE_ENTRY'
  | 'CONFIRMATION'
  | 'AUTO_PULL'
  | 'COMPLETED'
  // Legacy steps (deprecated but maintained for compatibility)
  | 'PLATFORM_AUTH'
  | 'LEAGUE_SELECTION';

export type Platform = 'ESPN' | 'Yahoo';

export interface League {
  leagueId: string;
  name: string;
  sport: 'baseball' | 'football' | 'basketball' | 'hockey';
  gameId: string; // ESPN's internal sport identifier
  teams: Array<{
    teamId: string;
    name: string;
    isUserTeam: boolean;
  }>;
  isActive: boolean;
  seasonYear: number;
  platform: Platform;
}

export interface PlatformCredentials {
  espn?: {
    swid: string;
    espn_s2: string;
  };
  yahoo?: {
    accessToken: string;
    refreshToken: string;
  };
}

export interface SelectedLeague {
  leagueId: string;
  teamId: string;
  sport: string;
  platform: Platform;
  name: string;
}

interface OnboardingState {
  // Current state
  step: OnboardingStep;
  selectedPlatform: Platform | null;
  
  // Multi-league ESPN state
  espnLeagues: EspnLeague[];
  currentLeagueEntry: Partial<EspnLeague> | null;
  autoPullData: EspnLeagueInfo | null;
  selectedTeamId: string | null;
  
  // Legacy compatibility (deprecated - will be removed)
  platformCredentials: PlatformCredentials | null;
  discoveredLeagues: League[]; 
  selectedLeague: SelectedLeague | null;
  
  isComplete: boolean;
  error: string | null;
  
  // Loading states
  isAuthenticating: boolean;
  isDiscoveringLeagues: boolean;
  isAutoSaving: boolean;
  isAutoPulling: boolean;
  
  // Multi-league actions
  addEspnLeague: (league: EspnLeague) => void;
  updateEspnLeague: (leagueId: string, updates: Partial<EspnLeague>) => void;
  removeEspnLeague: (leagueId: string) => void;
  setEspnLeagues: (leagues: EspnLeague[]) => void;
  setCurrentLeagueEntry: (league: Partial<EspnLeague> | null) => void;
  setAutoPullData: (data: EspnLeagueInfo | null) => void;
  setSelectedTeamId: (teamId: string | null) => void;
  
  // General actions
  setStep: (step: OnboardingStep) => void;
  goToPreviousStep: () => void;
  setSelectedPlatform: (platform: Platform) => void;
  setError: (error: string | null) => void;
  setIsAuthenticating: (loading: boolean) => void;
  setIsDiscoveringLeagues: (loading: boolean) => void;
  setIsAutoSaving: (loading: boolean) => void;
  setIsAutoPulling: (loading: boolean) => void;
  completeOnboarding: () => void;
  resetOnboarding: () => void;
  
  // Legacy actions (deprecated)
  setPlatformCredentials: (platform: Platform, credentials: any) => void;
  setDiscoveredLeagues: (leagues: League[]) => void;
  setSelectedLeague: (league: SelectedLeague) => void;
  
  // Computed getters
  canProceedToAuth: () => boolean;
  canProceedToLeagueSelection: () => boolean;
  canCompleteOnboarding: () => boolean;
  canAddMoreLeagues: () => boolean;
  hasTenLeagues: () => boolean;
  getLeagueById: (leagueId: string) => EspnLeague | undefined;
  hasLeague: (leagueId: string, sport: SportName) => boolean;
  isLeagueEntryValid: () => boolean;
  isAutoPulled: () => boolean;
  
  // Re-entry editing action
  editLeague: (league: EspnLeague) => void;
  startAddLeague: () => void;
  
  // Active league helpers
  activeLeagueKey: string | null;
  setActiveLeague: (league: EspnLeague) => void;
  getActiveLeague: () => EspnLeague | undefined;
  hydrateLeagues: () => Promise<void>;
}

const initialState = {
  step: 'NOT_STARTED' as OnboardingStep,
  selectedPlatform: null,
  
  // Multi-league ESPN state
  espnLeagues: [],
  currentLeagueEntry: null,
  autoPullData: null,
  selectedTeamId: null,
  
  // Legacy compatibility (deprecated)
  platformCredentials: null,
  discoveredLeagues: [],
  selectedLeague: null,
  
  isComplete: false,
  error: null,
  
  // Loading states
  isAuthenticating: false,
  isDiscoveringLeagues: false,
  isAutoSaving: false,
  isAutoPulling: false,
  
  // Active league helpers
  activeLeagueKey: null,
};

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      ...initialState,
      
      // Multi-league ESPN actions
      addEspnLeague: (league) => set((state) => {
        // Check for duplicates
        const isDuplicate = state.espnLeagues.some(
          existing => existing.leagueId === league.leagueId && existing.sport === league.sport
        );
        
        if (isDuplicate) {
          return { error: `League ${league.leagueId} for ${league.sport} already exists` };
        }
        
        // Check max leagues limit
        if (state.espnLeagues.length >= 10) {
          return { error: 'Maximum of 10 leagues allowed per user' };
        }
        
        return {
          espnLeagues: [...state.espnLeagues, league],
          error: null
        };
      }),
      
      updateEspnLeague: (leagueId, updates) => set((state) => ({
        espnLeagues: state.espnLeagues.map(league =>
          league.leagueId === leagueId ? { ...league, ...updates } : league
        ),
        error: null
      })),
      
      removeEspnLeague: (leagueId) => set((state) => ({
        espnLeagues: state.espnLeagues.filter(league => league.leagueId !== leagueId),
        error: null
      })),
      
      setEspnLeagues: (leagues) => set({ espnLeagues: leagues, error: null }),
      
      setCurrentLeagueEntry: (league) => set({ currentLeagueEntry: league, error: null }),
      
      setAutoPullData: (data) => set({ autoPullData: data, error: null }),
      
      setSelectedTeamId: (teamId) => set({ selectedTeamId: teamId, error: null }),
      
      // General actions
      setStep: (step) => set({ step, error: null }),
      
      goToPreviousStep: () => set((state) => {
        const stepOrder: OnboardingStep[] = [
          'NOT_STARTED',
          'PLATFORM_SELECTION',
          'PLATFORM_AUTH',
          'LEAGUE_ENTRY',
          'CONFIRMATION',
          'AUTO_PULL',
          'COMPLETED'
        ];
        
        // Handle legacy steps first (not in stepOrder array)
        if (state.step === 'PLATFORM_AUTH') {
          // Go back to platform selection
          return {
            step: 'PLATFORM_SELECTION',
            error: null
          };
        }
        
        if (state.step === 'LEAGUE_SELECTION') {
          // Go back to platform auth or platform selection depending on flow
          return {
            step: state.platformCredentials ? 'PLATFORM_AUTH' : 'PLATFORM_SELECTION',
            error: null
          };
        }
        
        const currentIndex = stepOrder.indexOf(state.step);
        
        // If we're at the first step or step not found, can't go back
        if (currentIndex <= 0) {
          return { error: null };
        }
        
        // Special logic for going back from certain steps
        let previousStep = stepOrder[currentIndex - 1];
        
        // Handle special cases for backwards navigation
        if (state.step === 'AUTO_PULL' && state.espnLeagues.length > 0) {
          // Go back to confirmation page if we have leagues
          previousStep = 'CONFIRMATION';
        } else if (state.step === 'CONFIRMATION' && state.espnLeagues.length === 0) {
          // Go back to league entry if no leagues added yet
          previousStep = 'LEAGUE_ENTRY';
        } else if (state.step === 'LEAGUE_ENTRY' && !state.selectedPlatform) {
          // Go back to platform selection if no platform selected
          previousStep = 'PLATFORM_SELECTION';
        }
        
        return { 
          step: previousStep,
          error: null,
          // Clear auto-pull data when going back from AUTO_PULL
          autoPullData: state.step === 'AUTO_PULL' ? null : state.autoPullData,
          selectedTeamId: state.step === 'AUTO_PULL' ? null : state.selectedTeamId
        };
      }),
      
      setSelectedPlatform: (platform) => set({ 
        selectedPlatform: platform,
        step: platform === 'ESPN' ? 'PLATFORM_AUTH' : 'LEAGUE_ENTRY',
        error: null 
      }),
      
      setError: (error) => set({ error }),
      
      setIsAuthenticating: (loading) => set({ isAuthenticating: loading }),
      
      setIsDiscoveringLeagues: (loading) => set({ isDiscoveringLeagues: loading }),
      
      setIsAutoSaving: (loading) => set({ isAutoSaving: loading }),
      
      setIsAutoPulling: (loading) => set({ isAutoPulling: loading }),
      
      completeOnboarding: () => set((state) => {
        let activeKey = state.activeLeagueKey;
        if (!activeKey && state.espnLeagues.length > 0) {
          const first = state.espnLeagues[0];
          activeKey = `${first.leagueId}-${first.sport}`;
        }
        return {
          step: 'COMPLETED',
          isComplete: true,
          error: null,
          activeLeagueKey: activeKey || null
        };
      }),
      
      resetOnboarding: () => set(initialState),
      
      // Legacy actions (deprecated but maintained for compatibility)
      setPlatformCredentials: (platform, credentials) => set((state) => ({
        platformCredentials: {
          ...state.platformCredentials,
          [platform.toLowerCase()]: credentials
        },
        error: null
      })),
      
      setDiscoveredLeagues: (leagues) => set({ 
        discoveredLeagues: leagues,
        step: leagues.length > 0 ? 'LEAGUE_ENTRY' : 'LEAGUE_ENTRY',
        error: leagues.length === 0 ? 'No leagues found for this account' : null
      }),
      
      setSelectedLeague: (league) => set({ 
        selectedLeague: league,
        error: null
      }),
      
      // Computed getters
      canProceedToAuth: () => {
        const state = get();
        return !!state.selectedPlatform;
      },
      
      canProceedToLeagueSelection: () => {
        const state = get();
        return !!state.selectedPlatform && state.espnLeagues.length > 0;
      },
      
      canCompleteOnboarding: () => {
        const state = get();
        return !!state.selectedPlatform && 
               state.espnLeagues.length > 0 &&
               state.espnLeagues.some(league => !!league.teamId);
      },
      
      canAddMoreLeagues: () => {
        const state = get();
        return state.espnLeagues.length < 10;
      },
      
      hasTenLeagues: () => {
        const state = get();
        return state.espnLeagues.length >= 10;
      },
      
      getLeagueById: (leagueId) => {
        const state = get();
        return state.espnLeagues.find(league => league.leagueId === leagueId);
      },
      
      hasLeague: (leagueId, sport) => {
        const state = get();
        return state.espnLeagues.some(
          league => league.leagueId === leagueId && league.sport === sport
        );
      },
      
      isLeagueEntryValid: () => {
        const state = get();
        const entry = state.currentLeagueEntry;
        if (!entry) return false;
        
        return !!(entry.leagueId && entry.sport && entry.swid && entry.s2);
      },
      
      isAutoPulled: () => {
        const state = get();
        return !!state.autoPullData;
      },
      
      // Re-entry editing action
      editLeague: (league) => set({
        currentLeagueEntry: league,
        autoPullData: null,
        selectedTeamId: null,
        step: 'AUTO_PULL',
        isComplete: false,
        error: null
      }),
      
      startAddLeague: () => set({
        currentLeagueEntry: null,
        autoPullData: null,
        selectedTeamId: null,
        step: 'LEAGUE_ENTRY',
        isComplete: false,
        error: null
      }),
      
      // Active league action
      setActiveLeague: (league) => set({ activeLeagueKey: `${league.leagueId}-${league.sport}` }),
      getActiveLeague: () => {
        const state = get();
        return state.espnLeagues.find(l => `${l.leagueId}-${l.sport}` === state.activeLeagueKey);
      },
      hydrateLeagues: async () => {
        const state = get();
        if (state.espnLeagues.length > 0) return;
        try {
          const res = await fetch('/api/onboarding/espn/leagues');
          if (res.ok) {
            const data = await res.json() as { leagues?: any[] };
            if (Array.isArray(data.leagues) && data.leagues.length > 0) {
              set({ espnLeagues: data.leagues });
            }
          }
        } catch (_) {
          /* network error ignored */
        }
      },
    }),
    {
      name: 'flaim-onboarding-storage',
      partialize: (state) => ({
        step: state.step,
        selectedPlatform: state.selectedPlatform,
        
        // Multi-league state
        espnLeagues: state.espnLeagues,
        currentLeagueEntry: state.currentLeagueEntry,
        autoPullData: state.autoPullData,
        selectedTeamId: state.selectedTeamId,
        
        // Legacy compatibility
        platformCredentials: state.platformCredentials,
        selectedLeague: state.selectedLeague,
        
        isComplete: state.isComplete,
        activeLeagueKey: state.activeLeagueKey,
      }),
      // Migration function to convert legacy data to new format
      migrate: (persistedState: any, version: number) => {
        // If no version is set, this is legacy data that needs migration
        if (version === undefined || version < 1) {
          const migrated = { ...persistedState };
          
          // Migrate legacy selectedLeague and ESPN credentials to espnLeagues array
          if (persistedState.selectedLeague && 
              persistedState.platformCredentials?.espn && 
              !persistedState.espnLeagues?.length) {
            
            const { selectedLeague, platformCredentials } = persistedState;
            const espnCreds = platformCredentials.espn;
            
            // Create new EspnLeague from legacy data
            const migratedLeague = {
              leagueId: selectedLeague.leagueId,
              sport: selectedLeague.sport as 'football' | 'hockey' | 'baseball' | 'basketball',
              swid: espnCreds.swid,
              s2: espnCreds.espn_s2,
              teamId: selectedLeague.teamId,
              leagueName: selectedLeague.name
            };
            
            // Only migrate if we have valid data
            if (migratedLeague.leagueId && migratedLeague.sport && 
                migratedLeague.swid && migratedLeague.s2) {
              migrated.espnLeagues = [migratedLeague];
              migrated.step = 'CONFIRMATION'; // Move to new confirmation step
            }
          }
          
          return migrated;
        }
        return persistedState;
      },
      version: 1,
    }
  )
);

export default useOnboardingStore;