import type { HandlerFn } from './types';
import { getYahooCredentials, resolveUserTeamKey } from '../auth';
import { yahooFetch, handleYahooError, requireCredentials } from '../yahoo-api';
import { buildYahooPendingTransactionsPath, buildYahooTransactionsPath, clampYahooTransactionCount, normalizeYahooTransactions } from '../yahoo-transactions';
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
        await handleYahooError(response);
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

      const filtered = parsed
        .filter((txn) => Number.isFinite(txn.timestamp) && txn.timestamp > 0)
        .filter((txn) => isPending || txn.timestamp >= cutoff)
        .filter((txn) => !type || txn.type === type);
      const normalized = filtered.slice(0, maxCount);

      // Yahoo's fetch is count-bound: buildYahooTransactionsPath/buildYahooPendingTransactionsPath
      // bake a clamped count into the request URL, so we can never fetch more
      // rows than requested. The general (non-pending) path also applies no
      // server-side type filter, so a full upstream page can hide additional
      // matching rows the client-side type filter never saw -- UNLESS the
      // page's own timestamps prove it already reached past the window start.
      // Yahoo returns rows newest-first, so if the oldest valid-timestamp row
      // in the page is older than cutoff, every row inside the 14-day window
      // was necessarily fetched (rows with invalid timestamps are already
      // dropped via dropped_invalid_timestamp_count and don't affect this --
      // a valid row past the cutoff still proves the boundary was crossed).
      // Without this check, any league with >= requestedUpstreamCount lifetime
      // transactions but a quiet fortnight would report possibly_truncated on
      // every call even though window coverage is complete. The pending path
      // has no cutoff/window concept, so this exception never applies there:
      // a full page always means more may exist upstream.
      const requestedUpstreamCount = clampYahooTransactionCount(count || 25);
      const validTimestamps = parsed
        .map((txn) => txn.timestamp)
        .filter((timestamp) => Number.isFinite(timestamp) && timestamp > 0);
      const oldestValidTimestamp = validTimestamps.length > 0 ? Math.min(...validTimestamps) : undefined;
      const pageCoveredWholeWindow =
        !isPending && oldestValidTimestamp !== undefined && oldestValidTimestamp < cutoff;
      const fullUpstreamPage = parsed.length >= requestedUpstreamCount && !pageCoveredWholeWindow;
      const possiblyTruncated = filtered.length > maxCount || fullUpstreamPage;

      const warnings: string[] = [];
      if (week !== undefined) {
        warnings.push('Explicit week filtering is not supported for Yahoo transactions; Yahoo always uses a recent timestamp window and ignored week.');
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
            returned_rows: normalized.length,
          },
          warning: warnings.length > 0 ? warnings.join(' ') : undefined,
          dropped_invalid_timestamp_count: invalidTimestampCount,
          count: normalized.length,
          transactions: normalized,
          ...(possiblyTruncated ? { limitations: { possibly_truncated: true } } : {}),
        },
      };
    } catch (error) {
      return toExecuteErrorResponse(error);
    }
  };
}
