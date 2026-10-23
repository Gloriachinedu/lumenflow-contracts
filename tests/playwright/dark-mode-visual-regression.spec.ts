/**
 * Visual Regression Tests – Dark Mode & Light Mode
 *
 * Captures full-page screenshots of every frontend page in both light and dark
 * colour schemes and compares them against approved baselines.
 *
 * Baseline storage:  tests/playwright/screenshots/
 * Threshold:         1 % pixel-ratio (configured in playwright.config.ts)
 *
 * Update baselines (run locally, commit the resulting PNGs):
 *   npm --prefix tests run test:update-snapshots -- playwright/dark-mode-visual-regression.spec.ts
 *
 * In CI the job uploads screenshot artefacts on failure so diffs can be
 * inspected from the Actions run summary.
 *
 * Resolves: #1085
 */

import { test, expect, Page } from "@playwright/test";

// ── Constants ─────────────────────────────────────────────────────────────────

const FIXED_TS = 1736935200; // 2026-01-15T10:00:00Z — stable across runs

type ColorScheme = "light" | "dark";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Wait for the page to reach a visually-stable state before snapping.
 * Disables CSS transitions/animations to eliminate flakiness.
 */
async function waitForIdle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");

  // Freeze CSS animations so screenshots are pixel-stable
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
      }
    `,
  });

  await page.waitForTimeout(200);
}

/**
 * Inject deterministic demo data so screenshots do not depend on live RPC or
 * wall-clock time.
 */
async function injectMockData(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as any).LUMENFLOW_CONTRACT_ID = "";
    (window as any).LUMENFLOW_MOCK_MODE = true;

    (window as any).__LUMENFLOW_DEMO_PAYMENT = {
      order_id: "ORDER_VRT_001",
      merchant_name: "Demo Merchant",
      merchant_verified: true,
      amount: 10_000_000,
      token: "XLM",
      paid_at: 1736935200,
      status: "Completed",
      refunds: [],
    };
  });
}

/**
 * Create a test that opens a page, waits for idle, and takes a full-page
 * screenshot for both light and dark colour schemes.
 *
 * The snapshot name follows the pattern:
 *   <label>-<light|dark>.png
 *
 * so baselines for the same page are stored side-by-side.
 */
function snapshotPage(
  label: string,
  path: string,
  scheme: ColorScheme,
  beforeSnapshot?: (page: Page) => Promise<void>
): void {
  test(`${label} [${scheme}]`, async ({ page }) => {
    // Apply colour scheme before any navigation so the browser honours it from
    // the first paint.
    await page.emulateMedia({ colorScheme: scheme });
    await injectMockData(page);
    await page.goto(path);
    await waitForIdle(page);
    if (beforeSnapshot) await beforeSnapshot(page);
    await expect(page).toHaveScreenshot(`${label}-${scheme}.png`, {
      fullPage: true,
    });
  });
}

// ── history.html ──────────────────────────────────────────────────────────────

test.describe("Dark/Light – history.html", () => {
  for (const scheme of ["light", "dark"] as ColorScheme[]) {
    snapshotPage("history-default", "/history.html", scheme);
  }
});

// ── receipt.html ──────────────────────────────────────────────────────────────

test.describe("Dark/Light – receipt.html", () => {
  for (const scheme of ["light", "dark"] as ColorScheme[]) {
    snapshotPage(
      "receipt-completed",
      "/receipt.html?orderId=ORDER_VRT_001",
      scheme,
      async (page) => {
        await expect(page.locator("#receipt-content")).toBeVisible();
      }
    );

    snapshotPage("receipt-not-found", "/receipt.html?orderId=NOT_FOUND", scheme, async (page) => {
      await expect(page.locator("#not-found")).toBeVisible();
    });

    test(`receipt-verified-badge [${scheme}]`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.addInitScript(() => {
        (window as any).LUMENFLOW_CONTRACT_ID = "";
        (window as any).__LUMENFLOW_DEMO_PAYMENT = {
          order_id: "ORDER_VRT_VERIFIED",
          merchant_name: "Verified Store",
          merchant_verified: true,
          amount: 5_000_000,
          token: "XLM",
          paid_at: 1736935200,
          status: "Completed",
          refunds: [],
        };
      });
      await page.goto("/receipt.html?orderId=ORDER_VRT_VERIFIED");
      await waitForIdle(page);
      await expect(page.locator("#receipt-content")).toBeVisible();
      // The verified badge must be visible when merchant is verified
      await expect(page.locator("#verified-badge")).toBeVisible();
      await expect(page).toHaveScreenshot(`receipt-verified-badge-${scheme}.png`, {
        fullPage: true,
      });
    });

    test(`receipt-partially-refunded [${scheme}]`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.addInitScript(() => {
        (window as any).LUMENFLOW_CONTRACT_ID = "";
        (window as any).__LUMENFLOW_DEMO_PAYMENT = {
          order_id: "ORDER_VRT_PARTIAL",
          merchant_name: "Demo Merchant",
          merchant_verified: false,
          amount: 10_000_000,
          token: "XLM",
          paid_at: 1736935200,
          status: "PartiallyRefunded",
          refunds: [
            {
              refund_id: "REFUND_001",
              amount: 3_000_000,
              reason: "Partial return",
              status: "Executed",
            },
          ],
        };
      });
      await page.goto("/receipt.html?orderId=ORDER_VRT_PARTIAL");
      await waitForIdle(page);
      await expect(page.locator("#receipt-content")).toBeVisible();
      await expect(page).toHaveScreenshot(`receipt-partially-refunded-${scheme}.png`, {
        fullPage: true,
      });
    });
  }
});

// ── multisig.html ─────────────────────────────────────────────────────────────

test.describe("Dark/Light – multisig.html", () => {
  for (const scheme of ["light", "dark"] as ColorScheme[]) {
    snapshotPage("multisig-empty", "/multisig.html", scheme);

    test(`multisig-filled [${scheme}]`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await injectMockData(page);
      await page.goto("/multisig.html");
      await waitForIdle(page);

      const merchantField = page
        .locator(
          'input[name="merchant_address"], #merchant-address, input[placeholder*="merchant" i]'
        )
        .first();
      if (await merchantField.isVisible()) {
        await merchantField.fill(
          "GBUYUAI75XXWDZEKLY66CFYKQPET5JR4EAPL7STQKQCRLKJ74SC65VU"
        );
      }

      const amountField = page
        .locator('input[name="amount"], #amount, input[placeholder*="amount" i]')
        .first();
      if (await amountField.isVisible()) {
        await amountField.fill("10000000");
      }

      await page.waitForTimeout(200);
      await expect(page).toHaveScreenshot(`multisig-filled-${scheme}.png`, {
        fullPage: true,
      });
    });
  }
});

// ── onboarding.html ───────────────────────────────────────────────────────────
// If this page does not yet exist, the test navigates to "/" as a fallback.

test.describe("Dark/Light – onboarding.html", () => {
  for (const scheme of ["light", "dark"] as ColorScheme[]) {
    test(`onboarding-default [${scheme}]`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await injectMockData(page);

      // Try dedicated page first; fall back to index
      const res = await page.request.head("/onboarding.html").catch(() => null);
      const path =
        res && res.status() < 400 ? "/onboarding.html" : "/";
      await page.goto(path);
      await waitForIdle(page);
      await expect(page).toHaveScreenshot(`onboarding-default-${scheme}.png`, {
        fullPage: true,
      });
    });
  }
});

// ── dashboard.html ────────────────────────────────────────────────────────────

test.describe("Dark/Light – dashboard.html", () => {
  for (const scheme of ["light", "dark"] as ColorScheme[]) {
    test(`dashboard-default [${scheme}]`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await injectMockData(page);

      // Try /dashboard.html, then index.html in the dashboard directory
      const candidates = ["/dashboard.html", "/dashboard/index.html"];
      let navigated = false;
      for (const path of candidates) {
        const res = await page.request.head(path).catch(() => null);
        if (res && res.status() < 400) {
          await page.goto(path);
          navigated = true;
          break;
        }
      }
      if (!navigated) {
        await page.goto("/dashboard/merchant-dashboard/index.html");
      }
      await waitForIdle(page);
      await expect(page).toHaveScreenshot(`dashboard-default-${scheme}.png`, {
        fullPage: true,
      });
    });
  }
});
