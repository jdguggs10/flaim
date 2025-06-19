/**
 * Jest setup file for FLAIM test suite
 * Configures test environment, mocks, and global utilities
 */

// Global test timeout (15 seconds)
jest.setTimeout(15000);

// Mock console methods in tests to reduce noise
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

beforeEach(() => {
  // Reset mocks between tests
  jest.clearAllMocks();
  
  // Suppress console.error/warn unless specifically testing error conditions
  if (!process.env.JEST_VERBOSE) {
    console.error = jest.fn();
    console.warn = jest.fn();
  }
});

afterEach(() => {
  // Restore console methods
  if (!process.env.JEST_VERBOSE) {
    console.error = originalConsoleError;
    console.warn = originalConsoleWarn;
  }
});

// Global test utilities
(global as any).testUtils = {
  // Generate test user ID
  generateTestUserId: () => `test_user_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
  
  // Generate test credentials
  generateTestCredentials: () => ({
    swid: `test_swid_${Math.random().toString(36).slice(2, 18)}`,
    espn_s2: `test_s2_${Math.random().toString(36).slice(2, 34)}`,
    email: `test${Date.now()}@example.com`
  }),
  
  // Wait utility for async operations
  wait: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
  
  // Test environment check
  isTestEnvironment: () => process.env.NODE_ENV === 'test',
  
  // Mock fetch for API calls
  createMockFetch: (responses: Array<{ url: RegExp; response: any }>) => {
    return jest.fn().mockImplementation((url: string) => {
      const match = responses.find(r => r.url.test(url));
      if (match) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(match.response),
          text: () => Promise.resolve(JSON.stringify(match.response))
        });
      }
      return Promise.reject(new Error(`Unmocked fetch call to ${url}`));
    });
  }
};

// Export module to allow global augmentation
export {};