/**
 * Extension Popup - Clerk Auth Version
 * ---------------------------------------------------------------------------
 * Main popup component using Clerk Sync Host for authentication.
 * Session syncs automatically from flaim.app when user is signed in there.
 */

import { useEffect, useState } from 'react';
import { useAuth, useClerk, SignedIn, SignedOut } from '@clerk/chrome-extension';
import {
  getSetupState,
  setSetupState,
  clearSetupState,
  type LeagueOption,
  type SeasonCounts,
} from '../lib/storage';
import { getEspnCredentials, validateCredentials } from '../lib/espn';
import {
  syncCredentials,
  checkStatus,
  getSiteBase,
  discoverLeagues,
  setDefaultLeague,
  type DiscoveredLeague,
} from '../lib/api';

// Simplified state machine (removed pairing states)
type State =
  | 'loading'
  | 'no_espn'
  | 'ready'
  | 'setup_syncing'
  | 'setup_discovering'
  | 'setup_selecting_default'
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

// Helper function to generate completion summary
function getCompletionSummary(counts: DiscoveryCounts): string {
  const { currentSeason: cs, pastSeasons: ps } = counts;
  const newItems = cs.added + ps.added;

  if (newItems === 0) {
    return 'Everything already saved!';
  }

  const parts: string[] = [];
  if (cs.added > 0) parts.push(`${cs.added} new league${cs.added !== 1 ? 's' : ''}`);
  if (ps.added > 0) parts.push(`${ps.added} new past season${ps.added !== 1 ? 's' : ''}`);

  return parts.join(' + ') + ' added';
}

