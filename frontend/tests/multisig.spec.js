import { test, expect } from '@playwright/test';

test.describe('Multisig Payment Form Validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('file://' + __dirname + '/../multisig.html');
  });

  test('should show error for invalid signer address', async ({ page }) => {
    // Fill in valid required fields
    await page.fill('#payment-id', 'MS_001');
    await page.fill('#merchant-address', 'GD6WUVRX7XJ6E5Q5K2L2K3K4K5K6K7K8K9K0K1K2K3K4K5K6K7K8K9K0K1K2');
    await page.fill('#token-address', 'CD6WUVRX7XJ6E5Q5K2L2K3K4K5K6K7K8K9K0K1K2K3K4K5K6K7K8K9K0K1K2');
    await page.fill('#amount', '1000000');

    // Enter an invalid signer address (too short)
    await page.fill('.signer-input', 'INVALID');

    // Try to submit
    await page.click('#submit-btn');

    // Check that inline error is shown for the signer input
    const signerError = page.locator('.signer-err');
    await expect(signerError).toBeVisible();
    await expect(signerError).toHaveText('Invalid Stellar address');
  });

  test('should show error for signer address with wrong prefix', async ({ page }) => {
    // Fill in valid required fields
    await page.fill('#payment-id', 'MS_002');
    await page.fill('#merchant-address', 'GD6WUVRX7XJ6E5Q5K2L2K3K4K5K6K7K8K9K0K1K2K3K4K5K6K7K8K9K0K1K2');
    await page.fill('#token-address', 'CD6WUVRX7XJ6E5Q5K2L2K3K4K5K6K7K8K9K0K1K2K3K4K5K6K7K8K9K0K1K2');
    await page.fill('#amount', '1000000');

    // Enter a signer address with wrong prefix (C instead of G)
    await page.fill('.signer-input', 'CD6WUVRX7XJ6E5Q5K2L2K3K4K5K6K7K8K9K0K1K2K3K4K5K6K7K8K9K0K1K2');

    // Try to submit
    await page.click('#submit-btn');

    // Check that inline error is shown
    const signerError = page.locator('.signer-err');
    await expect(signerError).toBeVisible();
  });

  test('should accept valid signer address', async ({ page }) => {
    // Fill in valid required fields
    await page.fill('#payment-id', 'MS_003');
    await page.fill('#merchant-address', 'GD6WUVRX7XJ6E5Q5K2L2K3K4K5K6K7K8K9K0K1K2K3K4K5K6K7K8K9K0K1K2');
    await page.fill('#token-address', 'CD6WUVRX7XJ6E5Q5K2L2K3K4K5K6K7K8K9K0K1K2K3K4K5K6K7K8K9K0K1K2');
    await page.fill('#amount', '1000000');

    // Enter a valid signer address
    await page.fill('.signer-input', 'GD6WUVRX7XJ6E5Q5K2L2K3K4K5K6K7K8K9K0K1K2K3K4K5K6K7K8K9K0K1K2');

    // Try to submit
    await page.click('#submit-btn');

    // Check that inline error is NOT shown
    const signerError = page.locator('.signer-err');
    await expect(signerError).not.toBeVisible();
  });

  test('should show error for invalid merchant address', async ({ page }) => {
    await page.fill('#payment-id', 'MS_004');
    await page.fill('#merchant-address', 'INVALID');
    await page.fill('#token-address', 'CD6WUVRX7XJ6E5Q5K2L2K3K4K5K6K7K8K9K0K1K2K3K4K5K6K7K8K9K0K1K2');
    await page.fill('#amount', '1000000');
    await page.fill('.signer-input', 'GD6WUVRX7XJ6E5Q5K2L2K3K4K5K6K7K8K9K0K1K2K3K4K5K6K7K8K9K0K1K2');

    await page.click('#submit-btn');

    const merchantError = page.locator('#err-merchant');
    await expect(merchantError).toBeVisible();
  });

  test('should show error for invalid token address', async ({ page }) => {
    await page.fill('#payment-id', 'MS_005');
    await page.fill('#merchant-address', 'GD6WUVRX7XJ6E5Q5K2L2K3K4K5K6K7K8K9K0K1K2K3K4K5K6K7K8K9K0K1K2');
    await page.fill('#token-address', 'INVALID');
    await page.fill('#amount', '1000000');
    await page.fill('.signer-input', 'GD6WUVRX7XJ6E5Q5K2L2K3K4K5K6K7K8K9K0K1K2K3K4K5K6K7K8K9K0K1K2');

    await page.click('#submit-btn');

    const tokenError = page.locator('#err-token');
    await expect(tokenError).toBeVisible();
  });
});
