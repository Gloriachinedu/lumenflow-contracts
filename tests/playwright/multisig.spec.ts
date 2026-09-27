/**
 * Playwright regression tests for frontend/multisig.html
 * Closes issue #333
 *
 * Acceptance criteria:
 *   - Tests verify form validation, navigation, and empty states.
 *   - Runs headless in CI.
 *   - Catches regressions in UI behaviour.
 */
import { test, expect } from '@playwright/test';

const MULTISIG_URL = '/frontend/multisig.html';

// Valid-looking 56-char Stellar addresses for form tests.
const VALID_G_ADDRESS = 'GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON';
const VALID_C_ADDRESS = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

// ── Page load ─────────────────────────────────────────────────────────────────

test('multisig page: loads with correct title', async ({ page }) => {
  await page.goto(MULTISIG_URL);
  await expect(page).toHaveTitle(/Multisig/i);
});

test('multisig page: shows the initiation form on load', async ({ page }) => {
  await page.goto(MULTISIG_URL);
  await expect(page.locator('#form-panel')).toBeVisible();
});

test('multisig page: progress panel is hidden on load', async ({ page }) => {
  await page.goto(MULTISIG_URL);
  await expect(page.locator('#progress-panel')).toBeHidden();
});

// ── Form structure ────────────────────────────────────────────────────────────

test('multisig page: all required form fields are present', async ({ page }) => {
  await page.goto(MULTISIG_URL);
  await expect(page.locator('#payment-id')).toBeVisible();
  await expect(page.locator('#merchant-address')).toBeVisible();
  await expect(page.locator('#token-address')).toBeVisible();
  await expect(page.locator('#amount')).toBeVisible();
  await expect(page.locator('#required-sigs')).toBeVisible();
  await expect(page.locator('#submit-btn')).toBeVisible();
});

test('multisig page: at least one signer input row is present on load', async ({ page }) => {
  await page.goto(MULTISIG_URL);
  const signerInputs = page.locator('.signer-input');
  await expect(signerInputs).toHaveCount(1);
});

test('multisig page: "Add signer" button is present', async ({ page }) => {
  await page.goto(MULTISIG_URL);
  await expect(page.locator('#add-signer-btn')).toBeVisible();
});

// -- Form validation: inline errors and submit gating --------------------------

test('multisig page: submit button is disabled while the form is empty', async ({ page }) => {
  await page.goto(MULTISIG_URL);
  await expect(page.locator('#submit-btn')).toBeDisabled();
});

test('multisig page: payment ID error is shown when field is cleared', async ({ page }) => {
  await page.goto(MULTISIG_URL);
  await page.locator('#payment-id').fill('MS_001');
  await page.locator('#payment-id').fill('');
  await expect(page.locator('#err-payment-id')).toBeVisible();
  await expect(page.locator('#err-payment-id')).toContainText(/required/i);
});

test('multisig page: payment ID longer than 64 characters shows an error', async ({ page }) => {
  await page.goto(MULTISIG_URL);
  await page.locator('#payment-id').fill('X'.repeat(65));
  await expect(page.locator('#err-payment-id')).toBeVisible();
  await expect(page.locator('#err-payment-id')).toContainText(/64/);
  await expect(page.locator('#submit-btn')).toBeDisabled();
});

test('multisig page: merchant address error shown for invalid address', async ({ page }) => {
  await page.goto(MULTISIG_URL);
  await page.locator('#merchant-address').fill('NOT_A_VALID_ADDRESS');
  await expect(page.locator('#err-merchant')).toBeVisible();
  await expect(page.locator('#err-merchant')).toContainText(/valid/i);
  await expect(page.locator('#submit-btn')).toBeDisabled();
});

test('multisig page: token address error shown for invalid address', async ({ page }) => {
  await page.goto(MULTISIG_URL);
  await page.locator('#token-address').fill('INVALID');
  await expect(page.locator('#err-token')).toBeVisible();
  await expect(page.locator('#err-token')).toContainText(/valid/i);
});

test('multisig page: amount error shown for zero amount', async ({ page }) => {
  await page.goto(MULTISIG_URL);
  await page.locator('#amount').fill('0');
  await expect(page.locator('#err-amount')).toBeVisible();
  await expect(page.locator('#submit-btn')).toBeDisabled();
});

test('multisig page: amount error shown for negative amount', async ({ page }) => {
  await page.goto(MULTISIG_URL);
  await page.locator('#amount').fill('-5');
  await expect(page.locator('#err-amount')).toBeVisible();
  await expect(page.locator('#submit-btn')).toBeDisabled();
});

test('multisig page: amount error shown when field is cleared', async ({ page }) => {
  await page.goto(MULTISIG_URL);
  await page.locator('#amount').fill('100');
  await page.locator('#amount').fill('');
  await expect(page.locator('#err-amount')).toBeVisible();
});

test('multisig page: submit button enables once all fields are valid', async ({ page }) => {
  await page.goto(MULTISIG_URL);
  await page.locator('#payment-id').fill('MS_001');
  await page.locator('#merchant-address').fill(VALID_G_ADDRESS);
  await page.locator('#token-address').fill(VALID_C_ADDRESS);
  await page.locator('#amount').fill('5000000');
  await page.locator('.signer-input').first().fill(VALID_G_ADDRESS);
  await expect(page.locator('#submit-btn')).toBeEnabled();
});

// ── Signer management ─────────────────────────────────────────────────────────

