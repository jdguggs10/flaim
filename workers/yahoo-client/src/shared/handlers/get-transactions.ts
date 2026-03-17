import type { HandlerFn } from './types';
import { getYahooCredentials, resolveUserTeamKey } from '../auth';
import { yahooFetch, handleYahooError, requireCredentials } from '../yahoo-api';
import { buildYahooPendingTransactionsPath, buildYahooTransactionsPath, normalizeYahooTransactions } from '../yahoo-transactions';
import { ErrorCode } from '@flaim/worker-shared';
import { toExecuteErrorResponse } from './utils';

export function createGetTransactionsHandler(): HandlerFn {
  return async (env, params, authHeader, correlationId) => {
    const { league_id, count, type, week } = params;
    const isPending = type === 'waiver' || type === 'pending_trade';

    try {
      const credentials = await getYahooCredentials(env, authHeader, correlationId);
      requireCredentials(credentials, 'get_transactions');

      let path: string;
      if (isPending) {
        const teamKey = await resolveUserTeamKey(env, league_id, authHeader, correlationId);
        if (!teamKey) {
          return {
            success: false,
            error: 'Team key not found for this league. Reconnect Yahoo in settings.',
            code: ErrorCode.TEAM_KEY_MISSING,
          };
        }
        path = buildYahooPendingTransactionsPath(league_id, teamKey, [type], count || 25);
      } else {
        path = buildYahooTransactionsPath(league_id, count || 25);
      }

      const response = await yahooFetch(path, { credentials });
      if (!response.ok) {
        handleYahooError(response);
      }

      const raw = await response.json();

      const cid = correlationId || 'no-cid';
      const maxCount = count ?? 25;
      const now = Date.now();
      const cutoff = now - (14 * 24 * 60 * 60 * 1000);
      const parsed = normalizeYahooTransactions(raw);
      const invalidTimestampCount = parsed.filter((txn) => !Number.isFinite(txn.timestamp) || txn.timestamp <= 0).length;
      if (invalidTimestampCount > 0) {
        console.warn(
          `[yahoo-client] ${cid} get_transactions excluded ${invalidTimestampCount} rows with missing/invalid timestamp`,
        );
      }

      const normalized = parsed
        .filter((txn) => Number.isFinite(txn.timestamp) && txn.timestamp > 0)
        .filter((txn) => isPending || txn.timestamp >= cutoff)
        .filter((txn) => !type || txn.type === type)
        .slice(0, maxCount);

      const warnings: string[] = [];
      if (week !== undefined) {
        warnings.push('Explicit week filtering is not supported for Yahoo transactions in v1; Yahoo always uses a recent timestamp window and ignored week.');
      }
      if (invalidTimestampCount > 0) {
        warnings.push(`${invalidTimestampCount} transaction(s) were excluded because Yahoo did not provide a valid timestamp.`);
      }

      return {
        success: true,
        data: {
          platform: 'yahoo',
          sport: params.sport,
          league_id,
          season_year: params.season_year,
          window: {
            mode: isPending ? 'pending' : 'recent_two_weeks_timestamp',
            weeks: [],
            start_timestamp_ms: isPending ? undefined : cutoff,
            end_timestamp_ms: isPending ? undefined : now,
          },
          warning: warnings.length > 0 ? warnings.join(' ') : undefined,
          dropped_invalid_timestamp_count: invalidTimestampCount,
          count: normalized.length,
          transactions: normalized,
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
