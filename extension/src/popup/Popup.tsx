import { useEffect, useState } from 'react';
import { getToken, setToken, clearToken } from '../lib/storage';
import { getEspnCredentials, validateCredentials } from '../lib/espn';
import { exchangePairingCode, syncCredentials, checkStatus, getSiteBase } from '../lib/api';

type State =
  | 'loading'
  | 'not_paired'
  | 'entering_code'
  | 'paired_no_espn'
  | 'ready'
  | 'syncing'
  | 'success'
  | 'error';

export default function Popup() {
  const [state, setState] = useState<State>('loading');
  const [pairingCode, setPairingCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [hasCredentials, setHasCredentials] = useState(false);

  // Check initial state
  useEffect(() => {
    const init = async () => {
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
      const result = await exchangePairingCode(pairingCode);
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

  // Handle sync
  const handleSync = async () => {
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
    setState('syncing');

    try {
      await syncCredentials(token, espnCreds);
      setHasCredentials(true);
      setState('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
      setState('error');
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
            <button className="button success full-width" onClick={handleSync}>
              {hasCredentials ? 'Re-sync Credentials' : 'Sync to Flaim'}
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

      case 'success':
        return (
          <div className="content">
            <div className="message success">
              Credentials synced successfully! You can now add your leagues.
            </div>
            <button
              className="button primary full-width"
              onClick={() => openFlaim('/leagues')}
            >
              Go to Leagues
            </button>
            <button
              className="button secondary full-width"
              onClick={() => setState('ready')}
            >
              Done
            </button>
          </div>
        );

      case 'error':
        return (
          <div className="content">
            <div className="message error">{error || 'An error occurred'}</div>
            <button className="button primary full-width" onClick={handleSync}>
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

      default:
        return null;
    }
  };

  const isPaired = !['loading', 'not_paired', 'entering_code'].includes(state);

  return (
    <div className="popup">
      <div className="header">
        <h1>Flaim</h1>
        <span className={`status-badge ${isPaired ? 'connected' : 'disconnected'}`}>
          {isPaired ? 'Connected' : 'Not Connected'}
        </span>
      </div>

      {renderContent()}

      <div className="footer">
        {isPaired ? (
          <span className="link" onClick={handleDisconnect}>
            Disconnect Extension
          </span>
        ) : (
          <span className="link" onClick={() => openFlaim('/')}>
            Learn more about Flaim
          </span>
        )}
      </div>
    </div>
  );
}
