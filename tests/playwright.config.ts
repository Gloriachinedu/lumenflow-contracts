import { defineConfig, devices } from "@playwright/test";

/**
 * LumenFlow Playwright configuration.
 *
 * Docs: https://playwright.dev/docs/test-configuration
 *
 * Environment variables:
 *   BASE_URL     – URL of the running frontend (default: http://localhost:3000)
 *   DASHBOARD_URL – URL of the running dashboard (default: http://localhost:3001)
 *   API_URL      – URL of the local mock-contract API   (default: http://localhost:8080)
 *   MOCK_WALLET  – Set to "1" to bypass Freighter/wallet in CI (default: "1")
 *
 * Accessibility (#1527):
 *   The `a11y` project runs the axe-core / keyboard / screen-reader specs in
 *   ./playwright/a11y against both the frontend and dashboard apps. Both apps
 *   are served from the repository root so relative asset paths resolve.
 */

export default defineConfig({
  testDir: "./playwright",
  // Full onboarding E2E (happy path + wallet rejection) must finish under 90s (#1560)
  timeout: 90_000,
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
    {
      // Smoke pipeline project (#1560): runs only @smoke-tagged specs,
      // including the end-to-end onboarding flow against the local
      // Stellar node started by docker-compose.test.yml.
      name: "smoke",
      grep: /@smoke/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 720 },
        // Point the frontend at the local Stellar node / mock-contract API
        baseURL: process.env.BASE_URL || "http://localhost:3000",
      },
    },
  ],
  webServer: {
    command: "npx serve ../frontend -p 3000 --no-clipboard",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      // The onboarding E2E spec (#1560) talks to the local Stellar node
      // brought up by docker-compose.test.yml.
      API_URL: process.env.API_URL || "http://localhost:8080",
      MOCK_WALLET: process.env.MOCK_WALLET || "1",
    },
  },
  // Store baseline screenshots in tests/playwright/screenshots/
  snapshotDir: "./playwright/screenshots",
  snapshotPathTemplate:
    "{snapshotDir}/{testFilePath}/{arg}-{projectName}{ext}",
});
