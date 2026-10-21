/**
 * Dark Mode Visual Regression Tests
 *
 * Captures screenshots of LumenFlow frontend pages in dark mode and compares
 * them against committed baseline images. The CI build fails if any screenshot
 * diff exceeds the configured threshold.
 *
 * Covered pages
 * ─────────────
 * - frontend/onboarding.html          (added by #1263)
 * - frontend/payment-history-paginated.html (added by #1263)
 *
 * Threshold
 * ─────────
 * maxDiffPixelRatio: 0.02  (2% of pixels may differ between runs)
 *
 * This matches the tolerance used for minor anti-aliasing and font-hinting
 * differences across platforms. Lower thresholds risk flakiness; higher
 * thresholds may mask genuine regressions.
 *
 * Updating baselines
 * ──────────────────
 * Run with the --update-snapshots flag to regenerate baseline images:
 *
 *   npx playwright test tests/playwright/dark-mode-visual-regression.spec.ts \
 *     --update-snapshots
 *
 * Then commit the new/updated files under tests/playwright/snapshots/.
 *
 * Dependencies
 * ────────────
 * Requires the pages to exist in the frontend/ directory. Serves them via a
 * local HTTP server spawned within the test (no external server needed).
 */

import { test, expect, Page } from '@playwright/test';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

// ── Screenshot diff threshold (2% of pixels) ─────────────────────────────────
const DIFF_THRESHOLD: number = 0.02;

// ── Local static file server ──────────────────────────────────────────────────

function createStaticServer(): http.Server {
  const root = process.cwd();
  return http.createServer((req, res) => {
    const requestUrl = new URL(req.url ?? '/', 'http://127.0.0.1');
    const filePath = path.join(root, requestUrl.pathname);

    // Path traversal guard
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType =
        ext === '.css' ? 'text/css; charset=utf-8' :
        ext === '.js'  ? 'application/javascript; charset=utf-8' :
                         'text/html; charset=utf-8';

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
}

async function startServer(): Promise<{ server: http.Server; port: number }> {
  const server = createStaticServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return { server, port: address.port };
}

// ── Dark-mode emulation helper ────────────────────────────────────────────────

/**
 * Navigate to a page with dark mode emulation enabled, wait for the page to
 * settle, and return the page handle.
 */
async function openInDarkMode(page: Page, url: string): Promise<void> {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(url, { waitUntil: 'networkidle' });
  // Small delay to allow CSS transitions and async JS rendering to complete
  await page.waitForTimeout(300);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Dark mode visual regression', () => {
  let server: http.Server;
  let port: number;

  test.beforeAll(async () => {
    ({ server, port } = await startServer());
  });

  test.afterAll(() => {
    server.close();
  });

  // ── onboarding.html ─────────────────────────────────────────────────────────

  test('onboarding.html — step 1 renders correctly in dark mode', async ({ page }) => {
    await openInDarkMode(page, `http://127.0.0.1:${port}/frontend/onboarding.html`);

    await expect(page).toHaveScreenshot('onboarding-step1-dark.png', {
      maxDiffPixelRatio: DIFF_THRESHOLD,
      fullPage: true,
    });
  });

  test('onboarding.html — step 3 category grid renders correctly in dark mode', async ({ page }) => {
    await openInDarkMode(page, `http://127.0.0.1:${port}/frontend/onboarding.html`);

    // Simulate wallet connect (demo mode) and navigate to step 3
    await page.click('#connect-wallet-btn');
    await page.waitForSelector('#wallet-connected-section', { state: 'visible' });
    await page.click('#next-1');

    // Fill required step 2 fields
    await page.fill('#business-name', 'Demo Store');
    await page.fill('#contact-info', 'demo@example.com');
    await page.click('button:has-text("Next: Category")');

    await expect(page).toHaveScreenshot('onboarding-step3-dark.png', {
      maxDiffPixelRatio: DIFF_THRESHOLD,
      fullPage: true,
    });
  });

  // ── payment-history-paginated.html ──────────────────────────────────────────

  test('payment-history-paginated.html — renders correctly in dark mode', async ({ page }) => {
    await openInDarkMode(
      page,
      `http://127.0.0.1:${port}/frontend/payment-history-paginated.html`
    );

    // Wait for the async mock data to load (page calls loadPage() on init)
    await page.waitForFunction(() => {
      const meta = document.getElementById('page-meta');
      return meta && meta.textContent !== '' && !meta.textContent.includes('Loading');
    }, { timeout: 5000 });

    await expect(page).toHaveScreenshot('payment-history-paginated-dark.png', {
      maxDiffPixelRatio: DIFF_THRESHOLD,
      fullPage: true,
    });
  });

  test('payment-history-paginated.html — next page renders correctly in dark mode', async ({ page }) => {
    await openInDarkMode(
      page,
      `http://127.0.0.1:${port}/frontend/payment-history-paginated.html`
    );

    // Wait for initial load
    await page.waitForFunction(() => {
      const btn = document.getElementById('next-btn') as HTMLButtonElement | null;
      return btn && !btn.disabled;
    }, { timeout: 5000 });

    await page.click('#next-btn');

    // Wait for page 2 to load
    await page.waitForFunction(() => {
      const meta = document.getElementById('page-meta');
      return meta && meta.textContent?.includes('Page 2');
    }, { timeout: 5000 });

    await expect(page).toHaveScreenshot('payment-history-paginated-page2-dark.png', {
      maxDiffPixelRatio: DIFF_THRESHOLD,
      fullPage: true,
    });
  });
});
