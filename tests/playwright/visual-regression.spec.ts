/**
 * Visual Regression Tests – LumenFlow Frontend UI Components
 *
 * Captures screenshots of key UI components and compares them against
 * approved baselines stored in tests/playwright/screenshots/.
 *
 * CI fails if any diff exceeds the 1% threshold configured in
 * playwright.config.ts (toHaveScreenshot.maxDiffPixelRatio = 0.01).
 *
 * To approve new baselines:
 *   npm --prefix tests run test:update-snapshots
 * then commit the updated PNG files and open a PR.
 *
 * Related issue: #620
 */

import { test, expect, Page } from "@playwright/test";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Wait for all images and fonts to finish loading before taking a screenshot.
 * This prevents flaky diffs caused by images rendering mid-capture.
 */
async function waitForIdle(page: Page) {
  await page.waitForLoadState("networkidle");
  // Give any CSS transitions a moment to settle
  await page.waitForTimeout(300);
}

/**
 * Inject deterministic mock data into the page's window object so that
 * screenshots are stable across runs (no live RPC calls, no timestamps
 * that change every second).
 */
async function injectMockData(page: Page) {
  await page.addInitScript(() => {
    // Disable live Soroban RPC fetching
    (window as any).LUMENFLOW_CONTRACT_ID = "";
    (window as any).LUMENFLOW_MOCK_MODE = true;

    // Fixed timestamp: 2026-01-15T10:00:00Z  →  1736935200
    const FIXED_TS = 1736935200;

    // Demo payment used by receipt.html when CONTRACT_ID is empty
    (window as any).__LUMENFLOW_DEMO_PAYMENT = {
      order_id: "ORDER_VRT_001",
      merchant_name: "Demo Merchant",
      merchant_verified: true,
      amount: 10_000_000,
      token: "XLM",
      paid_at: FIXED_TS,
      status: "Completed",
      refunds: [],
    };
  });
}

// ── Receipt page ──────────────────────────────────────────────────────────────

test.describe("Visual – Receipt Page", () => {
  test.beforeEach(async ({ page }) => {
    await injectMockData(page);
  });

  test("receipt page – completed payment", async ({ page }) => {
    await page.goto("/receipt.html?orderId=ORDER_VRT_001");
    await waitForIdle(page);
    // Ensure the receipt content panel is visible before snapping
    await expect(page.locator("#receipt-content")).toBeVisible();
    await expect(page).toHaveScreenshot("receipt-completed.png", {
      fullPage: true,
    });
  });

  test("receipt page – partially refunded payment", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__LUMENFLOW_DEMO_PAYMENT = {
        order_id: "ORDER_VRT_002",
        merchant_name: "Demo Merchant",
        merchant_verified: false,
        amount: 10_000_000,
        token: "XLM",
        paid_at: 1736935200,
        status: "PartiallyRefunded",
        refunds: [
          {
            refund_id: "REFUND_VRT_001",
            amount: 3_000_000,
            reason: "Partial return",
            status: "Executed",
          },
        ],
      };
    });
    await page.goto("/receipt.html?orderId=ORDER_VRT_002");
    await waitForIdle(page);
    await expect(page.locator("#receipt-content")).toBeVisible();
    await expect(page).toHaveScreenshot("receipt-partially-refunded.png", {
      fullPage: true,
    });
  });

  test("receipt page – fully refunded payment", async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__LUMENFLOW_DEMO_PAYMENT = {
        order_id: "ORDER_VRT_003",
        merchant_name: "Demo Merchant",
        merchant_verified: true,
        amount: 10_000_000,
        token: "XLM",
        paid_at: 1736935200,
        status: "FullyRefunded",
        refunds: [
          {
            refund_id: "REFUND_VRT_002",
            amount: 10_000_000,
            reason: "Full refund requested",
            status: "Executed",
          },
        ],
      };
    });
    await page.goto("/receipt.html?orderId=ORDER_VRT_003");
    await waitForIdle(page);
    await expect(page.locator("#receipt-content")).toBeVisible();
    await expect(page).toHaveScreenshot("receipt-fully-refunded.png", {
      fullPage: true,
    });
  });

  test("receipt page – not found state", async ({ page }) => {
    await page.goto("/receipt.html?orderId=NONEXISTENT_ORDER");
    await waitForIdle(page);
    // The not-found panel should be visible
    await expect(page.locator("#not-found")).toBeVisible();
    await expect(page).toHaveScreenshot("receipt-not-found.png", {
      fullPage: true,
    });
  });
});

