import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test/setup.ts"],
    // Run tests sequentially to avoid DB conflicts
    fileParallelism: false,
    maxWorkers: 1,
    // Timeout for longer integration tests
    testTimeout: 10000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/*.ts", "src/!(services)/**/*.ts", "src/services/coverage.ts"],
      exclude: [
        "src/test/**",
        "src/**/*.d.ts",
        "src/**/index.ts",
        "src/utils/logger.ts",
      ],
      thresholds: {
        global: {
          lines: 60,
          functions: 65,
          branches: 50,
          statements: 60,
        },
      },
    },
  },
});
