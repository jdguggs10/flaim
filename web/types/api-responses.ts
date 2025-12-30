/**
 * API Response Type Definitions
 * Reusable DTO interfaces for JSON response casting
 */

export interface BaseApiResponse {
  success?: boolean;
  error?: string | { message?: string };
}

export interface EspnCredentialsResponse extends BaseApiResponse {
  hasCredentials?: boolean;
}

export interface McpDataResponse extends BaseApiResponse {
  data?: {
    leagueName?: string;
    seasonYear?: number;
    standings?: any[];
    teams?: any[];
    allLeagues?: any[];
    totalLeagues?: number;
    baseballLeagues?: any[];
    footballLeagues?: any[];
  };
}

export interface StorageApiResponse extends BaseApiResponse {
  totalLeagues?: number;
  [key: string]: any;
}

export interface PlatformCredentialsRequest {
  platform?: string;
  credentials?: Record<string, any>;
}

export interface OnboardingStatusRequest {
  step?: string;
  isComplete?: boolean;
}

export interface TurnResponseRequest {
  messages?: any[];
  tools?: any[];
}

export interface UsageActionRequest {
  action?: string;
}

export interface VectorStoreRequest {
  name?: string;
  vectorStoreId?: string;
  fileId?: string;
  fileObject?: any;
}