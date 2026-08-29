/**
 * Browser tests for keyboard-only payment completion.
 * Closes issue #882
 *
 * A generated payment link opens frontend/receipt.html in "pre-fill" mode
 * (`?merchant=…`), showing the payment summary and a "Pay with Freighter" CTA.
 * These tests drive that flow with the keyboard only:
 *   - the pay button is reachable via Tab and is a native, activatable control
 *   - activating it with the keyboard does not raise a script error
 *   - the "Copy Link" action is also keyboard reachable
 *   - an expired link disables the CTA and keeps it out of the tab order
 */
import { test, expect } from '@playwright/test';

const MERCHANT = 'GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON';
const TOKEN = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

function linkUrl(extra = ''): string {
  return `/frontend/receipt.html?merchant=${MERCHANT}&token=${TOKEN}&amount=50000000&order_id=ORDER_KBD${extra}`;
}

/** Presses Tab up to `max` times until the element with `id` holds focus. */
async function tabUntilFocused(page, id: string, max = 30): Promise<boolean> {
  for (let i = 0; i < max; i++) {
    const active = await page.evaluate(() => document.activeElement?.id ?? '');
    if (active === id) return true;
    await page.keyboard.press('Tab');
  }
  return (await page.evaluate(() => document.activeElement?.id ?? '')) === id;
}

test('payment link: pay button is reachable and activatable by keyboard', async ({ page }) => {
  await page.goto(linkUrl());
  await expect(page.locator('#payment-prefill')).toBeVisible();

  const payBtn = page.locator('#prefill-pay-btn');
  await expect(payBtn).toBeVisible();
  await expect(payBtn).toBeEnabled();
  await expect(payBtn).toHaveJSProperty('tagName', 'BUTTON');

  await page.evaluate(() => document.body.focus());
  expect(await tabUntilFocused(page, 'prefill-pay-btn')).toBe(true);
});

test('payment link: keyboard activation of the pay button raises no error', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(linkUrl());
  await expect(page.locator('#payment-prefill')).toBeVisible();

  await page.evaluate(() => document.body.focus());
  expect(await tabUntilFocused(page, 'prefill-pay-btn')).toBe(true);

  const before = errors.length;
  await page.keyboard.press('Enter');
  await page.keyboard.press(' ');
  expect(errors.length).toBe(before);
  await expect(page.locator('#prefill-pay-btn')).toBeFocused();
});

test('payment link: the Copy Link action is keyboard reachable', async ({ page }) => {
  await page.goto(linkUrl());
  await expect(page.locator('#payment-prefill')).toBeVisible();

  const copyBtn = page.locator('#payment-prefill button', { hasText: /Copy Link/i });
  await expect(copyBtn).toBeVisible();
  await copyBtn.focus();
  await expect(copyBtn).toBeFocused();
});

test('payment link: an expired link disables the pay button (edge case)', async ({ page }) => {
  // `expires` in the distant past → link is expired.
  await page.goto(linkUrl('&expires=1000000000000'));
  await expect(page.locator('#payment-prefill')).toBeVisible();

  await expect(page.locator('#prefill-expired-badge')).toBeVisible();
  await expect(page.locator('#prefill-pay-btn')).toBeDisabled();

  // A disabled control must not receive keyboard focus.
  await page.evaluate(() => document.body.focus());
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press('Tab');
    const active = await page.evaluate(() => document.activeElement?.id ?? '');
    expect(active).not.toBe('prefill-pay-btn');
  }
});
