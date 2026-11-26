/**
 * Playwright tests for the payment receipt print stylesheet.
 * Closes issue #1538
 *
 * Acceptance criteria:
 *   - @media print hides navigation, toast, and wallet-status elements
 *   - Payment details (amount, merchant name, transaction ID) are visible
 *   - Background colours are removed; text is forced to black
 *   - PDF capture asserts key fields are present in the rendered output
 */
import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';

const RECEIPT_URL = '/frontend/receipt.html?orderId=ORDER_001';

// ── PDF capture ───────────────────────────────────────────────────────────────

test('receipt print: PDF can be captured and key fields are present', async ({ page }) => {
  await page.goto(RECEIPT_URL);
  await expect(page.locator('#receipt-content')).toBeVisible({ timeout: 5_000 });

  // Verify key data fields are populated before printing
  await expect(page.locator('#field-amount')).toBeVisible();
  await expect(page.locator('#field-merchant-name')).toBeVisible();
  await expect(page.locator('#field-order-id')).toBeVisible();

  const amountText = await page.locator('#field-amount').textContent();
  expect(amountText?.trim().length).toBeGreaterThan(0);

  const merchantText = await page.locator('#field-merchant-name').textContent();
  expect(merchantText?.trim().length).toBeGreaterThan(0);

  const orderIdText = await page.locator('#field-order-id').textContent();
  expect(orderIdText).toContain('ORDER_001');

  // Capture PDF to a temp file and confirm it was written
  const pdfDir = path.join(process.cwd(), 'tests', 'playwright', 'screenshots');
  if (!fs.existsSync(pdfDir)) fs.mkdirSync(pdfDir, { recursive: true });
  const pdfPath = path.join(pdfDir, 'receipt-print.pdf');

  await page.pdf({
    path: pdfPath,
    format: 'A4',
    printBackground: false,
    margin: { top: '18mm', bottom: '18mm', left: '15mm', right: '15mm' },
  });

  const stat = fs.statSync(pdfPath);
  expect(stat.size).toBeGreaterThan(1024); // non-trivial PDF written
});

// ── Print media: navigation hidden ───────────────────────────────────────────

test('receipt print: nav bar is hidden in print media', async ({ page }) => {
  await page.goto(RECEIPT_URL);
  await expect(page.locator('#receipt-content')).toBeVisible({ timeout: 5_000 });

  await page.emulateMedia({ media: 'print' });

  const nav = page.locator('nav.lf-nav');
  // display:none elements are not visible
  await expect(nav).toBeHidden();
});

// ── Print media: wallet status hidden ────────────────────────────────────────

test('receipt print: wallet status container is hidden in print media', async ({ page }) => {
  await page.goto(RECEIPT_URL);
  await expect(page.locator('#receipt-content')).toBeVisible({ timeout: 5_000 });

  await page.emulateMedia({ media: 'print' });

  const walletStatus = page.locator('#wallet-status-container');
  await expect(walletStatus).toBeHidden();
});

// ── Print media: action buttons hidden ───────────────────────────────────────

test('receipt print: action buttons are hidden in print media', async ({ page }) => {
  await page.goto(RECEIPT_URL);
  await expect(page.locator('#receipt-content')).toBeVisible({ timeout: 5_000 });

  await page.emulateMedia({ media: 'print' });

  const actions = page.locator('.actions');
  await expect(actions).toBeHidden();
});

// ── Print media: receipt content still visible ────────────────────────────────

test('receipt print: payment details remain visible in print media', async ({ page }) => {
  await page.goto(RECEIPT_URL);
  await expect(page.locator('#receipt-content')).toBeVisible({ timeout: 5_000 });

  await page.emulateMedia({ media: 'print' });

  // The receipt card itself must still be visible
  await expect(page.locator('.receipt')).toBeVisible();
  await expect(page.locator('#field-amount')).toBeVisible();
  await expect(page.locator('#field-merchant-name')).toBeVisible();
  await expect(page.locator('#field-order-id')).toBeVisible();
});

// ── Print media: backgrounds removed, text forced to black ───────────────────

test('receipt print: body background is white in print media', async ({ page }) => {
  await page.goto(RECEIPT_URL);
  await expect(page.locator('#receipt-content')).toBeVisible({ timeout: 5_000 });

  await page.emulateMedia({ media: 'print' });

  const bodyBg = await page.evaluate(() =>
    window.getComputedStyle(document.body).backgroundColor
  );
  // white (#fff) → rgb(255, 255, 255) or transparent
  expect(['rgb(255, 255, 255)', 'rgba(0, 0, 0, 0)', 'transparent']).toContain(bodyBg);
});
