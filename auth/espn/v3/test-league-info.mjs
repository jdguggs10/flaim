// Simple test script using ES modules
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { getLeagueInfo } from './get-league-info.js';

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

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
    console.error(error.message);
    if (error.stack) {
      console.error(error.stack.split('\n').slice(1).join('\n'));
    }
    process.exit(1);
  }
}

test().catch(console.error);
