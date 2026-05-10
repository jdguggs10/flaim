import {
  YAHOO_DEFAULT_RATE_LIMIT_RETRY_AFTER_SECONDS,
  YAHOO_DEFAULT_TRANSIENT_RETRY_AFTER_SECONDS,
} from '@flaim/worker-shared';

export interface YahooClientErrorOptions {
  code: string;
  message: string;
  status?: number;
  retryable?: boolean;
  retryAfter?: number;
}

export class YahooClientError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly retryable?: boolean;
  readonly retryAfter?: number;

  constructor(options: YahooClientErrorOptions) {
    super(`${options.code}: ${options.message}`);
    this.name = 'YahooClientError';
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable;
    this.retryAfter = options.retryAfter;
  }
}

export function isYahooClientError(error: unknown): error is YahooClientError {
  return error instanceof YahooClientError;
}

export function defaultMetadataForYahooCode(code?: string): Pick<YahooClientErrorOptions, 'status' | 'retryable' | 'retryAfter'> {
  switch (code) {
    case 'YAHOO_AUTH_UNAVAILABLE':
    case 'YAHOO_TIMEOUT':
      return { status: 503, retryable: true, retryAfter: YAHOO_DEFAULT_TRANSIENT_RETRY_AFTER_SECONDS };
    case 'YAHOO_RATE_LIMITED':
      return { status: 429, retryable: true, retryAfter: YAHOO_DEFAULT_RATE_LIMIT_RETRY_AFTER_SECONDS };
    case 'YAHOO_NOT_CONNECTED':
    case 'YAHOO_AUTH_ERROR':
      return { status: 401 };
    case 'YAHOO_ACCESS_DENIED':
      return { status: 403 };
    case 'YAHOO_NOT_FOUND':
      return { status: 404 };
    case 'YAHOO_API_ERROR':
      return { status: 502 };
    default:
      return {};
  }
}
