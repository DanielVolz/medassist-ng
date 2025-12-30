import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
    // Run tests sequentially to avoid DB conflicts
    poolOptions: {
      threads: {
        singleThread: true,
      },
    },
    // Timeout for longer integration tests
    testTimeout: 10000,
  },
});
