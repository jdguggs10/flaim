import type { Env } from '../types';
import { authWorkerFetch, YahooAuthWorkerErrorCode } from '@flaim/worker-shared';

export interface YahooCredentials {
  accessToken: string;
}

async function throwYahooAuthWorkerError(response: Response): Promise<never> {
  const errorData = await response.json().catch(() => ({})) as {
    error?: string;
    error_description?: string;
    retryable?: boolean;
  };
  const errorSummary = errorData.error || response.statusText;
  const errorDetail = errorData.error_description
    ? `${errorSummary}: ${errorData.error_description}`
    : errorSummary;
  // retryable is the durable contract; status and known codes keep older worker responses classified correctly.
  // TOKEN_EXCHANGE_UNAVAILABLE is an OAuth redirect code, not an internal credentials API response.
  const isTransientAuthFailure =
    response.status === 429 ||
    response.status === 503 ||
    errorData.retryable === true ||
    errorData.error === YahooAuthWorkerErrorCode.REFRESH_TEMPORARILY_UNAVAILABLE ||
    errorData.error === YahooAuthWorkerErrorCode.TOKEN_REFRESH_VALIDATION_UNAVAILABLE;

  if (isTransientAuthFailure) {
    throw new Error(`YAHOO_AUTH_UNAVAILABLE: ${errorDetail}`);
  }

  throw new Error(`YAHOO_AUTH_ERROR: ${errorDetail}`);
}

export async function getYahooCredentials(
  env: Env,
  authHeader?: string,
  correlationId?: string
): Promise<YahooCredentials | null> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (authHeader) {
    headers['Authorization'] = authHeader;
  }
  if (correlationId) {
    headers['X-Correlation-ID'] = correlationId;
  }

  // Call auth-worker to get Yahoo token (handles refresh automatically)
  const response = await authWorkerFetch(env, '/internal/connect/yahoo/credentials', {
    method: 'GET',
    headers
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    await throwYahooAuthWorkerError(response);
  }

  // auth-worker returns snake_case, we normalize to camelCase
  const data = await response.json() as { access_token?: string };
  if (!data.access_token) {
    throw new Error('Invalid credentials response from auth-worker');
  }

  return { accessToken: data.access_token };
}

interface YahooLeagueEntry {
  leagueKey: string;
  teamKey?: string;
}

export async function resolveUserTeamKey(
  env: Env,
  leagueKey: string,
  authHeader?: string,
  correlationId?: string,
): Promise<string | null> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authHeader) headers['Authorization'] = authHeader;
  if (correlationId) headers['X-Correlation-ID'] = correlationId;

  const response = await authWorkerFetch(env, '/internal/leagues/yahoo', {
    method: 'GET',
    headers,
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    await throwYahooAuthWorkerError(response);
  }

  const data = (await response.json()) as { leagues?: YahooLeagueEntry[] };
  const league = data.leagues?.find((l) => l.leagueKey === leagueKey);
  return league?.teamKey ?? null;
}
