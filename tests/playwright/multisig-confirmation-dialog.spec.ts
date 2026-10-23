/**
 * Playwright regression tests for the confirmation dialog modal in
 * frontend/multisig.html.
 * Closes issue #1337
 *
 * Acceptance criteria:
 *   - Confirmation modal is shown before submitting a multisig payment.
 *   - Cancel dismisses the modal without submitting.
 *   - Confirm proceeds with the actual submission.
 *   - Modal is keyboard-accessible (focus trap, Escape, initial focus).
 */
import { test, expect } from '@playwright/test';

const MULTISIG_URL = '/frontend/multisig.html';

// Valid 56-char Stellar addresses for form tests.
const VALID_G_ADDRESS = 'GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON';
const VALID_C_ADDRESS = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';

/**
 * Fill the multisig initiation form with valid data and click Submit.
 * Shared helper used across several tests.
 */
async function fillAndSubmitForm(page: import('@playwright/test').Page, opts: {
  paymentId?: string;
  merchant?: string;
  token?: string;
  amount?: string;
  signer?: string;
} = {}) {
  const {
    paymentId = 'MS_MODAL_001',
    merchant  = VALID_G_ADDRESS,
    token     = VALID_C_ADDRESS,
    amount    = '5000000',
    signer    = VALID_G_ADDRESS,
  } = opts;

  await page.locator('#payment-id').fill(paymentId);
  await page.locator('#merchant-address').fill(merchant);
  await page.locator('#token-address').fill(token);
  await page.locator('#amount').fill(amount);
  await page.locator('.signer-input').first().fill(signer);

  await page.locator('#submit-btn').click();
}

// ── Test 1: shows confirmation modal on submit ─────────────────────────────

test('confirmation modal: shows on submit with correct payment details', async ({ page }) => {
  await page.goto(MULTISIG_URL);

  await fillAndSubmitForm(page, {
    paymentId: 'MS_CONFIRM_001',
    merchant:  VALID_G_ADDRESS,
    token:     VALID_C_ADDRESS,
    amount:    '9876543',
    signer:    VALID_G_ADDRESS,
  });

  // Modal should be visible.
  const modal = page.locator('#confirmModal');
  await expect(modal).toBeVisible();

  // Verify each detail field contains the expected value.
  await expect(page.locator('#confirmMerchant')).toContainText(VALID_G_ADDRESS);
  await expect(page.locator('#confirmAmount')).toContainText('9876543');
  await expect(page.locator('#confirmToken')).toContainText(VALID_C_ADDRESS);
  // One signer, required = 1 → "1 of 1"
  await expect(page.locator('#confirmSigners')).toContainText('1 of 1');

  // Modal title must be present for ARIA.
  await expect(page.locator('#confirmModalTitle')).toBeVisible();

  // The irreversibility warning must be shown.
  await expect(page.locator('.modal__warning')).toContainText(/irreversible/i);
});

// ── Test 2: cancel button dismisses modal without submitting ───────────────

test('confirmation modal: cancel button dismisses modal without submitting', async ({ page }) => {
  await page.goto(MULTISIG_URL);

  await fillAndSubmitForm(page, { paymentId: 'MS_CANCEL_001' });

  // Modal should appear.
  await expect(page.locator('#confirmModal')).toBeVisible();

  // Track whether the progress panel becomes visible (would indicate submission).
  let progressPanelShown = false;
  page.locator('#progress-panel').waitFor({ state: 'visible', timeout: 1_500 })
    .then(() => { progressPanelShown = true; })
    .catch(() => { /* expected — panel should NOT appear */ });

  // Click Cancel.
  await page.locator('#confirmModalCancel').click();

  // Modal should now be hidden.
  await expect(page.locator('#confirmModal')).toBeHidden();

  // Form panel should still be visible (no navigation away).
  await expect(page.locator('#form-panel')).toBeVisible();

  // Progress panel must NOT have appeared.
  expect(progressPanelShown).toBe(false);

  // Submit button should regain focus after modal closes.
  await expect(page.locator('#submit-btn')).toBeFocused();
});

// ── Test 3: confirm button proceeds with submission ────────────────────────

test('confirmation modal: confirm button proceeds with submission', async ({ page }) => {
  await page.goto(MULTISIG_URL);

  await fillAndSubmitForm(page, { paymentId: 'MS_PROCEED_001' });

  // Wait for modal to appear.
  await expect(page.locator('#confirmModal')).toBeVisible();

  // Click Confirm.
  await page.locator('#confirmModalConfirm').click();

  // Modal should be dismissed.
  await expect(page.locator('#confirmModal')).toBeHidden();

  // In demo mode the contract call is simulated; the progress panel should
  // appear, indicating the submission was attempted and succeeded.
  await expect(page.locator('#progress-panel')).toBeVisible({ timeout: 5_000 });
  await expect(page.locator('#form-panel')).toBeHidden();
});

// ── Test 4: modal is keyboard accessible ──────────────────────────────────

test('confirmation modal: keyboard accessibility — initial focus, Tab trap, Escape', async ({ page }) => {
  await page.goto(MULTISIG_URL);

  await fillAndSubmitForm(page, { paymentId: 'MS_A11Y_001' });

  // Modal should be visible.
  await expect(page.locator('#confirmModal')).toBeVisible();

  // Initial focus must be on the Cancel button.
  await expect(page.locator('#confirmModalCancel')).toBeFocused();

  // Tab should move focus forward within the modal.
  await page.keyboard.press('Tab');
  // Next focusable element is the Confirm button.
  await expect(page.locator('#confirmModalConfirm')).toBeFocused();

  // Tab again should wrap back to Cancel (focus trap).
  await page.keyboard.press('Tab');
  await expect(page.locator('#confirmModalCancel')).toBeFocused();

  // Shift+Tab from Cancel should wrap to Confirm (reverse trap).
  await page.keyboard.press('Shift+Tab');
  await expect(page.locator('#confirmModalConfirm')).toBeFocused();

  // Pressing Escape should close the modal.
  await page.keyboard.press('Escape');
  await expect(page.locator('#confirmModal')).toBeHidden();

  // Focus should return to the submit button.
  await expect(page.locator('#submit-btn')).toBeFocused();
});
