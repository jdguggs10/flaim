"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth, SignInButton, SignUpButton } from '@clerk/nextjs';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Loader2,
  Trash2,
  AlertCircle,
  ChevronDown,
  Star,
  Chrome,
  BookOpen,
  Info,
  Mail,
  RefreshCw,
  Archive,
  ArchiveRestore,
  EyeOff,
  CheckCircle2,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useEspnCredentials } from '@/lib/use-espn-credentials';
import {
  getYahooBadgeCopy,
  getYahooDisplayState,
  getYahooStatusCopy,
  parseYahooConnectionHealth,
  type YahooConnectionHealth,
} from '@/lib/yahoo-connection-display';
import {
  getYahooConnectErrorMessage,
  isYahooReconnectRequired,
  isYahooTransientAuthError,
  isYahooTransientAuthResponse,
  parseYahooDiscoverErrorResponse,
  parseYahooRetryAfterSeconds,
} from '@/lib/yahoo-auth-errors';
import { CHROME_EXTENSION_URL } from '@/config/constants';
import { StepConnectAI } from '@/components/site/StepConnectAI';
import { getPreviousSeasonYear } from '@/lib/season-utils';
import { getDeviceClass, type DeviceClass } from '@/lib/device';

interface League {
  leagueId: string;
  sport: string;
  leagueName?: string;
  teamId?: string;
  teamName?: string;
  seasonYear?: number;
  archived?: boolean;
  archiveMode?: 'historical' | 'hidden';
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
  recurringLeagueId?: string;
  archived?: boolean;
  archiveMode?: 'historical' | 'hidden';
}

interface SleeperLeague {
  id: string;        // DB UUID for deletion
  sport: string;
  seasonYear: number;
  leagueId: string;  // Sleeper's numeric string league ID
  leagueName: string;
  rosterId: number | null;
  recurringLeagueId?: string;
  archived?: boolean;
  archiveMode?: 'historical' | 'hidden';
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

interface LeagueRefreshProviderResult {
  status?: 'success' | 'skipped' | 'error';
  error?: string;
  error_description?: string;
  retryAfter?: string;
}

interface LeagueRefreshResponse {
  success?: boolean;
  results?: Partial<Record<'espn' | 'yahoo' | 'sleeper', LeagueRefreshProviderResult>>;
  error?: string;
  error_description?: string;
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
  // Archive state (annotated by the public /leagues* endpoints, ESPN + Yahoo + Sleeper).
  // `archiveMode` is only meaningful when `archived` is true: 'historical' (still
  // browsable for past seasons) vs 'hidden' (completely hidden from the AI).
  archived?: boolean;
  archiveMode?: 'historical' | 'hidden';
}

interface UnifiedLeagueGroup {
  key: string;           // e.g., "espn:football:12345" or "yahoo:football:nfl.l.54321"
  platform: 'espn' | 'yahoo' | 'sleeper';
  sport: string;
  leagueId: string;
  leagueName: string;
  teamId?: string;
  seasons: UnifiedLeague[];
  archived: boolean;     // true when this recurring league is suppressed (archived or hidden)
  archiveMode?: 'historical' | 'hidden'; // mode of the suppression when archived is true
}

const SPORT_OPTIONS: { value: Sport; label: string; emoji: string }[] = [
  { value: 'football', label: 'Football', emoji: '\u{1F3C8}' },
  { value: 'baseball', label: 'Baseball', emoji: '\u26BE' },
  { value: 'basketball', label: 'Basketball', emoji: '\u{1F3C0}' },
  { value: 'hockey', label: 'Hockey', emoji: '\u{1F3D2}' },
];

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
const YAHOO_STATUS_RECHECK_FALLBACK_SECONDS = 60;
const YAHOO_STATUS_RECHECK_MAX_SECONDS = 15 * 60;

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function createEmptyPreferences(): UserPreferencesState {
  return { ...EMPTY_USER_PREFERENCES };
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

function summarizeLeagueRefresh(data: LeagueRefreshResponse): string {
  const results = data.results ? Object.values(data.results) : [];
  const successful = results.filter((result) => result?.status === 'success').length;
  const skipped = results.filter((result) => result?.status === 'skipped').length;
  const failed = results.filter((result) => result?.status === 'error').length;
  const retryAfter = results.find((result) => result?.status === 'error' && result.retryAfter)?.retryAfter;
  const firstError = results.find(
    (result) => result?.status === 'error' && (result.error_description || result.error)
  );

  if (successful > 0 && failed === 0) {
    return skipped > 0
      ? 'Synced connected platforms. Some platforms are not connected yet.'
      : 'Synced connected platforms.';
  }

  if (retryAfter) {
    return `Some platforms are temporarily rate limited. Try again in ${retryAfter} seconds.`;
  }

  if (successful > 0) {
    return 'Synced some platforms. Check any platform warnings below.';
  }

  if (skipped > 0 && failed === 0) {
    return 'No connected platforms needed a sync.';
  }

  return firstError?.error_description || firstError?.error || data.error_description || data.error || 'No platforms were synced.';
}

function didEveryRefreshProviderError(data: LeagueRefreshResponse): boolean {
  const results = data.results ? Object.values(data.results) : [];
  return results.length > 0 && results.every((result) => result?.status === 'error');
}

type ConnectionStatusResult = 'connected' | 'disconnected' | 'unknown';

function isSleeperDisconnectedStatus(status: number, data: { error?: string }): boolean {
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
      archived: l.archived ?? false,
      archiveMode: l.archiveMode,
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
      recurringLeagueId: l.recurringLeagueId,
      archived: l.archived ?? false,
      archiveMode: l.archiveMode,
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
      archived: sl.archived ?? false,
      archiveMode: sl.archiveMode,
    };
  });
}

// Resolve the recurring-league archive key for a group: ESPN keys on the stable
// leagueId; Sleeper and Yahoo key on their recurring id (falling back to the season
// league id — for Yahoo that fallback is the season-scoped leagueKey).
function getArchiveRecurringId(group: UnifiedLeagueGroup): string {
  if (group.platform === 'sleeper' || group.platform === 'yahoo') {
    const withRecurring = group.seasons.find((s) => s.recurringLeagueId);
    return withRecurring?.recurringLeagueId || group.leagueId;
  }
  return group.leagueId;
}

