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