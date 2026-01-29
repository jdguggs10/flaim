"use client";

import React, { Suspense, useEffect, useState, useMemo } from 'react';
import { useAuth, SignIn } from '@clerk/nextjs';
import { useSearchParams, useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Loader2,
  Trophy,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Search,
  ChevronDown,
  X,
  Star,
  History,
  Chrome,
  Info,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { getDefaultSeasonYear, type SeasonSport } from '@/lib/season-utils';
import { useEspnCredentials } from '@/lib/use-espn-credentials';

const CHROME_EXTENSION_URL = "https://chromewebstore.google.com/detail/flaim-espn-fantasy-connec/mbnokejgglkfgkeeenolgdpcnfakpbkn";

interface League {
  leagueId: string;
  sport: string;
  leagueName?: string;
  teamId?: string;
  teamName?: string;
  seasonYear?: number;
}

interface YahooLeague {
  id: string;
  sport: string;
  seasonYear: number;
  leagueKey: string;
  leagueName: string;
  teamId?: string;
  teamKey?: string;
  teamName?: string;
}

interface LeagueDefault {
  platform: 'espn' | 'yahoo';
  leagueId: string;
  seasonYear: number;
}

interface UserPreferencesState {
  defaultSport: string | null;
  defaultFootball: LeagueDefault | null;
  defaultBaseball: LeagueDefault | null;
  defaultBasketball: LeagueDefault | null;
  defaultHockey: LeagueDefault | null;
}

interface Team {
  id: string;
  name: string;
  owner?: string;
}

interface VerifiedLeague {
  leagueId: string;
  leagueName: string;
  sport: string;
  seasonYear: number;
  teams: Team[];
}

type Sport = 'football' | 'baseball' | 'basketball' | 'hockey';

// Unified league for display - combines ESPN and Yahoo into common format
interface UnifiedLeague {
  platform: 'espn' | 'yahoo';
  // Common fields
  sport: string;
  seasonYear: number;
  leagueName: string;
  teamName?: string;
  isDefault: boolean;
  // Platform-specific identifiers
  leagueId: string;      // ESPN: numeric ID, Yahoo: league_key
  teamId?: string;
  // Yahoo-specific
  yahooId?: string;      // UUID for Yahoo league (for API calls)
}

interface UnifiedLeagueGroup {
  key: string;           // e.g., "espn:football:12345" or "yahoo:football:nfl.l.54321"
  platform: 'espn' | 'yahoo';
  sport: string;
  leagueId: string;
  leagueName: string;
  teamId?: string;
  seasons: UnifiedLeague[];
}

const SPORT_OPTIONS: { value: Sport; label: string; emoji: string }[] = [
  { value: 'football', label: 'Football', emoji: '\u{1F3C8}' },
  { value: 'baseball', label: 'Baseball', emoji: '\u26BE' },
];

// Generate season options (current year down to 2000)
const MIN_YEAR = 2000;
const currentYear = new Date().getFullYear();
const SEASON_OPTIONS = Array.from(
  { length: currentYear - MIN_YEAR + 1 },
  (_, i) => currentYear - i
);

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Convert ESPN leagues to unified format (isDefault computed from preferences)
function espnToUnified(leagues: League[], preferences: UserPreferencesState): UnifiedLeague[] {
  return leagues.map((l) => {
    const sportKey = `default${capitalize(l.sport)}` as keyof UserPreferencesState;
    const sportDefault = preferences[sportKey] as LeagueDefault | null;
    const isDefault = sportDefault?.platform === 'espn' &&
                      sportDefault?.leagueId === l.leagueId &&
                      sportDefault?.seasonYear === l.seasonYear;
    return {
      platform: 'espn' as const,
      sport: l.sport,
      seasonYear: l.seasonYear || new Date().getFullYear(),
      leagueName: l.leagueName || `League ${l.leagueId}`,
      teamName: l.teamName,
      isDefault,
      leagueId: l.leagueId,
      teamId: l.teamId,
    };
  });
}

// Convert Yahoo leagues to unified format (isDefault computed from preferences)
function yahooToUnified(leagues: YahooLeague[], preferences: UserPreferencesState): UnifiedLeague[] {
  return leagues.map((l) => {
    const sportKey = `default${capitalize(l.sport)}` as keyof UserPreferencesState;
    const sportDefault = preferences[sportKey] as LeagueDefault | null;
    const isDefault = sportDefault?.platform === 'yahoo' &&
                      sportDefault?.leagueId === l.leagueKey &&
                      sportDefault?.seasonYear === l.seasonYear;
    return {
      platform: 'yahoo' as const,
      sport: l.sport,
      seasonYear: l.seasonYear,
      leagueName: l.leagueName,
      teamName: l.teamName,
      isDefault,
      leagueId: l.leagueKey,
      teamId: l.teamId,
      yahooId: l.id,
    };
  });
}

function LeaguesPageContent() {
  const { isLoaded, isSignedIn } = useAuth();
  const espnCredentials = useEspnCredentials();
  const { hasCredentials, lastUpdated: espnLastUpdated, isCheckingCreds } = espnCredentials;
  const searchParams = useSearchParams();
  const router = useRouter();

  // Leagues state
  const [leagues, setLeagues] = useState<League[]>([]);
  const [isLoadingLeagues, setIsLoadingLeagues] = useState(true);
  const [leagueError, setLeagueError] = useState<string | null>(null);
  const [leagueNotice, setLeagueNotice] = useState<string | null>(null);
  const [deletingLeagueKey, setDeletingLeagueKey] = useState<string | null>(null);
  const [settingDefaultKey, setSettingDefaultKey] = useState<string | null>(null);
  const [discoveringLeagueKey, setDiscoveringLeagueKey] = useState<string | null>(null);
  const [isEspnSetupOpen, setIsEspnSetupOpen] = useState(false);
  const [isYahooSetupOpen, setIsYahooSetupOpen] = useState(false);
  const [isYahooConnected, setIsYahooConnected] = useState(false);
  const [yahooLastUpdated, setYahooLastUpdated] = useState<string | null>(null);
  const [isCheckingYahoo, setIsCheckingYahoo] = useState(true);
  const [isYahooDisconnecting, setIsYahooDisconnecting] = useState(false);
  const [yahooLeagues, setYahooLeagues] = useState<YahooLeague[]>([]);
  const [isDiscoveringYahoo, setIsDiscoveringYahoo] = useState(false);
  const [preferences, setPreferences] = useState<UserPreferencesState>({
    defaultSport: null,
    defaultFootball: null,
    defaultBaseball: null,
    defaultBasketball: null,
    defaultHockey: null,
  });
  const [settingSportDefault, setSettingSportDefault] = useState<string | null>(null);

  // Convenience accessor
  const defaultSport = preferences.defaultSport;
  const [showOldLeagues, setShowOldLeagues] = useState(false);

  // Add league flow state
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [newLeagueId, setNewLeagueId] = useState('');
  const [newLeagueSport, setNewLeagueSport] = useState<Sport>('football');
  const [newLeagueSeason, setNewLeagueSeason] = useState<number>(() => getDefaultSeasonYear('football'));
  const [seasonManuallySet, setSeasonManuallySet] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifiedLeague, setVerifiedLeague] = useState<VerifiedLeague | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [isAddingLeague, setIsAddingLeague] = useState(false);

  // Helper to determine if a league is "old" (no seasons in last 2 years)
  const isOldLeague = (seasons: { seasonYear: number }[]): boolean => {
    const thresholdYear = new Date().getFullYear() - 2;
    const mostRecentYear = Math.max(...seasons.map(s => s.seasonYear), 0);
    return mostRecentYear < thresholdYear;
  };

  // Group all leagues by sport, then by platform+leagueId
  const leaguesBySport = useMemo(() => {
    // Convert both platforms to unified format
    const allLeagues = [
      ...espnToUnified(leagues, preferences),
      ...yahooToUnified(yahooLeagues, preferences),
    ];

    // Group by platform + leagueId (ESPN) or leagueName (Yahoo)
    // Yahoo uses unique leagueKey per season, so we group by name instead
    const grouped = new Map<string, UnifiedLeagueGroup>();

    for (const league of allLeagues) {
      // Yahoo: group by league name since leagueKey differs per season
      // ESPN: group by leagueId which stays consistent across seasons
      const groupKey = league.platform === 'yahoo'
        ? `${league.platform}:${league.sport}:${league.leagueName}`
        : `${league.platform}:${league.sport}:${league.leagueId}`;

      if (!grouped.has(groupKey)) {
        grouped.set(groupKey, {
          key: groupKey,
          platform: league.platform,
          sport: league.sport,
          leagueId: league.leagueId,
          leagueName: league.leagueName,
          teamId: league.teamId,
          seasons: [],
        });
      }
      grouped.get(groupKey)!.seasons.push(league);
    }

    // Sort seasons desc within each group
    for (const group of grouped.values()) {
      group.seasons.sort((a, b) => b.seasonYear - a.seasonYear);
      // Use most recent season's league name
      group.leagueName = group.seasons[0]?.leagueName || group.leagueName;
      group.teamId = group.seasons.find((s) => s.teamId)?.teamId;
    }

    // Separate active vs old leagues
    const activeLeagues: UnifiedLeagueGroup[] = [];
    const oldLeagueGroups: UnifiedLeagueGroup[] = [];

    for (const group of grouped.values()) {
      if (isOldLeague(group.seasons)) {
        oldLeagueGroups.push(group);
      } else {
        activeLeagues.push(group);
      }
    }

    // Group active leagues by sport
    const bySportActive = new Map<string, UnifiedLeagueGroup[]>();
    for (const group of activeLeagues) {
      if (!bySportActive.has(group.sport)) {
        bySportActive.set(group.sport, []);
      }
      bySportActive.get(group.sport)!.push(group);
    }

    // Sort leagues within each sport by most recent season
    for (const sportGroups of bySportActive.values()) {
      sportGroups.sort((a, b) => {
        const aYear = a.seasons[0]?.seasonYear || 0;
        const bYear = b.seasons[0]?.seasonYear || 0;
        return bYear - aYear;
      });
    }

    // Return sorted by sport order
    const sportOrder = ['football', 'baseball', 'basketball', 'hockey'];
    const sortedActive = Array.from(bySportActive.entries()).sort((a, b) => {
      return sportOrder.indexOf(a[0]) - sportOrder.indexOf(b[0]);
    });

    return { active: sortedActive, old: oldLeagueGroups };
  }, [leagues, yahooLeagues, preferences]);

  // Load leagues on mount
  const loadLeagues = async (options?: { showSpinner?: boolean }) => {
    const showSpinner = options?.showSpinner ?? true;
    if (showSpinner) setIsLoadingLeagues(true);

    try {
      const leaguesRes = await fetch('/api/espn/leagues');
      if (leaguesRes.ok) {
        const data = await leaguesRes.json() as { leagues?: League[] };
        setLeagues(data.leagues || []);
      }
    } catch (err) {
      console.error('Failed to load leagues:', err);
    } finally {
      if (showSpinner) setIsLoadingLeagues(false);
    }
  };

  const checkYahooStatus = async () => {
    try {
      const res = await fetch('/api/connect/yahoo/status');
      if (res.ok) {
        const data = await res.json() as { connected?: boolean; lastUpdated?: string };
        setIsYahooConnected(data.connected ?? false);
        setYahooLastUpdated(data.lastUpdated || null);
      }
    } catch (err) {
      console.error('Failed to check Yahoo status:', err);
    } finally {
      setIsCheckingYahoo(false);
    }
  };

  const loadYahooLeagues = async () => {
    try {
      const res = await fetch('/api/connect/yahoo/leagues');
      if (res.ok) {
        const data = await res.json() as { leagues?: YahooLeague[] };
        setYahooLeagues(data.leagues || []);
      }
    } catch (err) {
      console.error('Failed to load Yahoo leagues:', err);
    }
  };

  const discoverYahooLeagues = async () => {
    setIsDiscoveringYahoo(true);
    try {
      const res = await fetch('/api/connect/yahoo/discover', { method: 'POST' });
      if (res.ok) {
        await loadYahooLeagues();
      }
    } catch (err) {
      console.error('Failed to discover Yahoo leagues:', err);
    } finally {
      setIsDiscoveringYahoo(false);
    }
  };

  const disconnectYahoo = async () => {
    setIsYahooDisconnecting(true);
    try {
      const res = await fetch('/api/connect/yahoo/disconnect', { method: 'DELETE' });
      if (res.ok) {
        setIsYahooConnected(false);
        setYahooLeagues([]);
      }
    } catch (err) {
      console.error('Failed to disconnect Yahoo:', err);
    } finally {
      setIsYahooDisconnecting(false);
    }
  };

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setIsLoadingLeagues(false);
      return;
    }

    loadLeagues({ showSpinner: true });
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (!isSignedIn) return;

    // Fetch user preferences
    const loadPreferences = async () => {
      try {
        const res = await fetch('/api/user/preferences');
        if (res.ok) {
          const data = await res.json() as UserPreferencesState;
          setPreferences({
            defaultSport: data.defaultSport || null,
            defaultFootball: data.defaultFootball || null,
            defaultBaseball: data.defaultBaseball || null,
            defaultBasketball: data.defaultBasketball || null,
            defaultHockey: data.defaultHockey || null,
          });
        }
      } catch (err) {
        console.error('Failed to load preferences:', err);
      }
    };
    loadPreferences();

    const yahooParam = searchParams.get('yahoo');
    if (yahooParam === 'connected') {
      // Just came from OAuth — trust the param, skip status check
      setIsYahooConnected(true);
      setIsCheckingYahoo(false);
      discoverYahooLeagues();
      router.replace('/leagues', { scroll: false });
    } else {
      // Normal page load — check status from backend
      checkYahooStatus().then(() => loadYahooLeagues());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  // Verify league (call auto-pull to get league info)
  const handleVerifyLeague = async () => {
    if (!hasCredentials) {
      setLeagueError('Add your ESPN credentials on the Connectors page first');
      return;
    }

    if (!newLeagueId.trim()) {
      setLeagueError('League ID is required');
      return;
    }

    // Check for duplicates (including season year for multi-season support)
    const exists = leagues.some(
      (l) => l.leagueId === newLeagueId.trim() && l.sport === newLeagueSport && l.seasonYear === newLeagueSeason
    );
    if (exists) {
      setLeagueError('This league and season is already added');
      return;
    }

    setIsVerifying(true);
    setLeagueError(null);
    setLeagueNotice(null);
    setVerifiedLeague(null);
    setSelectedTeamId('');

    try {
      const res = await fetch('/api/espn/auto-pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sport: newLeagueSport,
          leagueId: newLeagueId.trim(),
          seasonYear: newLeagueSeason,
        }),
      });

      const data = await res.json() as {
        success?: boolean;
        error?: string;
        leagueInfo?: {
          leagueId: string;
          leagueName: string;
          sport: string;
          seasonYear: number;
          teams: Array<{ id: string; name: string; owner?: string }>;
        };
      };

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to verify league');
      }

      if (!data.leagueInfo) {
        throw new Error('No league info returned');
      }

      setVerifiedLeague({
        leagueId: newLeagueId.trim(),
        leagueName: data.leagueInfo.leagueName,
        sport: newLeagueSport,
        seasonYear: data.leagueInfo.seasonYear,
        teams: data.leagueInfo.teams.map((t: { teamId?: string; id?: string; teamName?: string; name?: string; ownerName?: string; owner?: string }) => ({
          id: String(t.teamId || t.id || ''),
          name: t.teamName || t.name || '',
          owner: t.ownerName || t.owner,
        })),
      });
      setManualDialogOpen(false); // Close dialog on successful verification
    } catch (err) {
      setLeagueError(err instanceof Error ? err.message : 'Failed to verify league');
    } finally {
      setIsVerifying(false);
    }
  };

  // Add verified league with team selection
  const handleAddVerifiedLeague = async () => {
    if (!verifiedLeague) return;

    const selectedTeam = verifiedLeague.teams.find((t) => t.id === selectedTeamId);

    setIsAddingLeague(true);
    setLeagueError(null);
    setLeagueNotice(null);

    try {
      const newLeague: League = {
        leagueId: verifiedLeague.leagueId,
        sport: verifiedLeague.sport,
        leagueName: verifiedLeague.leagueName,
        seasonYear: verifiedLeague.seasonYear,
        teamId: selectedTeamId || undefined,
        teamName: selectedTeam?.name,
      };

      const updatedLeagues = [...leagues, newLeague];

      const res = await fetch('/api/espn/leagues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagues: updatedLeagues }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error || 'Failed to add league');
      }

      setLeagues(updatedLeagues);
      setNewLeagueId('');
      setVerifiedLeague(null);
      setSelectedTeamId('');
    } catch (err) {
      setLeagueError(err instanceof Error ? err.message : 'Failed to add league');
    } finally {
      setIsAddingLeague(false);
    }
  };

  // Cancel verification
  const handleCancelVerification = () => {
    setVerifiedLeague(null);
    setSelectedTeamId('');
    setLeagueError(null);
  };

  // Delete league - removes ALL seasons of this league
  const handleDeleteLeague = async (leagueId: string, sport: string) => {
    const leagueKey = `${leagueId}-${sport}`;
    setDeletingLeagueKey(leagueKey);
    setLeagueNotice(null);

    try {
      // Delete all seasons of this league (no seasonYear = delete all)
      const deleteUrl = `/api/espn/leagues?leagueId=${encodeURIComponent(leagueId)}&sport=${encodeURIComponent(sport)}`;
      const res = await fetch(deleteUrl, { method: 'DELETE' });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error || 'Failed to remove league');
      }

      // Remove all seasons of this league from local state
      setLeagues(leagues.filter((l) => !(l.leagueId === leagueId && l.sport === sport)));
    } catch (err) {
      setLeagueError(err instanceof Error ? err.message : 'Failed to remove league');
    } finally {
      setDeletingLeagueKey(null);
    }
  };

  // Set default league (unified for ESPN and Yahoo)
  const handleSetDefault = async (
    platform: 'espn' | 'yahoo',
    leagueId: string,
    sport: string,
    seasonYear: number,
    yahooId?: string
  ) => {
    const leagueKey = platform === 'yahoo'
      ? `yahoo:${yahooId}`
      : `${leagueId}-${sport}-${seasonYear}`;
    setSettingDefaultKey(leagueKey);
    setLeagueError(null);
    setLeagueNotice(null);

    try {
      const res = await fetch('/api/espn/leagues/default', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platform, leagueId, sport, seasonYear }),
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error || 'Failed to set default league');
      }

      const data = await res.json() as { preferences?: UserPreferencesState };
      if (data.preferences) {
        setPreferences(data.preferences);
      }

      // Auto-set sport as default if no sport default exists
      if (!preferences.defaultSport) {
        await fetch('/api/user/preferences', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ defaultSport: sport }),
        });
        setPreferences(prev => ({ ...prev, defaultSport: sport }));
      }
    } catch (err) {
      setLeagueError(err instanceof Error ? err.message : 'Failed to set default league');
    } finally {
      setSettingDefaultKey(null);
    }
  };

  // Set default sport
  const handleSetDefaultSport = async (sport: string) => {
    setSettingSportDefault(sport);
    try {
      const newDefault = preferences.defaultSport === sport ? null : sport;
      const res = await fetch('/api/user/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultSport: newDefault }),
      });
      if (res.ok) {
        setPreferences(prev => ({ ...prev, defaultSport: newDefault }));
      }
    } catch (err) {
      console.error('Failed to set default sport:', err);
    } finally {
      setSettingSportDefault(null);
    }
  };

  // Delete Yahoo league (single season)
  const handleDeleteYahooLeague = async (yahooId: string) => {
    setDeletingLeagueKey(`yahoo:${yahooId}`);
    setLeagueNotice(null);

    try {
      const res = await fetch(`/api/connect/yahoo/leagues/${yahooId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error || 'Failed to delete league');
      }

      const data = await res.json() as { leagues?: YahooLeague[] };
      if (data.leagues) {
        setYahooLeagues(data.leagues);
      }
    } catch (err) {
      setLeagueError(err instanceof Error ? err.message : 'Failed to delete league');
    } finally {
      setDeletingLeagueKey(null);
    }
  };

  // Delete all seasons of a Yahoo league group
  const handleDeleteYahooLeagueGroup = async (seasons: UnifiedLeague[]) => {
    const yahooIds = seasons.map(s => s.yahooId).filter((id): id is string => !!id);
    if (yahooIds.length === 0) return;

    setDeletingLeagueKey(`yahoo:${yahooIds[0]}`);
    setLeagueNotice(null);

    try {
      // Delete each season sequentially
      for (const yahooId of yahooIds) {
        const res = await fetch(`/api/connect/yahoo/leagues/${yahooId}`, {
          method: 'DELETE',
        });

        if (!res.ok) {
          const data = await res.json() as { error?: string };
          throw new Error(data.error || 'Failed to delete league');
        }
      }

      // Refresh leagues after all deletions
      const refreshRes = await fetch('/api/connect/yahoo/leagues');
      if (refreshRes.ok) {
        const data = await refreshRes.json() as { leagues?: YahooLeague[] };
        if (data.leagues) {
          setYahooLeagues(data.leagues);
        }
      }
    } catch (err) {
      setLeagueError(err instanceof Error ? err.message : 'Failed to delete league');
    } finally {
      setDeletingLeagueKey(null);
    }
  };

  // Discover historical seasons for a league
  const handleDiscoverSeasons = async (leagueId: string, sport: string) => {
    // Only baseball and football are supported
    if (sport !== 'baseball' && sport !== 'football') {
      setLeagueError('Season discovery is only available for baseball and football leagues');
      return;
    }

    const leagueKey = `${leagueId}-${sport}`;
    setDiscoveringLeagueKey(leagueKey);
    setLeagueError(null);
    setLeagueNotice(null);

    try {
      const response = await fetch('/api/espn/discover-seasons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leagueId, sport })
      });

      const data = await response.json() as {
        success?: boolean;
        error?: string;
        discovered?: Array<{ seasonYear: number; leagueName: string; teamCount: number }>;
        skipped?: number;
        rateLimited?: boolean;
      };

      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Discovery failed');
      }

      // Show success message
      const count = data.discovered?.length || 0;
      const skipped = data.skipped || 0;
      const rateLimitedMsg = data.rateLimited ? ' (stopped early due to rate limiting)' : '';

      // Refresh leagues list to show newly discovered seasons
      const leaguesRes = await fetch('/api/espn/leagues');
      if (leaguesRes.ok) {
        const leaguesData = await leaguesRes.json() as { leagues?: League[] };
        setLeagues(leaguesData.leagues || []);
      }

      setLeagueNotice(`Discovered ${count} new season${count !== 1 ? 's' : ''}, ${skipped} already stored${rateLimitedMsg}`);
      setTimeout(() => setLeagueNotice(null), 5000);

    } catch (err) {
      setLeagueError(err instanceof Error ? err.message : 'Failed to discover seasons');
    } finally {
      setDiscoveringLeagueKey(null);
    }
  };

  const getSportEmoji = (sport: string) => {
    const option = SPORT_OPTIONS.find((s) => s.value === sport);
    return option?.emoji || '\u{1F3C6}';
  };

  // Loading state
  if (!isLoaded || isCheckingCreds) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Not signed in
  if (!isSignedIn) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6">
          <div className="text-center space-y-3">
            <div className="w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center font-bold mx-auto">
              1
            </div>
            <h1 className="text-2xl font-semibold">Sign in to manage leagues</h1>
            <p className="text-muted-foreground">
              Create an account or sign in to connect your ESPN fantasy leagues.
            </p>
          </div>
          <SignIn routing="hash" fallbackRedirectUrl="/leagues" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-2xl mx-auto py-8 px-4 space-y-6">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Trophy className="h-6 w-6" />
            <h1 className="text-2xl font-semibold">Your Leagues</h1>
          </div>
          <p className="text-muted-foreground">
            Manage your connected leagues, seasons, and default team here.
          </p>
        </div>

        {/* Global alerts */}
        {leagueError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{leagueError}</AlertDescription>
          </Alert>
        )}

        {leagueNotice && (
          <Alert className="bg-info/10 border-info/30 text-info">
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>{leagueNotice}</AlertDescription>
          </Alert>
        )}

        {/* Your Leagues Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Active Leagues</CardTitle>
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className="text-muted-foreground hover:text-warning transition-colors" aria-label="Star defaults info">
                    <Star className="h-4 w-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 text-sm">
                  <p className="text-muted-foreground">
                    <strong className="text-foreground">Stars mark your defaults.</strong> Set a default sport, and also set a default team per sport. This is optional, but it can be helpful with many leagues.
                  </p>
                </PopoverContent>
              </Popover>
            </div>
            <CardDescription>
              These are your teams and seasons that are already linked.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoadingLeagues ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : leaguesBySport.active.length === 0 && leaguesBySport.old.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <p className="text-sm">No leagues added yet.</p>
              </div>
            ) : (
              <div className="space-y-6">
                {leaguesBySport.active.map(([sport, sportLeagues]) => (
                  <div key={sport} className="space-y-3">
                    {/* Sport Header with Default Star */}
                    <div className="flex items-center gap-2 font-medium text-muted-foreground">
                      <span className="text-lg">{getSportEmoji(sport)}</span>
                      <span className="capitalize text-base">{sport}</span>
                      {defaultSport === sport ? (
                        <button
                          onClick={() => handleSetDefaultSport(sport)}
                          disabled={settingSportDefault === sport}
                          className="flex items-center gap-1 px-2 py-1 rounded-full bg-warning/20 text-warning text-xs hover:bg-warning/30 transition-colors"
                          title="Default sport (click to unset)"
                        >
                          {settingSportDefault === sport ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Star className="h-3 w-3 fill-current" />
                          )}
                          <span>default</span>
                        </button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-warning"
                          onClick={() => handleSetDefaultSport(sport)}
                          disabled={settingSportDefault === sport}
                          title="Set as default sport"
                        >
                          {settingSportDefault === sport ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Star className="h-3 w-3" />
                          )}
                        </Button>
                      )}
                    </div>

                    {/* Leagues in this sport */}
                    <div className="space-y-3">
                      {sportLeagues.map((group) => {
                        const baseKey = `${group.leagueId}-${group.sport}`;
                        const isDeleting = deletingLeagueKey === baseKey;
                        const isDiscovering = discoveringLeagueKey === baseKey;
                        const canDiscover = group.sport === 'baseball' || group.sport === 'football';
                        const hasTeamSelection = group.seasons.some((season) => !!season.teamId);
                        const primaryTeamId = group.seasons.find((s) => s.teamId)?.teamId;

                        return (
                          <div key={group.key} className="rounded-lg border bg-card">
                            {/* Group Header */}
                            <div className="flex items-center justify-between gap-3 p-3 border-b">
                              <div className="min-w-0">
                                <div className="font-medium break-words">
                                  {group.leagueName || `League ${group.leagueId}`}
                                </div>
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  {(() => {
                                    const mostRecentSeason = group.seasons[0];
                                    const isLeagueDefault = mostRecentSeason?.isDefault;
                                    const leagueKey = group.platform === 'espn'
                                      ? `${mostRecentSeason?.leagueId}-${mostRecentSeason?.sport}-${mostRecentSeason?.seasonYear || 'all'}`
                                      : `yahoo:${mostRecentSeason?.yahooId}`;
                                    const isSettingThis = settingDefaultKey === leagueKey;

                                    return (
                                      <button
                                        className={`shrink-0 p-0.5 rounded hover:bg-muted ${
                                          isLeagueDefault
                                            ? 'text-warning'
                                            : 'text-muted-foreground hover:text-warning'
                                        }`}
                                        onClick={() => handleSetDefault(
                                          group.platform,
                                          mostRecentSeason.leagueId,
                                          mostRecentSeason.sport,
                                          mostRecentSeason.seasonYear,
                                          mostRecentSeason.yahooId
                                        )}
                                        disabled={isSettingThis || isLeagueDefault || !mostRecentSeason?.teamId}
                                        title={
                                          !mostRecentSeason?.teamId
                                            ? 'No team selected'
                                            : isLeagueDefault
                                            ? 'Default league for this sport'
                                            : 'Set as default for this sport'
                                        }
                                      >
                                        {isSettingThis ? (
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : (
                                          <Star className={`h-3 w-3 ${isLeagueDefault ? 'fill-current' : ''}`} />
                                        )}
                                      </button>
                                    );
                                  })()}
                                  <span className="break-words">
                                    {group.platform === 'espn' ? 'ESPN' : 'Yahoo'}
                                    {` • League ID: ${group.leagueId}`}
                                    {primaryTeamId && ` • Team ID: ${primaryTeamId}`}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {group.platform === 'espn' && canDiscover && (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 text-muted-foreground hover:text-primary"
                                    onClick={() => handleDiscoverSeasons(group.leagueId, group.sport)}
                                    disabled={isDiscovering || !!discoveringLeagueKey || !hasTeamSelection}
                                    title={
                                      !hasTeamSelection
                                        ? 'Select a team first'
                                        : 'Discover historical seasons'
                                    }
                                  >
                                    {isDiscovering ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <History className="h-4 w-4" />
                                    )}
                                  </Button>
                                )}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                  onClick={() => {
                                    if (group.platform === 'espn') {
                                      handleDeleteLeague(group.leagueId, group.sport);
                                    } else {
                                      // For Yahoo, delete all seasons in the group
                                      handleDeleteYahooLeagueGroup(group.seasons);
                                    }
                                  }}
                                  disabled={group.platform === 'espn'
                                    ? deletingLeagueKey === baseKey
                                    : deletingLeagueKey === `yahoo:${group.seasons[0]?.yahooId}`}
                                  title="Delete all seasons"
                                >
                                  {(group.platform === 'espn' ? isDeleting : deletingLeagueKey === `yahoo:${group.seasons[0]?.yahooId}`) ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-4 w-4" />
                                  )}
                                </Button>
                              </div>
                            </div>

                            {/* Season Chips */}
                            <div className="p-3">
                              <div className="flex gap-2 overflow-x-auto pb-1">
                                {group.seasons.map((season) => {
                                  const seasonKey = `${season.leagueId}-${season.sport}-${season.seasonYear || 'all'}`;

                                  return (
                                    <div
                                      key={seasonKey}
                                      className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm shrink-0 ${
                                        season.isDefault
                                          ? 'bg-primary/10 border border-primary/30'
                                          : 'bg-muted'
                                      }`}
                                    >
                                      <div className="flex flex-col">
                                        <div className="flex items-center gap-1">
                                          <span className="font-medium">{season.seasonYear || 'Unknown'}</span>
                                          {season.isDefault && (
                                            <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
                                              Default
                                            </span>
                                          )}
                                        </div>
                                        {season.teamName && (
                                          <span className="text-xs text-muted-foreground">{season.teamName}</span>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}

                    {/* Old Leagues Section */}
                    {leaguesBySport.old.length > 0 && (
                      <div className="space-y-3 pt-3 border-t">
                        <button
                          type="button"
                          className="flex items-center gap-2 font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
                          onClick={() => setShowOldLeagues(!showOldLeagues)}
                        >
                          <span className="text-lg">🗄️</span>
                          <span className="text-base">Old Leagues ({leaguesBySport.old.length})</span>
                          <ChevronDown className={`h-4 w-4 ml-auto transition-transform ${showOldLeagues ? 'rotate-180' : ''}`} />
                        </button>

                        {showOldLeagues && (
                          <div className="space-y-3">
                            {leaguesBySport.old.map((group) => {
                              const baseKey = `${group.leagueId}-${group.sport}`;
                              const isDeleting = deletingLeagueKey === baseKey;
                              const mostRecentYear = group.seasons[0]?.seasonYear;

                              return (
                                <div key={group.key} className="rounded-lg border bg-muted/30">
                                  {/* Old League Header */}
                                  <div className="flex items-center justify-between gap-3 p-3">
                                    <div className="min-w-0">
                                      <div className="font-medium break-words text-muted-foreground">
                                        {group.leagueName || `League ${group.leagueId}`}
                                      </div>
                                      <div className="text-xs text-muted-foreground/70 break-words">
                                        {group.platform === 'espn' ? 'ESPN' : 'Yahoo'}
                                        {` • Last active: ${mostRecentYear}`}
                                      </div>
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-8 w-8 text-muted-foreground hover:text-destructive shrink-0"
                                      onClick={() => {
                                        if (group.platform === 'espn') {
                                          handleDeleteLeague(group.leagueId, group.sport);
                                        } else {
                                          const yahooId = group.seasons[0]?.yahooId;
                                          if (yahooId) handleDeleteYahooLeague(yahooId);
                                        }
                                      }}
                                      disabled={isDeleting}
                                      title="Delete league"
                                    >
                                      {isDeleting ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                      ) : (
                                        <Trash2 className="h-4 w-4" />
                                      )}
                                    </Button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* League Maintenance */}
        <div className="space-y-4">
          <div className="space-y-2">
            <h2 className="text-2xl font-semibold">League Maintenance</h2>
            <p className="text-muted-foreground">
              Manage ESPN credentials, discover new leagues, or add them manually.
            </p>
          </div>

          {/* Platform cards */}
          <div className="grid gap-4">
            <Card>
              <button
                type="button"
                onClick={() => setIsEspnSetupOpen((prev) => !prev)}
                aria-expanded={isEspnSetupOpen}
                aria-controls="espn-setup-content"
                className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <CardHeader className="flex items-start gap-4">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg">ESPN</CardTitle>
                      {hasCredentials && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-success/20 text-success">
                          Credentials Saved
                        </span>
                      )}
                    </div>
                    <CardDescription>
                      Use the extension to update credentials and discover leagues, or add one manually.
                    </CardDescription>
                  </div>
                  <ChevronDown
                    className={`h-5 w-5 text-muted-foreground transition-transform shrink-0 self-start ${
                      isEspnSetupOpen ? 'rotate-180' : ''
                    }`}
                  />
                </CardHeader>
              </button>
              {isEspnSetupOpen && (
                <CardContent id="espn-setup-content" className="space-y-4">
                  {espnLastUpdated && (
                    <p className="text-xs text-muted-foreground">
                      Last synced: {new Date(espnLastUpdated).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </p>
                  )}
                  {!verifiedLeague && (
                    <div className="space-y-4">
                      <div className="space-y-2">
                        <a
                          href={CHROME_EXTENSION_URL}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block"
                        >
                          <Button
                            variant={hasCredentials ? 'outline' : 'default'}
                            className="w-full justify-center"
                          >
                            <span className="inline-flex items-center gap-2">
                              <span>Automatically</span>
                              <Chrome className="h-4 w-4" />
                              <span>Use Chrome Extension</span>
                            </span>
                          </Button>
                        </a>
                      </div>

                      <Dialog open={manualDialogOpen} onOpenChange={setManualDialogOpen}>
                        <DialogTrigger asChild>
                          <Button variant="outline" className="w-full">
                            Add league manually
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <div className="flex items-center gap-2">
                              <DialogTitle>Add League Manually</DialogTitle>
                              <Popover>
                                <PopoverTrigger asChild>
                                  <button
                                    type="button"
                                    className="text-muted-foreground hover:text-foreground transition-colors"
                                    aria-label="How to find your league ID"
                                  >
                                    <Info className="h-4 w-4" />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-80 text-sm">
                                  <p className="font-medium mb-2">Finding your league ID</p>
                                  <p className="text-muted-foreground">
                                    Your league ID is in the ESPN URL when viewing your league:
                                  </p>
                                  <code className="block mt-2 p-2 bg-muted rounded text-xs break-all">
                                    espn.com/fantasy/football/league?leagueId=<strong>12345678</strong>
                                  </code>
                                </PopoverContent>
                              </Popover>
                            </div>
                            <DialogDescription>
                              Enter your ESPN league ID to add a specific league or season.
                            </DialogDescription>
                          </DialogHeader>
                          <div className="space-y-4 pt-2">
                            {/* Quick season toggles */}
                            {(newLeagueSport === 'baseball' || newLeagueSport === 'football') && (
                              <div className="flex gap-2">
                                <Button
                                  variant={newLeagueSeason === getDefaultSeasonYear(newLeagueSport as SeasonSport) ? 'default' : 'outline'}
                                  size="sm"
                                  onClick={() => {
                                    const sport = newLeagueSport as SeasonSport;
                                    setNewLeagueSeason(getDefaultSeasonYear(sport));
                                    setSeasonManuallySet(false);
                                  }}
                                  disabled={isVerifying}
                                >
                                  This season
                                </Button>
                                <Button
                                  variant={newLeagueSeason === getDefaultSeasonYear(newLeagueSport as SeasonSport) - 1 ? 'default' : 'outline'}
                                  size="sm"
                                  onClick={() => {
                                    const sport = newLeagueSport as SeasonSport;
                                    setNewLeagueSeason(getDefaultSeasonYear(sport) - 1);
                                    setSeasonManuallySet(true);
                                  }}
                                  disabled={isVerifying}
                                >
                                  Last season
                                </Button>
                              </div>
                            )}
                            <div className="space-y-2">
                              <Label htmlFor="leagueId">League ID</Label>
                              <Input
                                id="leagueId"
                                placeholder="e.g., 12345678"
                                value={newLeagueId}
                                onChange={(e) => setNewLeagueId(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleVerifyLeague()}
                                disabled={isVerifying}
                              />
                            </div>
                            <div className="flex gap-2">
                              <div className="flex-1 space-y-2">
                                <Label>Sport</Label>
                                <Select
                                  value={newLeagueSport}
                                  onValueChange={(v) => {
                                    const sport = v as Sport;
                                    setNewLeagueSport(sport);
                                    if (!seasonManuallySet && (sport === 'baseball' || sport === 'football')) {
                                      setNewLeagueSeason(getDefaultSeasonYear(sport));
                                    }
                                  }}
                                  disabled={isVerifying}
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {SPORT_OPTIONS.map((sport) => (
                                      <SelectItem key={sport.value} value={sport.value}>
                                        {sport.emoji} {sport.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="w-24 space-y-2">
                                <Label>Season</Label>
                                <Select
                                  value={String(newLeagueSeason)}
                                  onValueChange={(v) => {
                                    setNewLeagueSeason(Number(v));
                                    setSeasonManuallySet(true);
                                  }}
                                  disabled={isVerifying}
                                >
                                  <SelectTrigger>
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {SEASON_OPTIONS.map((year) => (
                                      <SelectItem key={year} value={String(year)}>
                                        {year}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                            <div className="flex gap-2 pt-2">
                              <Button
                                onClick={handleVerifyLeague}
                                disabled={isVerifying || !newLeagueId.trim()}
                              >
                                {isVerifying ? (
                                  <>
                                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                    Verifying...
                                  </>
                                ) : (
                                  <>
                                    <Search className="h-4 w-4 mr-2" />
                                    Verify League
                                  </>
                                )}
                              </Button>
                              <Button variant="outline" onClick={() => setManualDialogOpen(false)}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        </DialogContent>
                      </Dialog>
                    </div>
                  )}

                {/* Verification result - shows after successful verify */}
                {verifiedLeague && (
                  <div className="p-4 border rounded-lg bg-muted/50 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-5 w-5 text-success" />
                        <span className="font-medium">League verified</span>
                      </div>
                      <Button variant="ghost" size="icon" onClick={handleCancelVerification}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{getSportEmoji(verifiedLeague.sport)}</span>
                        <div>
                          <div className="font-medium">{verifiedLeague.leagueName}</div>
                          <div className="text-sm text-muted-foreground">
                            {verifiedLeague.seasonYear} Season
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Select Your Team</Label>
                      <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose your team..." />
                        </SelectTrigger>
                        <SelectContent>
                          {verifiedLeague.teams.map((team, index) => {
                            const uniqueId = team.id || String(index + 1);
                            return (
                              <SelectItem key={`team-${index}-${uniqueId}`} value={uniqueId}>
                                {team.name}
                                {team.owner && (
                                  <span className="text-muted-foreground ml-2">({team.owner})</span>
                                )}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        onClick={handleAddVerifiedLeague}
                        disabled={isAddingLeague || !selectedTeamId}
                      >
                        {isAddingLeague ? (
                          <>
                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                            Adding...
                          </>
                        ) : (
                          'Add League'
                        )}
                      </Button>
                      <Button variant="outline" onClick={handleCancelVerification}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
                </CardContent>
              )}
            </Card>

            <Card>
              <button
                type="button"
                onClick={() => setIsYahooSetupOpen((prev) => !prev)}
                aria-expanded={isYahooSetupOpen}
                aria-controls="yahoo-setup-content"
                className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <CardHeader className="flex items-start gap-4">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <CardTitle className="text-lg">Yahoo</CardTitle>
                      {isYahooConnected && (
                        <span className="text-xs px-2 py-0.5 rounded-full bg-success/20 text-success">
                          Connected
                        </span>
                      )}
                    </div>
                    <CardDescription>
                      {isYahooConnected
                        ? 'Use the Refresh Leagues button to trigger a fresh pull of your leagues, teams, and seasons from Yahoo.'
                        : 'Connect your Yahoo account to add leagues.'}
                    </CardDescription>
                  </div>
                  <ChevronDown
                    className={`h-5 w-5 text-muted-foreground transition-transform shrink-0 self-start ${
                      isYahooSetupOpen ? 'rotate-180' : ''
                    }`}
                  />
                </CardHeader>
              </button>
              {isYahooSetupOpen && (
                <CardContent id="yahoo-setup-content" className="space-y-3">
                  {isCheckingYahoo ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Checking Yahoo connection...
                    </div>
                  ) : isYahooConnected ? (
                    <div className="space-y-3">
                      {yahooLastUpdated && (
                        <p className="text-xs text-muted-foreground">
                          Last synced: {new Date(yahooLastUpdated).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={discoverYahooLeagues}
                          disabled={isDiscoveringYahoo}
                        >
                          {isDiscoveringYahoo ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Discovering...
                            </>
                          ) : (
                            'Refresh Leagues'
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={disconnectYahoo}
                          disabled={isYahooDisconnecting}
                          className="text-destructive hover:text-destructive"
                        >
                          {isYahooDisconnecting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            'Disconnect'
                          )}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 border rounded-lg bg-muted/40 space-y-2">
                      <p className="text-sm text-muted-foreground">
                        Sign in with Yahoo to connect your fantasy leagues. Uses OAuth — no passwords stored.
                      </p>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => { window.location.href = '/api/connect/yahoo/authorize'; }}
                      >
                        Connect Yahoo
                      </Button>
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LeaguesPage() {
  return (
    <Suspense fallback={<div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></div>}>
      <LeaguesPageContent />
    </Suspense>
  );
}