// Visibility controls shared by the active and old league sections. Renders two
// icon-buttons for all three platforms (ESPN, Yahoo, Sleeper):
//   - Archive → mode 'historical' (still browsable when asked about past seasons)
//   - Hide    → mode 'hidden' (completely hidden from the AI)
// While either request is in flight both buttons are disabled.
function ArchiveButtons({
  group,
  archivingLeagueKey,
  onArchive,
  onHide,
}: {
  group: UnifiedLeagueGroup;
  archivingLeagueKey: string | null;
  onArchive: (group: UnifiedLeagueGroup) => void;
  onHide: (group: UnifiedLeagueGroup) => void;
}) {
  const isArchiving = archivingLeagueKey === `${group.platform}:${getArchiveRecurringId(group)}`;
  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        onClick={() => onArchive(group)}
        disabled={isArchiving}
        title="Archive (still browsable for past seasons)"
      >
        {isArchiving ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Archive className="h-4 w-4" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        onClick={() => onHide(group)}
        disabled={isArchiving}
        title="Hide (completely hidden from the AI)"
      >
        {isArchiving ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <EyeOff className="h-4 w-4" />
        )}
      </Button>
    </>
  );
}

function WidgetSetupBanner({ accountCreated, isChatGpt }: { accountCreated: boolean; isChatGpt: boolean }) {
  const assistantName = isChatGpt ? 'ChatGPT' : 'your AI assistant';
  const steps = [
    { label: 'Create your Flaim account', done: accountCreated },
    { label: 'Connect a fantasy league below', done: false },
    { label: `Return to ${assistantName} and reconnect Flaim to finish`, done: false },
  ];

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="space-y-3 p-6">
        <div className="space-y-1">
          <h2 className="font-medium">{isChatGpt ? 'Finishing your ChatGPT setup' : 'Finishing your AI setup'}</h2>
          <p className="text-sm text-muted-foreground">
            You&apos;re almost there — three quick steps and Flaim is ready in {assistantName}.
          </p>
        </div>
        <ol className="space-y-2 text-sm">
          {steps.map((step, index) => (
            <li key={step.label} className="flex items-start gap-2">
              {step.done ? (
                <CheckCircle2 aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              ) : (
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground"
                >
                  {index + 1}
                </span>
              )}
              <span className={step.done ? 'text-muted-foreground line-through' : 'text-foreground'}>
                {step.label}
                {step.done && <span className="sr-only"> (completed)</span>}
              </span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function LeaguesPageContent() {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const {
    hasCredentials,
    lastUpdated: espnLastUpdated,
    isCheckingCreds,
  } = useEspnCredentials();
  const searchParams = useSearchParams();
  const router = useRouter();
  const fromParam = searchParams.get('from');
  const fromChatGpt = fromParam === 'chatgpt';
  const fromWidget = fromChatGpt || fromParam === 'widget';
  // Attribution tag from inbound links (e.g. email CTAs append ?ref=email-…).
  // Captured once on mount because later router.replace calls strip params.
  const [inboundRef] = useState(() => searchParams.get('ref'));
  const authRedirectParams = new URLSearchParams();
  if (fromWidget && fromParam) authRedirectParams.set('from', fromParam);
  if (inboundRef) authRedirectParams.set('ref', inboundRef);
  // .toString() rather than .size: size is missing on older Safari/Node 18
  // and would silently strip the params exactly where they matter.
  const authRedirectQuery = authRedirectParams.toString();
  const authRedirectUrl = authRedirectQuery ? `/leagues?${authRedirectQuery}` : '/leagues';

  // Leagues state
  const [leagues, setLeagues] = useState<League[]>([]);
  const [isLoadingLeagues, setIsLoadingLeagues] = useState(true);
  const [leagueError, setLeagueError] = useState<string | null>(null);
  const [leagueNotice, setLeagueNotice] = useState<string | null>(null);
  const [deletingLeagueKey, setDeletingLeagueKey] = useState<string | null>(null);
  const [settingDefaultKey, setSettingDefaultKey] = useState<string | null>(null);
  const [isPlatformsSectionOpen, setIsPlatformsSectionOpen] = useState(true);
  const [isLeaguesSectionOpen, setIsLeaguesSectionOpen] = useState(true);
  const [isAiSectionOpen, setIsAiSectionOpen] = useState(true);
  const [isEspnSetupOpen, setIsEspnSetupOpen] = useState(false);
  const [isYahooSetupOpen, setIsYahooSetupOpen] = useState(false);
  const [isYahooConnected, setIsYahooConnected] = useState(false);
  const [yahooHealth, setYahooHealth] = useState<YahooConnectionHealth | null>(null);
  const [isYahooReconnectNeeded, setIsYahooReconnectNeeded] = useState(false);
  const [yahooLastUpdated, setYahooLastUpdated] = useState<string | null>(null);
  const [isCheckingYahoo, setIsCheckingYahoo] = useState(true);
  const [isYahooDisconnecting, setIsYahooDisconnecting] = useState(false);
  const [yahooLeagues, setYahooLeagues] = useState<YahooLeague[]>([]);
  const [isLoadingYahooLeagues, setIsLoadingYahooLeagues] = useState(true);
  const [isDiscoveringYahoo, setIsDiscoveringYahoo] = useState(false);
  const [isReconnectingYahoo, setIsReconnectingYahoo] = useState(false);
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
  const [isRefreshingLeagues, setIsRefreshingLeagues] = useState(false);
  const [sleeperConnectInput, setSleeperConnectInput] = useState('');
  const [sleeperError, setSleeperError] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<UserPreferencesState>(() => createEmptyPreferences());
  const [accountScopedUserId, setAccountScopedUserId] = useState<string | null>(null);
  const [settingSportDefault, setSettingSportDefault] = useState<string | null>(null);
  const currentUserIdRef = useRef<string | null>(null);
  // Device class resolves after mount so SSR and hydration render identically.
  const [deviceClass, setDeviceClass] = useState<DeviceClass | null>(null);
  const [setupLinkState, setSetupLinkState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const espnViewSignalSent = useRef(false);
  const pageViewSignalSent = useRef(false);

  useEffect(() => {
    currentUserIdRef.current = isSignedIn ? userId ?? null : null;
  }, [isSignedIn, userId]);

  useEffect(() => {
    setDeviceClass(getDeviceClass());
  }, []);

  const isMobileDevice = deviceClass === 'mobile';

  // Measure the ESPN extension wall: one signal per page load when the ESPN
  // connect UI is first viewed, on any device, once the credential check has
  // settled so `connected` is accurate.
  useEffect(() => {
    if (!isEspnSetupOpen || espnViewSignalSent.current) return;
    if (!isSignedIn || deviceClass === null || isCheckingCreds) return;
    espnViewSignalSent.current = true;
    void fetch('/api/signals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'espn_connect_ui_view',
        device: deviceClass,
        connected: hasCredentials,
        ...(inboundRef ? { ref: inboundRef } : {}),
      }),
    }).catch(() => {});
  }, [isEspnSetupOpen, isSignedIn, deviceClass, isCheckingCreds, hasCredentials, inboundRef]);

  // Attribution: when the page was reached via a tagged link (ref param),
  // report one landing signal so campaigns are countable in Workers Logs.
  useEffect(() => {
    if (!inboundRef || pageViewSignalSent.current) return;
    if (!isSignedIn || deviceClass === null) return;
    pageViewSignalSent.current = true;
    void fetch('/api/signals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: 'leagues_page_view',
        device: deviceClass,
        ref: inboundRef,
      }),
    }).catch(() => {});
  }, [inboundRef, isSignedIn, deviceClass]);

  const handleEmailSetupLink = useCallback(async () => {
    setSetupLinkState('sending');
    try {
      const res = await fetch('/api/espn/setup-link-email', { method: 'POST' });
      if (!res.ok) throw new Error('send failed');
      setSetupLinkState('sent');
    } catch {
      setSetupLinkState('error');
    }
  }, []);

  const isAccountStateCurrent = Boolean(isSignedIn && userId && accountScopedUserId === userId);
  const displayLeagues = isAccountStateCurrent ? leagues : EMPTY_ESPN_LEAGUES;
  const displayYahooLeagues = isAccountStateCurrent ? yahooLeagues : EMPTY_YAHOO_LEAGUES;
  const displaySleeperLeagues = isAccountStateCurrent ? sleeperLeagues : EMPTY_SLEEPER_LEAGUES;
  const displayPreferences = isAccountStateCurrent ? preferences : EMPTY_USER_PREFERENCES;
  const defaultSport = displayPreferences.defaultSport;
  const [showInactiveLeagues, setShowInactiveLeagues] = useState(false);
  const [showHiddenLeagues, setShowHiddenLeagues] = useState(false);
  // Keyed by `${platform}:${recurringLeagueId}` while an archive/unarchive request is in flight.
  const [archivingLeagueKey, setArchivingLeagueKey] = useState<string | null>(null);

  const clearYahooConnectionState = useCallback(() => {
    setIsYahooConnected(false);
    setYahooHealth(null);
    setIsYahooReconnectNeeded(false);
    setYahooLastUpdated(null);
    setYahooLeagues([]);
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
    setIsDiscoveringYahoo(false);
    setIsReconnectingYahoo(false);
    setIsYahooDisconnecting(false);
    setIsDiscoveringSleeper(false);
    setIsRefreshingLeagues(false);
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

    const thresholdYear = getPreviousSeasonYear(sport);
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
          archived: false,
        });
      }
      const group = grouped.get(groupKey)!;
      group.seasons.push(league);
      // Seasons of a recurring league share an archive state; any flagged season
      // suppresses the group and carries its mode (default 'historical' when absent).
      if (league.archived) {
        group.archived = true;
        group.archiveMode = league.archiveMode ?? 'historical';
      }
    }

    // Sort seasons desc within each group
    for (const group of grouped.values()) {
      group.seasons.sort((a, b) => (b.seasonYear ?? 0) - (a.seasonYear ?? 0));
      // Use most recent season's league name
      group.leagueName = group.seasons[0]?.leagueName || group.leagueName;
      group.teamId = group.seasons.find((s) => s.teamId)?.teamId;
    }

    // Separate suppressed groups, then active vs old. The data split stays four-way
    // (active/old/archived/hidden); the UI renders old + archived together in the
    // merged "Inactive" section, while 'hidden' gets its own "Hidden" section.
    const activeLeagues: UnifiedLeagueGroup[] = [];
    const oldLeagueGroups: UnifiedLeagueGroup[] = [];
    const archivedLeagueGroups: UnifiedLeagueGroup[] = [];
    const hiddenLeagueGroups: UnifiedLeagueGroup[] = [];

    for (const group of grouped.values()) {
      if (group.archived) {
        if (group.archiveMode === 'hidden') {
          hiddenLeagueGroups.push(group);
        } else {
          archivedLeagueGroups.push(group);
        }
      } else if (isOldLeague(group.sport as Sport, group.seasons)) {
        oldLeagueGroups.push(group);
      } else {
        activeLeagues.push(group);
      }
    }

    // Sort suppressed groups by most recent season desc for a stable list order.
    const bySeasonDesc = (a: UnifiedLeagueGroup, b: UnifiedLeagueGroup) =>
      (b.seasons[0]?.seasonYear ?? 0) - (a.seasons[0]?.seasonYear ?? 0);
    archivedLeagueGroups.sort(bySeasonDesc);
    hiddenLeagueGroups.sort(bySeasonDesc);

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

    return { active: sortedActive, old: oldLeagueGroups, archived: archivedLeagueGroups, hidden: hiddenLeagueGroups };
  }, [displayLeagues, displayYahooLeagues, displaySleeperLeagues, displayPreferences]);

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

  const checkYahooStatus = useCallback(async (shouldApply?: () => boolean): Promise<ConnectionStatusResult> => {
    try {
      const res = await fetch('/api/connect/yahoo/status');
      const data = await res.json().catch(() => ({})) as {
        connected?: boolean;
        lastUpdated?: string;
        // Keep the wire shape loose and validate it before using it in UI state.
        health?: unknown;
        error?: string;
      };
      if (res.ok) {
        if (!canApplyState(shouldApply)) return 'unknown';
        const connected = data.connected ?? false;
        setIsYahooConnected(connected);
        setYahooHealth(connected ? parseYahooConnectionHealth(data.health) : null);
        setIsYahooReconnectNeeded(false);
        setYahooLastUpdated(connected ? data.lastUpdated || null : null);
        if (!connected) {
          setYahooLeagues([]);
          setIsLoadingYahooLeagues(false);
        }
        return connected ? 'connected' : 'disconnected';
      }

      // Yahoo status only reports stored connection metadata; retryable refresh failures surface in discovery.
      if (res.status === 401 || res.status === 403 || data.error === 'not_connected') {
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

      if (isSleeperDisconnectedStatus(res.status, data)) {
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

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !userId) {
      return;
    }
    const refreshState = yahooHealth?.refreshState;
    const retryAfterSeconds = yahooHealth?.retryAfterSeconds;
    if (refreshState !== 'cooldown' && refreshState !== 'in_progress') {
      return;
    }
    const recheckAfterSeconds = Math.min(
      typeof retryAfterSeconds === 'number' && retryAfterSeconds > 0
        ? retryAfterSeconds
        : YAHOO_STATUS_RECHECK_FALLBACK_SECONDS,
      YAHOO_STATUS_RECHECK_MAX_SECONDS
    );

    let isActive = true;
    const retryTimer = window.setTimeout(() => {
      // Show the checking state immediately; checkYahooStatus clears it when the status request settles.
      setIsCheckingYahoo(true);
      void checkYahooStatus(() => isActive);
    }, Math.ceil(recheckAfterSeconds * 1000));

    return () => {
      isActive = false;
      window.clearTimeout(retryTimer);
    };
  }, [
    checkYahooStatus,
    isLoaded,
    isSignedIn,
    userId,
    yahooHealth?.refreshState,
    yahooHealth?.retryAfterSeconds,
  ]);

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

  const refreshConnectedLeagues = useCallback(async () => {
    const shouldApply = createAccountGuard();
    if (!shouldApply()) return;

    setIsRefreshingLeagues(true);
    setLeagueError(null);
    setLeagueNotice(null);
    setSleeperError(null);

    try {
      const res = await fetch('/api/leagues/refresh', { method: 'POST' });
      const data = await res.json().catch(() => ({ error: 'Unknown error' })) as LeagueRefreshResponse;
      if (!shouldApply()) return;

      if (!res.ok) {
        throw new Error(data.error_description || data.error || 'Failed to sync leagues');
      }

      if (data.success === false && didEveryRefreshProviderError(data)) {
        throw new Error(summarizeLeagueRefresh(data));
      }

      setIsCheckingYahoo(true);
      setIsCheckingSleeper(true);
      await Promise.allSettled([
        loadLeagues({ showSpinner: false, shouldApply }),
        loadYahooLeagues(shouldApply),
        loadSleeperLeagues(shouldApply),
        checkYahooStatus(shouldApply),
        checkSleeperStatus(shouldApply),
      ]);

      if (shouldApply()) {
        setLeagueNotice(summarizeLeagueRefresh(data));
      }
    } catch (err) {
      if (shouldApply()) {
        setLeagueError(err instanceof Error ? err.message : 'Failed to sync leagues');
      }
    } finally {
      if (shouldApply()) {
        setIsRefreshingLeagues(false);
      }
    }
  }, [
    checkSleeperStatus,
    checkYahooStatus,
    createAccountGuard,
    loadLeagues,
    loadSleeperLeagues,
    loadYahooLeagues,
  ]);

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
        if (isYahooReconnectRequired(res.status, data)) {
          // The opened panel and notice are the reconnect prompt, so skip the error banner.
          setIsYahooSetupOpen(true);
          clearYahooConnectionState();
          setIsYahooReconnectNeeded(true);
          setLeagueNotice(null);
          shouldCheckYahooStatus = false;
          return;
        }
        if (isYahooTransientAuthResponse(data)) {
          // Intentionally open the Yahoo panel so the temporary state appears beside
          // the Sync leagues and Reconnect Yahoo actions that resolve it.
          const retryAfterSeconds = typeof data.retry_after === 'number' &&
            Number.isFinite(data.retry_after) &&
            data.retry_after > 0
            ? data.retry_after
            : undefined;
          setIsYahooSetupOpen(true);
          setIsYahooConnected(true);
          setIsYahooReconnectNeeded(false);
          setYahooHealth({
            accessTokenState: 'needs_refresh',
            refreshState: 'cooldown',
            retryAfterSeconds,
          });
          setLeagueError(null);
          setLeagueNotice(null);
          shouldCheckYahooStatus = false;
          return;
        }
        throw new Error(data.error_description || data.error || 'Failed to sync Yahoo leagues');
      }
      didLoadYahooLeagues = true;
      setYahooHealth({
        accessTokenState: 'fresh',
        refreshState: 'idle',
      });
      setIsYahooReconnectNeeded(false);
      await loadYahooLeagues(shouldApply);
    } catch (err) {
      if (shouldApply()) {
        console.error('Failed to discover Yahoo leagues:', err);
        setLeagueError(err instanceof Error ? err.message : 'Failed to sync Yahoo leagues');
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

  const reconnectYahoo = () => {
    setLeagueError(null);
    setLeagueNotice(null);
    setIsYahooReconnectNeeded(false);
    setIsReconnectingYahoo(true);
    window.location.href = '/api/connect/yahoo/authorize';
  };

  useEffect(() => {
    if (!isReconnectingYahoo) {
      return;
    }

    const resetReconnectState = () => setIsReconnectingYahoo(false);
    const resetTimer = window.setTimeout(resetReconnectState, 15_000);
    const handlePageHide = () => {
      window.clearTimeout(resetTimer);
    };
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        resetReconnectState();
      }
    };

    window.addEventListener('pagehide', handlePageHide, { once: true });
    window.addEventListener('pageshow', handlePageShow, { once: true });

    return () => {
      window.clearTimeout(resetTimer);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [isReconnectingYahoo]);

  const disconnectYahoo = useCallback(async () => {
    const shouldApply = createAccountGuard();
    if (!shouldApply()) return;

    setIsYahooDisconnecting(true);
    try {
      const res = await fetch('/api/connect/yahoo/disconnect', { method: 'DELETE' });
      if (shouldApply() && res.ok) {
        clearYahooConnectionState();
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
  }, [clearYahooConnectionState, createAccountGuard]);

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
      const retryAfter = parseYahooRetryAfterSeconds(searchParams.get('retry_after'));
      if (isYahooTransientAuthError(yahooError)) {
        setLeagueError(null);
        setLeagueNotice(getYahooConnectErrorMessage(yahooError, searchParams.get('error_description'), retryAfter));
      } else {
        setLeagueNotice(null);
        setLeagueError(getYahooConnectErrorMessage(yahooError, searchParams.get('error_description'), retryAfter));
        setIsYahooSetupOpen(true);
      }
      router.replace('/leagues', { scroll: false });
    }

    const yahooParam = searchParams.get('yahoo');
    if (yahooParam === 'connected') {
      // Just came from OAuth — trust the param, skip status check
      setIsYahooConnected(true);
      setYahooHealth(null);
      setIsYahooReconnectNeeded(false);
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

  // Set or clear a league group's visibility (ESPN, Yahoo, Sleeper). All directions
  // share the flow: resolve key → set loading → fetch → refresh the affected platform
  // so the `archived`/`archiveMode` flags re-bucket the group. POST sets the archive
  // mode ('historical' = Archive, 'hidden' = Hide); DELETE restores it to the visible/
  // AI surfaces. `mode` is only used for the 'archive' action.
  const performArchiveAction = async (
    group: UnifiedLeagueGroup,
    action: 'archive' | 'unarchive',
    mode: 'historical' | 'hidden' = 'historical'
  ) => {
    const recurringLeagueId = getArchiveRecurringId(group);
    const actionKey = `${group.platform}:${recurringLeagueId}`;
    const shouldApply = createAccountGuard();
    setArchivingLeagueKey(actionKey);
    setLeagueError(null);
    setLeagueNotice(null);

    try {
      const res = await fetch('/api/leagues/archive', {
        method: action === 'archive' ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          action === 'archive'
            ? { platform: group.platform, sport: group.sport, recurringLeagueId, mode }
            : { platform: group.platform, sport: group.sport, recurringLeagueId }
        ),
      });
      if (!res.ok) {
        const data = await res.json() as { error?: string };
        throw new Error(data.error || `Failed to ${action} league`);
      }
      if (group.platform === 'espn') {
        await loadLeagues({ showSpinner: false, shouldApply });
      } else if (group.platform === 'yahoo') {
        await loadYahooLeagues(shouldApply);
      } else {
        await loadSleeperLeagues(shouldApply);
      }
    } catch (err) {
      if (shouldApply()) {
        setLeagueError(err instanceof Error ? err.message : `Failed to ${action} league`);
      }
    } finally {
      if (shouldApply()) setArchivingLeagueKey(null);
    }
  };

  const getSportEmoji = (sport: string) => {
    const option = SPORT_OPTIONS.find((s) => s.value === sport);
    return option?.emoji || '\u{1F3C6}';
  };

  const hasAnyLeagueGroups =
    leaguesBySport.active.length > 0 ||
    leaguesBySport.old.length > 0 ||
    leaguesBySport.archived.length > 0 ||
    leaguesBySport.hidden.length > 0;
  const displayLeagueError = isAccountStateCurrent ? leagueError : null;
  const displayLeagueNotice = isAccountStateCurrent ? leagueNotice : null;
  const displayEspnConnected = isAccountStateCurrent && hasCredentials;
  const displayEspnLastUpdated = isAccountStateCurrent ? espnLastUpdated : null;
  const isEspnStatusChecking = !isAccountStateCurrent || isCheckingCreds;
  const displayYahooConnected = isAccountStateCurrent && isYahooConnected;
  const displayYahooLastUpdated = isAccountStateCurrent ? yahooLastUpdated : null;
  const displayYahooHealth = isAccountStateCurrent ? yahooHealth : null;
  const displayYahooReconnectNeeded = isAccountStateCurrent && isYahooReconnectNeeded;
  const isYahooStatusChecking = !isAccountStateCurrent || isCheckingYahoo;
  const yahooDisplayState = getYahooDisplayState(
    isYahooStatusChecking,
    displayYahooConnected,
    displayYahooReconnectNeeded,
    displayYahooHealth
  );
  const yahooBadgeCopy = getYahooBadgeCopy(yahooDisplayState);
  const yahooStatusCopy = getYahooStatusCopy(yahooDisplayState, displayYahooHealth);
  const isYahooTemporarilyBusy =
    yahooDisplayState === 'cooldown' ||
    yahooDisplayState === 'in_progress';
  const shouldShowYahooStatusAlert =
    isYahooTemporarilyBusy ||
    yahooDisplayState === 'reconnect_needed';
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
          {fromWidget && <WidgetSetupBanner accountCreated={false} isChatGpt={fromChatGpt} />}
          <div className="space-y-3 text-center">
            <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary text-primary-foreground font-bold">
              1
            </div>
            <h1 className="text-3xl font-semibold">Set up Your Leagues</h1>
            <p className="text-muted-foreground">
              Sign in to connect ESPN, Yahoo, and Sleeper, choose the league ChatGPT should use first, and manage your defaults in one place.
            </p>
          </div>
          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="space-y-2">
                <h2 className="font-medium">What happens here</h2>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>Connect your fantasy platforms and sync league data</li>
                  <li>Pick the sport and league ChatGPT should use by default</li>
                  <li>Open ChatGPT and use Flaim Fantasy once your leagues are connected</li>
                </ul>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row">
                <SignUpButton mode="modal" forceRedirectUrl={authRedirectUrl}>
                  <Button className="w-full sm:flex-1">Create Account</Button>
                </SignUpButton>
                <SignInButton mode="modal" forceRedirectUrl={authRedirectUrl}>
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
        {fromWidget && !isLeagueStateLoading && !hasAnyLeagueGroups && (
          <WidgetSetupBanner accountCreated isChatGpt={fromChatGpt} />
        )}

        {/* Global alerts */}
        {displayLeagueError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{displayLeagueError}</AlertDescription>
          </Alert>
        )}

        {displayLeagueNotice && (
          <Alert className="bg-info/10 border-info/30 text-info">
            <Info className="h-4 w-4" />
            <AlertDescription>{displayLeagueNotice}</AlertDescription>
          </Alert>
        )}

        <Card id="connect-ai" className="order-4">
          <CardHeader className="pb-4">
            <div className="flex items-start justify-between gap-4">
              <button
                type="button"
                onClick={() => setIsAiSectionOpen((prev) => !prev)}
                aria-expanded={isAiSectionOpen}
                aria-controls="ai-card-content"
                className="flex flex-1 items-start gap-4 text-left"
              >
                <div className="min-w-0 space-y-2">
                  <CardTitle className="text-lg">Agents</CardTitle>
                </div>
              </button>
              <div className="flex items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="rounded-md border border-muted bg-muted/60 p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label="Alternative AI connector info"
                      title="Alternative AI connector info"
                    >
                      <Info className="h-4 w-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="max-w-xs text-sm text-muted-foreground">
                    Alternative AI&apos;s are unofficially supported as custom
                    connectors. Click{" "}
                    <Link href="/guide/ai#custom-connectors" className="text-primary underline hover:no-underline">
                      here
                    </Link>{" "}
                    to learn more.
                  </PopoverContent>
                </Popover>
                <button
                  type="button"
                  onClick={() => setIsAiSectionOpen((prev) => !prev)}
                  aria-expanded={isAiSectionOpen}
                  aria-controls="ai-card-content"
                  className="rounded-md border border-muted bg-muted/60 p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={isAiSectionOpen ? 'Collapse chatbots section' : 'Expand chatbots section'}
                >
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${
                      isAiSectionOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>
              </div>
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
            <h2 className="text-sm font-semibold">Tips for using Flaim</h2>
            <p className="text-sm text-muted-foreground">
              Flaim Fantasy provides the connective tissue between your fantasy
              platforms and your AI agents. Once you&apos;ve connected a Flaim
              account to both your leagues and your chatbot, you&apos;re done.
              Everything else happens behind the scenes. Use your AI like you
              normally would.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {[
              [
                'Quicker Answers',
                'Set defaults so you can ask "Find me a waiver wire add" and your AI will know what sport and what team without even asking.',
              ],
              [
                'Activating Flaim',
                'Use your AI like you normally would and Flaim should activate automatically. You can also say, "Use Flaim." to help it activate, or select Flaim Fantasy from your plugin drawer (the plus button).',
              ],
            ].map(([label, description]) => (
              <div key={label} className="rounded-md border bg-background/70 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-foreground/70">
                  {label}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {description}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Your Leagues Card */}
        <Card id="leagues" className="order-3">
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
                  <CardTitle className="text-lg">Leagues</CardTitle>
                </div>
              </button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={refreshConnectedLeagues}
                  disabled={!isAccountStateCurrent || isRefreshingLeagues}
                  className="h-8 shrink-0"
                >
                  {isRefreshingLeagues ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Syncing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Sync all
                    </>
                  )}
                </Button>
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="rounded-md border border-muted bg-muted/60 p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-warning"
                      aria-label="Star defaults info"
                      title="Star defaults info"
                    >
                      <Star className="h-4 w-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="max-w-xs text-sm text-muted-foreground">
                    Stars mark your defaults. Set a default sport, and also set a default team per sport.
                  </PopoverContent>
                </Popover>
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
                {leaguesBySport.active.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    Active leagues with current seasons. These are automatically sent to your AI at the start of every conversation. Non-current seasons are also available if you ask.
                  </p>
                )}
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
                                {/* Visibility controls: all three platforms (ESPN, Yahoo, Sleeper). */}
                                <ArchiveButtons
                                  group={group}
                                  archivingLeagueKey={archivingLeagueKey}
                                  onArchive={(g) => performArchiveAction(g, 'archive', 'historical')}
                                  onHide={(g) => performArchiveAction(g, 'archive', 'hidden')}
                                />
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

                    {/* Inactive Leagues Section (aged-out + manually archived) */}
                    {(leaguesBySport.old.length + leaguesBySport.archived.length) > 0 && (
                      <div className="space-y-3 pt-3 border-t">
                        <button
                          type="button"
                          className="flex items-center gap-2 font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
                          onClick={() => setShowInactiveLeagues(!showInactiveLeagues)}
                        >
                          <Archive className="h-4 w-4" />
                          <span className="text-base">Inactive ({leaguesBySport.old.length + leaguesBySport.archived.length})</span>
                          <ChevronDown className={`h-4 w-4 ml-auto transition-transform ${showInactiveLeagues ? 'rotate-180' : ''}`} />
                        </button>

                        {showInactiveLeagues && (
                          <div className="space-y-3">
                            <p className="text-sm text-muted-foreground">
                              Leagues that are old or that you&apos;ve manually archived. These are still available to your AI when you ask about past seasons.
                            </p>
                            {leaguesBySport.old.map((group) => {
                              const baseKey = `${group.leagueId}-${group.sport}`;
                              const isDeleting = deletingLeagueKey === baseKey;
                              const isArchiving = archivingLeagueKey === `${group.platform}:${getArchiveRecurringId(group)}`;
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
                                    <div className="flex items-center gap-1 shrink-0">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                        onClick={() => performArchiveAction(group, 'archive', 'hidden')}
                                        disabled={isArchiving}
                                        title="Hide (completely hidden from the AI)"
                                      >
                                        {isArchiving ? <Loader2 className="h-4 w-4 animate-spin" /> : <EyeOff className="h-4 w-4" />}
                                      </Button>
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
                                </div>
                              );
                            })}
                            {leaguesBySport.archived.map((group) => {
                              const baseKey = `${group.leagueId}-${group.sport}`;
                              const isDeleting =
                                (group.platform === 'espn' && deletingLeagueKey === baseKey)
                                || (group.platform === 'sleeper' && deletingSleeperKey === `sleeper:${group.leagueId}`)
                                || (group.platform === 'yahoo' && deletingLeagueKey === `yahoo:${group.seasons[0]?.yahooId}`);
                              const isArchiving = archivingLeagueKey === `${group.platform}:${getArchiveRecurringId(group)}`;
                              const mostRecentYear = group.seasons[0]?.seasonYear;

                              return (
                                <div key={group.key} className="rounded-lg border bg-muted/30">
                                  {/* Archived League Header */}
                                  <div className="flex items-center justify-between gap-3 p-3">
                                    <div className="min-w-0">
                                      <div className="font-medium break-words text-muted-foreground">
                                        {group.leagueName || `League ${group.leagueId}`}
                                      </div>
                                      <div className="text-xs text-muted-foreground/70 break-words">
                                        {group.platform === 'espn' ? 'ESPN' : group.platform === 'yahoo' ? 'Yahoo' : 'Sleeper'}
                                        {mostRecentYear ? ` • Last active: ${mostRecentYear}` : ''}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                        onClick={() => performArchiveAction(group, 'archive', 'hidden')}
                                        disabled={isArchiving}
                                        title="Hide (completely hidden from the AI)"
                                      >
                                        {isArchiving ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                          <EyeOff className="h-4 w-4" />
                                        )}
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                        onClick={() => performArchiveAction(group, 'unarchive')}
                                        disabled={isArchiving}
                                        title="Restore (show to your AI again)"
                                      >
                                        {isArchiving ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                          <ArchiveRestore className="h-4 w-4" />
                                        )}
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                        onClick={() => {
                                          if (group.platform === 'espn') {
                                            handleDeleteLeague(group.leagueId, group.sport);
                                          } else if (group.platform === 'yahoo') {
                                            handleDeleteYahooLeagueGroup(group.seasons);
                                          } else {
                                            handleDeleteSleeperLeagueGroup(group.seasons, group.leagueId);
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
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Hidden Leagues Section (mode: 'hidden') */}
                    {leaguesBySport.hidden.length > 0 && (
                      <div className="space-y-3 pt-3 border-t">
                        <button
                          type="button"
                          className="flex items-center gap-2 font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
                          onClick={() => setShowHiddenLeagues(!showHiddenLeagues)}
                        >
                          <EyeOff className="h-4 w-4" />
                          <span className="text-base">Hidden ({leaguesBySport.hidden.length})</span>
                          <ChevronDown className={`h-4 w-4 ml-auto transition-transform ${showHiddenLeagues ? 'rotate-180' : ''}`} />
                        </button>

                        {showHiddenLeagues && (
                          <div className="space-y-3">
                            <p className="text-sm text-muted-foreground">
                              Leagues you&apos;ve fully hidden. Your AI never sees these, in any conversation.
                            </p>
                            {leaguesBySport.hidden.map((group) => {
                              const baseKey = `${group.leagueId}-${group.sport}`;
                              const isDeleting =
                                (group.platform === 'espn' && deletingLeagueKey === baseKey)
                                || (group.platform === 'sleeper' && deletingSleeperKey === `sleeper:${group.leagueId}`)
                                || (group.platform === 'yahoo' && deletingLeagueKey === `yahoo:${group.seasons[0]?.yahooId}`);
                              const isArchiving = archivingLeagueKey === `${group.platform}:${getArchiveRecurringId(group)}`;
                              const mostRecentYear = group.seasons[0]?.seasonYear;

                              return (
                                <div key={group.key} className="rounded-lg border bg-muted/30">
                                  {/* Hidden League Header */}
                                  <div className="flex items-center justify-between gap-3 p-3">
                                    <div className="min-w-0">
                                      <div className="font-medium break-words text-muted-foreground">
                                        {group.leagueName || `League ${group.leagueId}`}
                                      </div>
                                      <div className="text-xs text-muted-foreground/70 break-words">
                                        {group.platform === 'espn' ? 'ESPN' : group.platform === 'yahoo' ? 'Yahoo' : 'Sleeper'}
                                        {mostRecentYear ? ` • Last active: ${mostRecentYear}` : ''}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-1 shrink-0">
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                        onClick={() => performArchiveAction(group, 'archive', 'historical')}
                                        disabled={isArchiving}
                                        title="Archive (still browsable for past seasons)"
                                      >
                                        {isArchiving ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                          <Archive className="h-4 w-4" />
                                        )}
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                                        onClick={() => performArchiveAction(group, 'unarchive')}
                                        disabled={isArchiving}
                                        title="Restore (show to your AI again)"
                                      >
                                        {isArchiving ? (
                                          <Loader2 className="h-4 w-4 animate-spin" />
                                        ) : (
                                          <ArchiveRestore className="h-4 w-4" />
                                        )}
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="icon"
                                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                                        onClick={() => {
                                          if (group.platform === 'espn') {
                                            handleDeleteLeague(group.leagueId, group.sport);
                                          } else if (group.platform === 'yahoo') {
                                            handleDeleteYahooLeagueGroup(group.seasons);
                                          } else {
                                            handleDeleteSleeperLeagueGroup(group.seasons, group.leagueId);
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
            <div className="flex items-start justify-between gap-4">
              <button
                type="button"
                onClick={() => setIsPlatformsSectionOpen((prev) => !prev)}
                aria-expanded={isPlatformsSectionOpen}
                aria-controls="platforms-card-content"
                className="flex flex-1 items-start gap-4 text-left"
              >
                <div className="min-w-0 space-y-2">
                  <CardTitle className="text-lg">Platforms</CardTitle>
                </div>
              </button>
              <div className="flex items-center gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="rounded-md border border-muted bg-muted/60 p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      aria-label="Open platform setup guides"
                      title="Platform setup guides"
                    >
                      <BookOpen className="h-4 w-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="end" className="max-w-xs text-sm text-muted-foreground">
                    For more help connecting your fantasy platform, click{" "}
                    <Link href="/guide/platforms" className="text-primary underline hover:no-underline">
                      here
                    </Link>
                    .
                  </PopoverContent>
                </Popover>
                <button
                  type="button"
                  onClick={() => setIsPlatformsSectionOpen((prev) => !prev)}
                  aria-expanded={isPlatformsSectionOpen}
                  aria-controls="platforms-card-content"
                  className="rounded-md border border-muted bg-muted/60 p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label={isPlatformsSectionOpen ? 'Collapse platforms section' : 'Expand platforms section'}
                >
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${
                      isPlatformsSectionOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>
              </div>
            </div>
          </CardHeader>
          {isPlatformsSectionOpen ? (
          <CardContent id="platforms-card-content" className="pt-0">
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
                  {isMobileDevice && !displayEspnConnected && !isEspnStatusChecking ? (
                    <>
                      <p className="text-sm text-muted-foreground">
                        ESPN setup takes sixty seconds on a computer. Credentials
                        link through a Chrome extension, and phone browsers
                        can&apos;t run extensions.
                      </p>
                      {setupLinkState === 'sent' ? (
                        <Alert className="bg-info/10 border-info/30 text-info">
                          <CheckCircle2 className="h-4 w-4" />
                          <AlertDescription>
                            Sent! The setup link is waiting in your inbox for the
                            next time you&apos;re at a computer.
                          </AlertDescription>
                        </Alert>
                      ) : (
                        <Button
                          size="sm"
                          className="w-full sm:w-auto"
                          onClick={handleEmailSetupLink}
                          disabled={setupLinkState === 'sending'}
                        >
                          {setupLinkState === 'sending' ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              Sending...
                            </>
                          ) : (
                            <>
                              <Mail className="h-4 w-4 mr-2" />
                              Email me the setup link
                            </>
                          )}
                        </Button>
                      )}
                      {setupLinkState === 'error' && (
                        <p className="text-sm text-destructive">
                          Couldn&apos;t send right now. Open flaim.app/leagues on
                          a computer to finish ESPN setup.
                        </p>
                      )}
                      <p className="text-sm text-muted-foreground">
                        On your phone right now? Yahoo and Sleeper connect right
                        here — no extension needed.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-muted-foreground">
                        {displayEspnConnected
                          ? 'Manage ESPN leagues, seasons, accounts, and credentials with the Flaim Chrome extension.'
                          : 'Add ESPN credentials with the Flaim Chrome extension.'}
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
                    </>
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
                  <span className={`text-xs px-2 py-0.5 rounded-full ${yahooBadgeCopy.className}`}>
                    {isYahooStatusChecking ? (
                      <span className="flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {yahooBadgeCopy.label}
                      </span>
                    ) : yahooBadgeCopy.label}
                  </span>
                </div>
                <ChevronDown
                  className={`h-5 w-5 text-muted-foreground transition-transform ${
                    isYahooSetupOpen ? 'rotate-180' : ''
                  }`}
                />
              </button>
              {isYahooSetupOpen && (
                <div id="yahoo-setup-content" className="px-4 pb-4 space-y-3">
                  {!shouldShowYahooStatusAlert && yahooDisplayState !== 'checking' && (
                    <p className="text-sm text-muted-foreground">
                      {yahooStatusCopy}
                    </p>
                  )}
                  {shouldShowYahooStatusAlert && (
                    <Alert variant={yahooDisplayState === 'reconnect_needed' ? 'destructive' : 'warning'}>
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>{yahooStatusCopy}</AlertDescription>
                    </Alert>
                  )}
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
                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        <Button
                          variant="default"
                          size="sm"
                          onClick={discoverYahooLeagues}
                          disabled={isDiscoveringYahoo || isYahooTemporarilyBusy}
                          className="w-full sm:w-auto"
                        >
                          {isDiscoveringYahoo ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Syncing...
                            </>
                          ) : (
                            <>
                              <RefreshCw className="mr-2 h-4 w-4" />
                              Sync leagues
                            </>
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={reconnectYahoo}
                          disabled={isReconnectingYahoo}
                          className="w-full sm:w-auto"
                        >
                          {isReconnectingYahoo ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              Opening Yahoo...
                            </>
                          ) : (
                            'Reconnect Yahoo'
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={disconnectYahoo}
                          disabled={isYahooDisconnecting}
                          className="w-full text-destructive hover:text-destructive sm:w-auto"
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
                    <div className="space-y-3">
                      <Button
                        size="sm"
                        className="w-full sm:w-auto"
                        onClick={reconnectYahoo}
                        disabled={isReconnectingYahoo}
                      >
                        {isReconnectingYahoo ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Opening Yahoo...
                          </>
                        ) : (
                          yahooDisplayState === 'reconnect_needed' ? 'Reconnect Yahoo' : 'Connect Yahoo'
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
                        {displaySleeperUsername
                          ? `Connected as ${displaySleeperUsername}. Refresh to pull latest leagues.`
                          : 'Connected to Sleeper. Refresh to pull latest leagues.'}
                      </p>
                      {displaySleeperLastUpdated && (
                        <p className="text-xs text-muted-foreground">
                          Last updated: {formatLastUpdated(displaySleeperLastUpdated)}
                        </p>
                      )}
                      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                        <Button
                          size="sm"
                          onClick={() => displaySleeperUsername && discoverSleeperLeagues(displaySleeperUsername)}
                          disabled={isDiscoveringSleeper || !displaySleeperUsername}
                          className="w-full sm:w-auto"
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
                          className="w-full text-destructive hover:text-destructive sm:w-auto"
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
                        Enter your Sleeper username to discover your leagues.
                      </p>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Input
                          placeholder="Sleeper username"
                          value={sleeperConnectInput}
                          onChange={(e) => setSleeperConnectInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && sleeperConnectInput.trim() && discoverSleeperLeagues(sleeperConnectInput.trim())}
                          disabled={isDiscoveringSleeper}
                          className="h-9 flex-1 text-xs"
                        />
                        <Button
                          size="sm"
                          onClick={() => discoverSleeperLeagues(sleeperConnectInput.trim())}
                          disabled={isDiscoveringSleeper || !sleeperConnectInput.trim()}
                          className="w-full sm:w-auto"
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
