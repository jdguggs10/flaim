import type { Env } from '../types';
import {
  authWorkerFetch,
  parseRetryAfterSeconds,
  YahooAuthWorkerErrorCode,
} from '@flaim/worker-shared';
import { YahooClientError } from './errors';

export interface YahooCredentials {
  accessToken: string;
}

async function throwYahooAuthWorkerError(response: Response): Promise<never> {
  const errorData = await response.json().catch(() => ({})) as {
    error?: string;
    error_description?: string;
    retryable?: boolean;
    retry_after?: number;
    retry_after_source?: string;
    upstream_status?: number;
  };
  const headerRetryAfter = parseRetryAfterSeconds(response.headers.get('Retry-After'));
  const retryAfter = headerRetryAfter ?? (typeof errorData.retry_after === 'number' ? errorData.retry_after : undefined);
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
    errorData.error === YahooAuthWorkerErrorCode.REFRESH_TEMPORARILY_UNAVAILABLE;

  if (isTransientAuthFailure) {
    throw new YahooClientError({
      code: 'YAHOO_AUTH_UNAVAILABLE',
      message: errorDetail,
      status: response.status,
      upstreamStatus: errorData.upstream_status,
      retryable: true,
      retryAfter,
      retryAfterSource: errorData.retry_after_source,
    });
  }

  // Only auth-worker's genuine credential-rejection codes get reconnect
  // guidance. `refresh_failed` covers Yahoo's permanent OAuth refresh
  // failures (the invalid_grant family: an expired or revoked Yahoo grant),
  // and `app_fingerprint_mismatch` covers stored tokens minted by a
  // different Yahoo app -- both need the same fix. Anything else reaching
  // this branch (auth-worker's own `server_error` exceptions, an
  // internal-auth/config failure such as `unauthorized`, or an unrecognized
  // code) is not something a Yahoo reconnect can fix, so it gets a plain
  // "couldn't load, try later" message instead of false reconnect guidance.
  const isCredentialRejection =
    errorData.error === 'refresh_failed' ||
    errorData.error === YahooAuthWorkerErrorCode.APP_FINGERPRINT_MISMATCH;

  // error_description is free-form upstream text and must not be logged
  // (FLA-363); the error code alone is the diagnostic signal here.
  console.error(`[yahoo-auth] non-transient auth-worker failure: ${errorData.error || 'unknown_error'}`);

  throw new YahooClientError({
    code: 'YAHOO_AUTH_ERROR',
    message: isCredentialRejection
      ? 'Yahoo access for this account expired or was revoked. Ask the user to open https://flaim.app/leagues and click Reconnect Yahoo. Reconnecting the Flaim app in the AI client will not fix this.'
      : "Flaim couldn't load the Yahoo connection right now. Try again later.",
    status: response.status,
  });
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
