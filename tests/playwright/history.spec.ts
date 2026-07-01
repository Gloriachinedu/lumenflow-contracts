import { test, expect } from '@playwright/test';

test('history page: empty state and navigation', async ({ page }) => {
  // TODO: flesh out selectors and assertions
  await page.goto('http://localhost:8080/history.html');
  // placeholder assertion
  expect(true).toBeTruthy();
});
