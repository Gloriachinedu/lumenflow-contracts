import { defineConfig, devices } from "@playwright/test";

/**
 * LumenFlow Playwright configuration.
 *
 * Docs: https://playwright.dev/docs/test-configuration
 *
 * Environment variables:
 *   BASE_URL     – URL of the running frontend (default: http://localhost:3000)
 *   API_URL      – URL of the local mock-contract API   (default: http://localhost:8080)
 *   MOCK_WALLET  – Set to "1" to bypass Freighter/wallet in CI (default: "1")
 */

export default defineConfig({
  testDir: "./playwright",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
    // Visual comparison: fail if diff exceeds 1 % of total pixels (#620)
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
    },
  },
  fullyParallel: false,
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
    // Ensure consistent font rendering for visual diffs
    colorScheme: "light",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Fix viewport for stable screenshot baselines
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
  webServer: {
    command: "npx serve ../frontend -p 3000 --no-clipboard",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  // Store baseline screenshots in tests/playwright/screenshots/
  snapshotDir: "./playwright/screenshots",
  snapshotPathTemplate:
    "{snapshotDir}/{testFilePath}/{arg}-{projectName}{ext}",
});
