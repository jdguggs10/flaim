import { useEffect, useState } from 'react';
import {
  getToken,
  setToken,
  clearToken,
  getSetupState,
  setSetupState,
  clearSetupState,
  type LeagueOption,
  type SeasonCounts
} from '../lib/storage';
import { getEspnCredentials, validateCredentials } from '../lib/espn';
import {
  exchangePairingCode,
  syncCredentials,
  checkStatus,
  getSiteBase,
  discoverLeagues,
  setDefaultLeague,
  type DiscoveredLeague
} from '../lib/api';
import { getDeviceLabel } from '../lib/device';

type State =
  | 'loading'
  | 'not_paired'
  | 'entering_code'
  | 'paired_no_espn'
  | 'ready'
  | 'syncing'
  | 'success'
  | 'error'
  // New setup flow states
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
  hockey: '🏒'
};

// Discovery counts for granular messaging
interface DiscoveryCounts {
  currentSeason: SeasonCounts;
  pastSeasons: SeasonCounts;
}

// Helper function to generate discovery message
function getDiscoveryMessage(counts: DiscoveryCounts): string {
  const { currentSeason: cs, pastSeasons: ps } = counts;

  // No leagues found at all
  if (cs.found === 0) {
    return 'No active leagues found for this season.';
  }

  const parts: string[] = [];

  // Current season leagues
  if (cs.added > 0 && cs.alreadySaved === 0) {
    // All new
    parts.push(`Found ${cs.found} league${cs.found !== 1 ? 's' : ''}`);
  } else if (cs.added === 0 && cs.alreadySaved > 0) {
    // All already saved
    parts.push(`${cs.found} league${cs.found !== 1 ? 's' : ''} already saved`);
  } else if (cs.added > 0 && cs.alreadySaved > 0) {
    // Mixed
    parts.push(`Found ${cs.found} league${cs.found !== 1 ? 's' : ''} (${cs.added} new, ${cs.alreadySaved} saved)`);
  } else if (cs.found > 0) {
    // Fallback: leagues found but all failed to save (DB error)
    parts.push(`Found ${cs.found} league${cs.found !== 1 ? 's' : ''} (save failed)`);
  }

  // Past seasons (only show if any found)
  if (ps.found > 0) {
    if (ps.added > 0 && ps.alreadySaved === 0) {
      // All new
      parts.push(`${ps.found} past season${ps.found !== 1 ? 's' : ''}`);
    } else if (ps.added === 0 && ps.alreadySaved > 0) {
      // All already saved
      parts.push(`${ps.found} past season${ps.found !== 1 ? 's' : ''} already saved`);
    } else if (ps.added > 0) {
      // Some new
      parts.push(`${ps.found} past season${ps.found !== 1 ? 's' : ''} (${ps.added} new)`);
    } else {
      // Fallback: past seasons found but all failed to save
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
  const [state, setState] = useState<State>('loading');
  const [pairingCode, setPairingCode] = useState('');
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

  // Check initial state
  useEffect(() => {
    const init = async () => {
      // Check for saved setup state first (popup close recovery)
      const savedSetup = await getSetupState();

      if (savedSetup?.step === 'complete') {
        // User finished setup - go to normal ready state
        await clearSetupState();
      } else if (savedSetup?.step === 'selecting_default') {
        // User was selecting default - restore that state
        const token = await getToken();
        if (token && savedSetup.currentSeasonLeagues && savedSetup.currentSeasonLeagues.length > 0) {
          setDiscoveredLeagues(savedSetup.discovered?.map(d => ({
            ...d,
            leagueId: '',
            teamId: '',
            seasonYear: 0
          })) || []);
          setCurrentSeasonLeagues(savedSetup.currentSeasonLeagues);

          // Restore counts - handle both new and legacy formats
          if (savedSetup.currentSeason && savedSetup.pastSeasons) {
            setDiscoveryCounts({
              currentSeason: savedSetup.currentSeason,
              pastSeasons: savedSetup.pastSeasons,
            });
          } else {
            // Legacy migration from v1.1
            setDiscoveryCounts({
              currentSeason: {
                found: (savedSetup.added || 0) + (savedSetup.skipped || 0),
                added: savedSetup.added || 0,
                alreadySaved: savedSetup.skipped || 0,
              },
              pastSeasons: {
                found: savedSetup.historical || 0,
                added: savedSetup.historical || 0,
                alreadySaved: 0,
              },
            });
          }

          // Preselect default: prefer existing default, else first league
          const leagues = savedSetup.currentSeasonLeagues;
          const defaultLeague = leagues.find(l => l.isDefault);
          const preselected = defaultLeague || leagues[0];
          setSelectedDefault(`${preselected.sport}|${preselected.leagueId}|${preselected.seasonYear}`);

          setState('setup_selecting_default');
          return;
        }
      } else if (savedSetup?.step === 'error') {
        setError(savedSetup.error || 'Setup failed');
        setState('setup_error');
        return;
      } else if (savedSetup?.step === 'syncing' || savedSetup?.step === 'discovering') {
        // Process was interrupted - clear and restart
        await clearSetupState();
      }

      const token = await getToken();

      if (!token) {
        setState('not_paired');
        return;
      }

      // Check if ESPN cookies are available
      const espnCreds = await getEspnCredentials();
      if (!espnCreds || !validateCredentials(espnCreds)) {
        setState('paired_no_espn');
        return;
      }

      // Check status with server
      try {
        const status = await checkStatus(token);
        setHasCredentials(status.hasCredentials);
        setState('ready');
      } catch {
        // Token might be invalid/revoked
        await clearToken();
        setState('not_paired');
      }
    };

    init();
  }, []);

  // Handle pairing
  const handlePair = async () => {
    if (pairingCode.length !== 6) {
      setError('Please enter a 6-character code');
      return;
    }

    setError(null);
    setState('loading');

    try {
      const deviceName = await getDeviceLabel();
      const result = await exchangePairingCode(pairingCode, deviceName);
      await setToken(result.token);

      // Check for ESPN credentials
      const espnCreds = await getEspnCredentials();
      if (!espnCreds || !validateCredentials(espnCreds)) {
        setState('paired_no_espn');
      } else {
        setState('ready');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to pair');
      setState('entering_code');
    }
  };

  // Handle full setup flow (sync + discover + select default)
  const handleFullSetup = async () => {
    const token = await getToken();
    if (!token) {
      setState('not_paired');
      return;
    }

    const espnCreds = await getEspnCredentials();
    if (!espnCreds || !validateCredentials(espnCreds)) {
      setState('paired_no_espn');
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

      // Store results
      setDiscoveredLeagues(result.discovered);
      setCurrentSeasonLeagues(result.currentSeasonLeagues);
      setDiscoveryCounts({
        currentSeason: result.currentSeason,
        pastSeasons: result.pastSeasons,
      });

      // If no current season leagues, go to "no leagues" state
      if (result.currentSeasonLeagues.length === 0) {
        setState('success');
        await clearSetupState();
        return;
      }

      // Check if user already has a default league
      const existingDefault = result.currentSeasonLeagues.find(l => l.isDefault);

      // If user has an existing default AND no new leagues were added, skip selection
      if (existingDefault && result.currentSeason.added === 0) {
        setSelectedDefault(`${existingDefault.sport}|${existingDefault.leagueId}|${existingDefault.seasonYear}`);
        setState('setup_complete');
        await clearSetupState();
        return;
      }

      // Pre-select the first league (or the one already marked as default)
      const firstLeague = result.currentSeasonLeagues[0];
      const preselected = existingDefault || firstLeague;
      setSelectedDefault(`${preselected.sport}|${preselected.leagueId}|${preselected.seasonYear}`);

      // Step 3: Select default
      setState('setup_selecting_default');
      await setSetupState({
        step: 'selecting_default',
        discovered: result.discovered.map(d => ({
          sport: d.sport,
          leagueName: d.leagueName,
          teamName: d.teamName
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
      setState('not_paired');
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
      // Stay on selecting_default so user can retry
    }
  };

  // Handle disconnect
  const handleDisconnect = async () => {
    await clearToken();
    setState('not_paired');
    setPairingCode('');
    setError(null);
  };

  // Open Flaim website
  const openFlaim = async (path: string = '/extension') => {
    const baseUrl = await getSiteBase();
    chrome.tabs.create({ url: `${baseUrl}${path}` });
  };

  // Render based on state
  const renderContent = () => {
    switch (state) {
      case 'loading':
        return (
          <div className="content">
            <div className="message info" style={{ textAlign: 'center' }}>
              <span className="spinner"></span>
              <span style={{ marginLeft: 8 }}>Loading...</span>
            </div>
          </div>
        );

      case 'not_paired':
        return (
          <div className="content">
            <div className="message info">
              Connect this extension to your Flaim account to automatically sync your ESPN credentials.
            </div>
            <button
              className="button primary full-width"
              onClick={() => setState('entering_code')}
            >
              Enter Pairing Code
            </button>
            <button
              className="button secondary full-width"
              onClick={() => openFlaim('/extension')}
            >
              Get Pairing Code
            </button>
          </div>
        );

      case 'entering_code':
        return (
          <div className="content">
            {error && <div className="message error">{error}</div>}
            <div className="input-group">
              <label htmlFor="code">Pairing Code</label>
              <input
                id="code"
                type="text"
                maxLength={6}
                placeholder="A3F8K2"
                value={pairingCode}
                onChange={(e) => setPairingCode(e.target.value.toUpperCase())}
                autoFocus
              />
            </div>
            <button
              className="button primary full-width"
              onClick={handlePair}
              disabled={pairingCode.length !== 6}
            >
              Connect
            </button>
            <button
              className="button secondary full-width"
              onClick={() => openFlaim('/extension')}
            >
              Get New Code
            </button>
          </div>
        );

      case 'paired_no_espn':
        return (
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
                  setError('ESPN cookies not found. Make sure you\'re logged into espn.com');
                }
              }}
            >
              I'm Logged In - Refresh
            </button>
          </div>
        );

      case 'ready':
        return (
          <div className="content">
            {hasCredentials ? (
              <div className="message success">
                Your ESPN credentials are synced!
              </div>
            ) : (
              <div className="message info">
                Ready to sync your ESPN credentials to Flaim.
              </div>
            )}
            <button className="button success full-width" onClick={handleFullSetup}>
              {hasCredentials ? 'Re-sync & Discover Leagues' : 'Sync to Flaim'}
            </button>
            <button
              className="button secondary full-width"
              onClick={() => openFlaim('/leagues')}
            >
              Go to Leagues
            </button>
          </div>
        );

      case 'syncing':
        return (
          <div className="content">
            <div className="message info" style={{ textAlign: 'center' }}>
              <span className="spinner"></span>
              <span style={{ marginLeft: 8 }}>Syncing credentials...</span>
            </div>
          </div>
        );

      case 'success': {
        const noLeaguesFound =
          discoveredLeagues.length === 0 && currentSeasonLeagues.length === 0;

        return (
          <div className="content">
            <div className="message success">
              {noLeaguesFound
                ? 'No active leagues found for this season. You can add leagues manually.'
                : 'Credentials synced successfully! You can now add your leagues.'}
            </div>
            <button
              className="button primary full-width"
              onClick={() => openFlaim('/leagues')}
            >
              {noLeaguesFound ? 'Add Leagues' : 'Go to Leagues'}
            </button>
            <button
              className="button secondary full-width"
              onClick={() => setState('ready')}
            >
              Done
            </button>
          </div>
        );
      }

      case 'error':
        return (
          <div className="content">
            <div className="message error">{error || 'An error occurred'}</div>
            <button className="button primary full-width" onClick={handleFullSetup}>
              Try Again
            </button>
            <button
              className="button secondary full-width"
              onClick={() => setState('ready')}
            >
              Back
            </button>
          </div>
        );

      // =========== SETUP FLOW STATES ===========

      case 'setup_syncing':
        return (
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
        );

      case 'setup_discovering':
        return (
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
        );

      case 'setup_selecting_default':
        return (
          <div className="content">
            {error && <div className="message error">{error}</div>}
            {hasCredentials && (
              <div className="message info" style={{ marginBottom: 8 }}>
                ESPN credentials synced
              </div>
            )}
            <div className="message success">
              {getDiscoveryMessage(discoveryCounts)}
            </div>

            {/* Show discovered leagues (what ESPN returned this run) */}
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

            {/* Dropdown uses currentSeasonLeagues (all saved, for default selection) */}
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
        );

      case 'setup_complete': {
        const selectedLeague = currentSeasonLeagues.find(l =>
          `${l.sport}|${l.leagueId}|${l.seasonYear}` === selectedDefault
        );
        return (
          <div className="content">
            <div className="message success">
              You're all set!
            </div>

            {selectedLeague && (
              <div className="league-item default-league">
                <span className="sport-emoji">{sportEmoji[selectedLeague.sport] || '🏆'}</span>
                <div className="league-info">
                  <span className="league-name">{selectedLeague.leagueName}</span>
                  <span className="team-name">{selectedLeague.teamName} ({selectedLeague.seasonYear})</span>
                </div>
              </div>
            )}

            <div className="setup-summary">
              {getCompletionSummary(discoveryCounts)}
            </div>

            <button
              className="button primary full-width"
              onClick={() => openFlaim('/leagues')}
            >
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
        );
      }

      case 'setup_error':
        return (
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
        );

      default:
        return null;
    }
  };

  const isPaired = !['loading', 'not_paired', 'entering_code'].includes(state);
  const isInSetupFlow = state.startsWith('setup_');

  return (
    <div className="popup">
      <div className="header">
        <h1>Flaim</h1>
        <span className={`status-badge ${isPaired ? 'connected' : 'disconnected'}`}>
          {isInSetupFlow ? 'Setting Up' : isPaired ? 'Connected' : 'Not Connected'}
        </span>
      </div>

      {renderContent()}

      <div className="footer">
        {isPaired && !isInSetupFlow ? (
          <span className="link" onClick={handleDisconnect}>
            Disconnect Extension
          </span>
        ) : !isInSetupFlow ? (
          <span className="link" onClick={() => openFlaim('/')}>
            Learn more about Flaim
          </span>
        ) : null}
      </div>
    </div>
  );
}
