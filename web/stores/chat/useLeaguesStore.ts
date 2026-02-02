/**
 * Chat-only leagues store
 *
 * Simple store for managing league data in chat. Fetches from API only,
 * no wizard/onboarding logic.
 */
import { create } from 'zustand';
import type { EspnLeague } from '@/lib/espn-types';

export const makeLeagueKey = (league: EspnLeague) =>
  `${league.leagueId}-${league.sport}-${league.seasonYear ?? 'unknown'}`;

interface SetupStatus {
  hasCredentials: boolean;
  hasLeagues: boolean;
  hasDefaultTeam: boolean;
}

interface SportDefault {
  platform: string;
  leagueId: string;
  seasonYear: number;
}

interface LeaguesState {
  // League data
  leagues: EspnLeague[];
  activeLeagueKey: string | null;

  // User preferences
  defaultSport: string | null;
  sportDefaults: Record<string, SportDefault | null>;

  // Setup status
  setupStatus: SetupStatus | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchSetupStatus: () => Promise<SetupStatus>;
  fetchLeagues: () => Promise<void>;
  fetchPreferences: () => Promise<void>;
  setDefaultSport: (sport: string) => Promise<void>;
  setDefaultLeague: (league: EspnLeague) => Promise<void>;
  setActiveLeague: (league: EspnLeague) => void;
  getActiveLeague: () => EspnLeague | undefined;
  getSportConfig: (sport: string) => { name: string; emoji: string } | null;
  getAvailableSports: () => string[];
  getLeaguesForSport: (sport: string) => EspnLeague[];
}

export const SPORT_CONFIG: Record<string, { name: string; emoji: string }> = {
  baseball: { name: 'Baseball', emoji: '⚾' },
  football: { name: 'Football', emoji: '🏈' },
  basketball: { name: 'Basketball', emoji: '🏀' },
  hockey: { name: 'Hockey', emoji: '🏒' },
};

export const useLeaguesStore = create<LeaguesState>()((set, get) => ({
  leagues: [],
  activeLeagueKey: null,
  defaultSport: null,
  sportDefaults: {},
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
    } catch {
      set({ error: 'Failed to check setup status', isLoading: false });
      return { hasCredentials: false, hasLeagues: false, hasDefaultTeam: false };
    }
  },

  fetchLeagues: async () => {
    const state = get();
    if (state.leagues.length > 0) return;

    set({ isLoading: true, error: null });
    try {
      const res = await fetch('/api/espn/leagues');
      if (!res.ok) throw new Error('Failed to fetch leagues');
      const data = await res.json() as { leagues?: EspnLeague[] };

      if (Array.isArray(data.leagues)) {
        const leagues = data.leagues;
        // If preferences already loaded, use defaultSport to pick active league
        const { defaultSport, sportDefaults } = get();
        let activeKey: string | null = null;

        if (defaultSport && sportDefaults[defaultSport]) {
          const sd = sportDefaults[defaultSport]!;
          const match = leagues.find(
            l => l.leagueId === sd.leagueId && l.sport === defaultSport && l.seasonYear === sd.seasonYear
          );
          if (match) activeKey = makeLeagueKey(match);
        }

        if (!activeKey) {
          const defaultLeague = leagues.find(l => l.isDefault) || leagues[0];
          activeKey = defaultLeague ? makeLeagueKey(defaultLeague) : null;
        }

        set({ leagues, activeLeagueKey: activeKey, isLoading: false });
      } else {
        set({ leagues: [], isLoading: false });
      }
    } catch {
      set({ error: 'Failed to fetch leagues', isLoading: false });
    }
  },

  fetchPreferences: async () => {
    try {
      const res = await fetch('/api/user/preferences');
      if (!res.ok) return;
      const data = await res.json() as Record<string, unknown>;

      const defaultSport = (data.default_sport as string) || null;
      const sportDefaults: Record<string, SportDefault | null> = {};

      // Map per-sport defaults from API response
      for (const sport of Object.keys(SPORT_CONFIG)) {
        const key = `default_${sport}`;
        const val = data[key] as { platform?: string; league_id?: string; season_year?: number } | undefined;
        if (val?.platform && val?.league_id && val?.season_year !== undefined) {
          sportDefaults[sport] = {
            platform: val.platform,
            leagueId: val.league_id,
            seasonYear: val.season_year,
          };
        } else {
          sportDefaults[sport] = null;
        }
      }

      set({ defaultSport, sportDefaults });

      // If leagues already loaded, switch active league to match preference
      const { leagues } = get();
      if (defaultSport && sportDefaults[defaultSport] && leagues.length > 0) {
        const sd = sportDefaults[defaultSport]!;
        const match = leagues.find(
          l => l.leagueId === sd.leagueId && l.sport === defaultSport && l.seasonYear === sd.seasonYear
        );
        if (match) set({ activeLeagueKey: makeLeagueKey(match) });
      }
    } catch {
      // Preferences are non-critical; don't block chat
    }
  },

  setDefaultSport: async (sport) => {
    const prev = get().defaultSport;
    set({ defaultSport: sport });

    try {
      const res = await fetch('/api/user/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultSport: sport }),
      });
      if (!res.ok) throw new Error('Failed to save default sport');
    } catch {
      set({ defaultSport: prev }); // rollback
      return;
    }

    // Switch active league to the default for this sport
    const { sportDefaults, leagues } = get();
    const sd = sportDefaults[sport];
    if (sd) {
      const match = leagues.find(
        l => l.leagueId === sd.leagueId && l.sport === sport && l.seasonYear === sd.seasonYear
      );
      if (match) set({ activeLeagueKey: makeLeagueKey(match) });
    } else {
      // No default for this sport — pick first league of that sport
      const first = leagues.find(l => l.sport === sport);
      if (first) set({ activeLeagueKey: makeLeagueKey(first) });
    }
  },

  setDefaultLeague: async (league) => {
    const prevKey = get().activeLeagueKey;
    const prevDefaults = { ...get().sportDefaults };

    // Optimistic update
    const newDefault: SportDefault = {
      platform: 'espn',
      leagueId: league.leagueId,
      seasonYear: league.seasonYear ?? new Date().getFullYear(),
    };
    set({
      activeLeagueKey: makeLeagueKey(league),
      sportDefaults: { ...prevDefaults, [league.sport]: newDefault },
    });

    try {
      const res = await fetch('/api/espn/leagues/default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: 'espn',
          leagueId: league.leagueId,
          sport: league.sport,
          seasonYear: league.seasonYear ?? new Date().getFullYear(),
        }),
      });
      if (!res.ok) throw new Error('Failed to set default league');
    } catch {
      // Rollback
      set({ activeLeagueKey: prevKey, sportDefaults: prevDefaults });
    }
  },

  setActiveLeague: (league) => {
    set({ activeLeagueKey: makeLeagueKey(league) });
  },

  getActiveLeague: () => {
    const state = get();
    return state.leagues.find(
      l => makeLeagueKey(l) === state.activeLeagueKey
    );
  },

  getSportConfig: (sport) => SPORT_CONFIG[sport] || null,

  getAvailableSports: () => {
    const { leagues } = get();
    const sports = new Set(leagues.map(l => l.sport));
    return Array.from(sports);
  },

  getLeaguesForSport: (sport) => {
    const { leagues } = get();
    return leagues.filter(l => l.sport === sport);
  },
}));

export default useLeaguesStore;
