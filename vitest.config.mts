import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup.ts"],
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
