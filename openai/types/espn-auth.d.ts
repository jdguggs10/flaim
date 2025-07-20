declare module '@flaim/auth/workers/espn/v3' {
  import type { GambitLeague } from '@flaim/auth/espn/types';
  export function discoverLeaguesV3Safe(swid: string, s2: string): Promise<{ success: boolean; leagues: GambitLeague[]; error?: string }>;
}
