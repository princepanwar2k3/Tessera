import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Real clocks, real HTTP, real watchdog: a 3-block job at 5s blocks is 15s.
    testTimeout: 90_000,
    hookTimeout: 30_000,
  },
});