test('multisig page: clicking "Add signer" adds a new signer row', async ({ page }) => {
  await page.goto(MULTISIG_URL);
  await page.locator('#add-signer-btn').click();
  const signerRows = page.locator('.signer-row');
  await expect(signerRows).toHaveCount(2);
});

test('multisig page: adding two signers increments signer count label', async ({ page }) => {
  await page.goto(MULTISIG_URL);
  await page.locator('#add-signer-btn').click();
  await page.locator('#add-signer-btn').click();
  const countLabel = page.locator('#signer-count');
  await expect(countLabel).toContainText('3');
});

test('multisig page: removing a signer row updates the signer count label', async ({ page }) => {
  await page.goto(MULTISIG_URL);
  await page.locator('#add-signer-btn').click();
  // Should now have 2 rows; remove one.
  const removeBtn = page.locator('.signer-row button').last();
  await removeBtn.click();
  const signerRows = page.locator('.signer-row');
  await expect(signerRows).toHaveCount(1);
  await expect(page.locator('#signer-count')).toContainText('1');
});

// ── Threshold validation ──────────────────────────────────────────────────────

test('multisig page: threshold message shows valid state when required <= signer count', async ({ page }) => {
  await page.goto(MULTISIG_URL);
  await page.locator('#required-sigs').fill('1');
  // Trigger the input event.
  await page.locator('#required-sigs').dispatchEvent('input');
  const msg = page.locator('#threshold-msg');
  await expect(msg).toContainText(/valid/i);
});

test('multisig page: threshold message shows error when required > signer count', async ({ page }) => {
  await page.goto(MULTISIG_URL);
  // Only one signer row; set required to 2.
  await page.locator('#required-sigs').fill('2');
  await page.locator('#required-sigs').dispatchEvent('input');
  const msg = page.locator('#threshold-msg');
  await expect(msg).toContainText(/cannot exceed/i);
});

// ── Demo mode submission ──────────────────────────────────────────────────────

test('multisig page: valid form submission in demo mode shows progress panel', async ({ page }) => {
  await page.goto(MULTISIG_URL);

  await page.locator('#payment-id').fill('MS_SMOKE_001');
  await page.locator('#merchant-address').fill(VALID_G_ADDRESS);
  await page.locator('#token-address').fill(VALID_C_ADDRESS);
  await page.locator('#amount').fill('5000000');
  await page.locator('.signer-input').first().fill(VALID_G_ADDRESS);

  await page.locator('#submit-btn').click();

  // In demo mode the contract call is simulated; progress panel should appear.
  await expect(page.locator('#progress-panel')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#form-panel')).toBeHidden();
});

test('multisig page: progress panel shows signer list after submission', async ({ page }) => {
  await page.goto(MULTISIG_URL);

  await page.locator('#payment-id').fill('MS_SMOKE_002');
  await page.locator('#merchant-address').fill(VALID_G_ADDRESS);
  await page.locator('#token-address').fill(VALID_C_ADDRESS);
  await page.locator('#amount').fill('1000000');
  await page.locator('.signer-input').first().fill(VALID_G_ADDRESS);
  await page.locator('#submit-btn').click();

  await expect(page.locator('#progress-panel')).toBeVisible({ timeout: 5_000 });
  const signerList = page.locator('#signer-status-list li');
  await expect(signerList).toHaveCount(1);
});

test('multisig page: execute button is disabled before threshold is met', async ({ page }) => {
  await page.goto(MULTISIG_URL);

  // Add two signers with threshold of 2.
  await page.locator('#add-signer-btn').click();
  await page.locator('.signer-input').nth(0).fill(VALID_G_ADDRESS);
  // Second signer needs a different address (use a slight variation)
  const VALID_G_ADDRESS_2 = 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWNY';
  await page.locator('.signer-input').nth(1).fill(VALID_G_ADDRESS_2);
  await page.locator('#required-sigs').fill('2');

  await page.locator('#payment-id').fill('MS_SMOKE_003');
  await page.locator('#merchant-address').fill(VALID_G_ADDRESS);
  await page.locator('#token-address').fill(VALID_C_ADDRESS);
  await page.locator('#amount').fill('2000000');

  await page.locator('#submit-btn').click();

  await expect(page.locator('#progress-panel')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#execute-btn')).toBeDisabled();
});

// ── Wallet status bar ─────────────────────────────────────────────────────────

test('multisig page: wallet bar is visible on load', async ({ page }) => {
  await page.goto(MULTISIG_URL);
  await expect(page.locator('#wallet-bar')).toBeVisible();
});

test('multisig page: wallet bar shows demo mode warning by default', async ({ page }) => {
  await page.goto(MULTISIG_URL);
  const barText = await page.locator('#wallet-bar-text').textContent();
  expect(barText).toMatch(/demo/i);
});

test('multisig page: Connect Wallet button is present', async ({ page }) => {
  await page.goto(MULTISIG_URL);
  await expect(page.locator('#connect-wallet-btn')).toBeVisible();
});

// ── Responsive layout ─────────────────────────────────────────────────────────

test('multisig page: renders form correctly at mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(MULTISIG_URL);
  await expect(page.locator('#form-panel')).toBeVisible();
  await expect(page.locator('#submit-btn')).toBeVisible();
});

test('multisig page: renders form correctly at desktop viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(MULTISIG_URL);
  await expect(page.locator('#form-panel')).toBeVisible();
  await expect(page.locator('#submit-btn')).toBeVisible();
});
