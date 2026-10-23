/**
 * Browser tests for wallet disconnect and reconnect flows.
 * Closes issue #881
 *
 * frontend/wallet-status.js renders the nav wallet chip. With no Freighter
 * extension present it uses a demo adapter that simulates connect / disconnect,
 * and emits a `lf:walletchange` event on every state transition. These tests
 * exercise that lifecycle on frontend/onboarding.html:
 *   - connect → disconnect (via the dropdown) → reconnect
 *   - each transition fires `lf:walletchange` with the correct detail
 *   - the chip is operable by keyboard (Enter to connect, Escape to close menu)
 *   - an expired session mid-transaction prompts a reconnect before retrying
 *     (issue #1334)
 */
import { test, expect } from '@playwright/test';

const PAGE_URL = '/frontend/onboarding.html';

test.beforeEach(async ({ page }) => {
  // Record every wallet-change event the chip emits.
  await page.addInitScript(() => {
    (window as unknown as { __walletEvents: unknown[] }).__walletEvents = [];
    window.addEventListener('lf:walletchange', (e) => {
      (window as unknown as { __walletEvents: unknown[] }).__walletEvents.push(
        (e as CustomEvent).detail
      );
    });
  });
});

const lastEvent = (page) =>
  page.evaluate(
    () =>
      (window as unknown as { __walletEvents: any[] }).__walletEvents.at(-1) ??
      null
  );

/**
 * Simulate a Freighter session expiring mid-transaction. The demo adapter
 * exposes `__expireSession()` which flips the session to expired and emits a
 * `lf:walletsessionexpired` event so the UI can prompt for a reconnect.
 */
const expireSession = (page) =>
  page.evaluate(() => {
    const w = window as unknown as { __expireSession?: () => void };
    if (typeof w.__expireSession === 'function') {
      w.__expireSession();
    } else {
      window.dispatchEvent(new CustomEvent('lf:walletsessionexpired'));
    }
  });

