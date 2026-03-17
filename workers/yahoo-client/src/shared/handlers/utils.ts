import type { ExecuteResponse } from '../../types';
import { extractErrorCode } from '@flaim/worker-shared';

export function toExecuteErrorResponse(error: unknown): ExecuteResponse {
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error',
    code: extractErrorCode(error),
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

export function withLogLabel(baseLabel: string, suffix: string): string {
  return `${baseLabel}${suffix}`;
}
