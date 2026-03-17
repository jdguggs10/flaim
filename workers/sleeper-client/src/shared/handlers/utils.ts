import type { ExecuteResponse } from '../../types';
import { extractErrorCode } from '@flaim/worker-shared';

export function toExecuteErrorResponse(error: unknown): ExecuteResponse {
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error',
    code: extractErrorCode(error),
  };
}
