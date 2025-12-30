/**
 * Chat-only leagues store
 *
 * Simple store for managing league data in chat. Fetches from API only,
 * no wizard/onboarding logic.
 */
import { create } from 'zustand';
import type { EspnLeague } from '@/lib/espn-types';

interface SetupStatus {
  hasCredentials: boolean;
  hasLeagues: boolean;
  hasDefaultTeam: boolean;
}

interface LeaguesState {
  // League data
  leagues: EspnLeague[];
  activeLeagueKey: string | null;

  // Setup status
  setupStatus: SetupStatus | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchSetupStatus: () => Promise<SetupStatus>;
  fetchLeagues: () => Promise<void>;
  setActiveLeague: (league: EspnLeague) => void;
  getActiveLeague: () => EspnLeague | undefined;
  getSportConfig: (sport: string) => { name: string; emoji: string } | null;
}

const SPORT_CONFIG: Record<string, { name: string; emoji: string }> = {
  baseball: { name: 'Baseball', emoji: '⚾' },
  football: { name: 'Football', emoji: '🏈' },
  basketball: { name: 'Basketball', emoji: '🏀' },
  hockey: { name: 'Hockey', emoji: '🏒' },
};

export const useLeaguesStore = create<LeaguesState>()((set, get) => ({
  leagues: [],
  activeLeagueKey: null,
  setupStatus: null,
  isLoading: false,
  error: null,

  fetchSetupStatus: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch('/api/auth/espn/status', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch setup status');
      const data = await res.json() as SetupStatus;
      set({ setupStatus: data, isLoading: false });
      return data;
    } catch (err) {
      set({ error: 'Failed to check setup status', isLoading: false });
      return { hasCredentials: false, hasLeagues: false, hasDefaultTeam: false };
    }
  },

  fetchLeagues: async () => {
    const state = get();
    if (state.leagues.length > 0) return; // Already have leagues

    set({ isLoading: true, error: null });
    try {
      const res = await fetch('/api/espn/leagues');
      if (!res.ok) throw new Error('Failed to fetch leagues');
      const data = await res.json() as { leagues?: EspnLeague[] };

      if (Array.isArray(data.leagues)) {
        const leagues = data.leagues;
        // Set active league to default or first
        const defaultLeague = leagues.find(l => l.isDefault) || leagues[0];
        const activeKey = defaultLeague
          ? `${defaultLeague.leagueId}-${defaultLeague.sport}`
          : null;

        set({ leagues, activeLeagueKey: activeKey, isLoading: false });
      } else {
        set({ leagues: [], isLoading: false });
      }
    } catch (err) {
      set({ error: 'Failed to fetch leagues', isLoading: false });
    }
  },

  setActiveLeague: (league) => {
    set({ activeLeagueKey: `${league.leagueId}-${league.sport}` });
  },

  getActiveLeague: () => {
    const state = get();
    return state.leagues.find(
      l => `${l.leagueId}-${l.sport}` === state.activeLeagueKey
    );
  },

  getSportConfig: (sport) => SPORT_CONFIG[sport] || null,
}));

export default useLeaguesStore;
