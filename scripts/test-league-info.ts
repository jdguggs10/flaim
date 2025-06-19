// Test script for get-league-info using tsx
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function runTest() {
  // Import the function inside an async function to avoid top-level await
  const { getLeagueInfo } = await import('../auth/espn/v3/get-league-info.js');
  
  const swid = process.env.ESPN_SWID;
  const s2 = process.env.ESPN_S2;
  const leagueId = process.env.ESPN_LEAGUE_ID || '123456';
  const season = process.env.ESPN_SEASON ? parseInt(process.env.ESPN_SEASON, 10) : 2025;

  if (!swid || !s2) {
    console.error('Error: ESPN_SWID and ESPN_S2 environment variables are required');
    console.error('Please set them in your .env file');
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

// Run the test
runTest().catch(error => {
  console.error('Unhandled error in test:');
  console.error(error);
  process.exit(1);
});
