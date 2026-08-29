/**
 * Property tests for cursor pagination stability.
 * Closes issue #884
 *
 * frontend/payment-history-paginated.html walks a mock "contract" API using an
 * opaque cursor (the last-seen order_id). These tests assert the invariants a
 * cursor pager must hold regardless of page size or navigation order:
 *
 *   - completeness .... every record appears exactly once across all pages
 *   - ordering ........ records keep their global order
 *   - stability ....... revisiting a page yields the identical rows
 *   - boundaries ...... Prev is disabled on the first page, Next on the last
 *   - bookmarkable .... a `?cursor=` URL resumes from that record
 */
import { test, expect } from '@playwright/test';

const PAGE_URL = '/frontend/payment-history-paginated.html';

// The full ordered dataset backing the mock API (ORDER_001 … ORDER_012).
const ALL_IDS = Array.from(
  { length: 12 },
  (_, i) => `ORDER_${String(i + 1).padStart(3, '0')}`
);

/** Order IDs currently rendered in the table body. */
async function visibleIds(page): Promise<string[]> {
  return page.locator('#table-body tr .order-id').allTextContents();
}

/** Walk from the current page to the last one, collecting every order ID. */
async function walkForward(page): Promise<string[]> {
  const collected: string[] = [];
  let pageNum = 1;
  for (;;) {
    await expect(page.locator('#page-meta')).toHaveText(
      new RegExp(`Page ${pageNum} · \\d+ record`)
    );
    collected.push(...(await visibleIds(page)));
    const next = page.locator('#next-btn');
    if (await next.isDisabled()) break;
    pageNum += 1;
    await next.click();
  }
  return collected;
}

for (const size of ['5', '10', '25']) {
  test(`pagination: page size ${size} yields every record once, in order`, async ({ page }) => {
    await page.goto(PAGE_URL);
    if (size !== '5') {
      await page.locator('#page-size').selectOption(size);
    }
    const collected = await walkForward(page);
    expect(collected).toEqual(ALL_IDS);
    expect(new Set(collected).size).toBe(ALL_IDS.length); // no duplicates
  });
}

test('pagination: revisiting a page returns identical rows (cursor is stable)', async ({ page }) => {
  await page.goto(PAGE_URL);

  await expect(page.locator('#page-meta')).toHaveText(/Page 1 · \d+ record/);
  const page1 = await visibleIds(page);

  await page.locator('#next-btn').click();
  await expect(page.locator('#page-meta')).toHaveText(/Page 2 · \d+ record/);
  const page2 = await visibleIds(page);

  await page.locator('#next-btn').click();
  await expect(page.locator('#page-meta')).toHaveText(/Page 3 · \d+ record/);

  // Walk back to page 1 …
  await page.locator('#prev-btn').click();
  await expect(page.locator('#page-meta')).toHaveText(/Page 2 · \d+ record/);
  expect(await visibleIds(page)).toEqual(page2);

  await page.locator('#prev-btn').click();
  await expect(page.locator('#page-meta')).toHaveText(/Page 1 · \d+ record/);
  expect(await visibleIds(page)).toEqual(page1);

  // … and forward again: the stored cursor must reproduce page 2 exactly.
  await page.locator('#next-btn').click();
  await expect(page.locator('#page-meta')).toHaveText(/Page 2 · \d+ record/);
  expect(await visibleIds(page)).toEqual(page2);
});

test('pagination: navigation buttons respect the dataset boundaries', async ({ page }) => {
  await page.goto(PAGE_URL);
  await expect(page.locator('#page-meta')).toHaveText(/Page 1 · \d+ record/);

  // First page: no previous.
  await expect(page.locator('#prev-btn')).toBeDisabled();
  await expect(page.locator('#next-btn')).toBeEnabled();

  const ids = await walkForward(page);
  expect(ids[ids.length - 1]).toBe(ALL_IDS[ALL_IDS.length - 1]);

  // Last page: no next.
  await expect(page.locator('#next-btn')).toBeDisabled();
  await expect(page.locator('#prev-btn')).toBeEnabled();
});

test('pagination: changing page size resets to the first page', async ({ page }) => {
  await page.goto(PAGE_URL);
  await page.locator('#next-btn').click();
  await expect(page.locator('#page-meta')).toHaveText(/Page 2 · \d+ record/);

  await page.locator('#page-size').selectOption('10');
  await expect(page.locator('#page-meta')).toHaveText(/Page 1 · \d+ record/);
  await expect(page.locator('#prev-btn')).toBeDisabled();
});

test('pagination: a ?cursor= URL resumes from that record', async ({ page }) => {
  await page.goto(`${PAGE_URL}?cursor=ORDER_006`);
  await expect(page.locator('#page-meta')).toHaveText(/Page 1 · \d+ record/);

  const ids = await visibleIds(page);
  expect(ids[0]).toBe('ORDER_006');
  // Back-stack cannot be reconstructed from a single cursor, so Prev stays off.
  await expect(page.locator('#prev-btn')).toBeDisabled();

  // Forward navigation from the bookmarked position still works.
  await page.locator('#next-btn').click();
  await expect(page.locator('#page-meta')).toHaveText(/Page 2 · \d+ record/);
  expect((await visibleIds(page))[0]).toBe('ORDER_011');
});
