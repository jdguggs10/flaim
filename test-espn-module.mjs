// test-espn-module.mjs
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Load environment variables
require('dotenv').config();

// Dynamically import the module
const { getLeagueInfo } = await import('./auth/espn/v3/get-league-info.js');

async function test() {
  const swid = process.env.ESPN_SWID;
  const s2 = process.env.ESPN_S2;
  const leagueId = process.env.ESPN_LEAGUE_ID || '123456';
  const season = process.env.ESPN_SEASON ? parseInt(process.env.ESPN_SEASON, 10) : 2025;

  if (!swid || !s2) {
    console.error('Error: ESPN_SWID and ESPN_S2 environment variables are required');
    process.exit(1);
  }

  console.log(`Fetching league info for league ${leagueId} (season ${season})...`);
  
  try {
    const result = await getLeagueInfo(swid, s2, leagueId, season);
    console.log('League Info:');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error('Error fetching league info:');
    if (error instanceof Error) {
      console.error(error.message);
      if (error.stack) {
        console.error(error.stack.split('\n').slice(1).join('\n'));
      }
    } else {
      console.error('Unknown error occurred');
    }
    process.exit(1);
  }
}

test().catch(console.error);
