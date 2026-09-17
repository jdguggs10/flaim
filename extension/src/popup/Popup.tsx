/**
 * Extension Popup - Clerk Auth Version
 * ---------------------------------------------------------------------------
 * Main popup component using Clerk Sync Host for authentication.
 * Session syncs automatically from flaim.app when user is signed in there.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth, useClerk, useUser, SignedIn, SignedOut } from '@clerk/chrome-extension';
import {
  getEspnHistoryState,
  setEspnHistoryState,
  getReviewInvitationState,
  setReviewInvitationState,
  type SeasonCounts,
} from '../lib/storage';
import { getEspnCredentials, validateCredentials } from '../lib/espn';
import {
  syncCredentials,
  checkStatus,
  getSiteBase,
  discoverLeagues,
  getEspnHistoryStatus,
  ApiRequestError,
  type DiscoveredLeague,
  type EspnHistoryStatus,
} from '../lib/api';

// Simplified state machine
type State =
  | 'loading'
  | 'no_espn'
  | 'ready'
  | 'setup_syncing'
  | 'setup_discovering'
  | 'setup_complete'
  | 'setup_unknown'
  | 'setup_error';

type DiagnosticStage = 'idle' | 'status' | 'sync' | 'discovery';
type DiscoveryResult = 'not_run' | 'confirmed' | 'none' | 'unknown';

const ESPN_SETUP_PATH = '/docs/espn';
const CHROME_WEB_STORE_REVIEW_URL =
  'https://chromewebstore.google.com/detail/flaim-espn-fantasy-connec/mbnokejgglkfgkeeenolgdpcnfakpbkn/reviews';

type SportIconDefinition = {
  label: string;
  paths: readonly string[];
};

/*!
 * @license @tabler/icons-react v3.41.1 - MIT
 *
 * Copyright (c) 2020-2026 Paweł Kuna
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
const SPORT_ICONS = new Map<string, SportIconDefinition>([
  [
    'football',
    {
      label: 'Football',
      paths: [
        'M15 9l-6 6',
        'M10 12l2 2',
        'M12 10l2 2',
        'M8 21a5 5 0 0 0 -5 -5',
        'M16 3c-7.18 0 -13 5.82 -13 13a5 5 0 0 0 5 5c7.18 0 13 -5.82 13 -13a5 5 0 0 0 -5 -5',
        'M16 3a5 5 0 0 0 5 5',
      ],
    },
  ],
  [
    'baseball',
    {
      label: 'Baseball',
      paths: [
        'M5.636 18.364a9 9 0 1 0 12.728 -12.728a9 9 0 0 0 -12.728 12.728',
        'M12.495 3.02a9 9 0 0 1 -9.475 9.475',
        'M20.98 11.505a9 9 0 0 0 -9.475 9.475',
        'M9 9l2 2',
        'M13 13l2 2',
        'M11 7l2 1',
        'M7 11l1 2',
        'M16 11l1 2',
        'M11 16l2 1',
      ],
    },
  ],
  [
    'basketball',
    {
      label: 'Basketball',
      paths: [
        'M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0',
        'M5.65 5.65l12.7 12.7',
        'M5.65 18.35l12.7 -12.7',
        'M12 3a9 9 0 0 0 9 9',
        'M3 12a9 9 0 0 1 9 9',
      ],
    },
  ],
  [
    'hockey',
    {
      label: 'Hockey',
      paths: [
        'M5.905 5h3.418a1 1 0 0 1 .928 .629l1.143 2.856a3 3 0 0 0 2.207 1.83l4.717 .926a2.084 2.084 0 0 1 1.682 2.045v.714a1 1 0 0 1 -1 1h-13.895a1 1 0 0 1 -1 -1.1l.8 -8a1 1 0 0 1 1 -.9',
        'M3 19h17a1 1 0 0 0 1 -1',
        'M9 15v4',
        'M15 15v4',
      ],
    },
  ],
]);

const FALLBACK_SPORT_ICON: SportIconDefinition = {
  label: 'Fantasy',
  paths: [
    'M8 21l8 0',
    'M12 17l0 4',
    'M7 4l10 0',
    'M17 4v8a5 5 0 0 1 -10 0v-8',
    'M3 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
    'M17 9a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
  ],
};

function SportIcon({ sport }: { sport: string }) {
  // Discovered leagues come straight from the API response, so a missing
  // sport must fall back rather than throw.
  const definition = SPORT_ICONS.get(sport?.toLowerCase()) ?? FALLBACK_SPORT_ICON;

  return (
    <svg
      aria-label={`${definition.label} league`}
      className="sport-icon"
      fill="none"
      focusable="false"
      role="img"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 24 24"
    >
      {definition.paths.map((d) => (
        <path d={d} key={d} />
      ))}
    </svg>
  );
}

function requestError(error: unknown): ApiRequestError {
  return error instanceof ApiRequestError
    ? error
    : new ApiRequestError('Unexpected request failure', { code: 'unknown_error' });
}

function retryAfterMessage(retryAfter: number | null): string {
  if (!retryAfter) return 'Please try again shortly.';
  const minutes = Math.ceil(retryAfter / 60);
  return minutes === 1 ? 'Please try again in about a minute.' : `Please try again in about ${minutes} minutes.`;
}

function setupErrorMessage(stage: DiagnosticStage, error: ApiRequestError): string {
  if (stage === 'discovery' && error.timedOut) {
    return 'ESPN access was saved, but the league check did not finish.';
  }
  if (stage === 'discovery' && error.code === 'espn_auth_failed') {
    return 'ESPN did not accept this Chrome profile’s sign-in. Sign in to ESPN Fantasy again, then retry.';
  }
  if (error.status === 429 || error.code === 'rate_limited' || error.code === 'cooldown') {
    return `ESPN needs a short break before another check. ${retryAfterMessage(error.retryAfter)}`;
  }
  if (stage === 'sync') return 'We could not save ESPN access to Flaim. Please try again.';
  return 'We could not check ESPN right now. Please try again.';
}

// Discovery counts for granular messaging
interface DiscoveryCounts {
  currentSeason: SeasonCounts;
  pastSeasons: SeasonCounts;
}

// Helper function to generate discovery message
function getDiscoveryMessage(counts: DiscoveryCounts): string {
  const { currentSeason: cs, pastSeasons: ps } = counts;

  if (cs.found === 0) {
    return 'No active leagues found for this season.';
  }

  const parts: string[] = [];

  if (cs.added > 0 && cs.alreadySaved === 0) {
    parts.push(`Found ${cs.found} league${cs.found !== 1 ? 's' : ''}`);
  } else if (cs.added === 0 && cs.alreadySaved > 0) {
    parts.push(`${cs.found} league${cs.found !== 1 ? 's' : ''} already saved`);
  } else if (cs.added > 0 && cs.alreadySaved > 0) {
    parts.push(
      `Found ${cs.found} league${cs.found !== 1 ? 's' : ''} (${cs.added} new, ${cs.alreadySaved} saved)`
    );
  } else if (cs.found > 0) {
    parts.push(`Found ${cs.found} league${cs.found !== 1 ? 's' : ''} (save failed)`);
  }

  if (ps.found > 0) {
    if (ps.added > 0 && ps.alreadySaved === 0) {
      parts.push(`${ps.found} past season${ps.found !== 1 ? 's' : ''}`);
    } else if (ps.added === 0 && ps.alreadySaved > 0) {
      parts.push(`${ps.found} past season${ps.found !== 1 ? 's' : ''} already saved`);
    } else if (ps.added > 0) {
      parts.push(`${ps.found} past season${ps.found !== 1 ? 's' : ''} (${ps.added} new)`);
    } else {
      parts.push(`${ps.found} past season${ps.found !== 1 ? 's' : ''} (save failed)`);
    }
  }

  return parts.join(' + ');
}

function hasPersistedCurrentLeague(counts: SeasonCounts): boolean {
  // `refreshed` is supplementary metadata. The established current-season
  // counters that prove a row exists are `added` and `alreadySaved`.
  return counts.added + counts.alreadySaved > 0;
}

function formatLastSync(value: string | null): string {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function checkmark(value: boolean | null): string {
  if (value === null) return '…';
  return value ? '✓' : '–';
}

function isHistoryInProgress(history: EspnHistoryStatus | null): boolean {
  return history?.state === 'queued' || history?.state === 'running';
}

function getHistoryMessage(history: EspnHistoryStatus): string {
  if (history.state === 'queued') return 'Current leagues are synced. ESPN history is queued.';
  if (history.state === 'running') return 'Current leagues are synced. ESPN history is continuing.';
  if (history.state === 'partial') return 'Some ESPN history could not be indexed. Re-sync later to retry it.';
  if (history.state === 'failed') return 'ESPN history could not be indexed. Re-sync later to retry it.';
  if (history.state === 'superseded' || history.state === 'cancelled') {
    return 'ESPN history stopped after your connection changed. Re-sync to start again.';
  }
  return 'ESPN history is up to date.';
}

export default function Popup() {
  // Clerk auth hooks
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const clerk = useClerk();
  const { user } = useUser();

  // Stable ref for getToken to avoid re-running init effect on every render
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const espnHistoryOwnerRef = useRef<string | null>(null);
  const popupActiveRef = useRef(true);
  const currentUserIdRef = useRef<string | null>(null);
  const accountGenerationRef = useRef(0);

  const primaryEmail =
    user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? null;
  const displayName = user?.fullName ?? user?.username ?? null;
  const avatarInitial = (primaryEmail || displayName || '?').charAt(0).toUpperCase();

  // Local state
  const [state, setState] = useState<State>('loading');
  const [error, setError] = useState<string | null>(null);
  const [hasCredentials, setHasCredentials] = useState<boolean | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSetupInProgress, setIsSetupInProgress] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [supportCopied, setSupportCopied] = useState(false);
  const [hasEspnCookies, setHasEspnCookies] = useState<boolean | null>(null);
  const [extensionVersion, setExtensionVersion] = useState<string | null>(null);
  const [espnHistory, setEspnHistory] = useState<EspnHistoryStatus | null>(null);
  const [espnHistoryStatusNeedsRetry, setEspnHistoryStatusNeedsRetry] = useState(false);
  const [diagnosticStage, setDiagnosticStage] = useState<DiagnosticStage>('idle');
  const [apiError, setApiError] = useState<ApiRequestError | null>(null);
  const [discoveryResult, setDiscoveryResult] = useState<DiscoveryResult>('not_run');
  const [showReviewInvitation, setShowReviewInvitation] = useState(false);

  const userId = isSignedIn ? user?.id ?? null : null;
  if (currentUserIdRef.current !== userId) {
    currentUserIdRef.current = userId;
    accountGenerationRef.current += 1;
  }
  const currentEspnHistory = espnHistoryOwnerRef.current === userId ? espnHistory : null;

  const supportInfo = useMemo(() => {
    const truncatedUserId = userId ? `${userId.slice(0, 12)}…` : 'unknown';
    const parts = [
      `userId=${truncatedUserId}`,
      `version=${extensionVersion ?? 'unknown'}`,
      `lastSync=${lastSync ?? 'unknown'}`,
      `stage=${diagnosticStage}`,
      `cookies=${hasEspnCookies === null ? 'unknown' : hasEspnCookies}`,
      `credentials=${hasCredentials === null ? 'unknown' : hasCredentials}`,
      `discovery=${discoveryResult}`,
      `status=${apiError?.status ?? 'unknown'}`,
      `code=${apiError?.code ?? 'unknown'}`,
      `retryAfter=${apiError?.retryAfter ?? 'unknown'}`,
      `clientTimeout=${apiError?.timedOut ?? false}`,
    ];
    return parts.join(' | ');
  }, [userId, extensionVersion, lastSync, diagnosticStage, hasEspnCookies, hasCredentials, discoveryResult, apiError]);

  // Setup flow state
  const [discoveredLeagues, setDiscoveredLeagues] = useState<DiscoveredLeague[]>([]);
  const [discoveryCounts, setDiscoveryCounts] = useState<DiscoveryCounts>({
    currentSeason: { found: 0, added: 0, alreadySaved: 0 },
    pastSeasons: { found: 0, added: 0, alreadySaved: 0 },
  });

  useEffect(() => {
    popupActiveRef.current = true;
    return () => {
      popupActiveRef.current = false;
    };
  }, []);

  // Initialize on Clerk load
  useEffect(() => {
    if (!isLoaded) return;
    let isActive = true;

    const init = async () => {
      setError(null);
      setHasCredentials(null);
      setHasEspnCookies(null);
      setLastSync(null);
      setDiscoveredLeagues([]);
      setDiscoveryCounts({
        currentSeason: { found: 0, added: 0, alreadySaved: 0 },
        pastSeasons: { found: 0, added: 0, alreadySaved: 0 },
      });
      setDiscoveryResult('not_run');
      setShowReviewInvitation(false);
      setIsSetupInProgress(false);
      setIsRefreshing(false);
      setState('loading');
      setDiagnosticStage('status');
      setApiError(null);
      // Never show a prior account's persisted history while this account's status loads.
      espnHistoryOwnerRef.current = null;
      setEspnHistory(null);
      setEspnHistoryStatusNeedsRetry(false);
      let savedHistory: EspnHistoryStatus | null = null;
      try {
        savedHistory = await getEspnHistoryState(isSignedIn ? userId : null);
      } catch {
        // History is a local cache; setup can continue without it.
      }
      if (!isActive) return;
      if (savedHistory && userId) {
        espnHistoryOwnerRef.current = userId;
        setEspnHistory(savedHistory);
      }

      try {
        const info = await chrome.management.getSelf();
        if (!isActive) return;
        setExtensionVersion(info.version);
      } catch {
        if (!isActive) return;
        setExtensionVersion(null);
      }

      // If not signed in, we'll show the signed-out UI via SignedOut component
      if (!isSignedIn) {
        setError(null);
        setState('ready'); // Will be overridden by SignedOut component
        return;
      }

      // Check ESPN cookies
      let espnCreds: Awaited<ReturnType<typeof getEspnCredentials>>;
      try {
        espnCreds = await getEspnCredentials();
      } catch {
        if (!isActive) return;
        setHasEspnCookies(null);
        setError('We could not check ESPN sign-in in this Chrome profile. Try refreshing or use ESPN setup help.');
        setState('ready');
        return;
      }
      if (!isActive) return;
      if (!espnCreds || !validateCredentials(espnCreds)) {
        setHasEspnCookies(false);
        setState('no_espn');
        return;
      }
      setHasEspnCookies(true);

      // Check status with server using Clerk token
      try {
        const token = await getTokenRef.current();
        if (!isActive) return;
        if (token) {
          const status = await checkStatus(token);
          if (!isActive) return;
          setHasCredentials(status.hasCredentials);
          setLastSync(status.lastSync ?? null);
          const history = await getEspnHistoryStatus(token);
          if (!isActive) return;
          espnHistoryOwnerRef.current = userId;
          setEspnHistory(history);
          setEspnHistoryStatusNeedsRetry(false);
          try {
            await setEspnHistoryState(userId, history);
          } catch {
            // History is a local cache; connection status remains known.
          }
          if (!isActive) return;
        } else {
          setEspnHistoryStatusNeedsRetry(true);
        }
        setApiError(null);
        setState('ready');
      } catch (err) {
        if (!isActive) return;
        // Token or status reads may be transient; retry while the popup stays open.
        setHasCredentials(null);
        setApiError(requestError(err));
        setEspnHistoryStatusNeedsRetry(true);
        setState('ready');
      }
    };

    void init();
    return () => {
      isActive = false;
    };
  }, [isLoaded, isSignedIn, userId]);

  useEffect(() => {
    if ((!isHistoryInProgress(currentEspnHistory) && !espnHistoryStatusNeedsRetry) || !isLoaded || !isSignedIn || !userId) return;
    let isActive = true;
    let timer: number | undefined;
    const hasKnownActiveJob = isHistoryInProgress(currentEspnHistory);
    const retryDelays = [5_000, 10_000, 20_000];
    let retryIndex = 0;
    const pollHistory = async () => {
      let receivedHistory = false;
      let shouldPollActiveJob = hasKnownActiveJob;
      try {
        const token = await getTokenRef.current();
        if (!token || !isActive) return;
        const history = await getEspnHistoryStatus(token);
        if (!isActive) return;
        receivedHistory = true;
        shouldPollActiveJob = isHistoryInProgress(history);
        espnHistoryOwnerRef.current = userId;
        setEspnHistory(history);
        setEspnHistoryStatusNeedsRetry(false);
        try {
          await setEspnHistoryState(userId, history);
        } catch {
          // Polling can continue without updating the local cache.
        }
      } catch {
        // A confirmed queued/running job keeps polling. An unknown initial
        // status gets only the bounded recovery sequence below.
      } finally {
        if (!isActive) return;
        if (shouldPollActiveJob) {
          timer = window.setTimeout(() => void pollHistory(), 5_000);
          return;
        }
        if (!receivedHistory && retryIndex < retryDelays.length) {
          timer = window.setTimeout(() => void pollHistory(), retryDelays[retryIndex]);
          retryIndex += 1;
        }
      }
    };
    const initialDelay = hasKnownActiveJob ? 5_000 : retryDelays[retryIndex];
    if (!hasKnownActiveJob) retryIndex += 1;
    timer = window.setTimeout(() => void pollHistory(), initialDelay);
    return () => {
      isActive = false;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [currentEspnHistory, espnHistoryStatusNeedsRetry, isLoaded, isSignedIn, userId]);

  // Handle full setup flow (sync + discover)
  const handleFullSetup = async () => {
    if (isSetupInProgress || !isLoaded || !isSignedIn) return;

    const initiatingUserId = userId;
    const initiatingGeneration = accountGenerationRef.current;
    const isCurrentSetup = () =>
      popupActiveRef.current &&
      currentUserIdRef.current === initiatingUserId &&
      accountGenerationRef.current === initiatingGeneration;

    setError(null);
    setApiError(null);
    setDiagnosticStage('sync');
    setDiscoveryResult('not_run');
    setShowReviewInvitation(false);
    setIsSetupInProgress(true);
    setState('setup_syncing');

    let token: string | null;
    try {
      token = await getToken();
    } catch (err) {
      if (!isCurrentSetup()) return;
      const apiRequestError = requestError(err);
      setApiError(apiRequestError);
      setError('We could not verify your Flaim sign-in. Please sign in again and retry.');
      setState('setup_error');
      setIsSetupInProgress(false);
      return;
    }
    if (!isCurrentSetup()) return;
    if (!token) {
      setError('Not signed in. Please sign in at flaim.app first.');
      setState('setup_error');
      setIsSetupInProgress(false);
      return;
    }

    let espnCreds: Awaited<ReturnType<typeof getEspnCredentials>>;
    try {
      espnCreds = await getEspnCredentials();
    } catch (err) {
      if (!isCurrentSetup()) return;
      const apiRequestError = requestError(err);
      setApiError(apiRequestError);
      setHasEspnCookies(null);
      setError('We could not check ESPN sign-in in this Chrome profile. Please try again.');
      setState('setup_error');
      setIsSetupInProgress(false);
      return;
    }
    if (!isCurrentSetup()) return;
    if (!espnCreds || !validateCredentials(espnCreds)) {
      setState('no_espn');
      setIsSetupInProgress(false);
      return;
    }

    try {
      await syncCredentials(token, espnCreds);
      if (!isCurrentSetup()) return;
      setHasCredentials(true);
      setLastSync(new Date().toISOString());
    } catch (err) {
      if (!isCurrentSetup()) return;
      const apiRequestError = requestError(err);
      setApiError(apiRequestError);
      setError(setupErrorMessage('sync', apiRequestError));
      setState('setup_error');
      setIsSetupInProgress(false);
      return;
    }

    // Step 2: Discover leagues
    setState('setup_discovering');
    setDiagnosticStage('discovery');

    try {
      // Re-fetch token in case the JWT expired during sync
      const freshToken = await getToken();
      if (!isCurrentSetup()) return;
      if (!freshToken) {
        throw new ApiRequestError('Session expired', { code: 'session_expired' });
      }
      const result = await discoverLeagues(freshToken);
      if (!isCurrentSetup()) return;

      setDiscoveredLeagues(result.discovered);
      setDiscoveryCounts({
        currentSeason: result.currentSeason,
        pastSeasons: result.pastSeasons,
      });
      espnHistoryOwnerRef.current = userId;
      setEspnHistory(result.history ?? null);
      setEspnHistoryStatusNeedsRetry(false);
      try {
        await setEspnHistoryState(userId, result.history ?? null);
      } catch {
        // History is a local cache; the completed league result remains valid.
      }
      if (!isCurrentSetup()) return;

      const foundCurrentLeague = result.currentSeason.found > 0;
      const leagueConfirmed = foundCurrentLeague && hasPersistedCurrentLeague(result.currentSeason);
      setDiscoveryResult(leagueConfirmed ? 'confirmed' : foundCurrentLeague ? 'unknown' : 'none');
      setApiError(null);

      if (foundCurrentLeague && !leagueConfirmed) {
        setError('ESPN found a league, but Flaim could not confirm that it was saved. Your league result is unknown.');
        setState('setup_unknown');
        setIsSetupInProgress(false);
        return;
      }

      if (leagueConfirmed && initiatingUserId) {
        let reviewState = null;
        try {
          reviewState = await getReviewInvitationState(initiatingUserId);
        } catch {
          // The invitation is optional and must not change a completed result.
        }
        if (!isCurrentSetup()) return;
        if (!reviewState?.shown && !reviewState?.dismissed) {
          try {
            await setReviewInvitationState(initiatingUserId, { shown: true, dismissed: false });
          } catch {
            // A local preference failure must not turn a completed sync into an error.
          }
          if (!isCurrentSetup()) return;
          setShowReviewInvitation(true);
        }
      }

      // Complete setup
      setState('setup_complete');
      setIsSetupInProgress(false);
    } catch (err) {
      if (!isCurrentSetup()) return;
      const apiRequestError = requestError(err);
      setApiError(apiRequestError);
      setError(setupErrorMessage('discovery', apiRequestError));
      setDiscoveryResult(apiRequestError.timedOut ? 'unknown' : 'not_run');
      setState(apiRequestError.timedOut ? 'setup_unknown' : 'setup_error');
      setIsSetupInProgress(false);
    }
  };

  const refreshStatus = async () => {
    const refreshingUserId = userId;
    const refreshingGeneration = accountGenerationRef.current;
    const isCurrentRefresh = () =>
      popupActiveRef.current &&
      currentUserIdRef.current === refreshingUserId &&
      accountGenerationRef.current === refreshingGeneration;
    setIsRefreshing(true);
    setError(null);
    setDiagnosticStage('status');
    setApiError(null);

    if (!isLoaded || !isSignedIn) {
      setState('ready');
      setIsRefreshing(false);
      return;
    }

    let espnCreds: Awaited<ReturnType<typeof getEspnCredentials>>;
    try {
      espnCreds = await getEspnCredentials();
    } catch (err) {
      if (!isCurrentRefresh()) return;
      setHasEspnCookies(null);
      setApiError(requestError(err));
      setError('We could not check ESPN sign-in in this Chrome profile. Please try again.');
      setState('ready');
      setIsRefreshing(false);
      return;
    }
    if (!isCurrentRefresh()) return;
    if (!espnCreds || !validateCredentials(espnCreds)) {
      setHasEspnCookies(false);
      setState('no_espn');
      setIsRefreshing(false);
      return;
    }
    setHasEspnCookies(true);

    try {
      const token = await getToken();
      if (!isCurrentRefresh()) return;
      if (token) {
        const status = await checkStatus(token);
        if (!isCurrentRefresh()) return;
        setHasCredentials(status.hasCredentials);
        setLastSync(status.lastSync ?? null);
        const history = await getEspnHistoryStatus(token);
        if (!isCurrentRefresh()) return;
        espnHistoryOwnerRef.current = userId;
        setEspnHistory(history);
        setEspnHistoryStatusNeedsRetry(false);
        try {
          await setEspnHistoryState(userId, history);
        } catch {
          // History is a local cache; refresh can still report current status.
        }
        if (!isCurrentRefresh()) return;
      }
      setState('ready');
    } catch (err) {
      if (!isCurrentRefresh()) return;
      setHasCredentials(null);
      setApiError(requestError(err));
      setError('We could not check your Flaim connection. You can try again or sync now.');
      setState('ready');
    } finally {
      if (isCurrentRefresh()) setIsRefreshing(false);
    }
  };

  // Open Flaim website
  const openFlaim = async (path: string = '/') => {
    const baseUrl = await getSiteBase();
    chrome.tabs.create({ url: `${baseUrl}${path}` });
  };

  const openReview = () => {
    chrome.tabs.create({ url: CHROME_WEB_STORE_REVIEW_URL });
  };

  const dismissReviewInvitation = async () => {
    const dismissingUserId = userId;
    const dismissingGeneration = accountGenerationRef.current;
    try {
      await setReviewInvitationState(dismissingUserId, { shown: true, dismissed: true });
    } catch {
      // The optional invitation can close even if the local preference cannot persist.
    }
    if (
      popupActiveRef.current &&
      currentUserIdRef.current === dismissingUserId &&
      accountGenerationRef.current === dismissingGeneration
    ) {
      setShowReviewInvitation(false);
    }
  };

  const copySupportInfo = async () => {
    const copyingUserId = userId;
    const copyingGeneration = accountGenerationRef.current;
    const isCurrentCopy = () =>
      popupActiveRef.current &&
      currentUserIdRef.current === copyingUserId &&
      accountGenerationRef.current === copyingGeneration;
    try {
      await navigator.clipboard.writeText(supportInfo);
      if (!isCurrentCopy()) return;
      setSupportCopied(true);
      window.setTimeout(() => {
        if (isCurrentCopy()) setSupportCopied(false);
      }, 1500);
    } catch {
      if (!isCurrentCopy()) return;
      setError('Failed to copy support info');
    }
  };

  // Loading state while Clerk initializes
  if (!isLoaded) {
    return (
      <div className="popup">
        <div className="header">
          <img src="/assets/icons/icon-48.png" alt="" className="header-logo" />
        <h1>Flaim</h1>
        </div>
        <div className="main">
          <div className="content">
            <div className="message info" style={{ textAlign: 'center' }}>
              <span className="spinner"></span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isInSetupFlow = state.startsWith('setup_');

  return (
    <div className="popup">
      <div className="header">
        <img src="/assets/icons/icon-48.png" alt="" className="header-logo" />
        <h1>Flaim</h1>
        <SignedIn>
          <button
            className="icon-button"
            onClick={() => setShowDiagnostics((prev) => !prev)}
            aria-label={showDiagnostics ? 'Hide info' : 'Show info'}
            title={showDiagnostics ? 'Hide info' : 'Show info'}
            type="button"
          >
            ⓘ
          </button>
        </SignedIn>
      </div>

      {/* Signed Out: Prompt to sign in at flaim.app */}
      <SignedOut>
        <div className="main">
          <div className="content">
            <div className="message info">
              Sign in to Flaim to sync your ESPN credentials.
            </div>
            <button className="button primary full-width" onClick={() => openFlaim('/sign-in')}>
              Sign in at flaim.app
            </button>
          </div>
        </div>
        <div className="footer">
          <span className="link" onClick={() => openFlaim('/')}>
            Learn more about Flaim
          </span>
          <span className="footer-separator" aria-hidden="true">·</span>
          <button className="link-button" onClick={() => openFlaim(ESPN_SETUP_PATH)}>
            ESPN setup help
          </button>
        </div>
      </SignedOut>

      {/* Signed In: Show state-based content */}
      <SignedIn>
        <div className="main">
        <div className="user-row">
          {user?.imageUrl ? (
            <img className="user-avatar" src={user.imageUrl} alt={displayName || 'User'} />
          ) : (
            <div className="user-avatar" aria-hidden="true">
              {avatarInitial}
            </div>
          )}
          <div className="user-details">
            <div className="user-name">{displayName || 'Signed in'}</div>
            {primaryEmail && <div className="user-email">{primaryEmail}</div>}
          </div>
        </div>
        {showDiagnostics && (
          <div className="diagnostics">
            <div className="diag-row">
              <span className="diag-label">ESPN cookies</span>
              <span className="diag-value">{checkmark(hasEspnCookies)}</span>
            </div>
            <div className="diag-row">
              <span className="diag-label">Credentials</span>
              <span className="diag-value">{checkmark(hasCredentials)}</span>
            </div>
            <div className="diag-row">
              <span className="diag-label">Last sync</span>
              <span className="diag-value">{formatLastSync(lastSync)}</span>
            </div>
            <div className="diag-row">
              <span className="diag-label">Version</span>
              <span className="diag-value">{extensionVersion ?? 'Unknown'}</span>
            </div>
            <div className="diag-row">
              <span className="diag-label">User ID</span>
              <span className="diag-value mono">{userId ? `${userId.slice(0, 12)}…` : 'Unknown'}</span>
            </div>
            <button
              className="button secondary full-width"
              onClick={copySupportInfo}
            >
              {supportCopied ? 'Copied' : 'Copy support info'}
            </button>
            <div className="diagnostic-links">
              <button className="link-button" onClick={() => openFlaim(ESPN_SETUP_PATH)}>
                ESPN setup help
              </button>
              <button className="link-button" onClick={openReview}>
                Leave an honest review
              </button>
            </div>
          </div>
        )}

        {state === 'loading' && (
          <div className="content">
            <div className="message info" style={{ textAlign: 'center' }}>
              <span className="spinner"></span>
            </div>
          </div>
        )}

        {state === 'no_espn' && (
          <div className="content">
            {error && <div className="message error">{error}</div>}
            <div className="message warning">
              Sign in to ESPN Fantasy in this same Chrome profile, then return here to sync.
            </div>
            <button
              className="button primary full-width"
              onClick={() => chrome.tabs.create({ url: 'https://www.espn.com/fantasy/' })}
            >
              Open ESPN Fantasy
            </button>
            <button
              className="button secondary full-width"
              onClick={refreshStatus}
              disabled={isRefreshing}
            >
              {isRefreshing ? 'Refreshing...' : "I'm Logged In - Refresh"}
            </button>
            <button className="link-button" onClick={() => openFlaim(ESPN_SETUP_PATH)}>
              ESPN setup help
            </button>
          </div>
        )}

        {state === 'ready' && (
          <div className="content">
            {error && <div className="message error">{error}</div>}
            <div className="setup-progress">
              <div className="setup-step completed">
                <span className="step-icon check">✓</span>
                <span>Signed in to Flaim</span>
              </div>
              <div className={`setup-step ${hasEspnCookies ? 'completed' : 'pending'}`}>
                <span className={`step-icon${hasEspnCookies ? ' check' : ''}`}>{checkmark(hasEspnCookies)}</span>
                <span>
                  {hasEspnCookies === null
                    ? 'ESPN (checking…)'
                    : hasEspnCookies
                    ? 'ESPN detected'
                    : 'ESPN not detected'}
                </span>
              </div>
            </div>
            {hasCredentials === true ? (
              <div className="message success">Your ESPN credentials are synced!</div>
            ) : hasCredentials === null ? (
              <div className="message info">
                Flaim connection status is unknown. You can still sync ESPN access again.
              </div>
            ) : (
              <div className="message info">Ready to sync your ESPN credentials to Flaim.</div>
            )}
            {currentEspnHistory && <div className="message info">{getHistoryMessage(currentEspnHistory)}</div>}
            <button
              className="button primary full-width"
              onClick={handleFullSetup}
              disabled={isSetupInProgress}
            >
              {hasCredentials === true ? 'Re-sync & Discover New ESPN Leagues/Seasons' : 'Sync to Flaim'}
            </button>
            <button className="button secondary full-width" onClick={() => openFlaim('/leagues')}>
              Your Leagues
            </button>
          </div>
        )}

        {/* Setup Flow States */}
        {state === 'setup_syncing' && (
          <div className="content">
            <div className="setup-progress">
              <div className="setup-step active">
                <span className="step-icon spinner"></span>
                <span>Syncing credentials...</span>
              </div>
              <div className="setup-step pending">
                <span className="step-icon">○</span>
                <span>Discovering leagues</span>
              </div>
            </div>
            <div className="message info">Keep this popup open until your league result appears.</div>
          </div>
        )}

        {state === 'setup_discovering' && (
          <div className="content">
            <div className="setup-progress">
              <div className="setup-step completed">
                <span className="step-icon check">✓</span>
                <span>Credentials synced</span>
              </div>
              <div className="setup-step active">
                <span className="step-icon spinner"></span>
                <span>Discovering leagues...</span>
              </div>
            </div>
            <div className="message info">Keep this popup open until your league result appears.</div>
          </div>
        )}

        {state === 'setup_complete' && (
          <div className="content">
            {currentEspnHistory && <div className="message info">{getHistoryMessage(currentEspnHistory)}</div>}
            {discoveryCounts.currentSeason.found === 0 ? (
              <div className="message warning">
                No current-season ESPN leagues were found. Confirm this Chrome profile has the intended ESPN account and that the league opens in ESPN Fantasy, then try again.
              </div>
            ) : (
              <div className="message info">{getDiscoveryMessage(discoveryCounts)}</div>
            )}
            {discoveredLeagues.length > 0 && (
              <>
                <div className="league-list">
                  {discoveredLeagues.map((league) => (
                    <div
                      key={`${league.sport}-${league.leagueId}-${league.seasonYear}`}
                      className="league-item"
                    >
                      <SportIcon sport={league.sport} />
                      <div className="league-info">
                        <span className="league-name">{league.leagueName}</span>
                        <span className="team-name">Team: {league.teamName}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            <button className="button primary full-width" onClick={() => openFlaim('/leagues')}>
              Your Leagues
            </button>
            {showReviewInvitation && discoveryResult === 'confirmed' && (
              <button className="button secondary full-width" onClick={openReview}>
                Leave an honest review
              </button>
            )}
            {discoveryResult === 'none' && (
              <>
                <button className="button secondary full-width" onClick={handleFullSetup}>
                  Try Again
                </button>
                <button className="link-button" onClick={() => openFlaim(ESPN_SETUP_PATH)}>
                  ESPN setup help
                </button>
              </>
            )}
            <button
              className="button secondary full-width"
              onClick={() => {
                if (showReviewInvitation) void dismissReviewInvitation();
                setState('ready');
              }}
            >
              Done
            </button>
          </div>
        )}

        {state === 'setup_unknown' && (
          <div className="content">
            <div className="message warning">
              {error || 'ESPN access was saved, but the league check did not finish.'}
            </div>
            <div className="message info">
              Your league result is unknown. Check Your Leagues for any saved result, then retry when you are ready.
            </div>
            <button className="button primary full-width" onClick={() => openFlaim('/leagues')}>
              Your Leagues
            </button>
            <button className="button secondary full-width" onClick={handleFullSetup}>
              Try Again
            </button>
            <button className="link-button" onClick={() => openFlaim(ESPN_SETUP_PATH)}>
              ESPN setup help
            </button>
          </div>
        )}

        {state === 'setup_error' && (
          <div className="content">
            <div className="message error">{error || 'Setup failed'}</div>
            {apiError?.code === 'espn_auth_failed' && (
              <button
                className="button secondary full-width"
                onClick={() => chrome.tabs.create({ url: 'https://www.espn.com/fantasy/' })}
              >
                Open ESPN Fantasy
              </button>
            )}
            <button className="button primary full-width" onClick={handleFullSetup}>
              Try Again
            </button>
            <button className="link-button" onClick={() => openFlaim(ESPN_SETUP_PATH)}>
              ESPN setup help
            </button>
            <button
              className="button secondary full-width"
              onClick={() => {
                setState('ready');
              }}
            >
              Back
            </button>
          </div>
        )}

        </div>{/* end .main */}

        {/* Footer for signed-in users */}
        {!isInSetupFlow && (
          <div className="footer">
            <button
              className="button secondary"
              onClick={() => {
                setError(null);
                void clerk.signOut();
              }}
            >
              Sign Out
            </button>
          </div>
        )}
      </SignedIn>
    </div>
  );
}
