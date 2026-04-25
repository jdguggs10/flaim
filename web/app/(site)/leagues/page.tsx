"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth, SignInButton, SignUpButton } from '@clerk/nextjs';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
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
  Wrench,
  Eye,
  EyeOff,
  Briefcase,
  Chrome,
  Info,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useEspnCredentials } from '@/lib/use-espn-credentials';
import { getDefaultSeasonYear, getPreviousSeasonYear, getSeasonYearOptions } from '@/lib/season-utils';
import { CHROME_EXTENSION_URL } from '@/config/constants';
import { StepConnectAI } from '@/components/site/StepConnectAI';

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

interface SleeperLeague {
  id: string;        // DB UUID for deletion
  sport: string;
  seasonYear: number;
  leagueId: string;  // Sleeper's numeric string league ID
  leagueName: string;
  rosterId: number | null;
  recurringLeagueId?: string;
}

interface LeagueDefault {
  platform: 'espn' | 'yahoo' | 'sleeper';
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

// Unified league for display - combines ESPN, Yahoo, and Sleeper into common format
interface UnifiedLeague {
  platform: 'espn' | 'yahoo' | 'sleeper';
  // Common fields
  sport: string;
  seasonYear?: number;
  leagueName: string;
  teamName?: string;
  isDefault: boolean;
  // Platform-specific identifiers
  leagueId: string;      // ESPN: numeric ID, Yahoo: league_key, Sleeper: numeric string league ID
  teamId?: string;
  // Yahoo-specific
  yahooId?: string;      // UUID for Yahoo league (for API calls)
  // Sleeper-specific
  sleeperId?: string;    // DB UUID for deletion (Sleeper only)
  recurringLeagueId?: string;
}

interface UnifiedLeagueGroup {
  key: string;           // e.g., "espn:football:12345" or "yahoo:football:nfl.l.54321"
  platform: 'espn' | 'yahoo' | 'sleeper';
  sport: string;
  leagueId: string;
  leagueName: string;
  teamId?: string;
  seasons: UnifiedLeague[];
}

const SPORT_OPTIONS: { value: Sport; label: string; emoji: string }[] = [
  { value: 'football', label: 'Football', emoji: '\u{1F3C8}' },
  { value: 'baseball', label: 'Baseball', emoji: '\u26BE' },
  { value: 'basketball', label: 'Basketball', emoji: '\u{1F3C0}' },
  { value: 'hockey', label: 'Hockey', emoji: '\u{1F3D2}' },
];

// Generate season options (current season year down to 2000)
const MIN_YEAR = 2000;
const EMPTY_ESPN_LEAGUES: League[] = [];
const EMPTY_YAHOO_LEAGUES: YahooLeague[] = [];
const EMPTY_SLEEPER_LEAGUES: SleeperLeague[] = [];
const EMPTY_USER_PREFERENCES: UserPreferencesState = {
  defaultSport: null,
  defaultFootball: null,
  defaultBaseball: null,
  defaultBasketball: null,
  defaultHockey: null,
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function createEmptyPreferences(): UserPreferencesState {
  return { ...EMPTY_USER_PREFERENCES };
}

function getYahooConnectErrorMessage(error: string, description: string | null): string {
  switch (error) {
    case 'token_refresh_validation_failed':
      return 'Yahoo connection did not complete because the refresh token could not be validated. Please connect Yahoo again.';
    case 'token_refresh_validation_unavailable':
      return 'Yahoo connection could not be validated because Yahoo was temporarily unavailable. Please try again in a few minutes.';
    case 'token_exchange_failed':
      return description || 'Yahoo connection failed while exchanging the authorization code. Please try again.';
    case 'oauth_denied':
      return 'Yahoo connection was canceled.';
    default:
      return description || 'Yahoo connection failed. Please try again.';
  }
}

interface YahooDiscoverErrorResponse {
  error?: string;
  error_description?: string;
}

interface EspnDiscoveryCounts {
  found?: number;
  added?: number;
  alreadySaved?: number;
}

interface EspnDiscoveryResponse {
  error?: string;
  error_description?: string;
  currentSeason?: EspnDiscoveryCounts;
  pastSeasons?: EspnDiscoveryCounts;
}

const ESPN_ERROR_CREDENTIALS_NOT_FOUND = 'credentials_not_found';
const ESPN_ERROR_AUTH_FAILED = 'espn_auth_failed';

function parseYahooDiscoverErrorResponse(data: unknown): YahooDiscoverErrorResponse {
  if (!data || typeof data !== 'object') {
    return {};
  }

  const record = data as Record<string, unknown>;
  return {
    error: typeof record.error === 'string' ? record.error : undefined,
    error_description: typeof record.error_description === 'string' ? record.error_description : undefined,
  };
}

function getEspnDiscoverErrorMessage(status: number, data: EspnDiscoveryResponse): string {
  if (data.error === ESPN_ERROR_CREDENTIALS_NOT_FOUND) {
    return 'Add ESPN credentials with the Chrome extension or manual entry, then refresh again.';
  }

  if (status === 401 || status === 403 || data.error === ESPN_ERROR_AUTH_FAILED) {
    return 'ESPN credentials look expired or invalid. Update them, then refresh again.';
  }

  return data.error_description || data.error || 'Failed to refresh ESPN leagues';
}

function formatEspnRefreshNotice(data: EspnDiscoveryResponse): string {
  const currentAdded = data.currentSeason?.added ?? 0;
  const historicalAdded = data.pastSeasons?.added ?? 0;
  const currentFound = data.currentSeason?.found ?? 0;
  const historicalFound = data.pastSeasons?.found ?? 0;
  const added = currentAdded + historicalAdded;
  const found = currentFound + historicalFound;

  if (added > 0) {
    return `ESPN refresh complete. Added ${added} new league season${added === 1 ? '' : 's'}.`;
  }

  if (found > 0) {
    return `ESPN refresh complete. All ${found} league season${found === 1 ? '' : 's'} already up to date.`;
  }

  return 'ESPN refresh complete. No ESPN leagues found for these credentials.';
}

function formatLastUpdated(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function ConnectionBadge({ isChecking, isConnected }: { isChecking: boolean; isConnected: boolean }) {
  if (isChecking) {
    return (
      <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Checking...
      </span>
    );
  }

  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full ${
        isConnected
          ? 'bg-success/20 text-success'
          : 'bg-muted text-muted-foreground'
      }`}
    >
      {isConnected ? 'Connected' : 'Not connected'}
    </span>
  );
}

function canApplyState(shouldApply?: () => boolean): boolean {
  return shouldApply ? shouldApply() : true;
}

type ConnectionStatusResult = 'connected' | 'disconnected' | 'unknown';

function isDefinitiveDisconnectedStatus(status: number, data: { error?: string }): boolean {
  return status === 401 || status === 403 || data.error === 'not_connected';
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
      seasonYear: l.seasonYear,
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

// Convert Sleeper leagues to unified format (isDefault computed from preferences)
function sleeperToUnified(
  sleepers: SleeperLeague[],
  preferences: UserPreferencesState
): UnifiedLeague[] {
  return sleepers.map((sl) => {
    const sportKey = `default${capitalize(sl.sport)}` as keyof UserPreferencesState;
    const sportDefault = preferences[sportKey] as LeagueDefault | null;
    const isDefault =
      sportDefault?.platform === 'sleeper' &&
      sportDefault?.leagueId === sl.leagueId &&
      sportDefault?.seasonYear === sl.seasonYear;

    return {
      platform: 'sleeper' as const,
      sport: sl.sport,
      seasonYear: sl.seasonYear,
      leagueId: sl.leagueId,
      leagueName: sl.leagueName,
      teamId: sl.rosterId != null ? String(sl.rosterId) : undefined,
      isDefault,
      sleeperId: sl.id,
      recurringLeagueId: sl.recurringLeagueId,
    };
  });
}

function LeaguesPageContent() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const {
    hasCredentials,
    lastUpdated: espnLastUpdated,
    isCheckingCreds,
    isLoadingCreds,
    swid,
    espnS2,
    showCredentials,
    credsSaving,
    credsError,
    credsSuccess,
    setSwid,
    setEspnS2,
    setShowCredentials,
    handleEditCredentials,
    handleSaveCredentials,
    handleCancelEdit,
  } = useEspnCredentials();
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
  const [isPlatformsSectionOpen, setIsPlatformsSectionOpen] = useState(true);
  const [isLeaguesSectionOpen, setIsLeaguesSectionOpen] = useState(true);
  const [isAiSectionOpen, setIsAiSectionOpen] = useState(true);
  const [isEspnSetupOpen, setIsEspnSetupOpen] = useState(false);
  const [isYahooSetupOpen, setIsYahooSetupOpen] = useState(false);
  const [isYahooConnected, setIsYahooConnected] = useState(false);
  const [yahooLastUpdated, setYahooLastUpdated] = useState<string | null>(null);
  const [isCheckingYahoo, setIsCheckingYahoo] = useState(true);
  const [isYahooDisconnecting, setIsYahooDisconnecting] = useState(false);
  const [yahooLeagues, setYahooLeagues] = useState<YahooLeague[]>([]);
  const [isLoadingYahooLeagues, setIsLoadingYahooLeagues] = useState(true);
  const [isRefreshingEspn, setIsRefreshingEspn] = useState(false);
  const [isDiscoveringYahoo, setIsDiscoveringYahoo] = useState(false);
  const [isRefreshingYahooAuth, setIsRefreshingYahooAuth] = useState(false);
  const [sleeperLeagues, setSleeperLeagues] = useState<SleeperLeague[]>([]);
  const [deletingSleeperKey, setDeletingSleeperKey] = useState<string | null>(null);
  const [isSleeperSetupOpen, setIsSleeperSetupOpen] = useState(false);
  const [isSleeperConnected, setIsSleeperConnected] = useState(false);
  const [sleeperUsername, setSleeperUsername] = useState<string | null>(null);
  const [sleeperLastUpdated, setSleeperLastUpdated] = useState<string | null>(null);
  const [isCheckingSleeper, setIsCheckingSleeper] = useState(true);
  const [isLoadingSleeperLeagues, setIsLoadingSleeperLeagues] = useState(true);
  const [isSleeperDisconnecting, setIsSleeperDisconnecting] = useState(false);
  const [isDiscoveringSleeper, setIsDiscoveringSleeper] = useState(false);
  const [sleeperConnectInput, setSleeperConnectInput] = useState('');
  const [sleeperError, setSleeperError] = useState<string | null>(null);
  const [espnCredsDialogOpen, setEspnCredsDialogOpen] = useState(false);
  const [preferences, setPreferences] = useState<UserPreferencesState>(() => createEmptyPreferences());
  const [accountScopedUserId, setAccountScopedUserId] = useState<string | null>(null);
  const [settingSportDefault, setSettingSportDefault] = useState<string | null>(null);
  const currentUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    currentUserIdRef.current = isSignedIn ? userId ?? null : null;
  }, [isSignedIn, userId]);

  const isAccountStateCurrent = Boolean(isSignedIn && userId && accountScopedUserId === userId);
  const displayLeagues = isAccountStateCurrent ? leagues : EMPTY_ESPN_LEAGUES;
  const displayYahooLeagues = isAccountStateCurrent ? yahooLeagues : EMPTY_YAHOO_LEAGUES;
  const displaySleeperLeagues = isAccountStateCurrent ? sleeperLeagues : EMPTY_SLEEPER_LEAGUES;
  const displayPreferences = isAccountStateCurrent ? preferences : EMPTY_USER_PREFERENCES;
  const defaultSport = displayPreferences.defaultSport;
  const [showOldLeagues, setShowOldLeagues] = useState(false);

  // Add league flow state
  const [manualDialogOpen, setManualDialogOpen] = useState(false);
  const [discoverDialogOpen, setDiscoverDialogOpen] = useState(false);
  const [newLeagueId, setNewLeagueId] = useState('');
  const [newLeagueSport, setNewLeagueSport] = useState<Sport>('football');
  const [newLeagueSeason, setNewLeagueSeason] = useState<number>(() => getDefaultSeasonYear('football'));
  const [seasonManuallySet, setSeasonManuallySet] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifiedLeague, setVerifiedLeague] = useState<VerifiedLeague | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<string>('');
  const [isAddingLeague, setIsAddingLeague] = useState(false);
  const [discoverLeagueKey, setDiscoverLeagueKey] = useState<string>('');
  const manualSeasonOptions = useMemo(
    () => getSeasonYearOptions(newLeagueSport, MIN_YEAR),
    [newLeagueSport]
  );

  const clearYahooConnectionState = useCallback(() => {
    setIsYahooConnected(false);
    setYahooLastUpdated(null);
  }, []);

  const clearSleeperConnectionState = useCallback(() => {
    setIsSleeperConnected(false);
    setSleeperUsername(null);
    setSleeperLastUpdated(null);
  }, []);

  const createAccountGuard = useCallback(() => {
    const operationUserId = currentUserIdRef.current;
    // Event-driven refresh/disconnect flows create their own guard; effect-driven loaders receive one from their effect cleanup.
    return () => Boolean(operationUserId && currentUserIdRef.current === operationUserId);
  }, []);

  const clearAccountScopedState = useCallback(() => {
    setLeagues([]);
    setYahooLeagues([]);
    setSleeperLeagues([]);
    clearYahooConnectionState();
    clearSleeperConnectionState();
    setPreferences(createEmptyPreferences());
    setSleeperError(null);
    setLeagueError(null);
    setLeagueNotice(null);
    setIsRefreshingEspn(false);
    setIsDiscoveringYahoo(false);
    setIsRefreshingYahooAuth(false);
    setIsYahooDisconnecting(false);
    setIsDiscoveringSleeper(false);
    setIsSleeperDisconnecting(false);
    setDeletingSleeperKey(null);
  }, [clearSleeperConnectionState, clearYahooConnectionState]);

  // Helper to determine if a league is "old" (no seasons in last 2 years)
  const isOldLeague = (sport: Sport, seasons: Array<{ seasonYear?: number }>): boolean => {
    const knownSeasonYears = seasons
      .map((season) => season.seasonYear)
      .filter((seasonYear): seasonYear is number => typeof seasonYear === 'number');
    if (knownSeasonYears.length === 0) {
      return false;
    }

    const thresholdYear = getDefaultSeasonYear(sport) - 1;
    const mostRecentYear = Math.max(...knownSeasonYears);
    return mostRecentYear < thresholdYear;
  };

  // Group all leagues by sport, then by platform+leagueId
  const leaguesBySport = useMemo(() => {
    // Convert all platforms to unified format
    const allLeagues = [
      ...espnToUnified(displayLeagues, displayPreferences),
      ...yahooToUnified(displayYahooLeagues, displayPreferences),
      ...sleeperToUnified(displaySleeperLeagues, displayPreferences),
    ];

    // Group by stable recurring identity where available.
    // Yahoo uses league name in the web UI because leagueKey is season-scoped.
    // Sleeper keeps season-specific leagueId for actions, but can group by recurringLeagueId.
    const grouped = new Map<string, UnifiedLeagueGroup>();

    for (const league of allLeagues) {
      const groupKey = league.platform === 'yahoo'
        ? `${league.platform}:${league.sport}:${league.leagueName}`
        : league.platform === 'sleeper'
          ? `${league.platform}:${league.sport}:${league.recurringLeagueId || league.leagueId}`
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
      group.seasons.sort((a, b) => (b.seasonYear ?? 0) - (a.seasonYear ?? 0));
      // Use most recent season's league name
      group.leagueName = group.seasons[0]?.leagueName || group.leagueName;
      group.teamId = group.seasons.find((s) => s.teamId)?.teamId;
    }

    // Separate active vs old leagues
    const activeLeagues: UnifiedLeagueGroup[] = [];
    const oldLeagueGroups: UnifiedLeagueGroup[] = [];

    for (const group of grouped.values()) {
      if (isOldLeague(group.sport as Sport, group.seasons)) {
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
  }, [displayLeagues, displayYahooLeagues, displaySleeperLeagues, displayPreferences]);

  const discoverableEspnLeagues = useMemo(() => {
    const groups: Array<{
      key: string;
      leagueId: string;
      sport: string;
      leagueName?: string;
      hasTeamSelection: boolean;
    }> = [];

    for (const [, sportLeagues] of leaguesBySport.active) {
      for (const group of sportLeagues) {
        if (group.platform !== 'espn') continue;
        if (group.sport !== 'baseball' && group.sport !== 'football') continue;
        const hasTeamSelection = group.seasons.some((season) => !!season.teamId);
        groups.push({
          key: `${group.leagueId}-${group.sport}`,
          leagueId: group.leagueId,
          sport: group.sport,
          leagueName: group.leagueName,
          hasTeamSelection,
        });
      }
    }

    return groups;
  }, [leaguesBySport]);

  useEffect(() => {
    if (discoverableEspnLeagues.length === 0) {
      if (discoverLeagueKey) setDiscoverLeagueKey('');
      return;
    }

    if (!discoverableEspnLeagues.some((league) => league.key === discoverLeagueKey)) {
      setDiscoverLeagueKey(discoverableEspnLeagues[0].key);
    }
  }, [discoverLeagueKey, discoverableEspnLeagues]);

  useEffect(() => {
    if (credsSuccess && espnCredsDialogOpen) {
      setEspnCredsDialogOpen(false);
    }
  }, [credsSuccess, espnCredsDialogOpen]);

  const loadLeagues = useCallback(async (options?: { showSpinner?: boolean; shouldApply?: () => boolean }) => {
    const showSpinner = options?.showSpinner ?? true;
    const shouldApply = options?.shouldApply;
    if (showSpinner && canApplyState(shouldApply)) setIsLoadingLeagues(true);

    try {
      const leaguesRes = await fetch('/api/espn/leagues');
      if (leaguesRes.ok) {
        const data = await leaguesRes.json() as { leagues?: League[] };
        if (!canApplyState(shouldApply)) return;
        setLeagues(data.leagues || []);
      }
    } catch (err) {
      console.error('Failed to load leagues:', err);
    } finally {
      if (showSpinner && canApplyState(shouldApply)) setIsLoadingLeagues(false);
    }
  }, []);

  const refreshEspnLeagues = useCallback(async (): Promise<void> => {
    const shouldApply = createAccountGuard();
    if (!shouldApply()) return;

    if (!hasCredentials) {
      setIsEspnSetupOpen(true);
      setLeagueNotice(null);
      return;
    }

    setIsRefreshingEspn(true);
    setLeagueError(null);
    setLeagueNotice(null);
    try {
      const res = await fetch('/api/espn/refresh', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
        },
      });
      const data = await res.json().catch(() => ({})) as EspnDiscoveryResponse;
      if (!shouldApply()) return;

      if (!res.ok) {
        if (
          res.status === 401 ||
          res.status === 403 ||
          data.error === ESPN_ERROR_CREDENTIALS_NOT_FOUND ||
          data.error === ESPN_ERROR_AUTH_FAILED
        ) {
          setIsEspnSetupOpen(true);
        }
        throw new Error(getEspnDiscoverErrorMessage(res.status, data));
      }

      await loadLeagues({ showSpinner: false, shouldApply });
      if (!shouldApply()) return;
      setLeagueNotice(formatEspnRefreshNotice(data));
    } catch (err) {
      if (shouldApply()) {
        console.error('Failed to refresh ESPN leagues:', err);
        setLeagueError(err instanceof Error ? err.message : 'Failed to refresh ESPN leagues');
      }
    } finally {
      if (shouldApply()) {
        setIsRefreshingEspn(false);
      }
    }
  }, [createAccountGuard, hasCredentials, loadLeagues]);

  const checkYahooStatus = useCallback(async (shouldApply?: () => boolean): Promise<ConnectionStatusResult> => {
    try {
      const res = await fetch('/api/connect/yahoo/status');
      const data = await res.json().catch(() => ({})) as { connected?: boolean; lastUpdated?: string; error?: string };
      if (res.ok) {
        if (!canApplyState(shouldApply)) return 'unknown';
        const connected = data.connected ?? false;
        setIsYahooConnected(connected);
        setYahooLastUpdated(connected ? data.lastUpdated || null : null);
        if (!connected) {
          setYahooLeagues([]);
          setIsLoadingYahooLeagues(false);
        }
        return connected ? 'connected' : 'disconnected';
      }

      if (isDefinitiveDisconnectedStatus(res.status, data)) {
        if (canApplyState(shouldApply)) {
          clearYahooConnectionState();
          setYahooLeagues([]);
          setIsLoadingYahooLeagues(false);
        }
        return 'disconnected';
      }

      console.error('Failed to check Yahoo status:', data.error || `HTTP ${res.status}`);
      if (canApplyState(shouldApply)) setIsLoadingYahooLeagues(false);
      return 'unknown';
    } catch (err) {
      console.error('Failed to check Yahoo status:', err);
      if (canApplyState(shouldApply)) setIsLoadingYahooLeagues(false);
      return 'unknown';
    } finally {
      if (canApplyState(shouldApply)) setIsCheckingYahoo(false);
    }
  }, [clearYahooConnectionState]);

  const checkSleeperStatus = useCallback(async (shouldApply?: () => boolean): Promise<ConnectionStatusResult> => {
    try {
      const res = await fetch('/api/connect/sleeper/status');
      const data = await res.json().catch(() => ({})) as { connected?: boolean; sleeperUsername?: string; lastUpdated?: string; error?: string };
      if (res.ok) {
        if (!canApplyState(shouldApply)) return 'unknown';
        const connected = data.connected ?? false;
        setIsSleeperConnected(connected);
        setSleeperUsername(data.sleeperUsername || null);
        setSleeperLastUpdated(connected ? data.lastUpdated || null : null);
        if (!connected) {
          setSleeperLeagues([]);
          setIsLoadingSleeperLeagues(false);
        }
        return connected ? 'connected' : 'disconnected';
      }

      if (isDefinitiveDisconnectedStatus(res.status, data)) {
        if (canApplyState(shouldApply)) {
          clearSleeperConnectionState();
          setSleeperLeagues([]);
          setIsLoadingSleeperLeagues(false);
        }
        return 'disconnected';
      }

      console.error('Failed to check Sleeper status:', data.error || `HTTP ${res.status}`);
      if (canApplyState(shouldApply)) setIsLoadingSleeperLeagues(false);
      return 'unknown';
    } catch (err) {
      console.error('Failed to check Sleeper status:', err);
      if (canApplyState(shouldApply)) setIsLoadingSleeperLeagues(false);
      return 'unknown';
    } finally {
      if (canApplyState(shouldApply)) setIsCheckingSleeper(false);
    }
  }, [clearSleeperConnectionState]);

  const loadYahooLeagues = useCallback(async (shouldApply?: () => boolean) => {
    if (canApplyState(shouldApply)) setIsLoadingYahooLeagues(true);
    try {
      const res = await fetch('/api/connect/yahoo/leagues');
      if (res.ok) {
        const data = await res.json() as { leagues?: YahooLeague[] };
        if (!canApplyState(shouldApply)) return;
        setYahooLeagues(data.leagues || []);
      } else {
        console.error(`Failed to load Yahoo leagues: HTTP ${res.status}`);
      }
    } catch (err) {
      console.error('Failed to load Yahoo leagues:', err);
    } finally {
      if (canApplyState(shouldApply)) setIsLoadingYahooLeagues(false);
    }
  }, []);

  const loadSleeperLeagues = useCallback(async (shouldApply?: () => boolean) => {
    if (canApplyState(shouldApply)) setIsLoadingSleeperLeagues(true);
    try {
      const res = await fetch('/api/connect/sleeper/leagues');
      if (res.ok) {
        const data = await res.json() as { leagues?: SleeperLeague[] };
        if (!canApplyState(shouldApply)) return;
        setSleeperLeagues(data.leagues || []);
      } else {
        console.error(`Failed to load Sleeper leagues: HTTP ${res.status}`);
      }
    } catch (err) {
      console.error('Failed to load Sleeper leagues:', err);
    } finally {
      if (canApplyState(shouldApply)) setIsLoadingSleeperLeagues(false);
    }
  }, []);

  const discoverSleeperLeagues = useCallback(async (username: string) => {
    const shouldApply = createAccountGuard();
    if (!shouldApply()) return;

    setIsDiscoveringSleeper(true);
    setSleeperError(null);
    try {
      const res = await fetch('/api/connect/sleeper/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username }),
      });
      if (!shouldApply()) return;
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        if (!shouldApply()) return;
        throw new Error(data.error || 'Failed to discover Sleeper leagues');
      }
      const data = await res.json() as { success?: boolean; warning?: string };
      if (!shouldApply()) return;
      if (data.success === false) {
        throw new Error(data.warning || 'Failed to refresh Sleeper leagues');
      }
      setIsSleeperConnected(true);
      setSleeperUsername(username);
      setSleeperConnectInput('');
      const status = await checkSleeperStatus(shouldApply);
      if (!shouldApply()) return;
      if (status !== 'disconnected') {
        await loadSleeperLeagues(shouldApply);
      } else {
        setIsLoadingSleeperLeagues(false);
      }
    } catch (err) {
      if (shouldApply()) {
        setSleeperError(err instanceof Error ? err.message : 'Failed to connect Sleeper');
      }
    } finally {
      if (shouldApply()) {
        setIsDiscoveringSleeper(false);
      }
    }
  }, [checkSleeperStatus, createAccountGuard, loadSleeperLeagues]);

  const disconnectSleeper = useCallback(async () => {
    const shouldApply = createAccountGuard();
    if (!shouldApply()) return;

    setIsSleeperDisconnecting(true);
    try {
      const res = await fetch('/api/connect/sleeper/disconnect', { method: 'DELETE' });
      if (shouldApply() && res.ok) {
        setIsSleeperConnected(false);
        setSleeperUsername(null);
        setSleeperLastUpdated(null);
        setSleeperLeagues([]);
      }
    } catch (err) {
      if (shouldApply()) {
        console.error('Failed to disconnect Sleeper:', err);
        setLeagueError('Failed to disconnect Sleeper. Please try again.');
      }
    } finally {
      if (shouldApply()) {
        setIsSleeperDisconnecting(false);
      }
    }
  }, [createAccountGuard]);

  const discoverYahooLeagues = useCallback(async (): Promise<void> => {
    const shouldApply = createAccountGuard();
    if (!shouldApply()) return;

    setIsDiscoveringYahoo(true);
    setLeagueError(null);
    setLeagueNotice(null);
    let didLoadYahooLeagues = false;
    let shouldCheckYahooStatus = true;
    try {
      const res = await fetch('/api/connect/yahoo/discover', { method: 'POST' });
      if (!shouldApply()) return;
      if (!res.ok) {
        // Auth-worker error bodies carry reconnect codes even when the response is not ok.
        const data = parseYahooDiscoverErrorResponse(await res.json().catch(() => null));
        if (!shouldApply()) return;
        if (
          res.status === 401 ||
          res.status === 403 ||
          data.error === 'not_connected' ||
          data.error === 'refresh_failed'
        ) {
          // The opened panel and notice are the reconnect prompt, so skip the error banner.
          setIsYahooSetupOpen(true);
          clearYahooConnectionState();
          setLeagueNotice('Your Yahoo session has expired. Click Refresh to sign in again and pull your latest leagues.');
          shouldCheckYahooStatus = false;
          return;
        }
        throw new Error(data.error_description || data.error || 'Failed to refresh Yahoo leagues');
      }
      didLoadYahooLeagues = true;
      await loadYahooLeagues(shouldApply);
    } catch (err) {
      if (shouldApply()) {
        console.error('Failed to discover Yahoo leagues:', err);
        setLeagueError(err instanceof Error ? err.message : 'Failed to refresh Yahoo leagues');
      }
    } finally {
      if (shouldApply()) {
        setIsDiscoveringYahoo(false);
        if (!didLoadYahooLeagues) {
          setIsLoadingYahooLeagues(false);
        }
        if (shouldCheckYahooStatus) {
          void checkYahooStatus(shouldApply).catch((err: unknown) => {
            console.error('Failed to refresh Yahoo status:', err);
          });
        }
      }
    }
  }, [checkYahooStatus, clearYahooConnectionState, createAccountGuard, loadYahooLeagues]);

  const refreshYahooAuth = () => {
    setLeagueError(null);
    setLeagueNotice(null);
    setIsRefreshingYahooAuth(true);
    window.location.href = '/api/connect/yahoo/authorize';
  };

  useEffect(() => {
    if (!isRefreshingYahooAuth) {
      return;
    }

    const resetRefreshState = () => setIsRefreshingYahooAuth(false);
    const resetTimer = window.setTimeout(resetRefreshState, 15_000);
    const handlePageHide = () => {
      window.clearTimeout(resetTimer);
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        resetRefreshState();
      }
    };

    window.addEventListener('pagehide', handlePageHide, { once: true });
    window.addEventListener('pageshow', handlePageShow, { once: true });

    return () => {
      window.clearTimeout(resetTimer);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [isRefreshingYahooAuth]);

  const disconnectYahoo = useCallback(async () => {
    const shouldApply = createAccountGuard();
    if (!shouldApply()) return;

    setIsYahooDisconnecting(true);
    try {
      const res = await fetch('/api/connect/yahoo/disconnect', { method: 'DELETE' });
      if (shouldApply() && res.ok) {
        setIsYahooConnected(false);
        setYahooLastUpdated(null);
        setYahooLeagues([]);
      }
    } catch (err) {
      if (shouldApply()) {
        console.error('Failed to disconnect Yahoo:', err);
        setLeagueError('Failed to disconnect Yahoo. Please try again.');
      }
    } finally {
      if (shouldApply()) {
        setIsYahooDisconnecting(false);
      }
    }
  }, [createAccountGuard]);

  useEffect(() => {
    if (!isLoaded) {
      return;
    }

    if (!isSignedIn || !userId) {
      clearAccountScopedState();
      setAccountScopedUserId(null);
      setIsLoadingLeagues(false);
      setIsLoadingYahooLeagues(false);
      setIsLoadingSleeperLeagues(false);
      setIsCheckingYahoo(false);
      setIsCheckingSleeper(false);
      return;
    }

    let isActive = true;
    clearAccountScopedState();
    setIsLoadingYahooLeagues(true);
    setIsLoadingSleeperLeagues(true);
    setIsCheckingYahoo(true);
    setIsCheckingSleeper(true);
    // The display gate must move to the new user before any async loaders can resolve.
    setAccountScopedUserId(userId);
    void loadLeagues({ showSpinner: true, shouldApply: () => isActive });
    return () => {
      isActive = false;
    };
  }, [clearAccountScopedState, isLoaded, isSignedIn, loadLeagues, userId]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId) return;

    let isActive = true;
    const shouldApply = () => isActive;

    setIsCheckingYahoo(true);
    setIsCheckingSleeper(true);
    setIsLoadingYahooLeagues(true);
    setIsLoadingSleeperLeagues(true);

    // Fetch user preferences
    const loadPreferences = async () => {
      try {
        const res = await fetch('/api/user/preferences');
        if (res.ok) {
          const data = await res.json() as UserPreferencesState;
          if (!shouldApply()) return;
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

    const yahooError = searchParams.get('error');
    if (yahooError) {
      setLeagueError(getYahooConnectErrorMessage(yahooError, searchParams.get('error_description')));
      setIsYahooSetupOpen(true);
      router.replace('/leagues', { scroll: false });
    }

    const yahooParam = searchParams.get('yahoo');
    if (yahooParam === 'connected') {
      // Just came from OAuth — trust the param, skip status check
      setIsYahooConnected(true);
      setIsCheckingYahoo(false);
      void discoverYahooLeagues();
      router.replace('/leagues', { scroll: false });
    } else {
      // Normal page load — check status from backend
      void (async () => {
        const status = await checkYahooStatus(shouldApply);
        if (!shouldApply()) return;
        if (status !== 'disconnected') {
          await loadYahooLeagues(shouldApply);
        } else {
          setIsLoadingYahooLeagues(false);
        }
      })();
    }

    // Load Sleeper leagues and check connection
    void (async () => {
      const status = await checkSleeperStatus(shouldApply);
      if (!shouldApply()) return;
      if (status !== 'disconnected') {
        await loadSleeperLeagues(shouldApply);
      } else {
        setIsLoadingSleeperLeagues(false);
      }
    })();
    return () => {
      isActive = false;
    };
  }, [
    checkSleeperStatus,
    checkYahooStatus,
    discoverYahooLeagues,
    isLoaded,
    isSignedIn,
    loadSleeperLeagues,
    loadYahooLeagues,
    router,
    searchParams,
    userId,
  ]);

  // Verify league (call auto-pull to get league info)
  const handleVerifyLeague = async () => {
    if (!hasCredentials) {
      setLeagueError('Add your ESPN credentials on the setup page first');
      return;
    }

    if (!newLeagueId.trim()) {
      setLeagueError('League ID is required');
      return;
    }

    // Check for duplicates (including season year for multi-season support)
    const exists = leagues.some(
      (l) =>
        l.leagueId === newLeagueId.trim() &&
        l.sport === newLeagueSport &&
        l.seasonYear === newLeagueSeason
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

  // Set default league (unified for ESPN, Yahoo, and Sleeper)
  const handleSetDefault = async (
    platform: 'espn' | 'yahoo' | 'sleeper',
    leagueId: string,
    sport: string,
    seasonYear: number,
    yahooId?: string
  ) => {
    const leagueKey = platform === 'yahoo'
      ? `yahoo:${yahooId}`
      : platform === 'sleeper'
      ? `sleeper:${leagueId}-${sport}-${seasonYear}`
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

  // Delete all seasons of a Sleeper league group
  const handleDeleteSleeperLeagueGroup = async (seasons: UnifiedLeague[], leagueId: string) => {
    const sleeperIds = seasons.map(s => s.sleeperId).filter((id): id is string => !!id);
    if (sleeperIds.length === 0) return;

    setDeletingSleeperKey(`sleeper:${leagueId}`);
    setLeagueNotice(null);

    try {
      for (const sleeperId of sleeperIds) {
        const res = await fetch(`/api/connect/sleeper/leagues/${sleeperId}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json() as { error?: string };
          throw new Error(data.error || 'Failed to delete league');
        }
      }
      await loadSleeperLeagues();
    } catch (err) {
      setLeagueError(err instanceof Error ? err.message : 'Failed to delete league');
    } finally {
      setDeletingSleeperKey(null);
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

  const getSportLabel = (sport: string) => {
    const option = SPORT_OPTIONS.find((s) => s.value === sport);
    return option?.label || sport;
  };

  const selectedDiscoverLeague = discoverableEspnLeagues.find(
    (league) => league.key === discoverLeagueKey
  );
  const isDiscoveringSelected = selectedDiscoverLeague
    ? discoveringLeagueKey === selectedDiscoverLeague.key
    : false;
  const hasAnyLeagueGroups = leaguesBySport.active.length > 0 || leaguesBySport.old.length > 0;
  const displayLeagueError = isAccountStateCurrent ? leagueError : null;
  const displayLeagueNotice = isAccountStateCurrent ? leagueNotice : null;
  const displayEspnConnected = isAccountStateCurrent && hasCredentials;
  const displayEspnLastUpdated = isAccountStateCurrent ? espnLastUpdated : null;
  const isEspnStatusChecking = !isAccountStateCurrent || isCheckingCreds;
  const displayYahooConnected = isAccountStateCurrent && isYahooConnected;
  const displayYahooLastUpdated = isAccountStateCurrent ? yahooLastUpdated : null;
  const isYahooStatusChecking = !isAccountStateCurrent || isCheckingYahoo;
  const displaySleeperConnected = isAccountStateCurrent && isSleeperConnected;
  const displaySleeperUsername = isAccountStateCurrent ? sleeperUsername : null;
  const displaySleeperLastUpdated = isAccountStateCurrent ? sleeperLastUpdated : null;
  const displaySleeperError = isAccountStateCurrent ? sleeperError : null;
  const isSleeperStatusChecking = !isAccountStateCurrent || isCheckingSleeper;
  const isLeagueStateLoading =
    !isAccountStateCurrent ||
    isLoadingLeagues ||
    isLoadingYahooLeagues ||
    isLoadingSleeperLeagues ||
    isCheckingYahoo ||
    isCheckingSleeper;

  // Loading state
  if (!isLoaded) {
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
        <div className="w-full max-w-xl space-y-6">
          <div className="space-y-3 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">
              1
            </div>
            <h1 className="text-3xl font-semibold">Set up Your Leagues</h1>
            <p className="text-muted-foreground">
              Sign in to connect ESPN, Yahoo, and Sleeper, copy your Flaim connector details, and manage your defaults in one place.
            </p>
          </div>
          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="space-y-2">
                <h2 className="font-medium">What happens here</h2>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>Connect your fantasy platforms and refresh league data</li>
                  <li>Copy the Flaim MCP name and URL for Claude, ChatGPT, or Perplexity</li>
                  <li>Choose defaults and manage seasons once your account is linked</li>
                </ul>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <SignUpButton mode="modal" forceRedirectUrl="/leagues">
                  <Button className="w-full sm:flex-1">Create Account</Button>
                </SignUpButton>
                <SignInButton mode="modal" forceRedirectUrl="/leagues">
                  <Button variant="outline" className="w-full sm:flex-1">Sign In</Button>
                </SignInButton>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Trophy className="h-6 w-6" />
            <h1 className="text-2xl font-semibold">Your Leagues</h1>
          </div>
          <p className="text-muted-foreground">
            Connect platforms, manage league seasons, copy your AI setup details, and set your defaults here.
          </p>
        </div>

        {/* Global alerts */}
        {displayLeagueError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{displayLeagueError}</AlertDescription>
          </Alert>
        )}

        {displayLeagueNotice && (
          <Alert className="bg-info/10 border-info/30 text-info">
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>{displayLeagueNotice}</AlertDescription>
          </Alert>
        )}

        <Card id="connect-ai" className="order-4">
          <CardHeader className="pb-4">
            <button
              type="button"
              onClick={() => setIsAiSectionOpen((prev) => !prev)}
              aria-expanded={isAiSectionOpen}
              aria-controls="ai-card-content"
              className="flex w-full items-start justify-between gap-4 text-left"
            >
              <div className="min-w-0 space-y-2">
                <CardTitle className="text-lg">3. Connect Your AI</CardTitle>
                <CardDescription>
                  Copy the MCP details you need for Claude, ChatGPT, or Perplexity.
                </CardDescription>
              </div>
              <ChevronDown
                className={`mt-0.5 h-5 w-5 shrink-0 text-muted-foreground transition-transform ${
                  isAiSectionOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
            <div className="pt-2">
              <Link href="/guide" className="text-sm text-primary hover:underline">
                See all setup guides
              </Link>
            </div>
          </CardHeader>
          {isAiSectionOpen ? (
            <CardContent id="ai-card-content" className="pt-0">
              <StepConnectAI
                showStepNumber={false}
                renderCard={false}
                showHeader={false}
              />
            </CardContent>
          ) : null}
        </Card>

        <section className="order-5 space-y-3 rounded-xl border border-dashed border-border bg-muted/30 p-4">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold">Tips for activating Flaim in your AI assistant</h2>
            <p className="text-sm text-muted-foreground">
              After you add and authenticate Flaim, most assistants still need one more click before they use it.
            </p>
          </div>
          <ol className="space-y-2 text-sm text-muted-foreground">
            <li>Start a fresh chat after the connection is approved.</li>
            <li>Open the assistant menu where apps, connectors, tools, or integrations live, then select Flaim if it is not already active.</li>
            <li>Ask a concrete league question like “Show me my roster” or “Who am I playing this week?” instead of a vague prompt.</li>
            <li>If the assistant still ignores Flaim, say “Use Flaim” and mention your league, team, or sport.</li>
            <li>Set a default sport or league above so Flaim can pick the right context faster.</li>
          </ol>
        </section>

        {/* Your Leagues Card */}
        <Card className="order-3">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <button
                type="button"
                onClick={() => setIsLeaguesSectionOpen((prev) => !prev)}
                aria-expanded={isLeaguesSectionOpen}
                aria-controls="leagues-card-content"
                className="flex flex-1 items-start gap-4 text-left"
              >
                <div className="min-w-0 space-y-2">
                  <CardTitle className="text-lg">2. Your Leagues</CardTitle>
                  <CardDescription>
                    Once a platform is connected, your linked teams and seasons appear here.
                  </CardDescription>
                </div>
              </button>
              <div className="flex items-center gap-2">
                <TooltipProvider delayDuration={150}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="rounded-md border border-muted bg-muted/60 p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-warning"
                        aria-label="Star defaults info"
                      >
                        <Star className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-xs whitespace-normal">
                      Stars mark your defaults. Set a default sport, and also set a default team per sport.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <button
                  type="button"
                  onClick={() => setIsLeaguesSectionOpen((prev) => !prev)}
                  aria-expanded={isLeaguesSectionOpen}
                  aria-controls="leagues-card-content"
                  className="rounded-md border border-muted bg-muted/60 p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={isLeaguesSectionOpen ? 'Collapse leagues section' : 'Expand leagues section'}
                >
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${
                      isLeaguesSectionOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>
              </div>
            </div>
          </CardHeader>
          {isLeaguesSectionOpen ? (
          <CardContent id="leagues-card-content" className="pt-0">
            {isLeagueStateLoading && !hasAnyLeagueGroups ? (
              <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" />
                <span className="text-sm">Loading your leagues...</span>
              </div>
            ) : !hasAnyLeagueGroups ? (
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
                                    const mostRecentSeasonYear = mostRecentSeason?.seasonYear;
                                    const isLeagueDefault = mostRecentSeason?.isDefault;
                                    const canSetDefault = !!mostRecentSeason?.teamId && typeof mostRecentSeasonYear === 'number';
                                    const leagueKey = group.platform === 'yahoo'
                                      ? `yahoo:${mostRecentSeason?.yahooId}`
                                      : group.platform === 'sleeper'
                                      ? `sleeper:${mostRecentSeason?.leagueId}-${mostRecentSeason?.sport}-${mostRecentSeason?.seasonYear || 'all'}`
                                      : `${mostRecentSeason?.leagueId}-${mostRecentSeason?.sport}-${mostRecentSeason?.seasonYear || 'all'}`;
                                    const isSettingThis = settingDefaultKey === leagueKey;

                                    return (
                                      <button
                                        className={`shrink-0 p-0.5 rounded hover:bg-muted ${
                                          isLeagueDefault
                                            ? 'text-warning'
                                            : 'text-muted-foreground hover:text-warning'
                                        }`}
                                        onClick={() => {
                                          if (!canSetDefault) {
                                            return;
                                          }
                                          handleSetDefault(
                                            group.platform,
                                            mostRecentSeason.leagueId,
                                            mostRecentSeason.sport,
                                            mostRecentSeasonYear,
                                            mostRecentSeason.yahooId
                                          );
                                        }}
                                        disabled={isSettingThis || isLeagueDefault || !canSetDefault}
                                        title={
                                          !mostRecentSeason?.teamId
                                            ? 'No team selected'
                                            : mostRecentSeasonYear === undefined
                                            ? 'Legacy league row is missing a season year'
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
                                    {group.platform === 'espn' ? 'ESPN' : group.platform === 'yahoo' ? 'Yahoo' : 'Sleeper'}
                                    {` • League: ${group.leagueId}`}
                                    {primaryTeamId && ` • Team: ${primaryTeamId}`}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                  onClick={() => {
                                    if (group.platform === 'espn') {
                                      handleDeleteLeague(group.leagueId, group.sport);
                                    } else if (group.platform === 'sleeper') {
                                      handleDeleteSleeperLeagueGroup(group.seasons, group.leagueId);
                                    } else {
                                      // For Yahoo, delete all seasons in the group
                                      handleDeleteYahooLeagueGroup(group.seasons);
                                    }
                                  }}
                                  disabled={group.platform === 'espn'
                                    ? deletingLeagueKey === baseKey
                                    : group.platform === 'sleeper'
                                    ? deletingSleeperKey === `sleeper:${group.leagueId}`
                                    : deletingLeagueKey === `yahoo:${group.seasons[0]?.yahooId}`}
                                  title="Delete all seasons"
                                >
                                  {(group.platform === 'espn'
                                    ? isDeleting
                                    : group.platform === 'sleeper'
                                    ? deletingSleeperKey === `sleeper:${group.leagueId}`
                                    : deletingLeagueKey === `yahoo:${group.seasons[0]?.yahooId}`) ? (
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
                                        {group.platform === 'espn' ? 'ESPN' : group.platform === 'yahoo' ? 'Yahoo' : 'Sleeper'}
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
                                        } else if (group.platform === 'sleeper') {
                                          handleDeleteSleeperLeagueGroup(group.seasons, group.leagueId);
                                        } else {
                                          handleDeleteYahooLeagueGroup(group.seasons);
                                        }
                                      }}
                                      disabled={
                                        isDeleting
                                        || (group.platform === 'sleeper' && deletingSleeperKey === `sleeper:${group.leagueId}`)
                                        || (group.platform === 'yahoo' && deletingLeagueKey === `yahoo:${group.seasons[0]?.yahooId}`)
                                      }
                                      title="Delete league"
                                    >
                                      {(
                                        isDeleting
                                        || (group.platform === 'sleeper' && deletingSleeperKey === `sleeper:${group.leagueId}`)
                                        || (group.platform === 'yahoo' && deletingLeagueKey === `yahoo:${group.seasons[0]?.yahooId}`)
                                      ) ? (
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
          ) : null}
        </Card>

        <Card id="platforms" className="order-2">
          <CardHeader className="pb-4">
            <button
              type="button"
              onClick={() => setIsPlatformsSectionOpen((prev) => !prev)}
              aria-expanded={isPlatformsSectionOpen}
              aria-controls="platforms-card-content"
              className="flex w-full items-start justify-between gap-4 text-left"
            >
              <div className="min-w-0 space-y-2">
                <CardTitle className="text-lg">1. Connect Platforms</CardTitle>
                <CardDescription>
                  Connect, refresh, or manually add leagues from ESPN, Yahoo, and Sleeper here.
                </CardDescription>
              </div>
              <ChevronDown
                className={`mt-0.5 h-5 w-5 shrink-0 text-muted-foreground transition-transform ${
                  isPlatformsSectionOpen ? 'rotate-180' : ''
                }`}
              />
            </button>
          </CardHeader>
          {isPlatformsSectionOpen ? (
          <CardContent id="platforms-card-content" className="pt-0">
          <div className="mb-4 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span>Platform guides:</span>
            <Link href="/guide/espn" className="text-primary hover:underline">
              ESPN
            </Link>
            <Link href="/guide/yahoo" className="text-primary hover:underline">
              Yahoo
            </Link>
            <Link href="/guide/sleeper" className="text-primary hover:underline">
              Sleeper
            </Link>
          </div>
          <div className="grid gap-4">
            <div className="border rounded-lg bg-background">
              <button
                type="button"
                onClick={() => setIsEspnSetupOpen((prev) => !prev)}
                aria-expanded={isEspnSetupOpen}
                aria-controls="espn-setup-content"
                className="w-full flex cursor-pointer items-center justify-between p-4 font-medium text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">ESPN</span>
                  <ConnectionBadge isChecking={isEspnStatusChecking} isConnected={displayEspnConnected} />
                </div>
                <ChevronDown
                  className={`h-5 w-5 text-muted-foreground transition-transform ${
                    isEspnSetupOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {isEspnSetupOpen && (
                <div id="espn-setup-content" className="px-4 pb-4 space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {displayEspnConnected
                      ? 'Refresh uses your stored ESPN credentials to discover leagues and reload the ESPN list.'
                      : 'Add ESPN credentials with the extension or manual entry, then refresh.'}
                  </p>
                  {displayEspnLastUpdated && (
                    <p className="text-xs text-muted-foreground">
                      Credentials updated: {formatLastUpdated(displayEspnLastUpdated)}
                    </p>
                  )}
                  {isEspnStatusChecking ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Checking ESPN connection...
                    </div>
                  ) : !verifiedLeague && (
                    <div className="space-y-3">
                      <div className="flex flex-col gap-2 sm:flex-row">
                        {displayEspnConnected ? (
                          <Button
                            size="sm"
                            onClick={refreshEspnLeagues}
                            disabled={isRefreshingEspn}
                            className="w-full sm:w-auto"
                          >
                            {isRefreshingEspn ? (
                              <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Refreshing...
                              </>
                            ) : (
                              'Refresh'
                            )}
                          </Button>
                        ) : (
                          <Button asChild size="sm" className="w-full sm:w-auto">
                            <a
                              href={CHROME_EXTENSION_URL}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <Chrome className="h-4 w-4 mr-2" />
                              Open Extension
                            </a>
                          </Button>
                        )}
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="w-full sm:w-auto"
                            >
                              Advanced
                              <ChevronDown className="ml-2 h-4 w-4 text-muted-foreground" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-64 p-2">
                            <div className="grid gap-1">
                            <Button asChild variant="ghost" size="sm" className="w-full justify-start">
                              <a
                                href={CHROME_EXTENSION_URL}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                <Chrome className="h-4 w-4 mr-2" />
                                Open Chrome Extension
                              </a>
                            </Button>
                        <Dialog open={discoverDialogOpen} onOpenChange={setDiscoverDialogOpen}>
                          <DialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="w-full justify-start"
                              disabled={discoverableEspnLeagues.length === 0}
                              aria-label="Discover historical seasons"
                              title={
                                discoverableEspnLeagues.length === 0
                                  ? 'Add an ESPN football or baseball league first'
                                  : 'Discover historical seasons'
                              }
                            >
                              <History className="h-4 w-4 mr-2" />
                              Discover Seasons
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Discover historical seasons</DialogTitle>
                              <DialogDescription>
                                Pull past seasons for an ESPN football or baseball league.
                              </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 pt-2">
                              {discoverableEspnLeagues.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                  Add an ESPN football or baseball league with a team selected to use this tool.
                                </p>
                              ) : (
                                <>
                                  <div className="space-y-2">
                                    <Label>League</Label>
                                    <Select value={discoverLeagueKey} onValueChange={setDiscoverLeagueKey}>
                                      <SelectTrigger>
                                        <SelectValue placeholder="Select a league" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {discoverableEspnLeagues.map((league) => (
                                          <SelectItem key={league.key} value={league.key}>
                                            {(league.leagueName || `League ${league.leagueId}`)}
                                            {` • ${getSportLabel(league.sport)}`}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  {!selectedDiscoverLeague?.hasTeamSelection && (
                                    <p className="text-xs text-muted-foreground">
                                      Select a team in this league first.
                                    </p>
                                  )}
                                  <div className="flex gap-2 pt-2">
                                    <Button
                                      onClick={() => {
                                        if (selectedDiscoverLeague) {
                                          handleDiscoverSeasons(
                                            selectedDiscoverLeague.leagueId,
                                            selectedDiscoverLeague.sport
                                          );
                                        }
                                      }}
                                      disabled={
                                        !selectedDiscoverLeague
                                        || !selectedDiscoverLeague.hasTeamSelection
                                        || isDiscoveringSelected
                                        || !!discoveringLeagueKey
                                      }
                                    >
                                      {isDiscoveringSelected ? (
                                        <>
                                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                          Discovering...
                                        </>
                                      ) : (
                                        'Discover Seasons'
                                      )}
                                    </Button>
                                    <Button
                                      variant="outline"
                                      onClick={() => setDiscoverDialogOpen(false)}
                                    >
                                      Cancel
                                    </Button>
                                  </div>
                                </>
                              )}
                            </div>
                          </DialogContent>
                        </Dialog>
                        <Dialog open={manualDialogOpen} onOpenChange={setManualDialogOpen}>
                          <DialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="w-full justify-start"
                              aria-label="Add league manually"
                              title="Add Manually"
                            >
                              <Briefcase className="h-4 w-4 mr-2" />
                              Add League Manually
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
                            <div className="flex gap-2">
                              <Button
                                variant={newLeagueSeason === getDefaultSeasonYear(newLeagueSport) ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => {
                                  setNewLeagueSeason(getDefaultSeasonYear(newLeagueSport));
                                  setSeasonManuallySet(false);
                                }}
                                disabled={isVerifying}
                              >
                                This season
                              </Button>
                              <Button
                                variant={newLeagueSeason === getPreviousSeasonYear(newLeagueSport) ? 'default' : 'outline'}
                                size="sm"
                                onClick={() => {
                                  setNewLeagueSeason(getPreviousSeasonYear(newLeagueSport));
                                  setSeasonManuallySet(true);
                                }}
                                disabled={isVerifying}
                              >
                                Last season
                              </Button>
                            </div>
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
                                    const defaultSeasonYear = getDefaultSeasonYear(sport);
                                    if (!seasonManuallySet) {
                                      setNewLeagueSeason(defaultSeasonYear);
                                      return;
                                    }

                                    const seasonOptions = getSeasonYearOptions(sport, MIN_YEAR);
                                    if (!seasonOptions.includes(newLeagueSeason)) {
                                      setNewLeagueSeason(defaultSeasonYear);
                                      setSeasonManuallySet(false);
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
                                    {manualSeasonOptions.map((year) => (
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
                        <Dialog
                          open={espnCredsDialogOpen}
                          onOpenChange={(open) => {
                            setEspnCredsDialogOpen(open);
                            if (open) {
                              handleCancelEdit();
                              handleEditCredentials();
                            } else {
                              handleCancelEdit();
                            }
                          }}
                        >
                          <DialogTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="w-full justify-start"
                              title="Edit ESPN credentials"
                              aria-label="Edit ESPN credentials"
                            >
                              <Wrench className="h-4 w-4 mr-2" />
                              Edit ESPN Credentials
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>ESPN Credentials</DialogTitle>
                              <DialogDescription>Enter your ESPN authentication cookies.</DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 pt-2">
                              {isLoadingCreds ? (
                                <div className="flex justify-center py-8">
                                  <Loader2 className="h-6 w-6 animate-spin" />
                                </div>
                              ) : (
                                <>
                                  {credsError && (
                                    <div className="p-3 bg-destructive/10 border border-destructive/30 rounded text-sm text-destructive">
                                      {credsError}
                                    </div>
                                  )}
                                  <div className="space-y-2">
                                    <Label htmlFor="swid">SWID</Label>
                                    <Input
                                      id="swid"
                                      type={showCredentials ? 'text' : 'password'}
                                      value={swid}
                                      onChange={(e) => setSwid(e.target.value)}
                                    />
                                  </div>
                                  <div className="space-y-2">
                                    <Label htmlFor="espn_s2">ESPN_S2</Label>
                                    <Input
                                      id="espn_s2"
                                      type={showCredentials ? 'text' : 'password'}
                                      value={espnS2}
                                      onChange={(e) => setEspnS2(e.target.value)}
                                    />
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setShowCredentials(!showCredentials)}
                                    >
                                      {showCredentials ? (
                                        <EyeOff className="h-4 w-4 mr-1" />
                                      ) : (
                                        <Eye className="h-4 w-4 mr-1" />
                                      )}
                                      {showCredentials ? 'Hide' : 'Show'}
                                    </Button>
                                  </div>
                                  <div className="flex gap-2">
                                    <Button onClick={handleSaveCredentials} disabled={credsSaving}>
                                      {credsSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                                      Save
                                    </Button>
                                    <Button variant="outline" onClick={() => setEspnCredsDialogOpen(false)}>
                                      Cancel
                                    </Button>
                                  </div>
                                </>
                              )}
                            </div>
                          </DialogContent>
                        </Dialog>
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>
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
                </div>
              )}
            </div>

            <div className="border rounded-lg bg-background">
              <button
                type="button"
                onClick={() => setIsYahooSetupOpen((prev) => !prev)}
                aria-expanded={isYahooSetupOpen}
                aria-controls="yahoo-setup-content"
                className="w-full flex cursor-pointer items-center justify-between p-4 font-medium text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">Yahoo</span>
                  <ConnectionBadge isChecking={isYahooStatusChecking} isConnected={displayYahooConnected} />
                </div>
                <ChevronDown
                  className={`h-5 w-5 text-muted-foreground transition-transform ${
                    isYahooSetupOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {isYahooSetupOpen && (
                <div id="yahoo-setup-content" className="px-4 pb-4 space-y-3">
                  <p className="text-sm text-muted-foreground">
                    {displayYahooConnected
                      ? 'Refresh signs in with Yahoo again, validates access, then pulls your latest leagues.'
                      : 'Connect your Yahoo account to add leagues.'}
                  </p>
                  {isYahooStatusChecking ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Checking Yahoo connection...
                    </div>
                  ) : displayYahooConnected ? (
                    <div className="space-y-3">
                      {displayYahooLastUpdated && (
                        <p className="text-xs text-muted-foreground">
                          Last updated: {formatLastUpdated(displayYahooLastUpdated)}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={refreshYahooAuth}
                          disabled={isDiscoveringYahoo || isRefreshingYahooAuth}
                        >
                          {isRefreshingYahooAuth ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Opening Yahoo...
                            </>
                          ) : isDiscoveringYahoo ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Refreshing...
                            </>
                          ) : (
                            'Refresh'
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
                        onClick={refreshYahooAuth}
                        disabled={isRefreshingYahooAuth}
                      >
                        {isRefreshingYahooAuth ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Opening Yahoo...
                          </>
                        ) : (
                          'Connect Yahoo'
                        )}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="border rounded-lg bg-background">
              <button
                type="button"
                onClick={() => setIsSleeperSetupOpen((prev) => !prev)}
                aria-expanded={isSleeperSetupOpen}
                aria-controls="sleeper-setup-content"
                className="w-full flex cursor-pointer items-center justify-between p-4 font-medium text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">Sleeper</span>
                  <ConnectionBadge isChecking={isSleeperStatusChecking} isConnected={displaySleeperConnected} />
                </div>
                <ChevronDown
                  className={`h-5 w-5 text-muted-foreground transition-transform ${
                    isSleeperSetupOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {isSleeperSetupOpen && (
                <div id="sleeper-setup-content" className="px-4 pb-4 space-y-3">
                  {displaySleeperError && (
                    <Alert variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{displaySleeperError}</AlertDescription>
                    </Alert>
                  )}
                  {isSleeperStatusChecking ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Checking Sleeper connection...
                    </div>
                  ) : displaySleeperConnected ? (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Connected as <strong>{displaySleeperUsername}</strong>. Refresh to pull latest leagues.
                      </p>
                      {displaySleeperLastUpdated && (
                        <p className="text-xs text-muted-foreground">
                          Last updated: {formatLastUpdated(displaySleeperLastUpdated)}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => displaySleeperUsername && discoverSleeperLeagues(displaySleeperUsername)}
                          disabled={isDiscoveringSleeper || !displaySleeperUsername}
                        >
                          {isDiscoveringSleeper ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Refreshing...
                            </>
                          ) : (
                            'Refresh'
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={disconnectSleeper}
                          disabled={isSleeperDisconnecting}
                          className="text-destructive hover:text-destructive"
                        >
                          {isSleeperDisconnecting ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            'Disconnect'
                          )}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Enter your Sleeper username to discover your leagues. No password needed — Sleeper&apos;s API is public.
                      </p>
                      <div className="flex gap-2">
                        <Input
                          placeholder="Sleeper username"
                          value={sleeperConnectInput}
                          onChange={(e) => setSleeperConnectInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && sleeperConnectInput.trim() && discoverSleeperLeagues(sleeperConnectInput.trim())}
                          disabled={isDiscoveringSleeper}
                          className="flex-1"
                        />
                        <Button
                          size="sm"
                          onClick={() => discoverSleeperLeagues(sleeperConnectInput.trim())}
                          disabled={isDiscoveringSleeper || !sleeperConnectInput.trim()}
                        >
                          {isDiscoveringSleeper ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Connecting...
                            </>
                          ) : (
                            'Connect'
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          </CardContent>
          ) : null}
        </Card>
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