// ── Multisig form ─────────────────────────────────────────────────────────────

test.describe("Visual – Multisig Form", () => {
  test.beforeEach(async ({ page }) => {
    await injectMockData(page);
  });

  test("multisig form – default (empty) state", async ({ page }) => {
    await page.goto("/multisig.html");
    await waitForIdle(page);
    await expect(page).toHaveScreenshot("multisig-empty.png", {
      fullPage: true,
    });
  });

  test("multisig form – filled with valid data", async ({ page }) => {
    await page.goto("/multisig.html");
    await waitForIdle(page);

    // Fill in the form with stable test data
    const merchantField = page.locator('input[name="merchant_address"], #merchant-address, input[placeholder*="merchant" i]').first();
    if (await merchantField.isVisible()) {
      await merchantField.fill(
        "GBUYUAI75XXWDZEKLY66CFYKQPET5JR4EAPL7STQKQCRLKJ74SC65VU"
      );
    }

    const amountField = page.locator('input[name="amount"], #amount, input[placeholder*="amount" i]').first();
    if (await amountField.isVisible()) {
      await amountField.fill("10000000");
    }

    const paymentIdField = page.locator('input[name="payment_id"], #payment-id, input[placeholder*="payment" i]').first();
    if (await paymentIdField.isVisible()) {
      await paymentIdField.fill("MS_VRT_001");
    }

    // Wait for any validation UI to settle
    await page.waitForTimeout(200);

    await expect(page).toHaveScreenshot("multisig-filled.png", {
      fullPage: true,
    });
  });

  test("multisig form – progress/signing panel", async ({ page }) => {
    await page.goto("/multisig.html");
    await waitForIdle(page);

    // Reveal the progress panel if there's a way to show it in mock mode
    const progressPanel = page.locator("#progress-panel");
    if (await progressPanel.isHidden()) {
      await page.evaluate(() => {
        const el = document.getElementById("progress-panel");
        if (el) el.style.display = "block";
      });
    }

    await page.waitForTimeout(200);
    await expect(page).toHaveScreenshot("multisig-progress.png", {
      fullPage: true,
    });
  });
});

// ── History table ─────────────────────────────────────────────────────────────

test.describe("Visual – History Table", () => {
  test.beforeEach(async ({ page }) => {
    await injectMockData(page);
  });

  test("history table – with results", async ({ page }) => {
    // The history table is rendered inline in index.html / a dedicated page.
    // We use the receipt page in mock mode with injected history data as a
    // proxy here; replace with the actual history page path when it exists.
    await page.goto("/receipt.html?orderId=ORDER_VRT_001&view=history");
    await waitForIdle(page);
    await expect(page).toHaveScreenshot("history-table-with-results.png", {
      fullPage: true,
    });
  });
});

// ── Onboarding flow ───────────────────────────────────────────────────────────

test.describe("Visual – Onboarding Flow", () => {
  test.beforeEach(async ({ page }) => {
    await injectMockData(page);
  });

  test("onboarding – connect wallet step", async ({ page }) => {
    // Navigate to the onboarding entry point; adjust path if it differs.
    await page.goto("/");
    await waitForIdle(page);
    await expect(page).toHaveScreenshot("onboarding-connect-wallet.png", {
      fullPage: true,
    });
  });

  test("onboarding – merchant registration form", async ({ page }) => {
    // If there is a dedicated registration page, adjust this path.
    await page.goto("/?step=register");
    await waitForIdle(page);
    await expect(page).toHaveScreenshot("onboarding-register.png", {
      fullPage: true,
    });
  });
});
