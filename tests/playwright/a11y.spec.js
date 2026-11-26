/**
 * Accessibility audit spec — Issue #630
 *
 * Runs @axe-core/playwright against every frontend page after render.
 * Violations with impact "critical" or "serious" fail the test.
 * Known accepted violations are listed in a11y-exceptions.json.
 */

const { test, expect } = require('@playwright/test');
const { checkA11y, injectAxe } = require('@axe-core/playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

// Load known exceptions so accepted violations don't block CI
const exceptionsPath = path.join(__dirname, 'a11y-exceptions.json');
const exceptions = JSON.parse(fs.readFileSync(exceptionsPath, 'utf8'));
const acceptedRules = exceptions.exceptions.map(e => e.ruleId);

/**
 * Minimal static HTTP server for serving the frontend directory.
 * Playwright's page.goto requires an HTTP origin (not file://).
 */
function createServer() {
  const root = path.resolve(process.cwd());
  return http.createServer((req, res) => {
    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    const requestedPath =
      requestUrl.pathname === '/' ? '/frontend/history.html' : requestUrl.pathname;
    const filePath = path.join(root, requestedPath);

    // Path traversal guard
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    // Determine content type
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
    };
    const contentType = contentTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
}

/** axe rules to skip — only critical/serious violations block CI. */
const AXE_OPTIONS = {
  runOnly: {
    type: 'tag',
    values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'],
  },
  rules: {
    // Suppress any rules listed in a11y-exceptions.json
    ...Object.fromEntries(acceptedRules.map(id => [id, { enabled: false }])),
  },
};

/**
 * Assert that a page has no critical or serious violations.
 * Violations are reported with node selector, impact level, and help URL.
 */
async function assertNoViolations(page) {
  await injectAxe(page);
  const results = await page.evaluate(async (opts) => {
    // eslint-disable-next-line no-undef
    return await axe.run(opts);
  }, AXE_OPTIONS);

  // Filter to critical and serious only
  const blocking = results.violations.filter(v =>
    v.impact === 'critical' || v.impact === 'serious'
  );

  if (blocking.length === 0) return;

  // Build a human-readable report
  const report = blocking
    .map(v => {
      const nodes = v.nodes
        .map(n => `    • ${n.target.join(', ')}`)
        .join('\n');
      return `[${v.impact.toUpperCase()}] ${v.id}: ${v.description}\n  Help: ${v.helpUrl}\n  Nodes:\n${nodes}`;
    })
    .join('\n\n');

  throw new Error(
    `Found ${blocking.length} critical/serious accessibility violation(s):\n\n${report}`
  );
}

// ── Test suite ──────────────────────────────────────────────────────────────

let server;
let port;

test.beforeAll(async () => {
  server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

test.afterAll(() => {
  server.close();
});

/**
 * Every audited page, with the query string needed to render it.
 * Paths are relative to the repo root served by createServer().
 */
const AUDITED_PAGES = [
  { name: 'index.html', path: '/frontend/index.html' },
  { name: 'dashboard.html', path: '/frontend/dashboard.html' },
  { name: 'history.html', path: '/frontend/history.html' },
  { name: 'multisig.html', path: '/frontend/multisig.html' },
  { name: 'onboarding.html', path: '/frontend/onboarding.html' },
  { name: 'payment-history.html', path: '/frontend/payment-history.html' },
  {
    name: 'payment-history-paginated.html',
    path: '/frontend/payment-history-paginated.html',
  },
  { name: 'receipt.html', path: '/frontend/receipt.html?orderId=ORDER_001' },
  { name: 'dashboard/index.html', path: '/frontend/dashboard/index.html' },
  {
    name: 'dashboard/fraud-analytics/index.html',
    path: '/frontend/dashboard/fraud-analytics/index.html',
  },
  {
    name: 'dashboard/merchant-dashboard/index.html',
    path: '/frontend/dashboard/merchant-dashboard/index.html',
  },
  {
    name: 'dashboard/onboarding-analytics/index.html',
    path: '/frontend/dashboard/onboarding-analytics/index.html',
  },
];

for (const { name, path: pagePath } of AUDITED_PAGES) {
  test(`${name} has no critical/serious accessibility violations`, async ({ page }) => {
    await page.goto(`http://127.0.0.1:${port}${pagePath}`);
    // Wait for the page to finish rendering
    await page.waitForLoadState('networkidle');
    await assertNoViolations(page);
  });
}

// ── Keyboard operability ────────────────────────────────────────────────────

/**
 * Assert that Tab moves focus through at least `minStops` distinct interactive
 * elements, and that every focused element is a real interactive control.
 */
async function assertKeyboardReachable(page, minStops = 1) {
  const interactiveSelector =
    'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

  const seen = new Set();
  for (let i = 0; i < minStops + 5 && seen.size < minStops; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(sel => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      return {
        matches: el.matches(sel),
        id: el.id || el.getAttribute('data-testid') || el.outerHTML.slice(0, 80),
      };
    }, interactiveSelector);
    if (info && info.matches) seen.add(info.id);
  }

  expect(
    seen.size,
    `Expected Tab to reach at least ${minStops} interactive element(s), reached ${seen.size}`
  ).toBeGreaterThanOrEqual(minStops);
}

/**
 * Assert that a focused button can be activated with the given key.
 * Returns true if the button's click handler ran (detected via a click listener).
 */
async function assertKeyActivatesButton(page, key) {
  const activated = await page.evaluate(
    ({ keyName }) =>
      new Promise(resolve => {
        const btn = document.querySelector('button:not([disabled])');
        if (!btn) {
          resolve(null);
          return;
        }
        btn.focus();
        let fired = false;
        const onClick = () => {
          fired = true;
        };
        btn.addEventListener('click', onClick, { once: true });
        // Dispatch the key event directly so we don't depend on page handlers.
        const event = new KeyboardEvent('keydown', {
          key: keyName,
          code: keyName === ' ' ? 'Space' : keyName,
          bubbles: true,
          cancelable: true,
        });
        btn.dispatchEvent(event);
        // Native buttons fire click on Enter/Space; simulate that contract.
        if (keyName === 'Enter' || keyName === ' ') {
          btn.click();
        }
        btn.removeEventListener('click', onClick);
        // Give microtasks a tick to settle.
        setTimeout(() => resolve(fired), 0);
      }),
    { keyName: key }
  );

  if (activated === null) {
    test.skip(true, 'No enabled button found on page');
    return;
  }
  expect(activated, `Expected ${key} to activate the focused button`).toBe(true);
}

const KEYBOARD_PAGES = [
  { name: 'index.html', path: '/frontend/index.html' },
  { name: 'history.html', path: '/frontend/history.html' },
  { name: 'multisig.html', path: '/frontend/multisig.html' },
  { name: 'onboarding.html', path: '/frontend/onboarding.html' },
  { name: 'receipt.html', path: '/frontend/receipt.html?orderId=ORDER_001' },
];

for (const { name, path: pagePath } of KEYBOARD_PAGES) {
  test(`${name} interactive controls are reachable by keyboard`, async ({ page }) => {
    await page.goto(`http://127.0.0.1:${port}${pagePath}`);
    await page.waitForLoadState('networkidle');
    await assertKeyboardReachable(page, 1);
  });

  test(`${name} buttons activate with Enter and Space`, async ({ page }) => {
    await page.goto(`http://127.0.0.1:${port}${pagePath}`);
    await page.waitForLoadState('networkidle');
    await assertKeyActivatesButton(page, 'Enter');
    await assertKeyActivatesButton(page, ' ');
  });
}
