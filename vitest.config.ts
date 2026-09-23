import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(process.cwd()),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Tests never talk to real services: fetch is replaced with a fake in each test file.
    setupFiles: ['tests/helpers/setupEnv.ts'],
    restoreMocks: true,
  },
});
