import type { Env } from '../types';
import { authWorkerFetch } from '@flaim/worker-shared';

export interface YahooCredentials {
  accessToken: string;
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
  const response = await authWorkerFetch(env, '/connect/yahoo/credentials', {
    method: 'GET',
    headers
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(`Auth-worker error: ${errorData.error || response.statusText}`);
  }

  const data = await response.json() as { accessToken?: string };
  if (!data.accessToken) {
    throw new Error('Invalid credentials response from auth-worker');
  }

  return { accessToken: data.accessToken };
}
