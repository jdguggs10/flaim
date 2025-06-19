import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getLeagueInfo } from '../auth/espn/v3/get-league-info.js';

// Load environment variables from .env file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Get credentials from environment variables
const SWID = process.env.ESPN_SWID;
const ESPN_S2 = process.env.ESPN_S2;
const LEAGUE_ID = process.env.ESPN_LEAGUE_ID || '123456';
const SEASON = process.env.ESPN_SEASON ? parseInt(process.env.ESPN_SEASON, 10) : 2025;

async function testGetLeagueInfo() {
  if (!SWID || !ESPN_S2) {
    console.error('Error: ESPN_SWID and ESPN_S2 environment variables are required');
    console.log('Usage: ESPN_SWID=your_swid ESPN_S2=your_s2 [ESPN_LEAGUE_ID=123456] [ESPN_SEASON=2025] ts-node scripts/test-espn-league-info.ts');
    process.exit(1);
  }

  console.log(`Fetching league info for league ${LEAGUE_ID} (season ${SEASON})...`);
  
  try {
    const result = await getLeagueInfo(SWID, ESPN_S2, LEAGUE_ID, SEASON);
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

testGetLeagueInfo();
