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
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/test/**",
        "src/**/*.d.ts",
        "src/**/index.ts",
        "src/services/**",
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
