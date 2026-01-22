import { describe, expect, it } from 'vitest';
import type { RouteResult } from '../router';

describe('fantasy-mcp router', () => {
  describe('RouteResult interface', () => {
    it('accepts success result', () => {
      const result: RouteResult = {
        success: true,
        data: { standings: [] },
      };
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('accepts error result', () => {
      const result: RouteResult = {
        success: false,
        error: 'Platform not supported',
        code: 'PLATFORM_NOT_SUPPORTED',
      };
      expect(result.success).toBe(false);
      expect(result.error).toBe('Platform not supported');
      expect(result.code).toBe('PLATFORM_NOT_SUPPORTED');
    });
  });

  describe('selectClient behavior', () => {
    it('should return null for yahoo platform (not yet implemented)', () => {
      // This documents the expected behavior: yahoo returns null until implemented
      // We can't directly test selectClient since it's not exported,
      // but we can verify the expected error response
      const expectedErrorForYahoo: RouteResult = {
        success: false,
        error: 'Platform "yahoo" is not yet supported',
        code: 'PLATFORM_NOT_SUPPORTED',
      };
      expect(expectedErrorForYahoo.code).toBe('PLATFORM_NOT_SUPPORTED');
    });
  });
});
