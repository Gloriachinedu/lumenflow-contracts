/**
 * Playwright visual and layout tests for the payment receipt page on mobile
 * viewports.
 * Closes issue #1528
 *
 * Acceptance criteria:
 *   - Renders correctly at 320 px, 375 px, 414 px, and 768 px widths
 *   - No horizontal scrollbar at any breakpoint
 *   - Existing receipt spec still passes (covered in receipt.spec.ts)
 */
import { test, expect } from '@playwright/test';

const RECEIPT_URL = '/frontend/receipt.html?orderId=ORDER_001';
const BREAKPOINTS = [320, 375, 414, 768] as const;

/** Returns true when the document itself scrolls horizontally. */
async function pageScrollsHorizontally(page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
}

for (const width of BREAKPOINTS) {
  const height = width <= 375 ? 667 : width <= 414 ? 736 : 1024;

  // ── No horizontal overflow ─────────────────────────────────────────────────

  test(`receipt mobile: no horizontal scrollbar at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(RECEIPT_URL);
    await expect(page.locator('#receipt-content')).toBeVisible({ timeout: 5_000 });

    expect(await pageScrollsHorizontally(page)).toBe(false);
  });

  // ── Receipt card renders and is fully visible ──────────────────────────────

  test(`receipt mobile: receipt card is visible and within viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(RECEIPT_URL);
    await expect(page.locator('#receipt-content')).toBeVisible({ timeout: 5_000 });

    const receipt = page.locator('.receipt');
    await expect(receipt).toBeVisible();

    const box = await receipt.boundingBox();
    expect(box).not.toBeNull();
    // The card must not extend beyond the viewport right edge
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  });

  // ── Key payment fields visible ─────────────────────────────────────────────

  test(`receipt mobile: amount and merchant name are visible at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(RECEIPT_URL);
    await expect(page.locator('#receipt-content')).toBeVisible({ timeout: 5_000 });

    await expect(page.locator('#field-amount')).toBeVisible();
    await expect(page.locator('#field-merchant-name')).toBeVisible();

    const amountText = await page.locator('#field-amount').textContent();
    expect(amountText?.trim().length).toBeGreaterThan(0);
  });

  // ── Visual snapshot ────────────────────────────────────────────────────────

  test(`receipt mobile: visual snapshot at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto(RECEIPT_URL);
    await expect(page.locator('#receipt-content')).toBeVisible({ timeout: 5_000 });

    await expect(page.locator('.receipt')).toBeVisible();

    await expect(page).toHaveScreenshot(`receipt-${width}px.png`, {
      fullPage: false,
      // Allow up to 5% pixel difference to avoid flakiness from anti-aliasing
      maxDiffPixelRatio: 0.05,
    });
  });
}
