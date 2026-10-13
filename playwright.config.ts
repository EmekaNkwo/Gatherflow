import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3210);
// `localhost` rather than `127.0.0.1`: the dev server serves its client
// bundle from the localhost origin, and a mismatch leaves the page stuck on
// the loading shell.
const baseURL = `http://localhost:${PORT}`;

/**
 * End-to-end configuration.
 *
 * Each test gets a fresh browser context, so every run starts from an empty
 * localStorage and seeds its own church — exactly the path a first-time
 * visitor to the deployed demo takes.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  // One browser project: the responsive checks set their own viewport, so a
  // second mobile project would only re-run the desktop flows against a
  // layout they were not written for.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // The suite shares a single server and a single machine; a handful of
  // workers keeps it quick without starving each other of time.
  workers: process.env.CI ? 1 : 3,
  // Tests run against a production build. The dev server compiles each route
  // on first request, which makes navigation timings unpredictable and the
  // suite flaky for reasons that have nothing to do with the app.
  webServer: {
    command: `npx next build && npx next start --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 420_000,
  },
});
