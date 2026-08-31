/**
 * Playwright regression tests for frontend/receipt.html
 * Closes issue #333
 *
 * Acceptance criteria:
 *   - Tests verify form validation, navigation, and empty states.
 *   - Runs headless in CI.
 *   - Catches regressions in UI behaviour.
 */
import { test, expect } from '@playwright/test';

const RECEIPT_URL = '/frontend/receipt.html';

// ── Page load ─────────────────────────────────────────────────────────────────

test('receipt page: loads with correct title', async ({ page }) => {
  await page.goto(`${RECEIPT_URL}?orderId=ORDER_001`);
  await expect(page).toHaveTitle(/Receipt|LumenFlow/i);
});

// ── 404 / not-found state ─────────────────────────────────────────────────────

test('receipt page: shows not-found state for NOT_FOUND order ID', async ({ page }) => {
  await page.goto(`${RECEIPT_URL}?orderId=NOT_FOUND`);
  await expect(page.locator('#not-found')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#missing-id')).toContainText('NOT_FOUND');
});

test('receipt page: not-found state is hidden for valid order', async ({ page }) => {
  await page.goto(`${RECEIPT_URL}?orderId=ORDER_001`);
  await expect(page.locator('#not-found')).toBeHidden({ timeout: 5_000 });
});

// ── Receipt content ───────────────────────────────────────────────────────────

test('receipt page: shows receipt content for a known order', async ({ page }) => {
  await page.goto(`${RECEIPT_URL}?orderId=ORDER_001`);
  await expect(page.locator('#receipt-content')).toBeVisible({ timeout: 5_000 });
});

test('receipt page: receipt card is visible', async ({ page }) => {
  await page.goto(`${RECEIPT_URL}?orderId=ORDER_001`);
  await expect(page.locator('.receipt')).toBeVisible();
});

test('receipt page: receipt header shows "Payment Receipt"', async ({ page }) => {
  await page.goto(`${RECEIPT_URL}?orderId=ORDER_001`);
  await expect(page.locator('#receipt-content')).toBeVisible();
  const heading = page.locator('.receipt-header h1');
  await expect(heading).toContainText('Payment Receipt');
});

test('receipt page: order ID field is populated', async ({ page }) => {
  await page.goto(`${RECEIPT_URL}?orderId=ORDER_001`);
  await expect(page.locator('#receipt-content')).toBeVisible();
  const orderField = page.locator('#field-order-id');
  await expect(orderField).not.toBeEmpty();
  await expect(orderField).toContainText('ORDER_001');
});

test('receipt page: amount field is visible and non-empty', async ({ page }) => {
  await page.goto(`${RECEIPT_URL}?orderId=ORDER_001`);
  await expect(page.locator('#receipt-content')).toBeVisible();
  const amountField = page.locator('#field-amount');
  await expect(amountField).toBeVisible();
  const text = await amountField.textContent();
  expect(text?.trim().length).toBeGreaterThan(0);
});

test('receipt page: merchant name field is visible', async ({ page }) => {
  await page.goto(`${RECEIPT_URL}?orderId=ORDER_001`);
  await expect(page.locator('#receipt-content')).toBeVisible();
  await expect(page.locator('#field-merchant-name')).toBeVisible();
});

test('receipt page: payment date field is visible', async ({ page }) => {
  await page.goto(`${RECEIPT_URL}?orderId=ORDER_001`);
  await expect(page.locator('#receipt-content')).toBeVisible();
  await expect(page.locator('#field-date')).toBeVisible();
  const text = await page.locator('#field-date').textContent();
  expect(text?.trim().length).toBeGreaterThan(0);
});

// ── Action buttons ────────────────────────────────────────────────────────────

test('receipt page: action buttons are present (print and copy link)', async ({ page }) => {
  await page.goto(`${RECEIPT_URL}?orderId=ORDER_001`);
  await expect(page.locator('#receipt-content')).toBeVisible();
  const buttons = page.locator('.actions .btn');
  await expect(buttons).toHaveCount(2);
});

test('receipt page: Print button contains expected text', async ({ page }) => {
  await page.goto(`${RECEIPT_URL}?orderId=ORDER_001`);
  await expect(page.locator('#receipt-content')).toBeVisible();
  const printBtn = page.locator('.actions .btn-outline');
  await expect(printBtn).toContainText(/print/i);
});

test('receipt page: Copy Link button contains expected text', async ({ page }) => {
  await page.goto(`${RECEIPT_URL}?orderId=ORDER_001`);
  await expect(page.locator('#receipt-content')).toBeVisible();
  const copyBtn = page.locator('.actions .btn-primary');
  await expect(copyBtn).toContainText(/copy/i);
});

// ── Loading state ─────────────────────────────────────────────────────────────

test('receipt page: loading state is eventually hidden after page resolves', async ({ page }) => {
  await page.goto(`${RECEIPT_URL}?orderId=ORDER_001`);
  // Wait for either receipt or not-found — loading must be hidden by then.
  await Promise.race([
    page.locator('#receipt-content').waitFor({ state: 'visible' }),
    page.locator('#not-found').waitFor({ state: 'visible' }),
  ]);
  await expect(page.locator('#loading')).toBeHidden();
});

// ── No orderId ────────────────────────────────────────────────────────────────

test('receipt page: shows not-found when no orderId query param is provided', async ({ page }) => {
  await page.goto(RECEIPT_URL);
  await expect(page.locator('#not-found')).toBeVisible({ timeout: 5_000 });
});

test('receipt page: rejects an over-long orderId without rendering a receipt', async ({ page }) => {
  await page.goto(`${RECEIPT_URL}?orderId=${'X'.repeat(65)}`);
  await expect(page.locator('#not-found')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#receipt-content')).toBeHidden();
});

// ── Responsive layout ─────────────────────────────────────────────────────────

test('receipt page: renders correctly at mobile viewport (390x844)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${RECEIPT_URL}?orderId=ORDER_001`);
  await expect(page.locator('#receipt-content')).toBeVisible();
  await expect(page.locator('.receipt')).toBeVisible();
});

test('receipt page: renders correctly at desktop viewport (1280x800)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`${RECEIPT_URL}?orderId=ORDER_001`);
  await expect(page.locator('#receipt-content')).toBeVisible();
});

// ── Accessibility ─────────────────────────────────────────────────────────────

test('receipt page: not-found state contains helpful remediation text', async ({ page }) => {
  await page.goto(`${RECEIPT_URL}?orderId=NOT_FOUND`);
  await expect(page.locator('#not-found')).toBeVisible();
  // Should contain actionable next steps for the user.
  const notFound = page.locator('#not-found');
  const text = await notFound.textContent();
  expect(text).toMatch(/check|contact|ask|resend/i);
});
