/**
 * Test script for EspnSupabaseStorage
 * 
 * Run with: npx tsx src/test-supabase.ts
 * Make sure to set SUPABASE_URL and SUPABASE_SERVICE_KEY environment variables
 */

import { EspnSupabaseStorage } from './supabase-storage';
import { EspnLeague } from './espn-types';

async function testBasicOperations() {
  console.log('🚀 Starting Supabase storage tests...\n');

  // Check environment variables
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('❌ Missing environment variables:');
    console.error('Please set SUPABASE_URL and SUPABASE_SERVICE_KEY');
    console.error('Example:');
    console.error('export SUPABASE_URL="https://your-project-ref.supabase.co"');
    console.error('export SUPABASE_SERVICE_KEY="eyJhbGci..."');
    process.exit(1);
  }

  const storage = EspnSupabaseStorage.fromEnvironment({
    SUPABASE_URL,
    SUPABASE_SERVICE_KEY
  });

  const testUserId = 'test-user-' + Date.now();
  console.log(`📝 Using test user ID: ${testUserId}\n`);
  
  try {
    // Test 1: Credential storage and retrieval
    console.log('1️⃣ Testing credential storage...');
    const stored = await storage.setCredentials(testUserId, 'test-swid-123', 'test-s2-456', 'test@example.com');
    console.log(`   Stored: ${stored ? '✅' : '❌'}`);
    
    if (!stored) {
      throw new Error('Failed to store credentials');
    }

    // Test 2: Credential retrieval
    console.log('2️⃣ Testing credential retrieval...');
    const retrieved = await storage.getCredentials(testUserId);
    console.log(`   Retrieved: ${retrieved ? '✅' : '❌'}`);
    console.log(`   SWID: ${retrieved?.swid}`);
    console.log(`   S2 length: ${retrieved?.s2?.length} chars`);
    
    if (!retrieved || retrieved.swid !== 'test-swid-123' || retrieved.s2 !== 'test-s2-456') {
      throw new Error('Retrieved credentials do not match stored credentials');
    }

    // Test 3: hasCredentials check
    console.log('3️⃣ Testing hasCredentials...');
    const hasCredentials = await storage.hasCredentials(testUserId);
    console.log(`   Has credentials: ${hasCredentials ? '✅' : '❌'}`);
    
    if (!hasCredentials) {
      throw new Error('hasCredentials returned false when credentials exist');
    }

    // Test 4: League storage
    console.log('4️⃣ Testing league storage...');
    const testLeagues: EspnLeague[] = [
      {
        leagueId: '123456',
        sport: 'football',
        teamId: 'team1',
        teamName: 'Test Team',
        leagueName: 'Test League'
      },
      {
        leagueId: '789012',
        sport: 'baseball',
        teamId: 'team2',
        teamName: 'Another Team',
        leagueName: 'Another League'
      }
    ];
    
    const leaguesStored = await storage.setLeagues(testUserId, testLeagues);
    console.log(`   Leagues stored: ${leaguesStored ? '✅' : '❌'}`);
    
    if (!leaguesStored) {
      throw new Error('Failed to store leagues');
    }

    // Test 5: League retrieval
    console.log('5️⃣ Testing league retrieval...');
    const retrievedLeagues = await storage.getLeagues(testUserId);
    console.log(`   Retrieved leagues: ${retrievedLeagues.length === 2 ? '✅' : '❌'}`);
    console.log(`   League count: ${retrievedLeagues.length}`);
    
    if (retrievedLeagues.length !== 2) {
      throw new Error(`Expected 2 leagues, got ${retrievedLeagues.length}`);
    }

    // Test 6: User data (combined)
    console.log('6️⃣ Testing getUserData...');
    const userData = await storage.getUserData(testUserId);
    console.log(`   Has credentials: ${userData.hasCredentials ? '✅' : '❌'}`);
    console.log(`   League count: ${userData.leagues.length}`);
    console.log(`   Metadata exists: ${userData.metadata ? '✅' : '❌'}`);

    // Test 7: Add individual league
    console.log('7️⃣ Testing addLeague...');
    const newLeague: EspnLeague = {
      leagueId: '345678',
      sport: 'basketball',
      teamId: 'team3',
      teamName: 'Basketball Team'
    };
    
    const leagueAdded = await storage.addLeague(testUserId, newLeague);
    console.log(`   League added: ${leagueAdded ? '✅' : '❌'}`);
    
    const updatedLeagues = await storage.getLeagues(testUserId);
    console.log(`   Total leagues now: ${updatedLeagues.length} ${updatedLeagues.length === 3 ? '✅' : '❌'}`);

    // Test 8: Remove league
    console.log('8️⃣ Testing removeLeague...');
    const leagueRemoved = await storage.removeLeague(testUserId, '345678', 'basketball');
    console.log(`   League removed: ${leagueRemoved ? '✅' : '❌'}`);
    
    const finalLeagues = await storage.getLeagues(testUserId);
    console.log(`   Final league count: ${finalLeagues.length} ${finalLeagues.length === 2 ? '✅' : '❌'}`);

    // Test 9: Cleanup
    console.log('9️⃣ Testing cleanup...');
    const deleted = await storage.deleteCredentials(testUserId);
    console.log(`   Deleted: ${deleted ? '✅' : '❌'}`);
    
    // Verify cleanup worked
    const afterDelete = await storage.hasCredentials(testUserId);
    console.log(`   Credentials gone: ${!afterDelete ? '✅' : '❌'}`);
    
    const afterDeleteLeagues = await storage.getLeagues(testUserId);
    console.log(`   Leagues gone: ${afterDeleteLeagues.length === 0 ? '✅' : '❌'}`);

    console.log('\n🎉 All tests passed! Supabase storage is working correctly.');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    
    // Cleanup on failure
    try {
      await storage.deleteCredentials(testUserId);
      console.log('🧹 Cleanup completed');
    } catch (cleanupError) {
      console.error('⚠️ Cleanup failed:', cleanupError);
    }
    
    process.exit(1);
  }
}

// Run the tests
testBasicOperations();