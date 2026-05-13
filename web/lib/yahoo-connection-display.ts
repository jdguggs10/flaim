import type {
  YahooPublicAccessTokenState,
  YahooPublicCredentialHealth,
  YahooPublicRefreshState,
} from '@flaim/worker-shared';
import { formatYahooRetryAfter } from './yahoo-auth-errors';

export type YahooDisplayState =
  | 'checking'
  | 'not_connected'
  | 'connected'
  | 'in_progress'
  | 'cooldown'
  | 'reconnect_needed';

export type YahooConnectionHealth = YahooPublicCredentialHealth;

const VALID_YAHOO_ACCESS_TOKEN_STATES = new Set<YahooPublicAccessTokenState>(['fresh', 'needs_refresh']);
const VALID_YAHOO_REFRESH_STATES = new Set<YahooPublicRefreshState>(['idle', 'in_progress', 'cooldown', 'expired']);

export function parseYahooConnectionHealth(value: unknown): YahooConnectionHealth | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const accessTokenState = record.accessTokenState;
  const refreshState = record.refreshState;
  if (
    typeof accessTokenState !== 'string' ||
    typeof refreshState !== 'string' ||
    !VALID_YAHOO_ACCESS_TOKEN_STATES.has(accessTokenState as YahooPublicAccessTokenState) ||
    !VALID_YAHOO_REFRESH_STATES.has(refreshState as YahooPublicRefreshState)
  ) {
    return null;
  }

  const retryAfterSeconds = typeof record.retryAfterSeconds === 'number' &&
    Number.isFinite(record.retryAfterSeconds) &&
    record.retryAfterSeconds > 0
    ? record.retryAfterSeconds
    : undefined;

  return {
    accessTokenState: accessTokenState as YahooPublicAccessTokenState,
    refreshState: refreshState as YahooPublicRefreshState,
    retryAfterSeconds,
  };
}

export function getYahooDisplayState(
  isChecking: boolean,
  isConnected: boolean,
  isReconnectNeeded: boolean,
  health: YahooConnectionHealth | null
): YahooDisplayState {
  if (isChecking) return 'checking';
  if (isReconnectNeeded) return 'reconnect_needed';
  if (!isConnected) return 'not_connected';
  if (health?.refreshState === 'cooldown') return 'cooldown';
  if (health?.refreshState === 'in_progress') return 'in_progress';
  // Idle and expired states are usable; expired only means a stale refresh lock.
  return 'connected';
}

export function getYahooBadgeCopy(state: YahooDisplayState): { label: string; className: string } {
  // Keep badge classes as literal strings so Tailwind includes them in production CSS.
  switch (state) {
    case 'checking':
      return { label: 'Checking...', className: 'bg-muted text-muted-foreground' };
    case 'connected':
      return { label: 'Connected', className: 'bg-success/20 text-success' };
    case 'cooldown':
      return { label: 'Temporarily unavailable', className: 'bg-warning/20 text-warning' };
    case 'in_progress':
      return { label: 'Syncing', className: 'bg-warning/20 text-warning' };
    case 'reconnect_needed':
      return { label: 'Reconnect needed', className: 'bg-destructive/10 text-destructive' };
    case 'not_connected':
    default:
      return { label: 'Not connected', className: 'bg-muted text-muted-foreground' };
  }
}

export function getYahooStatusCopy(state: YahooDisplayState, health: YahooConnectionHealth | null): string {
  const retryAfter = formatYahooRetryAfter(health?.retryAfterSeconds);

  switch (state) {
    case 'connected':
      return 'Sync leagues pulls your latest Yahoo leagues using your current Yahoo connection. Reconnect Yahoo opens Yahoo sign-in again to repair the connection if it stops working.';
    case 'cooldown':
      return `Yahoo is temporarily unavailable. ${retryAfter ? `Try syncing leagues again in ${retryAfter}.` : 'Try syncing leagues again in a few minutes.'} If this keeps happening, reconnect Yahoo.`;
    case 'in_progress':
      return `Yahoo is refreshing credentials from another request. ${retryAfter ? `Try syncing leagues again in ${retryAfter}.` : 'Try syncing leagues again shortly.'}`;
    case 'reconnect_needed':
      return 'Yahoo needs you to sign in again before Flaim can sync leagues.';
    case 'not_connected':
      return 'Connect your Yahoo account to add leagues.';
    case 'checking':
    default:
      return 'Checking Yahoo connection...';
  }
}
