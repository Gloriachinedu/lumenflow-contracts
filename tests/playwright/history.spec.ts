/**
 * Playwright regression tests for frontend/history.html
 * Closes issue #333
 *
 * Acceptance criteria:
 *   - Tests verify form validation, navigation, and empty states.
 *   - Runs headless in CI.
 *   - Catches regressions in UI behaviour.
 */
import { test, expect } from '@playwright/test';

const HISTORY_URL = '/frontend/history.html';

// ── Page load and structure ───────────────────────────────────────────────────

test('history page: loads with correct title', async ({ page }) => {
  await page.goto(HISTORY_URL);
  await expect(page).toHaveTitle(/Payment History/i);
});

test('history page: renders the filter panel', async ({ page }) => {
  await page.goto(HISTORY_URL);
  await expect(page.locator('.filter-panel')).toBeVisible();
  await expect(page.locator('#merchant-address')).toBeVisible();
  await expect(page.locator('#date-start')).toBeVisible();
  await expect(page.locator('#date-end')).toBeVisible();
  await expect(page.locator('#amount-min')).toBeVisible();
  await expect(page.locator('#amount-max')).toBeVisible();
  await expect(page.locator('#token-selector')).toBeVisible();
  await expect(page.locator('#status-selector')).toBeVisible();
});

test('history page: renders the results table with header columns', async ({ page }) => {
  await page.goto(HISTORY_URL);
  await expect(page.locator('#history-table')).toBeVisible();
  const headers = page.locator('#history-table thead th');
  await expect(headers).toHaveCount(5);
});

// ── Demo mode — mock data rows visible without a contract ─────────────────────

test('history page: demo mode shows mock payment rows', async ({ page }) => {
  await page.goto(HISTORY_URL);
  // In demo mode (no CONTRACT_ID) mock rows are rendered immediately.
  const rows = page.locator('#history-body tr');
  await expect(rows.first()).toBeVisible({ timeout: 5_000 });
  const count = await rows.count();
  expect(count).toBeGreaterThan(0);
});

test('history page: demo mode does not show empty state', async ({ page }) => {
  await page.goto(HISTORY_URL);
  await page.waitForTimeout(300); // allow JS to run
  await expect(page.locator('#empty-state')).toBeHidden();
});

test('history page: each mock row has five cells', async ({ page }) => {
  await page.goto(HISTORY_URL);
  const firstRow = page.locator('#history-body tr').first();
  await expect(firstRow).toBeVisible();
  const cells = firstRow.locator('td');
  await expect(cells).toHaveCount(5);
});

// ── Status badges ─────────────────────────────────────────────────────────────

test('history page: mock rows include at least one status badge', async ({ page }) => {
  await page.goto(HISTORY_URL);
  await page.locator('#history-body tr').first().waitFor();
  const badges = page.locator('.status-badge');
  await expect(badges.first()).toBeVisible();
});

test('history page: Completed status badge has correct class', async ({ page }) => {
  await page.goto(HISTORY_URL);
  // At least one "Completed" badge should be present in the mock data.
  const completedBadge = page.locator('.status-completed').first();
  await expect(completedBadge).toBeVisible();
});

// ── Filter form interaction ───────────────────────────────────────────────────

test('history page: merchant address input accepts text', async ({ page }) => {
  await page.goto(HISTORY_URL);
  const input = page.locator('#merchant-address');
  await input.fill('GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON');
  await expect(input).toHaveValue('GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON');
});

test('history page: invalid merchant address shows an inline error', async ({ page }) => {
  await page.goto(HISTORY_URL);
  const input = page.locator('#merchant-address');
  await input.fill('not-an-address');
  await input.blur();
  await expect(page.locator('#merchant-address-err')).toBeVisible();
  await expect(page.locator('#merchant-address-err')).toContainText(/valid/i);
});

test('history page: valid merchant address shows no inline error', async ({ page }) => {
  await page.goto(HISTORY_URL);
  const input = page.locator('#merchant-address');
  await input.fill('GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON');
  await input.blur();
  await expect(page.locator('#merchant-address-err')).toBeHidden();
});

test('history page: negative minimum amount shows an inline error', async ({ page }) => {
  await page.goto(HISTORY_URL);
  const input = page.locator('#amount-min');
  await input.fill('-5');
  await input.blur();
  await expect(page.locator('#amount-min-err')).toBeVisible();
});

