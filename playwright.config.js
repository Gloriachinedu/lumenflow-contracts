// @ts-check
const { defineConfig } = require('@playwright/test');
const http = require('http');
const fs = require('fs');
const path = require('path');

/**
 * Shared static file server for all frontend test specs.
 *
 * The server is started as a web server so Playwright can use a single port
 * across all workers. The baseURL is set accordingly so specs can use relative
 * paths (e.g., page.goto('/frontend/history.html')).
 *
 * In CI the server is started automatically before tests run and torn down
 * afterwards. In local development you can also run the existing
 * `./scripts/dev.sh` server and override the base URL:
 *   BASE_URL=http://localhost:3000 npx playwright test
 */
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:4444';

module.exports = defineConfig({
  // Include both the top-level tests directory and the Playwright-specific
  // specs (including the axe-core accessibility suite) under tests/playwright.
  testDir: './tests',
  testMatch: ['**/*.spec.js', '**/playwright/**/*.spec.js'],
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,

  use: {
    headless: true,
    baseURL: BASE_URL,
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
    // Capture screenshot only on failure for CI diagnostics.
    screenshot: 'only-on-failure',
    // Capture trace only on first retry so failures are diagnosable without
    // overhead on green runs.
    trace: 'on-first-retry',
  },

  // Start the lightweight static server before the test run. The server is
  // rooted at the repository root so both `frontend/` and `dashboard/` pages
  // are reachable (e.g. /frontend/history.html, /dashboard/index.html).
  webServer: process.env.BASE_URL
    ? undefined // External server supplied — skip auto-start.
    : {
        command: 'node tests/playwright/server.js',
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 10_000,
        env: {
          // Expose the repository root so the static server can serve every
          // top-level directory (frontend/, dashboard/, etc.).
          STATIC_ROOT: path.resolve(__dirname),
        },
      },

  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
    {
      // Dedicated accessibility project running axe-core scans in headless
      // Chromium with a stable desktop viewport for consistent results.
      name: 'a11y',
      testMatch: ['**/playwright/**/*a11y*.spec.js'],
      use: {
        browserName: 'chromium',
        headless: true,
        viewport: { width: 1280, height: 800 },
      },
    },
  ],
});
