/**
 * HTML snapshot tests for frontend/payment-history.html
 * Closes issue #1322
 *
 * Purpose: Capture the full DOM structure of the payment history page in its
 * loaded (demo-mode) state and fail CI when unintended structural changes are
 * introduced — e.g., missing table headers, broken filter controls, or absent
 * pagination controls.
 *
 * The tests normalise dynamic content (timestamps, live RPC data) by injecting
 * a deterministic mock before each test, so snapshots are stable across runs.
 *
 * ## Updating snapshots
 * When an intentional structural change is made, regenerate the baselines:
 *
 *   cd tests
 *   npm run test:update-snapshots
 *
 * Or with the Playwright CLI directly:
 *
 *   npx playwright test payment-history-snapshot --update-snapshots
 *
 * Commit the updated `.txt` snapshot files alongside your code change.
 * See CONTRIBUTING.md §Snapshot Tests for the full update workflow.
 */

import { test, expect, Page } from "@playwright/test";

const PAGE_URL = "/payment-history.html";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Inject deterministic mock data so the page renders with fixed content and
 * does not attempt live RPC calls. This keeps snapshots reproducible.
 */
async function injectDemoMock(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Prevent live Soroban / Horizon requests
    (window as any).LUMENFLOW_CONTRACT_ID = "";
    (window as any).LUMENFLOW_MOCK_MODE = true;

    // Fixed epoch: 2026-01-15T10:00:00Z
    const FIXED_TS = 1736935200;

    // Override Date.now so relative timestamps are stable
    const OrigDate = Date;
    (window as any).Date = class extends OrigDate {
      constructor(...args: ConstructorParameters<typeof Date>) {
        // @ts-ignore
        super(...args);
      }
      static now() {
        return FIXED_TS * 1000;
      }
    };
  });
}

/**
 * Normalise the inner HTML of an element before snapshotting:
 *  - Strip inline timestamp values that change between renders
 *  - Strip dynamic data-* attributes
 *  - Collapse consecutive whitespace for readability
 */
function normalise(html: string): string {
  return html
    // Remove dynamic data attributes (e.g. data-cursor="ORDER_005")
    .replace(/data-cursor="[^"]*"/g, 'data-cursor="[cursor]"')
    // Remove ISO date strings so time-dependent values don't break snapshots
    .replace(
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g,
      "[datetime]"
    )
    // Normalise Unix timestamps embedded in data attributes
    .replace(/data-ts="\d+"/g, 'data-ts="[ts]"')
    // Collapse extra whitespace and trim
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

test.beforeEach(async ({ page }) => {
  await injectDemoMock(page);
  await page.goto(PAGE_URL);
  // Wait for the JS to render demo-mode rows (no network required)
  await page.waitForLoadState("domcontentloaded");
  // Allow the payment-history.js init cycle to complete
  await page.waitForTimeout(400);
});

// ── 1. Payment history table structure ───────────────────────────────────────

test("snapshot: payment history table structure", async ({ page }) => {
  // Wait for the skeleton loaders to be replaced by real rows
  await page.waitForFunction(() => {
    const tbody = document.querySelector<HTMLElement>("#table-body");
    if (!tbody) return false;
    // Either rows are present or the empty-state is shown
    const rows = tbody.querySelectorAll("tr:not(.skeleton-row)");
    const emptyState = document.querySelector<HTMLElement>("#empty-state");
    return rows.length > 0 || (emptyState && emptyState.style.display !== "none");
  }, { timeout: 10_000 });

  const tableHtml = await page.evaluate(() => {
    const table = document.querySelector("#history-table");
    return table ? table.outerHTML : "";
  });

  expect(tableHtml).toBeTruthy();
  const snapshot = normalise(tableHtml);
  expect(snapshot).toMatchSnapshot("payment-history-table.txt");
});

// ── 2. Table header columns ───────────────────────────────────────────────────

test("snapshot: payment history table header columns", async ({ page }) => {
  const headersHtml = await page.evaluate(() => {
    const thead = document.querySelector("#history-table thead");
    return thead ? thead.outerHTML : "";
  });

  expect(headersHtml).toBeTruthy();
  const snapshot = normalise(headersHtml);
  expect(snapshot).toMatchSnapshot("payment-history-table-headers.txt");
});

// ── 3. Filter controls structure ─────────────────────────────────────────────

test("snapshot: filter controls structure", async ({ page }) => {
  // The payment-history.html page uses a toolbar div for filter controls
  const filterHtml = await page.evaluate(() => {
    // Try .filter-panel first (history.html), then .toolbar (payment-history.html)
    const panel =
      document.querySelector(".filter-panel") ??
      document.querySelector('[role="search"]') ??
      document.querySelector(".toolbar");
    return panel ? panel.outerHTML : "";
  });

  expect(filterHtml).toBeTruthy();
  const snapshot = normalise(filterHtml);
  expect(snapshot).toMatchSnapshot("payment-history-filter-controls.txt");
});

// ── 4. Pagination controls structure ─────────────────────────────────────────

test("snapshot: pagination controls structure", async ({ page }) => {
  const paginationHtml = await page.evaluate(() => {
    const nav = document.querySelector(".pagination");
    return nav ? nav.outerHTML : "";
  });

  expect(paginationHtml).toBeTruthy();
  const snapshot = normalise(paginationHtml);
  expect(snapshot).toMatchSnapshot("payment-history-pagination.txt");
});

// ── 5. Full page structural landmark snapshot ─────────────────────────────────

test("snapshot: full page DOM skeleton (landmarks only)", async ({ page }) => {
  /**
   * Capture only the structural skeleton — element tags, IDs, and ARIA roles —
   * not the dynamic text content. This keeps the snapshot small and stable
   * while still catching structural regressions (missing sections, renamed IDs).
   */
  const skeleton = await page.evaluate((): string => {
    function walkSkeleton(el: Element, depth: number): string {
      const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "LINK", "META"]);
      if (SKIP_TAGS.has(el.tagName)) return "";

      const indent = "  ".repeat(depth);
      const id = el.id ? ` id="${el.id}"` : "";
      const role = el.getAttribute("role")
        ? ` role="${el.getAttribute("role")}"`
        : "";
      const ariaLabel = el.getAttribute("aria-label")
        ? ` aria-label="${el.getAttribute("aria-label")}"`
        : "";
      const tag = el.tagName.toLowerCase();

      let out = `${indent}<${tag}${id}${role}${ariaLabel}>\n`;

      // Recurse only into structural elements, not deep into data rows
      const STRUCTURAL = new Set([
        "MAIN",
        "NAV",
        "HEADER",
        "FOOTER",
        "SECTION",
        "ARTICLE",
        "ASIDE",
        "FORM",
        "TABLE",
        "THEAD",
        "TBODY",
        "TFOOT",
        "TR",
        "DIV",
        "UL",
        "OL",
      ]);

      if (STRUCTURAL.has(el.tagName) && depth < 6) {
        for (const child of Array.from(el.children)) {
          out += walkSkeleton(child, depth + 1);
        }
      }

      out += `${indent}</${tag}>\n`;
      return out;
    }

    return walkSkeleton(document.body, 0);
  });

  expect(skeleton).toBeTruthy();
  expect(skeleton).toMatchSnapshot("payment-history-page-skeleton.txt");
});

