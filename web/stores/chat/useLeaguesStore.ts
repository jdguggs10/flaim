/**
 * Chat-only leagues store
 *
 * Simple store for managing league data in chat. Fetches from API only,
 * no wizard/onboarding logic. Supports ESPN and Yahoo leagues.
 */
import { create } from 'zustand';
import type { EspnLeague } from '@/lib/espn-types';

/** Platform-agnostic league used throughout the chat UI */
export interface ChatLeague {
  platform: 'espn' | 'yahoo';
  leagueId: string;
  sport: string;
  leagueName?: string;
  teamId?: string;
  teamName?: string;
  seasonYear?: number;
  isDefault?: boolean;
}

export const makeLeagueKey = (league: ChatLeague) =>
  `${league.platform}-${league.leagueId}-${league.sport}-${league.seasonYear ?? 'unknown'}`;

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
  leagues: ChatLeague[];
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
  setDefaultLeague: (league: ChatLeague) => Promise<void>;
  setActiveLeague: (league: ChatLeague) => void;
  getActiveLeague: () => ChatLeague | undefined;
  getSportConfig: (sport: string) => { name: string; emoji: string } | null;
  getAvailableSports: () => string[];
  getLeaguesForSport: (sport: string) => ChatLeague[];
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
      // Fetch ESPN and Yahoo leagues in parallel
      const [espnRes, yahooRes] = await Promise.all([
        fetch('/api/espn/leagues'),
        fetch('/api/connect/yahoo/leagues').catch(() => null),
      ]);

      const allLeagues: ChatLeague[] = [];

      // ESPN leagues
      if (espnRes.ok) {
        const espnData = await espnRes.json() as { leagues?: EspnLeague[] };
        if (Array.isArray(espnData.leagues)) {
          for (const l of espnData.leagues) {
            allLeagues.push({ ...l, platform: 'espn' });
          }
        }
      }

      // Yahoo leagues
      if (yahooRes?.ok) {
        const yahooData = await yahooRes.json() as {
          leagues?: Array<{
            id: string;
            sport: string;
            seasonYear: number;
            leagueKey: string;
            leagueName: string;
            teamId?: string;
            teamName?: string;
          }>;
        };
        if (Array.isArray(yahooData.leagues)) {
          for (const l of yahooData.leagues) {
            allLeagues.push({
              platform: 'yahoo',
              leagueId: l.leagueKey,
              sport: l.sport,
              leagueName: l.leagueName,
              teamId: l.teamId,
              teamName: l.teamName,
              seasonYear: l.seasonYear,
            });
          }
        }
      }

      // Pick initial active league based on preferences or isDefault flag
      const { defaultSport, sportDefaults } = get();
      let activeKey: string | null = null;

      if (defaultSport && sportDefaults[defaultSport]) {
        const sd = sportDefaults[defaultSport]!;
        const match = allLeagues.find(
          l => l.leagueId === sd.leagueId && l.sport === defaultSport
            && l.seasonYear === sd.seasonYear && l.platform === sd.platform
        );
        if (match) activeKey = makeLeagueKey(match);
      }

      if (!activeKey) {
        const defaultLeague = allLeagues.find(l => l.isDefault) || allLeagues[0];
        activeKey = defaultLeague ? makeLeagueKey(defaultLeague) : null;
      }

      set({ leagues: allLeagues, activeLeagueKey: activeKey, isLoading: false });
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
          l => l.leagueId === sd.leagueId && l.sport === defaultSport
            && l.seasonYear === sd.seasonYear && l.platform === sd.platform
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
        l => l.leagueId === sd.leagueId && l.sport === sport
          && l.seasonYear === sd.seasonYear && l.platform === sd.platform
      );
      if (match) set({ activeLeagueKey: makeLeagueKey(match) });
    } else {
      // No default for this sport — pick first current-season league
      const first = leagues.find(l => l.sport === sport);
      if (first) set({ activeLeagueKey: makeLeagueKey(first) });
    }
  },

  setDefaultLeague: async (league) => {
    const prevKey = get().activeLeagueKey;
    const prevDefaults = { ...get().sportDefaults };

    // Optimistic update
    const newDefault: SportDefault = {
      platform: league.platform,
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
          platform: league.platform,
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
    // Only show current-season leagues (no historic seasons).
    // seasonYear is canonical (auth-worker normalizes); calendar year is close enough for filtering.
    const currentYear = new Date().getFullYear();
    return leagues.filter(l => l.sport === sport && l.seasonYear === currentYear);
  },
}));

export default useLeaguesStore;
