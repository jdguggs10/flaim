/**
 * League Discovery MCP Tool
 * 
 * Note: This tool is deprecated in favor of the new manual league entry flow.
 * ESPN credentials and league data are now stored via the onboarding API.
 */

import { Env } from '../index.js';

export async function discoverUserLeagues(
  _args: { clerkUserId?: string },
  _env: Env
) {
  return {
    success: false,
    error: 'League discovery has been moved to the onboarding flow. Please use the manual league entry in the frontend.',
    deprecated: true,
    migration: 'Use the new onboarding flow to enter league IDs and sports manually'
  };
}