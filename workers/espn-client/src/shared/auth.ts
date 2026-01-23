// workers/espn-client/src/shared/auth.ts
import type { Env } from '../types';
import { authWorkerFetch, type EspnCredentials } from '@flaim/worker-shared';

export async function getCredentials(
  env: Env,
  authHeader?: string,
  correlationId?: string
): Promise<EspnCredentials | null> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (authHeader) {
    headers['Authorization'] = authHeader;
  }
  if (correlationId) {
    headers['X-Correlation-ID'] = correlationId;
  }

  const response = await authWorkerFetch(env, '/credentials/espn?raw=true', {
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

  const data = await response.json() as { success?: boolean; credentials?: EspnCredentials };
  if (!data.success || !data.credentials) {
    throw new Error('Invalid credentials response from auth-worker');
  }

  return data.credentials;
}
