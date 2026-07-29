import { defineConfig, devices } from "@playwright/test";

/**
 * LumenFlow Playwright configuration.
 *
 * Docs: https://playwright.dev/docs/test-configuration
 *
 * Environment variables (set in CI or via .env):
 *   BASE_URL     – URL of the running frontend (default: http://localhost:3000)
 *   API_URL      – URL of the local mock-contract API   (default: http://localhost:8080)
 *   MOCK_WALLET  – Set to "1" to bypass Freighter/wallet in CI (default: "1")
 */

export default defineConfig({
  testDir: "./playwright",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    // Visual comparison: fail if diff exceeds 1 % of total pixels
    toHaveScreenshot: { maxDiffPixelRatio: 0.01 },
  },
  fullyParallel: false, // e2e tests share Docker state; run sequentially
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "on-first-retry",
    // Inject mock-wallet flag so pages can skip Freighter in CI
    extraHTTPHeaders: {
      "X-Mock-Wallet": process.env.MOCK_WALLET || "1",
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Start a lightweight static server for the frontend during tests.
  // The Docker Compose mock-contract API is started by the CI step, not here.
  webServer: {
    command: "npx serve ../frontend -p 3000 --no-clipboard",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  snapshotDir: "./playwright/screenshots",
  snapshotPathTemplate:
    "{snapshotDir}/{testFilePath}/{arg}-{projectName}{ext}",
});