test('wallet chip: connects, disconnects, and reconnects', async ({ page }) => {
  await page.goto(PAGE_URL);

  const chip = page.locator('.wallet-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toHaveClass(/disconnected/);

  // ── Connect ───────────────────────────────────────────────────────────────
  await chip.click();
  await expect(chip).toHaveClass(/\bconnected\b/, { timeout: 5_000 });
  await expect(chip.locator('.wallet-chip__label')).toHaveText(/Connected:/);
  expect(await lastEvent(page)).toMatchObject({ connected: true });
  expect((await lastEvent(page)).publicKey).toBeTruthy();

  // ── Disconnect via the dropdown ───────────────────────────────────────────
  await chip.click();
  const disconnect = page.locator('.wallet-dropdown button', {
    hasText: /Disconnect/i,
  });
  await expect(disconnect).toBeVisible();
  await disconnect.click();

  await expect(chip).toHaveClass(/disconnected/);
  await expect(chip.locator('.wallet-chip__label')).toHaveText('Disconnected');
  expect(await lastEvent(page)).toMatchObject({
    connected: false,
    publicKey: null,
  });

  // ── Reconnect ─────────────────────────────────────────────────────────────
  await chip.click();
  await expect(chip).toHaveClass(/\bconnected\b/, { timeout: 5_000 });
  expect(await lastEvent(page)).toMatchObject({ connected: true });
});

test('wallet chip: is operable with the keyboard', async ({ page }) => {
  await page.goto(PAGE_URL);

  const chip = page.locator('.wallet-chip');
  await expect(chip).toHaveAttribute('role', 'button');
  await expect(chip).toHaveAttribute('tabindex', '0');

  await chip.focus();
  await expect(chip).toBeFocused();

  // Enter triggers the connect flow.
  await page.keyboard.press('Enter');
  await expect(chip).toHaveClass(/\bconnected\b/, { timeout: 5_000 });

  // Enter opens the dropdown; Escape closes it without disconnecting.
  await page.keyboard.press('Enter');
  await expect(page.locator('.wallet-dropdown')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.wallet-dropdown')).toHaveCount(0);
  await expect(chip).toHaveClass(/\bconnected\b/);
});

test('wallet chip: reconnect after disconnect restores a usable session', async ({ page }) => {
  await page.goto(PAGE_URL);
  const chip = page.locator('.wallet-chip');

  await chip.click();
  await expect(chip).toHaveClass(/\bconnected\b/, { timeout: 5_000 });
  const firstKey = (await lastEvent(page)).publicKey;

  await chip.click();
  await page
    .locator('.wallet-dropdown button', { hasText: /Disconnect/i })
    .click();
  await expect(chip).toHaveClass(/disconnected/);

  await chip.click();
  await expect(chip).toHaveClass(/\bconnected\b/, { timeout: 5_000 });
  const secondKey = (await lastEvent(page)).publicKey;

  expect(secondKey).toBeTruthy();
  expect(secondKey).toBe(firstKey);
  // The dropdown must work again after reconnecting.
  await chip.click();
  await expect(page.locator('.wallet-dropdown')).toBeVisible();
});

test('wallet session: expiry before signing shows a reconnect prompt', async ({ page }) => {
  await page.goto(PAGE_URL);
  const chip = page.locator('.wallet-chip');

  await chip.click();
  await expect(chip).toHaveClass(/\bconnected\b/, { timeout: 5_000 });

  // Session expires mid-transaction, before the user signs.
  await expireSession(page);

  const prompt = page.locator('.wallet-reconnect-prompt');
  await expect(prompt).toBeVisible({ timeout: 5_000 });
  await expect(prompt).toContainText(/reconnect/i);
  // The chip reflects the expired session rather than silently staying connected.
  await expect(chip).toHaveClass(/disconnected/);
});

test('wallet session: reconnect retries the pending transaction automatically', async ({ page }) => {
  await page.goto(PAGE_URL);
  const chip = page.locator('.wallet-chip');

  await chip.click();
  await expect(chip).toHaveClass(/\bconnected\b/, { timeout: 5_000 });

  await expireSession(page);
  const prompt = page.locator('.wallet-reconnect-prompt');
  await expect(prompt).toBeVisible({ timeout: 5_000 });

  // User reconnects from the prompt; the pending transaction is retried.
  await prompt.locator('button', { hasText: /Reconnect/i }).click();

  await expect(prompt).toHaveCount(0);
  await expect(chip).toHaveClass(/\bconnected\b/, { timeout: 5_000 });
  expect(await lastEvent(page)).toMatchObject({ connected: true });

  // The retried transaction completes without a stuck loading state.
  const status = page.locator('.tx-status');
  await expect(status).toHaveText(/submitted|success/i, { timeout: 5_000 });
  await expect(page.locator('.tx-status.loading')).toHaveCount(0);
});

test('wallet session: dismissing the reconnect prompt cancels the transaction cleanly', async ({ page }) => {
  await page.goto(PAGE_URL);
  const chip = page.locator('.wallet-chip');

  await chip.click();
  await expect(chip).toHaveClass(/\bconnected\b/, { timeout: 5_000 });

  await expireSession(page);
  const prompt = page.locator('.wallet-reconnect-prompt');
  await expect(prompt).toBeVisible({ timeout: 5_000 });

  // User dismisses the prompt instead of reconnecting.
  await prompt.locator('button', { hasText: /Cancel|Dismiss/i }).click();

  await expect(prompt).toHaveCount(0);
  // Transaction is cancelled cleanly — no silent failure, no stuck loading state.
  const status = page.locator('.tx-status');
  await expect(status).toHaveText(/cancelled/i, { timeout: 5_000 });
  await expect(page.locator('.tx-status.loading')).toHaveCount(0);
  await expect(chip).toHaveClass(/disconnected/);
});