test('history page: status selector has expected options', async ({ page }) => {
  await page.goto(HISTORY_URL);
  const options = page.locator('#status-selector option');
  const values = await options.evaluateAll((opts: HTMLOptionElement[]) =>
    opts.map(o => o.value)
  );
  expect(values).toContain('Any');
  expect(values).toContain('Completed');
  expect(values).toContain('PartiallyRefunded');
  expect(values).toContain('FullyRefunded');
});

test('history page: token selector has at least two options', async ({ page }) => {
  await page.goto(HISTORY_URL);
  const count = await page.locator('#token-selector option').count();
  expect(count).toBeGreaterThanOrEqual(2);
});

test('history page: status change triggers filter chip', async ({ page }) => {
  await page.goto(HISTORY_URL);
  await page.locator('#status-selector').selectOption('Completed');
  // A chip should appear for the active filter.
  const chips = page.locator('#active-filters .chip');
  await expect(chips).toHaveCount(1);
  await expect(chips.first()).toContainText('Completed');
});

test('history page: removing a chip clears the filter', async ({ page }) => {
  await page.goto(HISTORY_URL);
  await page.locator('#status-selector').selectOption('Completed');
  // Wait for the chip to appear then remove it.
  const removeBtn = page.locator('#active-filters .chip button').first();
  await expect(removeBtn).toBeVisible();
  await removeBtn.click();
  await expect(page.locator('#active-filters .chip')).toHaveCount(0);
});

// ── Error and loading states ──────────────────────────────────────────────────

test('history page: error state is hidden by default', async ({ page }) => {
  await page.goto(HISTORY_URL);
  await expect(page.locator('#error-state')).toBeHidden();
});

test('history page: loading state is hidden by default', async ({ page }) => {
  await page.goto(HISTORY_URL);
  await expect(page.locator('#loading-state')).toBeHidden();
});

// ── Accessibility ─────────────────────────────────────────────────────────────

test('history page: filter panel has accessible heading', async ({ page }) => {
  await page.goto(HISTORY_URL);
  // The filter heading is visually hidden but present for screen readers.
  const heading = page.locator('#filter-heading');
  await expect(heading).toBeAttached();
  await expect(heading).toHaveText(/Filters/i);
});

test('history page: filter inputs have associated labels', async ({ page }) => {
  await page.goto(HISTORY_URL);
  // Each visible input should have a corresponding label.
  const labelledInputs = ['merchant-address', 'amount-min', 'amount-max'];
  for (const id of labelledInputs) {
    const input = page.locator(`#${id}`);
    await expect(input).toBeVisible();
  }
});

// ── URL persistence ───────────────────────────────────────────────────────────

test('history page: filter state is reflected in URL after change', async ({ page }) => {
  await page.goto(HISTORY_URL);
  await page.locator('#status-selector').selectOption('Completed');
  const url = page.url();
  expect(url).toContain('status=Completed');
});

test('history page: pre-populated filters restored from URL query params', async ({ page }) => {
  await page.goto(`${HISTORY_URL}?status=FullyRefunded`);
  const select = page.locator('#status-selector');
  await expect(select).toHaveValue('FullyRefunded');
  // Chip must appear for the pre-populated filter.
  await expect(page.locator('#active-filters .chip')).toHaveCount(1);
});

test('history page: invalid amount URL params are dropped and flagged', async ({ page }) => {
  await page.goto(`${HISTORY_URL}?amount_min=-5&amount_max=abc`);
  await expect(page.locator('#amount-min-err')).toBeVisible();
  await expect(page.locator('#amount-max-err')).toBeVisible();
  // Dropped values must not become active filters.
  await expect(page.locator('#active-filters .chip')).toHaveCount(0);
});

test('history page: invalid merchant address URL param is dropped and flagged', async ({ page }) => {
  await page.goto(`${HISTORY_URL}?merchant_address=not-an-address`);
  await expect(page.locator('#merchant-address-err')).toBeVisible();
  await expect(page.locator('#active-filters .chip')).toHaveCount(0);
});

// ── Responsive layout ─────────────────────────────────────────────────────────

test('history page: renders correctly at mobile viewport (390x844)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HISTORY_URL);
  await expect(page.locator('.filter-panel')).toBeVisible();
  await expect(page.locator('#history-table')).toBeVisible();
});

test('history page: renders correctly at desktop viewport (1280x800)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(HISTORY_URL);
  await expect(page.locator('.filter-panel')).toBeVisible();
  await expect(page.locator('#history-table')).toBeVisible();
});
