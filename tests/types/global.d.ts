/**
 * Global type declarations for test utilities
 */

declare global {
  var testUtils: {
    generateTestUserId(): string;
    generateTestCredentials(): { swid: string; espn_s2: string; email: string };
    wait(ms: number): Promise<void>;
    isTestEnvironment(): boolean;
    createMockFetch(responses: Array<{ url: RegExp; response: any }>): jest.Mock;
  };
}

export {};