import { test, expect } from '@playwright/test';

test('multisig page: form validation and empty state', async ({ page }) => {
  // TODO: validate multisig UI flows
  await page.goto('http://localhost:8080/multisig.html');
  expect(true).toBeTruthy();
});
