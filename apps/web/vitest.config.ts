import { defineConfig } from 'vitest/config';

// Fixed non-UTC zone so date helpers are exercised across DST transitions.
process.env.TZ = 'America/New_York';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
