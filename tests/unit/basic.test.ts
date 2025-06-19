/**
 * Basic unit tests for FLAIM core functionality
 */

describe('FLAIM Basic Tests', () => {
  describe('Environment Setup', () => {
    it('should be running in test environment', () => {
      expect(process.env.NODE_ENV).toBe('test');
    });

    it('should have access to test utilities', () => {
      expect(global.testUtils).toBeDefined();
      expect(typeof global.testUtils.generateTestUserId).toBe('function');
    });
  });

  describe('Utility Functions', () => {
    it('should generate unique test user IDs', () => {
      const id1 = global.testUtils.generateTestUserId();
      const id2 = global.testUtils.generateTestUserId();
      
      expect(id1).toMatch(/^test_user_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^test_user_\d+_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    it('should generate test credentials with correct format', () => {
      const creds = global.testUtils.generateTestCredentials();
      
      expect(creds).toHaveProperty('swid');
      expect(creds).toHaveProperty('espn_s2');
      expect(creds).toHaveProperty('email');
      expect(creds.email).toMatch(/^test\d+@example\.com$/);
    });

    it('should provide wait utility', async () => {
      const start = Date.now();
      await global.testUtils.wait(100);
      const elapsed = Date.now() - start;
      
      expect(elapsed).toBeGreaterThanOrEqual(95); // Allow some timing variance
    });
  });

  describe('Mock Fetch', () => {
    it('should create working mock fetch', () => {
      const mockFetch = global.testUtils.createMockFetch([
        {
          url: /\/api\/test/,
          response: { success: true, data: 'test' }
        }
      ]);

      expect(typeof mockFetch).toBe('function');
      expect(jest.isMockFunction(mockFetch)).toBe(true);
    });
  });
});