export default function Popup() {
  // Clerk auth hooks
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const clerk = useClerk();

  // Local state
  const [state, setState] = useState<State>('loading');
  const [error, setError] = useState<string | null>(null);
  const [hasCredentials, setHasCredentials] = useState(false);

  // Setup flow state
  const [discoveredLeagues, setDiscoveredLeagues] = useState<DiscoveredLeague[]>([]);
  const [currentSeasonLeagues, setCurrentSeasonLeagues] = useState<LeagueOption[]>([]);
  const [selectedDefault, setSelectedDefault] = useState<string>('');
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

      if (savedSetup?.step === 'complete') {
        await clearSetupState();
      } else if (savedSetup?.step === 'selecting_default') {
        // Restore selecting_default state
        if (savedSetup.currentSeasonLeagues && savedSetup.currentSeasonLeagues.length > 0) {
          setDiscoveredLeagues(
            savedSetup.discovered?.map((d) => ({
              ...d,
              leagueId: '',
              teamId: '',
              seasonYear: 0,
            })) || []
          );
          setCurrentSeasonLeagues(savedSetup.currentSeasonLeagues);

          if (savedSetup.currentSeason && savedSetup.pastSeasons) {
            setDiscoveryCounts({
              currentSeason: savedSetup.currentSeason,
              pastSeasons: savedSetup.pastSeasons,
            });
          }

          const leagues = savedSetup.currentSeasonLeagues;
          const defaultLeague = leagues.find((l) => l.isDefault);
          const preselected = defaultLeague || leagues[0];
          setSelectedDefault(
            `${preselected.sport}|${preselected.leagueId}|${preselected.seasonYear}`
          );

          setState('setup_selecting_default');
          return;
        }
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
        setState('no_espn');
        return;
      }

      // Check status with server using Clerk token
      try {
        const token = await getToken();
        if (token) {
          const status = await checkStatus(token);
          setHasCredentials(status.hasCredentials);
        }
        setState('ready');
      } catch {
        // Token might be invalid - still show ready state
        setState('ready');
      }
    };

    init();
  }, [isLoaded, isSignedIn, getToken]);

  // Handle full setup flow (sync + discover + select default)
  const handleFullSetup = async () => {
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

    // Step 1: Sync credentials
    setState('setup_syncing');
    await setSetupState({ step: 'syncing' });

    try {
      await syncCredentials(token, espnCreds);
      setHasCredentials(true);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to sync credentials';
      setError(errorMsg);
      setState('setup_error');
      await setSetupState({ step: 'error', error: errorMsg });
      return;
    }

    // Step 2: Discover leagues
    setState('setup_discovering');
    await setSetupState({ step: 'discovering' });

    try {
      const result = await discoverLeagues(token);

      setDiscoveredLeagues(result.discovered);
      setCurrentSeasonLeagues(result.currentSeasonLeagues);
      setDiscoveryCounts({
        currentSeason: result.currentSeason,
        pastSeasons: result.pastSeasons,
      });

      // If no current season leagues, complete setup
      if (result.currentSeasonLeagues.length === 0) {
        setState('setup_complete');
        await clearSetupState();
        return;
      }

      // Check if user already has a default league
      const existingDefault = result.currentSeasonLeagues.find((l) => l.isDefault);

      // If user has existing default AND no new leagues, skip selection
      if (existingDefault && result.currentSeason.added === 0) {
        setSelectedDefault(
          `${existingDefault.sport}|${existingDefault.leagueId}|${existingDefault.seasonYear}`
        );
        setState('setup_complete');
        await clearSetupState();
        return;
      }

      // Pre-select first league or existing default
      const firstLeague = result.currentSeasonLeagues[0];
      const preselected = existingDefault || firstLeague;
      setSelectedDefault(`${preselected.sport}|${preselected.leagueId}|${preselected.seasonYear}`);

      // Step 3: Select default
      setState('setup_selecting_default');
      await setSetupState({
        step: 'selecting_default',
        discovered: result.discovered.map((d) => ({
          sport: d.sport,
          leagueName: d.leagueName,
          teamName: d.teamName,
        })),
        currentSeasonLeagues: result.currentSeasonLeagues,
        currentSeason: result.currentSeason,
        pastSeasons: result.pastSeasons,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Discovery failed';
      setError(errorMsg);
      setState('setup_error');
      await setSetupState({ step: 'error', error: errorMsg });
    }
  };

  // Handle finishing setup (setting default)
  const handleFinishSetup = async () => {
    if (!selectedDefault) {
      setError('Please select a default league');
      return;
    }

    const token = await getToken();
    if (!token) {
      setError('Not signed in');
      return;
    }

    const [sport, leagueId, seasonYearStr] = selectedDefault.split('|');
    const seasonYear = parseInt(seasonYearStr, 10);

    try {
      await setDefaultLeague(token, { sport, leagueId, seasonYear });
      setState('setup_complete');
      await setSetupState({ step: 'complete' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set default');
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
          <h1>Flaim</h1>
          <span className="status-badge disconnected">Loading</span>
        </div>
        <div className="content">
          <div className="message info" style={{ textAlign: 'center' }}>
            <span className="spinner"></span>
          </div>
        </div>
      </div>
    );
  }

  const isInSetupFlow = state.startsWith('setup_');

  return (
    <div className="popup">
      <div className="header">
        <h1>Flaim</h1>
        <SignedIn>
          <span className="status-badge connected">
            {isInSetupFlow ? 'Setting Up' : 'Connected'}
          </span>
        </SignedIn>
        <SignedOut>
          <span className="status-badge disconnected">Not Signed In</span>
        </SignedOut>
      </div>

      {/* Signed Out: Prompt to sign in at flaim.app */}
      <SignedOut>
        <div className="content">
          <div className="message info">
            Sign in to Flaim to sync your ESPN credentials.
          </div>
          <button className="button primary full-width" onClick={() => openFlaim('/sign-in')}>
            Sign in at flaim.app
          </button>
          <button className="button secondary full-width" onClick={() => openFlaim('/')}>
            Learn More
          </button>
        </div>
        <div className="footer">
          <span className="link" onClick={() => openFlaim('/')}>
            Learn more about Flaim
          </span>
        </div>
      </SignedOut>

      {/* Signed In: Show state-based content */}
      <SignedIn>
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
              onClick={async () => {
                const espnCreds = await getEspnCredentials();
                if (espnCreds && validateCredentials(espnCreds)) {
                  setState('ready');
                } else {
                  setError("ESPN cookies not found. Make sure you're logged into espn.com");
                }
              }}
            >
              I'm Logged In - Refresh
            </button>
          </div>
        )}

        {state === 'ready' && (
          <div className="content">
            {error && <div className="message error">{error}</div>}
            {hasCredentials ? (
              <div className="message success">Your ESPN credentials are synced!</div>
            ) : (
              <div className="message info">Ready to sync your ESPN credentials to Flaim.</div>
            )}
            <button className="button success full-width" onClick={handleFullSetup}>
              {hasCredentials ? 'Re-sync & Discover Leagues' : 'Sync to Flaim'}
            </button>
            <button className="button secondary full-width" onClick={() => openFlaim('/leagues')}>
              Go to Leagues
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
              <div className="setup-step pending">
                <span className="step-icon">○</span>
                <span>Select default</span>
              </div>
            </div>
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: '20%' }}></div>
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
              <div className="setup-step pending">
                <span className="step-icon">○</span>
                <span>Select default</span>
              </div>
            </div>
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: '50%' }}></div>
            </div>
          </div>
        )}

        {state === 'setup_selecting_default' && (
          <div className="content">
            {error && <div className="message error">{error}</div>}
            {hasCredentials && (
              <div className="message info" style={{ marginBottom: 8 }}>
                ESPN credentials synced
              </div>
            )}
            <div className="message success">{getDiscoveryMessage(discoveryCounts)}</div>

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

            <div className="input-group">
              <label htmlFor="default-league">Select your default league:</label>
              <select
                id="default-league"
                value={selectedDefault}
                onChange={(e) => setSelectedDefault(e.target.value)}
              >
                {currentSeasonLeagues.map((league) => (
                  <option
                    key={`${league.sport}|${league.leagueId}|${league.seasonYear}`}
                    value={`${league.sport}|${league.leagueId}|${league.seasonYear}`}
                  >
                    {sportEmoji[league.sport] || '🏆'} {league.leagueName} ({league.seasonYear})
                  </option>
                ))}
              </select>
            </div>

            <button className="button primary full-width" onClick={handleFinishSetup}>
              Finish Setup
            </button>
          </div>
        )}

        {state === 'setup_complete' && (
          <div className="content">
            <div className="message success">You're all set!</div>

            {selectedDefault && currentSeasonLeagues.length > 0 && (
              <>
                {(() => {
                  const selectedLeague = currentSeasonLeagues.find(
                    (l) => `${l.sport}|${l.leagueId}|${l.seasonYear}` === selectedDefault
                  );
                  return selectedLeague ? (
                    <div className="league-item default-league">
                      <span className="sport-emoji">
                        {sportEmoji[selectedLeague.sport] || '🏆'}
                      </span>
                      <div className="league-info">
                        <span className="league-name">{selectedLeague.leagueName}</span>
                        <span className="team-name">
                          {selectedLeague.teamName} ({selectedLeague.seasonYear})
                        </span>
                      </div>
                    </div>
                  ) : null;
                })()}
              </>
            )}

            <div className="setup-summary">{getCompletionSummary(discoveryCounts)}</div>

            <button className="button primary full-width" onClick={() => openFlaim('/leagues')}>
              View Leagues
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

        {/* Footer for signed-in users */}
        {!isInSetupFlow && (
          <div className="footer">
            <span
              className="link"
              onClick={() => {
                setError(null);
                void clerk.signOut();
              }}
            >
              Sign Out
            </span>
          </div>
        )}
      </SignedIn>
    </div>
  );
}
