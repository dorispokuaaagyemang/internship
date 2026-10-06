import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup-env.js'],
    // Locally the API, worker and Vite are usually running too; more workers than this can run
    // a 6 GB machine out of memory ("Worker exited unexpectedly"). CI uses the default.
    maxWorkers: process.env.CI ? undefined : 2,
  },
});
