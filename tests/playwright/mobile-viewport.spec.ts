/**
 * Mobile viewport tests for the merchant dashboard.
 * Closes issue #883
 *
 * Verifies frontend/dashboard.html on small screens:
 *   - the page never scrolls horizontally at common phone widths
 *   - wide data panels contain their own horizontal scroll (no page break-out)
 *   - interactive controls meet the WCAG 2.2 (SC 2.5.8) 24x24 CSS px target size
 *   - the stats grid collapses to a single column
 */
import { test, expect } from '@playwright/test';

const DASHBOARD_URL = '/frontend/dashboard.html';

/** True when the document itself scrolls horizontally. */
async function pageScrollsHorizontally(page): Promise<boolean> {
  return page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
}

for (const width of [390, 360]) {
  test(`dashboard: page does not scroll horizontally at ${width}px wide`, async ({ page }) => {
    await page.setViewportSize({ width, height: 780 });
    await page.goto(DASHBOARD_URL);
    await expect(page.locator('.stats-grid')).toBeVisible();
    // Demo mode auto-populates the payment/refund tables; give layout a beat.
    await expect(page.locator('#payments-container table, #payments-container .state-box')).toBeVisible();
    expect(await pageScrollsHorizontally(page)).toBe(false);
  });
}

test('dashboard: wide data panels scroll internally instead of breaking the page', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.goto(DASHBOARD_URL);

  const panels = page.locator('.panel');
  const panelCount = await panels.count();
  expect(panelCount).toBeGreaterThan(0);
  for (let i = 0; i < panelCount; i++) {
    const overflowX = await panels
      .nth(i)
      .evaluate((el) => getComputedStyle(el).overflowX);
    expect(overflowX, `panel ${i} should confine horizontal overflow`).toBe('auto');
  }
  expect(await pageScrollsHorizontally(page)).toBe(false);
});

test('dashboard: interactive controls meet the 24px minimum touch target', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto(DASHBOARD_URL);

  const controls = page.locator('nav a, #load-btn, #merchant-addr');
  const count = await controls.count();
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < count; i++) {
    const box = await controls.nth(i).boundingBox();
    expect(box, `control ${i} should be laid out`).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(24);
    expect(box!.width).toBeGreaterThanOrEqual(24);
  }
});

test('dashboard: stat cards stack into a single column on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  await page.goto(DASHBOARD_URL);

  const cards = page.locator('.stats-grid .stat-card');
  await expect(cards).toHaveCount(4);

  const lefts = await cards.evaluateAll((els) =>
    els.map((el) => Math.round(el.getBoundingClientRect().left))
  );
  // Every card shares the same left edge => one column.
  for (const left of lefts) {
    expect(Math.abs(left - lefts[0])).toBeLessThan(2);
  }
});
