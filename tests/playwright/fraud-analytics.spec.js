const { test, expect } = require('@playwright/test');
const fs = require('fs/promises');

const FRAUD_URL = '/dashboard/fraud-analytics/index.html';

test('fraud analytics export matches the visible alerts after threshold and date filters', async ({ page }) => {
  await page.goto(FRAUD_URL);

  await page.locator('#largePaymentThreshold').fill('300000');
  await page.locator('#thresholdForm button[type="submit"]').click();
  await expect(page.locator('#alertsTableBody tr')).toHaveCount(2);

  const future = new Date();
  future.setDate(future.getDate() + 1);
  const futureDate = [future.getFullYear(), String(future.getMonth() + 1).padStart(2, '0'), String(future.getDate()).padStart(2, '0')].join('-');
  await page.locator('#alertDateFrom').fill(futureDate);
  await expect(page.locator('#alertsTableBody tr')).toHaveCount(0);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#exportFlagged').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^flagged-transactions-\d{4}-\d{2}-\d{2}-testnet\.csv$/);

  const path = await download.path();
  const csv = await fs.readFile(path, 'utf8');
  expect(csv.trim()).toBe('"timestamp","merchant","payer","amount","flag reason"');

  const past = new Date();
  past.setDate(past.getDate() - 2);
  const pastDate = [past.getFullYear(), String(past.getMonth() + 1).padStart(2, '0'), String(past.getDate()).padStart(2, '0')].join('-');
  await page.locator('#alertDateFrom').fill(pastDate);
  await expect(page.locator('#alertsTableBody tr')).toHaveCount(2);

  const visibleOrderIds = await page.locator('#alertsTableBody tr code').allTextContents();
  const nextDownloadPromise = page.waitForEvent('download');
  await page.locator('#exportFlagged').click();
  const nextDownload = await nextDownloadPromise;
  const nextPath = await nextDownload.path();
  const exportedCsv = (await fs.readFile(nextPath, 'utf8')).trim();
  const exportedRows = exportedCsv.split('\r\n').slice(1);
  expect(exportedRows).toHaveLength(visibleOrderIds.length);
  expect(exportedCsv.split('\r\n')[0]).toBe('"timestamp","merchant","payer","amount","flag reason"');
  expect(exportedCsv).toContain('"GCMER...B2YR"');
  expect(exportedCsv).toContain('"GTEST...D4WV"');
  expect(exportedCsv).toContain('"GDIFF...C3ZP"');
  expect(exportedCsv).toContain('"500000"');
  expect(exportedCsv).not.toContain('"250000"');
  expect(exportedCsv).toContain('"High Refund Rate"');
  expect(exportedCsv).toContain('"Large Payment"');
});

test('merchant category filter is present and filters every dashboard panel', async ({ page }) => {
  await page.goto(FRAUD_URL);

  const categoryFilter = page.locator('#merchantCategoryFilter');
  await expect(categoryFilter).toBeVisible();

  // All panels should have rows before filtering.
  const panels = ['#eventsTableBody', '#refundsTableBody', '#largePaymentsTableBody', '#velocityTableBody'];
  for (const panel of panels) {
    await expect(page.locator(`${panel} tr`).first()).toBeVisible();
  }

  // Select a single category and verify every panel is filtered.
  await categoryFilter.selectOption('gambling');
  for (const panel of panels) {
    const rows = page.locator(`${panel} tr`);
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      await expect(rows.nth(i)).toHaveAttribute('data-merchant-category', 'gambling');
    }
  }

  // Selecting multiple categories keeps only rows in those categories.
  await categoryFilter.selectOption(['gambling', 'digital_goods']);
  for (const panel of panels) {
    const rows = page.locator(`${panel} tr`);
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const category = await rows.nth(i).getAttribute('data-merchant-category');
      expect(['gambling', 'digital_goods']).toContain(category);
    }
  }
});

test('merchant category labels are human-readable', async ({ page }) => {
  await page.goto(FRAUD_URL);

  const categoryFilter = page.locator('#merchantCategoryFilter');
  await expect(categoryFilter).toBeVisible();

  const optionLabels = await categoryFilter.locator('option').allTextContents();
  expect(optionLabels.length).toBeGreaterThan(0);
  for (const label of optionLabels) {
    const trimmed = label.trim();
    if (trimmed === '' || /^all/i.test(trimmed)) continue;
    // Raw enum values look like snake_case identifiers.
    expect(trimmed).not.toMatch(/^[a-z0-9]+(_[a-z0-9]+)+$/);
  }

  // Category labels rendered in the panels should also be human-readable.
  const categoryCells = page.locator('[data-merchant-category-label]');
  const cellCount = await categoryCells.count();
  expect(cellCount).toBeGreaterThan(0);
  for (let i = 0; i < cellCount; i++) {
    const text = (await categoryCells.nth(i).textContent()).trim();
    expect(text).not.toMatch(/^[a-z0-9]+(_[a-z0-9]+)+$/);
  }
});

test('merchant category distribution pie chart renders in the overview panel with a legend', async ({ page }) => {
  await page.goto(FRAUD_URL);

  const overview = page.locator('#overviewPanel');
  await expect(overview).toBeVisible();

  const pieChart = overview.locator('#categoryDistributionChart');
  await expect(pieChart).toBeVisible();

  // The chart should render actual slices (SVG paths or canvas content).
  const slices = pieChart.locator('path, .pie-slice');
  expect(await slices.count()).toBeGreaterThan(0);

  const legend = overview.locator('#categoryDistributionLegend');
  await expect(legend).toBeVisible();
  const legendItems = legend.locator('li, .legend-item');
  expect(await legendItems.count()).toBeGreaterThan(0);

  // Legend entries should use human-readable labels, not raw enum values.
  const legendLabels = await legendItems.allTextContents();
  for (const label of legendLabels) {
    expect(label.trim()).not.toMatch(/^[a-z0-9]+(_[a-z0-9]+)+$/);
  }
});