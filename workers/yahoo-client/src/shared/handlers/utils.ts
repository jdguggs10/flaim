import type { ExecuteResponse } from '../../types';
import { extractErrorCode } from '@flaim/worker-shared';
import { asArray, parseYahooPercentOwned } from '../normalizers';
import { defaultMetadataForYahooCode, isYahooClientError } from '../errors';

export function toExecuteErrorResponse(error: unknown): ExecuteResponse {
  const code = extractErrorCode(error);
  const metadata = isYahooClientError(error) ? error : defaultMetadataForYahooCode(code);

  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error',
    code,
    status: metadata.status,
    upstream_status: isYahooClientError(error) ? error.upstreamStatus : undefined,
    retryable: metadata.retryable,
    retry_after: metadata.retryAfter,
    retry_after_source: isYahooClientError(error) ? error.retryAfterSource : undefined,
  };
}

export function extractPlayerMeta(playerData: unknown[]): Record<string, unknown> {
  const metaArray = playerData?.[0] as unknown[];
  let playerMeta: Record<string, unknown> = {};
  if (Array.isArray(metaArray)) {
    for (const item of metaArray) {
      if (typeof item === 'object' && item !== null) {
        playerMeta = { ...playerMeta, ...item };
      }
    }
  }
  return playerMeta;
}

export function extractPlayerPercentOwned(playerData: unknown[]): number | null {
  const ownershipData = playerData?.[1] as Record<string, unknown> | undefined;
  const ownership = ownershipData?.ownership as Record<string, unknown> | undefined;
  return parseYahooPercentOwned(ownership?.percent_owned);
}

/**
 * Extract the primary manager name from a Yahoo team metadata object.
 * After unwrapTeam merges metadata, team.managers may be:
 * - A native array: [{ manager: { nickname: "..." } }]
 * - A Yahoo numeric-keyed object: { "0": { manager: { nickname: "..." } }, count: 1 }
 * We use asArray() to normalize both forms.
 */
export function extractManagerName(team: Record<string, unknown>): string | undefined {
  const raw = team.managers;
  if (!raw || typeof raw !== 'object') return undefined;

  const managersArray = asArray(raw as Record<string, unknown>);
  if (managersArray.length === 0) return undefined;

  const firstWrapper = managersArray[0] as Record<string, unknown> | undefined;
  const manager = firstWrapper?.manager as Record<string, unknown> | undefined;
  return (manager?.nickname as string) || undefined;
}