// ── 6. Table body has rows (structural, not content) ─────────────────────────

test("structural: table body contains payment rows after load", async ({
  page,
}) => {
  await page.waitForFunction(() => {
    const tbody = document.querySelector("#table-body");
    if (!tbody) return false;
    const rows = tbody.querySelectorAll("tr:not(.skeleton-row)");
    const emptyState = document.querySelector<HTMLElement>("#empty-state");
    return (
      rows.length > 0 ||
      (emptyState !== null && emptyState.style.display !== "none")
    );
  }, { timeout: 10_000 });

  const rowCount = await page.evaluate(() => {
    const rows = document.querySelectorAll(
      "#table-body tr:not(.skeleton-row)"
    );
    return rows.length;
  });

  // In demo mode we always get at least one row
  expect(rowCount).toBeGreaterThan(0);
});

// ── 7. Table header count regression guard ────────────────────────────────────

test("structural: table has exactly 5 header columns", async ({ page }) => {
  const headerCount = await page.evaluate(() => {
    return document.querySelectorAll("#history-table thead th").length;
  });
  expect(headerCount).toBe(5);
});

// ── 8. Filter control IDs presence ───────────────────────────────────────────

test("structural: required filter control elements are present", async ({
  page,
}) => {
  // These IDs must exist — removing or renaming them is a breaking structural change
  const requiredIds = ["search", "status-filter"];
  for (const id of requiredIds) {
    const exists = await page.evaluate(
      (elemId) => document.getElementById(elemId) !== null,
      id
    );
    expect(exists, `Expected element with id="${id}" to exist`).toBe(true);
  }
});

// ── 9. Pagination control IDs presence ───────────────────────────────────────

test("structural: required pagination control elements are present", async ({
  page,
}) => {
  const requiredIds = ["prev-btn", "next-btn", "page-info"];
  for (const id of requiredIds) {
    const exists = await page.evaluate(
      (elemId) => document.getElementById(elemId) !== null,
      id
    );
    expect(exists, `Expected element with id="${id}" to exist`).toBe(true);
  }
});

// ── 10. State elements are present (hidden by default) ───────────────────────

test("structural: empty-state and error-state elements are present", async ({
  page,
}) => {
  for (const id of ["empty-state", "error-state"]) {
    const exists = await page.evaluate(
      (elemId) => document.getElementById(elemId) !== null,
      id
    );
    expect(
      exists,
      `Expected element with id="${id}" to be present in the DOM`
    ).toBe(true);
  }
});
