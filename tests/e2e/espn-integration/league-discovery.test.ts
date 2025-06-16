/**
 * End-to-end tests for ESPN league discovery functionality
 * Tests the complete user flow from authentication to league discovery
 */

import { test, expect, Page } from '@playwright/test';

test.describe('ESPN League Discovery E2E', () => {
  let page: Page;
  const frontendUrl = process.env.TEST_FRONTEND_URL || 'http://localhost:3000';

  test.beforeEach(async ({ browser }) => {
    page = await browser.newPage();
    
    // Navigate to the application
    await page.goto(frontendUrl);
    
    // Wait for the page to load
    await page.waitForLoadState('networkidle');
  });

  test.afterEach(async () => {
    await page.close();
  });

  test('complete user journey: sign up → ESPN auth → league discovery', async () => {
    test.setTimeout(120000); // 2 minute timeout for complete flow
    
    // Step 1: Check if we need to sign up/sign in
    const signInButton = page.locator('button:has-text("Sign In"), button:has-text("Sign Up")').first();
    
    if (await signInButton.isVisible()) {
      // Navigate to sign up if not authenticated
      await signInButton.click();
      
      // Fill out registration form (if using email/password)
      const emailInput = page.locator('input[type="email"]').first();
      const passwordInput = page.locator('input[type="password"]').first();
      
      if (await emailInput.isVisible()) {
        await emailInput.fill(process.env.TEST_USER_EMAIL || 'test@example.com');
        await passwordInput.fill(process.env.TEST_USER_PASSWORD || 'testpassword123');
        
        await page.locator('button[type="submit"]').click();
      }
      
      // Wait for successful authentication
      await page.waitForSelector('[data-testid="user-menu"], [data-testid="authenticated-content"]', {
        timeout: 30000
      });
    }

    // Step 2: Navigate to ESPN authentication
    await page.locator('button:has-text("Configure ESPN"), [data-testid="espn-auth-button"]').click();
    
    // Wait for ESPN auth form to load
    await page.waitForSelector('input[placeholder*="SWID"], input[name="swid"]', {
      timeout: 10000
    });

    // Step 3: Enter ESPN credentials
    const testCredentials = {
      swid: process.env.TEST_ESPN_SWID || 'test_swid_12345',
      espn_s2: process.env.TEST_ESPN_S2 || 'test_s2_abcdefghijklmnop'
    };

    await page.fill('input[placeholder*="SWID"], input[name="swid"]', testCredentials.swid);
    await page.fill('input[placeholder*="espn_s2"], input[name="espn_s2"]', testCredentials.espn_s2);

    // Step 4: Save credentials and trigger discovery
    await page.locator('button:has-text("Save"), button:has-text("Connect")').click();

    // Step 5: Wait for league discovery to complete
    await expect(page.locator(':has-text("Discovering leagues"), :has-text("Auto-discovering")')).toBeVisible({
      timeout: 5000
    });

    // Step 6: Verify discovery results
    // Either successful discovery or graceful fallback
    await page.waitForSelector(
      ':has-text("Discovered"), :has-text("leagues found"), :has-text("Manual entry available")',
      { timeout: 30000 }
    );

    // Check for success indicators
    const successIndicators = [
      ':has-text("Successfully discovered")',
      ':has-text("leagues found")',
      ':has-text("Auto-discovery complete")'
    ];

    let discoverySuccessful = false;
    for (const selector of successIndicators) {
      if (await page.locator(selector).isVisible()) {
        discoverySuccessful = true;
        break;
      }
    }

    if (discoverySuccessful) {
      // Verify league information is displayed
      await expect(page.locator('[data-testid="discovered-leagues"], .league-list')).toBeVisible();
      
      // Check that league names/IDs are shown
      const leagueElements = page.locator('[data-testid="league-item"], .league-item');
      const leagueCount = await leagueElements.count();
      expect(leagueCount).toBeGreaterThan(0);
      
      console.log(`✅ Successfully discovered ${leagueCount} leagues`);
    } else {
      // Verify graceful fallback to manual entry
      await expect(page.locator(':has-text("Manual entry"), :has-text("manually enter")')).toBeVisible();
      console.log('✅ Graceful fallback to manual entry works');
    }

    // Step 7: Test AI chat with league context
    const chatInput = page.locator('textarea[placeholder*="Ask"], input[placeholder*="message"]').first();
    
    if (await chatInput.isVisible()) {
      await chatInput.fill('Tell me about my fantasy baseball leagues');
      await page.keyboard.press('Enter');
      
      // Wait for AI response
      await page.waitForSelector('.ai-response, [data-testid="ai-message"]', {
        timeout: 15000
      });
      
      console.log('✅ AI chat integration works with league context');
    }
  });

  test('handles ESPN authentication errors gracefully', async () => {
    // Navigate to ESPN auth
    await page.goto(`${frontendUrl}/auth/espn`);
    
    // Enter invalid credentials
    await page.fill('input[name="swid"]', 'invalid_swid');
    await page.fill('input[name="espn_s2"]', 'invalid_s2');
    
    await page.locator('button:has-text("Save"), button:has-text("Connect")').click();
    
    // Verify error handling
    await expect(page.locator(':has-text("Invalid credentials"), :has-text("Authentication failed")')).toBeVisible({
      timeout: 10000
    });
    
    // Verify user can retry
    await expect(page.locator('input[name="swid"]')).toBeEditable();
  });

  test('league discovery fallback to manual entry', async () => {
    // This test verifies that if auto-discovery fails, 
    // users can still manually enter league information
    
    // Navigate to league setup
    await page.goto(`${frontendUrl}/leagues`);
    
    // Look for manual entry option
    const manualEntryButton = page.locator('button:has-text("Manual Entry"), button:has-text("Add League")');
    await expect(manualEntryButton).toBeVisible();
    
    await manualEntryButton.click();
    
    // Fill manual league information
    await page.fill('input[name="leagueId"]', process.env.TEST_LEAGUE_ID || '123456');
    await page.fill('input[name="seasonId"]', process.env.TEST_SEASON_ID || '2024');
    
    await page.locator('button:has-text("Add League"), button[type="submit"]').click();
    
    // Verify league was added
    await expect(page.locator(`:has-text("${process.env.TEST_LEAGUE_ID || '123456'}")`)).toBeVisible();
  });

  test('multi-sport league discovery', async () => {
    // Test that discovery works across different sports
    
    // This test would require test credentials that have leagues in multiple sports
    // For now, we'll test the UI handles multi-sport results correctly
    
    await page.goto(`${frontendUrl}/leagues/discover`);
    
    // Mock successful multi-sport discovery response
    await page.route('**/discover-leagues', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            allLeagues: [
              {
                sport: 'baseball',
                leagueId: '123456',
                name: 'Test Baseball League',
                seasonId: '2024'
              },
              {
                sport: 'football',
                leagueId: '789012',
                name: 'Test Football League', 
                seasonId: '2024'
              }
            ],
            sportBreakdown: ['2 baseball leagues', '1 football league']
          }
        })
      });
    });
    
    // Trigger discovery
    await page.locator('button:has-text("Discover Leagues")').click();
    
    // Verify multi-sport results are displayed correctly
    await expect(page.locator(':has-text("baseball")')).toBeVisible();
    await expect(page.locator(':has-text("football")')).toBeVisible();
    await expect(page.locator(':has-text("Test Baseball League")')).toBeVisible();
    await expect(page.locator(':has-text("Test Football League")')).toBeVisible();
  });

  test('usage tracking during league discovery', async () => {
    // Test that league discovery operations are properly tracked in usage metrics
    
    await page.goto(frontendUrl);
    
    // Check initial usage
    const usagePanel = page.locator('[data-testid="usage-panel"], .usage-tracker');
    if (await usagePanel.isVisible()) {
      const initialUsage = await usagePanel.textContent();
      console.log('Initial usage:', initialUsage);
      
      // Perform league discovery
      await page.locator('button:has-text("Discover Leagues")').click();
      
      // Wait for operation to complete
      await page.waitForTimeout(2000);
      
      // Check if usage was properly tracked
      // Note: League discovery itself shouldn't count against AI message limits
      // but any AI interactions afterward should
      
      const finalUsage = await usagePanel.textContent();
      console.log('Final usage:', finalUsage);
      
      // League discovery should not consume AI message quota
      expect(finalUsage).toBe(initialUsage);
    }
  });
});