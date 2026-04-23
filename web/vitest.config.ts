import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
      '@flaim/worker-shared': fileURLToPath(new URL('../workers/shared/src/browser.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['lib/server/__tests__/**/*.test.ts'],
  },
});
