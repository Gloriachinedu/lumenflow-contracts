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

/**
 * Issue #1087: mobile viewport coverage for the remaining frontend pages,
 * at iPhone SE (375px) and iPhone 14 Pro Max (428px) widths.
 *
 * For each page, verifies:
 *   - no horizontal page overflow
 *   - visible touch targets (buttons, links, inputs, selects) are >= 44x44 CSS px
 *   - body text is readable without zoom (>= 16px base font size, per common
 *     mobile-accessibility guidance so users don't have to pinch-zoom)
 */

const MOBILE_WIDTHS = [375, 428] as const; // iPhone SE, iPhone 14 Pro Max
const MIN_TOUCH_TARGET_PX = 44;
const MIN_READABLE_FONT_PX = 16;

interface MobilePage {
  name: string;
  url: string;
  /** Selector for an element that confirms the page has finished loading. */
  readySelector: string;
}

const MOBILE_PAGES: MobilePage[] = [
  { name: 'history', url: '/frontend/history.html', readySelector: '#history-main' },
  { name: 'receipt', url: '/frontend/receipt.html', readySelector: '#receipt-main' },
  { name: 'multisig', url: '/frontend/multisig.html', readySelector: '#multisig-main' },
  { name: 'onboarding', url: '/frontend/onboarding.html', readySelector: '#step-1' },
  { name: 'dashboard', url: '/frontend/dashboard.html', readySelector: '.stats-grid' },
];

/** Visible touch-target elements: buttons, links, inputs, selects, textareas. */
const TOUCH_TARGET_SELECTOR =
  'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"]';

for (const { name, url, readySelector } of MOBILE_PAGES) {
  for (const width of MOBILE_WIDTHS) {
    test(`${name}: no horizontal overflow at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 });
      await page.goto(url);
      await expect(page.locator(readySelector)).toBeVisible();

      const scrollsHorizontally = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1
      );
      expect(scrollsHorizontally).toBe(false);
    });

    test(`${name}: touch targets meet the ${MIN_TOUCH_TARGET_PX}px minimum at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 });
      await page.goto(url);
      await expect(page.locator(readySelector)).toBeVisible();

      const targets = page.locator(TOUCH_TARGET_SELECTOR);
      const count = await targets.count();
      expect(count).toBeGreaterThan(0);

      for (let i = 0; i < count; i++) {
        const el = targets.nth(i);
        if (!(await el.isVisible())) continue;
        const box = await el.boundingBox();
        if (!box) continue;
        // Skip zero-area elements (e.g. visually-hidden but not display:none).
        if (box.width === 0 || box.height === 0) continue;
        expect(
          box.height,
          `touch target ${i} on ${name} should be >= ${MIN_TOUCH_TARGET_PX}px tall`
        ).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
        expect(
          box.width,
          `touch target ${i} on ${name} should be >= ${MIN_TOUCH_TARGET_PX}px wide`
        ).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
      }
    });

    test(`${name}: body text is readable without zoom at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 812 });
      await page.goto(url);
      await expect(page.locator(readySelector)).toBeVisible();

      const bodyFontSizePx = await page.evaluate(() =>
        parseFloat(getComputedStyle(document.body).fontSize)
      );
      expect(bodyFontSizePx).toBeGreaterThanOrEqual(MIN_READABLE_FONT_PX);
    });
  }
}
