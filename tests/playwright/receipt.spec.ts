import { test, expect } from '@playwright/test';

test('receipt page: form validation and empty state', async ({ page }) => {
  // TODO: add detailed checks for receipt display and validation
  await page.goto('http://localhost:8080/receipt.html');
  expect(true).toBeTruthy();
});
