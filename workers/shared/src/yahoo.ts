export type YahooPublicAccessTokenState = 'fresh' | 'needs_refresh';
export type YahooPublicRefreshState = 'idle' | 'in_progress' | 'cooldown' | 'expired';

export interface YahooPublicCredentialHealth {
  accessTokenState: YahooPublicAccessTokenState;
  refreshState: YahooPublicRefreshState;
  retryAfterSeconds?: number;
}
