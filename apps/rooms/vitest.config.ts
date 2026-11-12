import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // The integration tests start workerd (via wrangler's test harness) and wait on real alarms.
    testTimeout: 15_000,
    hookTimeout: 60_000,
  },
});
