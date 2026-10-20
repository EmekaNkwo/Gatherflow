import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
    // A JUnit file alongside the console: an intermittent failure keeps its
    // full message and stack even when the console output was not kept.
    reporters: ["default", ["junit", { outputFile: "./.vitest-reports/junit.xml" }]],
    include: ["**/*.test.{ts,tsx}"],
    exclude: ["node_modules/**", ".next/**", "e2e/**"],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      include: ["services/**", "hooks/**", "lib/**", "stores/**"],
      exclude: ["**/*.test.ts"],
    },
  },
});
