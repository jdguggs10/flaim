/**
 * Extension Popup - Clerk Auth Version
 * ---------------------------------------------------------------------------
 * Main popup component using Clerk Sync Host for authentication.
 * Session syncs automatically from flaim.app when user is signed in there.
 */

import { useEffect, useMemo, useState } from 'react';
import { useAuth, useClerk, useUser, SignedIn, SignedOut } from '@clerk/chrome-extension';
import {
  getSetupState,
  setSetupState,
  clearSetupState,
  type SeasonCounts,
} from '../lib/storage';
import { getEspnCredentials, validateCredentials } from '../lib/espn';
import {
  syncCredentials,
  checkStatus,
  getSiteBase,
  discoverLeagues,
  type DiscoveredLeague,
} from '../lib/api';

// Simplified state machine
type State =
  | 'loading'
  | 'no_espn'
  | 'ready'
  | 'setup_syncing'
  | 'setup_discovering'
  | 'setup_complete'
  | 'setup_error';

// Sport to emoji mapping
const sportEmoji: Record<string, string> = {
  football: '🏈',
  baseball: '⚾',
  basketball: '🏀',
  hockey: '🏒',
};

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

export default function Popup() {
  // Clerk auth hooks
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const clerk = useClerk();
  const { user } = useUser();

  const primaryEmail =
    user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress ?? null;
  const displayName = user?.fullName ?? user?.username ?? null;
  const avatarInitial = (primaryEmail || displayName || '?').charAt(0).toUpperCase();

  // Local state
  const [state, setState] = useState<State>('loading');
  const [error, setError] = useState<string | null>(null);
  const [hasCredentials, setHasCredentials] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSetupInProgress, setIsSetupInProgress] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [supportCopied, setSupportCopied] = useState(false);
  const [hasEspnCookies, setHasEspnCookies] = useState<boolean | null>(null);
  const [extensionVersion, setExtensionVersion] = useState<string | null>(null);

  const userId = user?.id ?? null;

  const supportInfo = useMemo(() => {
    const parts = [
      `userId=${userId ?? 'unknown'}`,
      `email=${primaryEmail ?? 'unknown'}`,
      `version=${extensionVersion ?? 'unknown'}`,
      `lastSync=${lastSync ?? 'unknown'}`,
      `siteBase=auto`,
    ];
    return parts.join(' | ');
  }, [userId, primaryEmail, extensionVersion, lastSync]);

  // Setup flow state
  const [discoveredLeagues, setDiscoveredLeagues] = useState<DiscoveredLeague[]>([]);
  const [discoveryCounts, setDiscoveryCounts] = useState<DiscoveryCounts>({
    currentSeason: { found: 0, added: 0, alreadySaved: 0 },
    pastSeasons: { found: 0, added: 0, alreadySaved: 0 },
  });

  // Initialize on Clerk load
  useEffect(() => {
    if (!isLoaded) return;

    const init = async () => {
      // Check for saved setup state (popup close recovery)
      const savedSetup = await getSetupState();

      try {
        const info = await chrome.management.getSelf();
        setExtensionVersion(info.version);
      } catch {
        setExtensionVersion(null);
      }

      if (savedSetup?.step === 'complete') {
        await clearSetupState();
      } else if (savedSetup?.step === 'error') {
        setError(savedSetup.error || 'Setup failed');
        setState('setup_error');
        return;
      } else if (savedSetup?.step === 'syncing' || savedSetup?.step === 'discovering') {
        await clearSetupState();
      }

      // If not signed in, we'll show the signed-out UI via SignedOut component
      if (!isSignedIn) {
        setError(null);
        setState('ready'); // Will be overridden by SignedOut component
        return;
      }

      // Check ESPN cookies
      const espnCreds = await getEspnCredentials();
      if (!espnCreds || !validateCredentials(espnCreds)) {
        setHasEspnCookies(false);
        setState('no_espn');
        return;
      }
      setHasEspnCookies(true);

      // Check status with server using Clerk token
      try {
        const token = await getToken();
        if (token) {
          const status = await checkStatus(token);
          setHasCredentials(status.hasCredentials);
          setLastSync(status.lastSync ?? null);
        }
        setState('ready');
      } catch {
        // Token might be invalid - still show ready state
        setState('ready');
      }
    };

    init();
  }, [isLoaded, isSignedIn, getToken]);

  // Handle full setup flow (sync + discover)
  const handleFullSetup = async () => {
    if (isSetupInProgress || !isLoaded || !isSignedIn) return;

    const token = await getToken();
    if (!token) {
      setError('Not signed in. Please sign in at flaim.app first.');
      return;
    }

    const espnCreds = await getEspnCredentials();
    if (!espnCreds || !validateCredentials(espnCreds)) {
      setState('no_espn');
      return;
    }

    setError(null);
    setIsSetupInProgress(true);

    // Step 1: Sync credentials
    setState('setup_syncing');
    await setSetupState({ step: 'syncing' });

    try {
      await syncCredentials(token, espnCreds);
      setHasCredentials(true);
      setLastSync(new Date().toISOString());
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to sync credentials';
      setError(errorMsg);
      setState('setup_error');
      await setSetupState({ step: 'error', error: errorMsg });
      setIsSetupInProgress(false);
      return;
    }

    // Step 2: Discover leagues
    setState('setup_discovering');
    await setSetupState({ step: 'discovering' });

    try {
      const result = await discoverLeagues(token);

      setDiscoveredLeagues(result.discovered);
      setDiscoveryCounts({
        currentSeason: result.currentSeason,
        pastSeasons: result.pastSeasons,
      });

      // Complete setup
      setState('setup_complete');
      await clearSetupState();
      setIsSetupInProgress(false);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Discovery failed';
      setError(errorMsg);
      setState('setup_error');
      await setSetupState({ step: 'error', error: errorMsg });
      setIsSetupInProgress(false);
    }
  };

  const refreshStatus = async () => {
    setIsRefreshing(true);
    setError(null);

    if (!isLoaded || !isSignedIn) {
      setState('ready');
      setIsRefreshing(false);
      return;
    }

    const espnCreds = await getEspnCredentials();
    if (!espnCreds || !validateCredentials(espnCreds)) {
      setHasEspnCookies(false);
      setState('no_espn');
      setIsRefreshing(false);
      return;
    }
    setHasEspnCookies(true);

    try {
      const token = await getToken();
      if (token) {
        const status = await checkStatus(token);
        setHasCredentials(status.hasCredentials);
        setLastSync(status.lastSync ?? null);
      }
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach Flaim');
      setState('ready');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Open Flaim website
  const openFlaim = async (path: string = '/') => {
    const baseUrl = await getSiteBase();
    chrome.tabs.create({ url: `${baseUrl}${path}` });
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
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(supportInfo);
                  setSupportCopied(true);
                  setTimeout(() => setSupportCopied(false), 1500);
                } catch {
                  setError('Failed to copy support info');
                }
              }}
            >
              {supportCopied ? 'Copied' : 'Copy support info'}
            </button>
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
              Please log into ESPN.com first, then come back here to sync your credentials.
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
            {hasCredentials ? (
              <div className="message success">Your ESPN credentials are synced!</div>
            ) : (
              <div className="message info">Ready to sync your ESPN credentials to Flaim.</div>
            )}
            <button
              className="button primary full-width"
              onClick={handleFullSetup}
              disabled={isSetupInProgress}
            >
              {hasCredentials ? 'Re-sync & Discover New ESPN Leagues/Seasons' : 'Sync to Flaim'}
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
          </div>
        )}

        {state === 'setup_complete' && (
          <div className="content">
            {discoveredLeagues.length > 0 && (
              <>
                <div className="message info">
                  {getDiscoveryMessage(discoveryCounts)}
                </div>
                <div className="league-list">
                  {discoveredLeagues.map((league, i) => (
                    <div key={i} className="league-item">
                      <span className="sport-emoji">{sportEmoji[league.sport] || '🏆'}</span>
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
            <button
              className="button secondary full-width"
              onClick={async () => {
                await clearSetupState();
                setState('ready');
              }}
            >
              Done
            </button>
          </div>
        )}

        {state === 'setup_error' && (
          <div className="content">
            <div className="message error">{error || 'Setup failed'}</div>
            <button className="button primary full-width" onClick={handleFullSetup}>
              Try Again
            </button>
            <button
              className="button secondary full-width"
              onClick={async () => {
                await clearSetupState();
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
